# 作品记忆三级摘要 + 记忆查看器（P1）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AI 建立「作品记忆」——已定稿章节按 15 章/分卷聚合为 .md 记忆文件（章节级 → 分卷级 → 全书状态三级），定稿后自动生成、失效自动标记，M2 记忆注入 system 提示词，项目结构侧栏提供记忆查看器。

**Architecture:** 存储：`{project}/.vela/memory/*.md`（章节级 `chapters-{start}-{end}.md` 15 章滚动按分卷边界对齐、分卷级 `volume-{n}.md`、全书 `book-state.md`），YAML frontmatter 承载 `status: stale` 失效标记。生成：章节摘要挂定稿后处理 DAG 新步骤（非关键，content_audit 同模式）；分卷/全书摘要经检查点触发或查看器手动重建。失效：重定稿/章节增删/卷成员变更 → 受影响区间文件标记 stale（与重定稿共用同一条失效规则）。注入：`buildAgentSystemSegments` 的 memory 段扩展 M2 节（预算 800，节选 book-state 精要 + 当前分卷 + 最近章节；完整文件走 read_file 按需读取）。查看器：ProjectTree 新增记忆组（文件列表 + 内容查看 + 手动重建 + stale 徽标）。

**Tech Stack:** Electron 41 + React 19 + TypeScript 6 + Zustand + Vitest。复用：`estimateTokens`/`truncateToTokenBudget`（token-budget.ts）、`buildAgentSystemSegments`（context-builder.ts，P0 已拆 memory 段）、`getCurrentProjectPath`（database.ts）、`getModelForPurpose('summarize')`（llm-store，budget 路由）、定稿 DAG `buildFinalizePostProcessSteps`（finalize-chapter.command.ts）。

**Spec:** [docs/2026-08-21-ccr-memory-design.md](2026-08-21-ccr-memory-design.md) §5（作品记忆三级摘要 + 记忆查看器）+ §3 注入顺序 + §8 风险表

## Global Constraints

- 聚合粒度：**章节级 → 分卷级 → 全书状态**三级；「十几章一个文件」是聚合产物粒度（存储主档仍是 chapter 级 DB 行 + volumes 表）
- 章节摘要：15 章滚动，**优先按分卷边界对齐**（有分卷按分卷、无分卷按 15 章）；分卷摘要仅在分卷定稿/检查点重建，**绝不在每轮对话生成**
- ⚠️ **P1 只支持已闭合分卷**（`chapterEnd != 0`）：进行中卷（chapterEnd === 0）的章节走 15 章滚动，卷级聚合（ensureVolumeSummary）对进行中卷跳过，归 P2/手动重建
- 失效规则统一：重定稿旧章 / 卷成员变更（VolumeDialog upsert/delete 钩子）→ 受影响区间文件 frontmatter `status: stale` 待重建。章节「插入/删除」在 NovelForge 无独立操作（章节号随内容走、新建=追加、修改=重定稿）——由重定稿规则覆盖，文档化
- ⚠️ **stale 生命周期闭环（防死循环）**：`upsertChapterMemory` 写回时**清除 frontmatter status**（新摘要生成即恢复非 stale）；stale 仅表示「已标记待重建、尚未重建」的中间态。重定稿判定移入 chapter_memory 步骤内（文件已有本章条目 = 重定稿 → 覆盖生成），Task 3 不再单独挂重定稿分支
- M2 注入：system memory 段（M1 会话摘要 + M2 作品记忆）总预算 ≈1100 tokens（M1 300 + M2 800），节选 = book-state 精要 + 当前分卷摘要 + 最近章节摘要；**完整文件走 read_file 工具按需读取，不每轮全量注入**
- M2 生成调用：LLM budget 路由（`getModelForPurpose('summarize')`）+ 温度 0.2 + purpose 落库 `memory_summary`（区别于 'ccr_summary'/'agent'）
- 非关键步骤失败不阻断 workflow（content_audit 模式：critical: false + try/catch 容错）
- memory 目录读写：主进程 `getCurrentProjectPath()` 定位 `{project}/.vela/memory/`（SANDBOX_ROOTS 不含项目盘符——不走 fs: 沙箱通道，主进程封装专用通道），UTF-8 强制
- ⚠️ **memory-codec 纯函数唯一源：`electron/utils/memory-codec.ts`**（主进程直接消费，避免 electron→src 反向 import）；`src/services/memory/memory-codec.ts` re-export（`export * from '../../../electron/utils/memory-codec'`，纯函数无 electron 依赖，渲染层打包安全）
- 质量门禁：tsc 零错误 / lint 零警告 / **测试全过（559/559，activity-repository 已随 better-sqlite3 ABI 恢复修复，无豁免）**；每任务独立 commit

---

### Task 1: 主进程 memory 通道 + 文件编解码纯函数

**Files:**
- Modify: `electron/controllers/fs-controller.ts`（追加 memory handler）或新建 `electron/controllers/memory-controller.ts`（推荐新建——职责独立，同 db/kb controller 模式）
- Modify: `src/shared/ipc-channels.ts`
- Create: `src/services/memory/memory-codec.ts`（纯函数：frontmatter 解析/失效标记/摘要模板组装）
- Test: `src/services/memory/memory-codec.test.ts`

**Interfaces:**
- Produces:
  - `'memory:list': { args: []; return: { file: string; kind: 'chapters' | 'volume' | 'book'; range?: string; stale: boolean; mtime: number }[] }`
  - `'memory:read': { args: [file: string]; return: string | null }`
  - `'memory:write': { args: [file: string, content: string]; return: { success: boolean } }`
  - `'memory:mark-stale': { args: [file: string]; return: { success: boolean } }`
  - `'memory:delete': { args: [file: string]; return: { success: boolean } }`
  - `export interface MemoryFileMeta { file: string; kind: 'chapters' | 'volume' | 'book'; range?: string; stale: boolean; mtime: number }`
  - `export function parseMemoryFile(raw: string): { frontmatter: { status?: string }; body: string } | null`（损坏兼容）
  - `export function isStale(raw: string): boolean`
  - `export function markStaleFrontmatter(raw: string): string`（幂等：已有 status: stale 不重复标记）
  - `export function buildChapterSummaryFile(range: string, entries: ChapterSummaryEntry[]): string`（frontmatter + 正文组装）
  - `export interface ChapterSummaryEntry { chapterNumber: number; title: string; keyEvents: string; characters: string; foreshadowing: string; newElements: string; currentState: string }`

- [ ] **Step 1: 写失败测试（编解码纯函数）**

```ts
// src/services/memory/memory-codec.test.ts
import { describe, it, expect } from 'vitest'
import { parseMemoryFile, isStale, markStaleFrontmatter, buildChapterSummaryFile } from './memory-codec'

describe('parseMemoryFile', () => {
  it('解析 frontmatter 与正文', () => {
    const parsed = parseMemoryFile('---\nstatus: stale\n---\n正文内容')
    expect(parsed).toEqual({ frontmatter: { status: 'stale' }, body: '正文内容' })
  })

  it('无 frontmatter 视为正常（非 stale）', () => {
    const parsed = parseMemoryFile('纯正文')
    expect(parsed?.frontmatter).toEqual({})
    expect(parsed?.body).toBe('纯正文')
  })

  it('损坏内容返回 null 不抛错', () => {
    expect(parseMemoryFile('')).toBeNull()
  })
})

describe('isStale / markStaleFrontmatter', () => {
  it('status: stale 判定', () => {
    expect(isStale('---\nstatus: stale\n---\n正文')).toBe(true)
    expect(isStale('---\nstatus: ok\n---\n正文')).toBe(false)
  })

  it('markStaleFrontmatter 幂等', () => {
    const once = markStaleFrontmatter('---\nstatus: stale\n---\n正文')
    expect(markStaleFrontmatter(once)).toBe(once)
  })

  it('无 frontmatter 时追加', () => {
    const marked = markStaleFrontmatter('纯正文')
    expect(marked.startsWith('---\nstatus: stale\n---\n')).toBe(true)
  })
})

describe('buildChapterSummaryFile', () => {
  it('组装 frontmatter + 章节条目', () => {
    const content = buildChapterSummaryFile('001-015', [
      { chapterNumber: 1, title: '开局', keyEvents: '主角觉醒', characters: '苏晚晴', foreshadowing: '虚晶', newElements: '武魂', currentState: '筑基' },
    ])
    expect(content).toContain('range: 001-015')
    expect(content).toContain('第 1 章 · 开局')
    expect(content).toContain('主角觉醒')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/memory/memory-codec.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 memory-codec.ts**

⚠️ **位置定案（审阅修正）**：纯函数唯一源放 **`electron/utils/memory-codec.ts`**（主进程 memory-controller 直接 import）；`src/services/memory/memory-codec.ts` 仅 re-export：`export * from '../../../electron/utils/memory-codec'`（渲染层经 re-export 消费；纯函数无 electron 依赖，Vite 打包安全）。**测试文件放 `src/services/memory/memory-codec.test.ts`**（import 经 src re-export，验证 re-export 链路完整）。

```ts
// electron/utils/memory-codec.ts
export interface ChapterSummaryEntry {
  chapterNumber: number
  title: string
  keyEvents: string
  characters: string
  foreshadowing: string
  newElements: string
  currentState: string
}

export interface MemoryFileMeta {
  file: string
  kind: 'chapters' | 'volume' | 'book'
  range?: string
  stale: boolean
  mtime: number
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function parseMemoryFile(raw: string): { frontmatter: Record<string, string>; body: string } | null {
  if (!raw.trim()) return null
  const m = raw.match(FM_RE)
  if (!m) return { frontmatter: {}, body: raw }
  const frontmatter: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) frontmatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return { frontmatter, body: raw.slice(m[0].length) }
}

export function isStale(raw: string): boolean {
  const parsed = parseMemoryFile(raw)
  return parsed?.frontmatter.status === 'stale'
}

export function markStaleFrontmatter(raw: string): string {
  const parsed = parseMemoryFile(raw)
  if (!parsed) return '---\nstatus: stale\n---\n'
  if (parsed.frontmatter.status === 'stale') return raw // 幂等
  const fm = ['---', ...Object.entries(parsed.frontmatter).map(([k, v]) => `${k}: ${v}`), 'status: stale', '---', ''].join('\n')
  return fm + parsed.body
}

/** 单章条目块（无 frontmatter/文件标题——upsert 替换与卷聚合共用，审阅修正） */
export function buildChapterEntryBlock(e: ChapterSummaryEntry): string {
  return [
    `## 第 ${e.chapterNumber} 章 · ${e.title || '（无题）'}`,
    `- 关键事件：${e.keyEvents || '无'}`,
    `- 出场角色：${e.characters || '无'}`,
    `- 伏笔：${e.foreshadowing || '无'}`,
    `- 新设定：${e.newElements || '无'}`,
    `- 当前状态：${e.currentState || '无'}`,
  ].join('\n')
}

export function buildChapterSummaryFile(range: string, entries: ChapterSummaryEntry[]): string {
  const lines = [
    '---', `range: ${range}`, '---', '',
    `# 章节记忆 ${range}`,
  ]
  for (const e of entries) {
    lines.push('', buildChapterEntryBlock(e))
  }
  return lines.join('\n')
}
```

- [ ] **Step 4: 实现主进程 memory-controller**

```ts
// electron/controllers/memory-controller.ts
// 注册到 ipc-handlers（同其他 controller 模式）
import { ipcMain } from 'electron'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { getCurrentProjectPath } from '../database'
import { parseMemoryFile } from '../../src/services/memory/memory-codec' // 或复制到 electron/ 侧纯函数（按项目惯例选择，见下）

const memoryDir = (): string => {
  const p = getCurrentProjectPath()
  if (!p) throw new Error('no project')
  return path.join(p, '.vela', 'memory')
}

const safeFile = (file: string): string => {
  const safe = path.basename(file) // 防路径穿越
  return path.join(memoryDir(), safe)
}

export function registerMemoryController() {
  ipcMain.handle('memory:list', async (): Promise<MemoryFileMeta[]> => {
    try {
      const dir = memoryDir()
      await fsPromises.mkdir(dir, { recursive: true })
      const entries = await fsPromises.readdir(dir, { withFileTypes: true })
      const out: MemoryFileMeta[] = []
      for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith('.md')) continue
        const raw = await fsPromises.readFile(path.join(dir, e.name), 'utf-8').catch(() => '')
        const parsed = parseMemoryFile(raw)
        const kind = e.name.startsWith('chapters-') ? 'chapters' as const : e.name.startsWith('volume-') ? 'volume' as const : 'book'
        const range = kind === 'chapters' ? e.name.replace(/^chapters-(\d+)-(\d+)\.md$/, '$1-$2') : undefined
        const stat = await fsPromises.stat(path.join(dir, e.name))
        out.push({ file: e.name, kind, range, stale: parsed ? parsed.frontmatter.status === 'stale' : false, mtime: stat.mtimeMs })
      }
      return out.sort((a, b) => b.mtime - a.mtime)
    } catch { return [] }
  })

  ipcMain.handle('memory:read', async (_e, file: string): Promise<string | null> => {
    try { return await fsPromises.readFile(safeFile(file), 'utf-8') } catch { return null }
  })

  ipcMain.handle('memory:write', async (_e, file: string, content: string): Promise<{ success: boolean }> => {
    try {
      const dir = memoryDir()
      await fsPromises.mkdir(dir, { recursive: true })
      const target = safeFile(file)
      const temp = `${target}.${Date.now()}.tmp`
      await fsPromises.writeFile(temp, content, 'utf-8')
      await fsPromises.rename(temp, target)
      return { success: true }
    } catch { return { success: false } }
  })

  ipcMain.handle('memory:mark-stale', async (_e, file: string): Promise<{ success: boolean }> => {
    try {
      const target = safeFile(file)
      const raw = await fsPromises.readFile(target, 'utf-8')
      const marked = markStaleFrontmatter(raw)
      if (marked === raw) return { success: true }
      const temp = `${target}.${Date.now()}.tmp`
      await fsPromises.writeFile(temp, marked, 'utf-8')
      await fsPromises.rename(temp, target)
      return { success: true }
    } catch { return { success: false } }
  })

  ipcMain.handle('memory:delete', async (_e, file: string): Promise<{ success: boolean }> => {
    try { await fsPromises.unlink(safeFile(file)); return { success: true } }
    catch (err) { return (err as NodeJS.ErrnoException).code === 'ENOENT' ? { success: true } : { success: false } }
  })
}
```

（注意：`memory-codec` 为纯函数——按项目惯例放 `src/services/` 主进程可直接 import；若遇 CJS/ESM 边界问题，复制到 `electron/utils/memory-codec.ts` 并在 src 侧 re-export，二选一保持一致。ipc-channels.ts 追加 5 通道类型；preload 白名单前缀 `memory:` 需新增（CLAUDE.md 要求），`electron/preload.ts` 的 `ALLOWED_INVOKE_CHANNELS` 数组加 `'memory:'`）

- [ ] **Step 5: 门禁 + 提交**

Run: `pnpm run typecheck && pnpm run lint`（零错误零警告）+ `npx vitest run src/services/memory/memory-codec.test.ts`
```bash
git add electron/controllers/memory-controller.ts src/shared/ipc-channels.ts electron/preload.ts src/services/memory/
git commit -m "feat: 作品记忆文件通道（memory:* 5 通道 + frontmatter 编解码纯函数）"
```

---

### Task 2: 章节摘要生成（定稿 DAG 新步骤）

**Files:**
- Create: `src/services/memory/chapter-memory.ts`（LLM 提取 + 文件聚合逻辑）
- Test: `src/services/memory/chapter-memory.test.ts`
- Modify: `src/services/workflows/commands/finalize-chapter.command.ts`（buildFinalizePostProcessSteps 追加步骤）

**Interfaces:**
- Consumes: Task 1 `buildChapterSummaryFile`/`ChapterSummaryEntry`、`memory:write` 通道、`getModelForPurpose('summarize')`、`db:volume-get-all`（ipc-channels.ts:461 已确认）
- Produces:
  - `export function buildChapterSummaryPrompt(chapterNumber: number, chapterTitle: string, draftContent: string): string`
  - `export async function generateChapterSummary(opts: { chapterNumber: number; chapterTitle: string; draftContent: string; modelId: string }): Promise<ChapterSummaryEntry>`
  - `export function computeMemoryFileRange(chapterNumber: number, volumes: { volumeNumber: number; chapterStart: number; chapterEnd: number }[]): { file: string; range: string }`（分卷边界对齐：命中卷 → 卷范围文件；未命中 → 15 章滚动）
  - `export async function upsertChapterMemory(entry: ChapterSummaryEntry): Promise<{ file: string; success: boolean }>`（读现有文件 → 按章节号替换/追加 → 写回）
  - `export function buildVolumeSummaryFile(volume: { volumeNumber: number; title: string; chapterStart: number; chapterEnd: number }, chapterEntries: ChapterSummaryEntry[]): string`（卷级聚合——纯函数组装章节条目，无需额外 LLM 调用）
  - `export async function ensureVolumeSummary(volume: { volumeNumber: number; title: string; chapterStart: number; chapterEnd: number }, chapterFile: string): Promise<{ file: string | null; success: boolean }>`（章节文件写入后调用：若卷内章节全部有条目（章节号连续覆盖卷范围）→ 从章节文件解析条目聚合生成 `volume-{n}.md`；否则跳过——**分卷定稿触发条件 = 卷内章节全部定稿（设计留确认项，按建议定案）**）

- [ ] **Step 1: 写失败测试（纯函数部分）**

```ts
// src/services/memory/chapter-memory.test.ts
import { describe, it, expect } from 'vitest'
import { computeMemoryFileRange, buildChapterSummaryPrompt } from './chapter-memory'

describe('computeMemoryFileRange（分卷边界对齐）', () => {
  const volumes = [
    { volumeNumber: 1, chapterStart: 1, chapterEnd: 15 },
    { volumeNumber: 2, chapterStart: 16, chapterEnd: 0 }, // 0 = 进行中
  ]

  it('命中分卷 → 卷范围文件', () => {
    expect(computeMemoryFileRange(8, volumes)).toEqual({ file: 'chapters-001-015.md', range: '001-015' })
  })

  it('进行中卷内 → 15 章滚动（章节号恒在范围内）', () => {
    // 卷 2 无上界：第 20 章 → 16-30 窗口
    expect(computeMemoryFileRange(20, volumes).file).toBe('chapters-016-030.md')
  })

  it('进行中卷超过 15 章 → 窗口随章节号滚动（审阅修正：不映射到卷起始固定窗口外）', () => {
    // 第 31 章（进行中卷从 16 起）→ 31-45 窗口，章节号恒在范围内
    expect(computeMemoryFileRange(31, volumes).file).toBe('chapters-031-045.md')
    expect(computeMemoryFileRange(45, volumes).file).toBe('chapters-031-045.md')
    expect(computeMemoryFileRange(46, volumes).file).toBe('chapters-046-060.md')
  })

  it('无分卷 → 15 章滚动对齐', () => {
    const r = computeMemoryFileRange(37, [])
    expect(r.file).toBe('chapters-031-045.md')
  })
})

describe('buildChapterSummaryPrompt', () => {
  it('包含章节号/标题/正文与输出字段要求', () => {
    const p = buildChapterSummaryPrompt(1, '开局', '正文内容')
    expect(p).toContain('第 1 章')
    expect(p).toContain('开局')
    expect(p).toContain('正文内容')
    expect(p).toContain('关键事件')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/memory/chapter-memory.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// src/services/memory/chapter-memory.ts
import { t } from '../../shared/locale'
import { useLLMStore } from '../../stores/llm-store'
import { ipc } from '../ipc-client'
import { buildChapterSummaryFile, type ChapterSummaryEntry } from './memory-codec'

/** 15 章滚动窗口（无分卷/未命中/进行中卷时） */
const CHAPTERS_PER_FILE = 15

/**
 * 章节 → 记忆文件：优先按分卷边界对齐。
 * 已闭合卷（chapterEnd != 0）→ 卷起始窗口（start = 卷起始，end = 卷结束）；
 * 未命中卷或进行中卷（chapterEnd === 0）→ 15 章滚动窗口（start 从章节号反推，保证章节号恒在 [start, end] 内——审阅修正：进行中卷超 15 章后不再映射到卷起始固定窗口外）。
 */
export function computeMemoryFileRange(
  chapterNumber: number,
  volumes: { volumeNumber: number; chapterStart: number; chapterEnd: number }[],
): { file: string; range: string } {
  const vol = volumes.find(v => chapterNumber >= v.chapterStart && (v.chapterEnd === 0 || chapterNumber <= v.chapterEnd))
  let start: number
  let end: number
  if (vol && vol.chapterEnd !== 0) {
    start = vol.chapterStart
    end = vol.chapterEnd
  } else {
    // 滚动窗口：start 反推使 chapterNumber ∈ [start, start+14]
    start = Math.max(1, Math.floor((chapterNumber - 1) / CHAPTERS_PER_FILE) * CHAPTERS_PER_FILE + 1)
    end = start + CHAPTERS_PER_FILE - 1
  }
  const pad = (n: number) => String(n).padStart(3, '0')
  return { file: `chapters-${pad(start)}-${pad(end)}.md`, range: `${pad(start)}-${pad(end)}` }
}

/** 章节摘要 prompt（budget 路由 + 温度 0.2；输出为六字段清单） */
export function buildChapterSummaryPrompt(chapterNumber: number, chapterTitle: string, draftContent: string): string {
  return [
    t('memory.summaryPrompt').replace('{n}', String(chapterNumber)).replace('{title}', chapterTitle),
    '',
    t('memory.draftLabel'),
    draftContent,
  ].join('\n')
}

/** 调用 LLM 生成章节摘要（budget 路由；失败 throw 由 DAG 步骤容错） */
export async function generateChapterSummary(opts: {
  chapterNumber: number
  chapterTitle: string
  draftContent: string
  modelId: string
}): Promise<ChapterSummaryEntry> {
  const prompt = buildChapterSummaryPrompt(opts.chapterNumber, opts.chapterTitle, opts.draftContent)
  const mid = useLLMStore.getState().getModelForPurpose('summarize') ?? opts.modelId
  const startTime = Date.now()
  const response = await useLLMStore.getState().generate([{ role: 'user', content: prompt }], mid, { temperature: 0.2, priority: 12 })
  const duration = Date.now() - startTime
  if (!response.success) throw new Error(response.error ?? 'memory summary failed')
  try {
    await ipc.invoke('db:log-llm-call', {
      model_id: mid,
      model_name: useLLMStore.getState().models.find(m => m.id === mid)?.name ?? '',
      purpose: 'memory_summary',
      prompt_tokens: 0, completion_tokens: 0, total_tokens: 0,
      duration_ms: duration, success: 1, error_message: '', cost: 0,
    })
  } catch { /* 日志失败不影响主流程 */ }
  // 六字段解析：LLM 输出以「关键事件：」等六行格式（prompt 已约束）；解析失败字段降级 '无'
  const text = response.content
  const field = (label: string) => {
    const m = text.match(new RegExp(`${label}[：:]([^\\n]+)`))
    return m ? m[1].trim() : ''
  }
  return {
    chapterNumber: opts.chapterNumber,
    title: opts.chapterTitle,
    keyEvents: field('关键事件'),
    characters: field('出场角色'),
    foreshadowing: field('伏笔'),
    newElements: field('新设定'),
    currentState: field('当前状态'),
  }
}

/**
 * 读现有文件 → 按章节号替换/追加 → 写回。
 * 审阅修正（Bug 1/2/5）：
 * - 块边界 = [idx, nextIdx)：按下一个「## 第」标题定位，只替换该区间——不再用 filter 误删后续章节字段行
 * - 写回时清除 frontmatter status（stale 生命周期闭环：新摘要生成即恢复非 stale，防重定稿后 M2 永久过滤）
 * - 单章块用 buildChapterEntryBlock（无 frontmatter/标题残留）
 * - 重定稿判定（文件已有本章条目 = 重定稿）由调用方在 DAG 步骤内完成（覆盖生成即清除 stale）
 */
export async function upsertChapterMemory(entry: ChapterSummaryEntry, file: string): Promise<{ file: string; success: boolean }> {
  try {
    const raw = await ipc.invoke('memory:read', file) as string | null
    const existing = parseMemoryFile(raw ?? '')
    const header = `## 第 ${entry.chapterNumber} 章`
    const lines = existing ? existing.body.split('\n') : []
    const idx = lines.findIndex(l => l.startsWith(header))
    const newBlock = buildChapterEntryBlock(entry)
    let body: string[]
    if (idx >= 0) {
      // 块边界：下一个「## 第」标题
      let nextIdx = lines.length
      for (let i = idx + 1; i < lines.length; i++) {
        if (lines[i].startsWith('## 第')) { nextIdx = i; break }
      }
      body = [...lines.slice(0, idx), newBlock, ...lines.slice(nextIdx)]
    } else {
      body = [...lines, '', newBlock]
    }
    // frontmatter：保留 range 等字段，**清除 status**（stale 闭环）
    const fmEntries = Object.entries(existing?.frontmatter ?? {}).filter(([k]) => k !== 'status')
    const fm = fmEntries.length > 0 ? `---\n${fmEntries.map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n` : ''
    await ipc.invoke('memory:write', file, `${fm}${body.join('\n')}`)
    return { file, success: true }
  } catch {
    return { file, success: false }
  }
}
```

（`parseMemoryFile` 从 Task 1 import；六字段解析的 LLM 输出格式约束写在 `memory.summaryPrompt` i18n 文案中——zh 模板要求「逐行输出 关键事件：/ 出场角色：/ 伏笔：/ 新设定：/ 当前状态：」）

- [ ] **Step 3.5: 卷级聚合实现（Task 2 内追加——分卷定稿触发条件 = 卷内章节全部定稿）**

```ts
/** 卷级摘要文件：纯函数组装（卷头 + 卷内章节条目），不额外 LLM */
export function buildVolumeSummaryFile(
  volume: { volumeNumber: number; title: string; chapterStart: number; chapterEnd: number },
  chapterEntries: ChapterSummaryEntry[],
): string {
  const end = volume.chapterEnd === 0 ? chapterEntries[chapterEntries.length - 1]?.chapterNumber ?? volume.chapterStart : volume.chapterEnd
  const lines = [
    '---', `volume: ${volume.volumeNumber}`, `range: ${volume.chapterStart}-${end}`, '---', '',
    `# 第 ${volume.volumeNumber} 卷 · ${volume.title || '（无题）'}`,
  ]
  for (const e of chapterEntries) {
    lines.push('', `## 第 ${e.chapterNumber} 章 · ${e.title || '（无题）'}`, `- 关键事件：${e.keyEvents || '无'}`, `- 出场角色：${e.characters || '无'}`, `- 伏笔：${e.foreshadowing || '无'}`, `- 新设定：${e.newElements || '无'}`, `- 当前状态：${e.currentState || '无'}`)
  }
  return lines.join('\n')
}

/** 章节文件写入后调用：**仅已闭合卷（chapterEnd != 0）**——卷内章节条目完整（覆盖卷范围）→ 聚合生成 volume-N.md；进行中卷跳过（归 P2/手动重建，审阅修正） */
export async function ensureVolumeSummary(
  volume: { volumeNumber: number; title: string; chapterStart: number; chapterEnd: number },
  chapterFile: string,
): Promise<{ file: string | null; success: boolean }> {
  if (volume.chapterEnd === 0) return { file: null, success: false } // 进行中卷：不支持
  try {
    const raw = await ipc.invoke('memory:read', chapterFile) as string | null
    if (!raw) return { file: null, success: false }
    const { body } = parseMemoryFile(raw) ?? { body: raw }
    // 从章节文件正文解析条目（按「## 第 N 章 ·」块；标题从块头分离——审阅修正）
    const entries: ChapterSummaryEntry[] = []
    const blocks = body.split('\n## 第 ')
    for (const b of blocks.slice(1)) {
      const numMatch = b.match(/^(\d+) 章 · (.+)/)
      if (!numMatch) continue
      const field = (label: string) => { const m = b.match(new RegExp(`${label}：([^\\n]+)`)); return m ? m[1].trim() : '' }
      entries.push({ chapterNumber: Number(numMatch[1]), title: numMatch[2].trim(), keyEvents: field('关键事件'), characters: field('出场角色'), foreshadowing: field('伏笔'), newElements: field('新设定'), currentState: field('当前状态') })
    }
    // 完整性检查：卷内章节号连续覆盖（chapterStart..chapterEnd）
    const expected = Array.from({ length: volume.chapterEnd - volume.chapterStart + 1 }, (_, i) => volume.chapterStart + i)
    const has = expected.every(n => entries.some(e => e.chapterNumber === n))
    if (!has) return { file: null, success: false } // 未完整，跳过
    const file = `volume-${String(volume.volumeNumber).padStart(3, '0')}.md` // 零填充防字典序错排（审阅修正）
    await ipc.invoke('memory:write', file, buildVolumeSummaryFile(volume, entries))
    return { file, success: true }
  } catch {
    return { file: null, success: false }
  }
}
```

（在 `upsertChapterMemory` 成功后调用：`const vol = volumes.find(v => v.volumeNumber === entry.chapterNumber 所在卷)；if (vol) await ensureVolumeSummary(vol, file)`——挂在 DAG 步骤 executor 内，非关键容错）

- [ ] **Step 4: DAG 步骤接入（finalize-chapter.command.ts）**

在 `buildFinalizePostProcessSteps` 的 content_audit 步骤之后追加（非关键，dependsOn kb_import，try/catch 容错）：

```ts
  // ─── 步骤: 章节记忆摘要（P1 作品记忆——非关键：失败不影响定稿） ──────
  steps.push({
    key: 'chapter_memory',
    label: t('workflow.chapterMemory'),
    critical: false,
    dependsOn: ['kb_import'],
    executor: async (callbacks: StepCallbacks) => {
      try {
        const { generateChapterSummary, computeMemoryFileRange, upsertChapterMemory } = await import('../../memory/chapter-memory')
        const volumes = (await ipc.invoke('db:volume-get-all')) as { volumeNumber: number; chapterStart: number; chapterEnd: number }[]
        const { file } = computeMemoryFileRange(chapterNumber, volumes)
        const modelId = useLLMStore.getState().defaultModelId ?? ''
        const entry = await generateChapterSummary({ chapterNumber, chapterTitle, draftContent, modelId })
        const result = await upsertChapterMemory(entry, file)
        if (result.success) {
          callbacks.log(t('log.finalize.memoryDone').replace('{file}', file))
        } else {
          callbacks.log(t('log.finalize.memoryFailed'))
        }
      } catch (e) {
        callbacks.log(t('log.finalize.memoryFailed').replace('{error}', () => String(e)))
      }
    },
  })
```

（`db:volume-get-all` 已确认（ipc-channels.ts:461）；`useLLMStore` 按需 import。**重定稿一次完成语义**：upsert 写回已清除 frontmatter status（stale 闭环）——文件已有本章条目时覆盖生成即恢复非 stale，无需在 DAG 内先标 stale 再生成；Task 3 不挂重定稿分支）

- [ ] **Step 5: 门禁 + 提交**

Run: `npx vitest run src/services/memory/` + `pnpm run typecheck && pnpm run lint`
```bash
git add src/services/memory/ src/services/workflows/commands/finalize-chapter.command.ts
git commit -m "feat: 章节记忆摘要生成（定稿 DAG 新步骤 + 分卷边界对齐 + upsert 防重复）"
```

---

### Task 3: 失效规则（重定稿/章节增删/卷变更 → stale）

**Files:**
- Create: `src/services/memory/memory-invalidation.ts`（失效判定纯函数）
- Test: `src/services/memory/memory-invalidation.test.ts`
- Modify: `src/services/workflows/commands/finalize-chapter.command.ts`（重定稿分支）——或按实现确认挂载点

**Interfaces:**
- Consumes: Task 1 `isStale`/`markStaleFrontmatter`、`computeMemoryFileRange`
- Produces:
  - `export function affectedFiles(chapterNumber: number, volumes: { volumeNumber: number; chapterStart: number; chapterEnd: number }[]): { file: string; reason: 'finalize' | 'chapter-add' | 'volume-change' }[]`（返回受影响区间文件——当前章所在文件 + 卷边界变更涉及的相邻文件）
  - `export async function invalidateMemoryFiles(files: string[]): Promise<number>`（逐文件 read → markStale → write，返回成功数）

- [ ] **Step 1: 写失败测试**

```ts
// src/services/memory/memory-invalidation.test.ts
import { describe, it, expect } from 'vitest'
import { affectedFiles } from './memory-invalidation'

describe('affectedFiles（失效区间）', () => {
  it('卷成员变更 → 变更卷起始窗口 + 相邻滚动窗口双失效', () => {
    const files = affectedFiles(8, [{ volumeNumber: 1, chapterStart: 1, chapterEnd: 15 }])
    const names = files.map(f => f.file)
    expect(names).toContain('chapters-001-015.md')
    expect(files.every(f => f.reason === 'volume-change')).toBe(true)
  })

  it('第 15 章 → 相邻窗口起始为 16（公式修正：15 的倍数不错位）', () => {
    const files = affectedFiles(15, [])
    const names = files.map(f => f.file)
    expect(names).toContain('chapters-001-015.md')
    expect(names).toContain('chapters-016-030.md')
  })

  it('卷边界变更（卷 1 结束 15→12）→ 涉及新边界所在窗口', () => {
    const files = affectedFiles(12, [{ volumeNumber: 1, chapterStart: 1, chapterEnd: 12 }, { volumeNumber: 2, chapterStart: 13, chapterEnd: 0 }])
    const names = files.map(f => f.file)
    expect(names).toContain('chapters-001-012.md')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/memory/memory-invalidation.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

```ts
// src/services/memory/memory-invalidation.ts
import { computeMemoryFileRange } from './chapter-memory'

export type InvalidationReason = 'finalize' | 'chapter-add' | 'volume-change'

export interface AffectedFile { file: string; reason: InvalidationReason }

/**
 * 失效规则（设计 §5.2，审阅修正）：
 * - 卷成员变更（VolumeDialog upsert/delete 钩子调用）→ 受影响区间 = 变更卷起始窗口 + 相邻滚动窗口 stale
 * - 重定稿旧章 → 不在此处处理：chapter_memory DAG 步骤内 upsert 覆盖即恢复非 stale（stale 闭环）
 * - 章节插入/删除在 NovelForge 无独立操作（新建=追加、修改=重定稿）——由重定稿规则覆盖，文档化
 * 保守策略：双窗口失效（变更卷起始窗口 + 下一滚动窗口），防边界漂移遗漏。
 */
export function affectedFiles(
  chapterNumber: number,
  volumes: { volumeNumber: number; chapterStart: number; chapterEnd: number }[],
): AffectedFile[] {
  const { file } = computeMemoryFileRange(chapterNumber, volumes)
  const out: AffectedFile[] = [{ file, reason: 'volume-change' }]
  // 相邻窗口起始（审阅修正公式：第 15 章 → 16，第 30 章 → 31）
  const nextStart = Math.floor((chapterNumber - 1) / 15) * 15 + 16
  const next = computeMemoryFileRange(nextStart, volumes)
  if (next.file !== file) out.push({ file: next.file, reason: 'volume-change' })
  return out
}

/** 批量失效：read → markStale → write（返回成功数） */
export async function invalidateMemoryFiles(files: string[]): Promise<number> {
  let ok = 0
  for (const file of files) {
    const res = await (window as unknown as { velaAPI: { invoke: (ch: string, ...a: unknown[]) => Promise<unknown> } }).velaAPI.invoke('memory:mark-stale', file)
    if ((res as { success: boolean }).success) ok++
  }
  return ok
}
```

- [ ] **Step 4: VolumeDialog 钩子接入（卷成员变更 → 失效标记）**

`src/components/dialogs/VolumeDialog.tsx`（或实际卷编辑组件——以 `db:volume-upsert`/`db:volume-delete` 调用点为锚）在 upsert/delete 成功后调用：
```ts
// 卷变更后：标记受影响区间记忆文件 stale（非关键，失败仅日志）
try {
  const { affectedFiles, invalidateMemoryFiles } = await import('../services/memory/memory-invalidation')
  const volumes = (await ipc.invoke('db:volume-get-all')) as { volumeNumber: number; chapterStart: number; chapterEnd: number }[]
  const boundary = Math.max(1, (changedVol?.chapterStart ?? 1))
  await invalidateMemoryFiles(affectedFiles(boundary, volumes).map(f => f.file))
} catch { /* 失效失败不阻断卷编辑 */ }
```
（重定稿分支不再单独挂——upsert 覆盖即清 stale，见 Global Constraints）

- [ ] **Step 5: 门禁 + 提交**

Run: `npx vitest run src/services/memory/` + 门禁
```bash
git add src/services/memory/ src/services/workflows/commands/finalize-chapter.command.ts
git commit -m "feat: 记忆文件失效规则（重定稿/边界变更 → stale 标记）"
```

---

### Task 4: M2 作品记忆注入（context-builder memory 段扩展）

**Files:**
- Modify: `src/services/agent/context-builder.ts`
- Test: `src/services/agent/context-builder.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 `memory:list`/`memory:read` 通道、Task 2 `computeMemoryFileRange`（节选定位）
- Produces: `buildAgentSystemSegments` memory 段扩展——`{ base, memory }` 的 memory 现为 M1 + M2 两节（M2 预算 800，节选 book-state 精要 + 当前分卷 + 最近章节；**同步读盘，失败降级只注入 M1**）

- [ ] **Step 1: 写失败测试**

`context-builder.test.ts` **文件顶部加 `// @vitest-environment jsdom`**（现有 5 条用例不依赖 window，jsdom 下兼容；新用例需要 window.velaAPI mock——P0 agent-store.test.ts 先例）。在文件内追加：

```ts
// 文件首行追加 pragma：// @vitest-environment jsdom
// 顶部 import 补：import { vi } from 'vitest'（现有 describe/it/expect 保留）

describe('M2 作品记忆节（P1）', () => {
  const mockInvoke = vi.fn(async (ch: string) => {
    if (ch === 'memory:list') return [{ file: 'chapters-001-015.md', kind: 'chapters', stale: false, mtime: 1 }]
    if (ch === 'memory:read') return '---\nrange: 001-015\n---\n\n## 第 1 章 · 开局\n- 关键事件：主角觉醒'
    return null
  })

  beforeEach(() => {
    Object.defineProperty(window, 'velaAPI', { value: { invoke: mockInvoke }, configurable: true })
    useAgentStore.setState({ conversations: [], activeConversationId: null })
  })

  it('有记忆文件时 memory 段含 M2 节', async () => {
    const { memory } = await buildAgentSystemSegmentsAsync('quick')
    expect(memory).toContain('作品记忆')
    expect(memory).toContain('主角觉醒')
  })

  it('读取失败降级：memory 段仅含 M1（不阻塞）', async () => {
    mockInvoke.mockResolvedValue(null)
    const { memory } = await buildAgentSystemSegmentsAsync('quick')
    expect(memory).not.toContain('作品记忆')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/agent/context-builder.test.ts`
Expected: 新用例 FAIL（buildAgentSystemSegmentsAsync 不存在）

- [ ] **Step 3: 实现**

**定稿方案（消除 async/sync 摇摆）**：`buildAgentSystemSegments` 保持同步（仅 M1——向后兼容现有测试与调用方）；新增 `buildAgentSystemSegmentsAsync`（同步版 + 异步读盘 M2，失败降级仅 M1）；新增 `buildAgentSystemPromptAsync`（async 版最终拼装 + 语言指令）；`buildAgentSystemPrompt` 保持同步（M1 only）；**sendMessage（agent-store.ts:421）改用 `await buildAgentSystemPromptAsync(currentConv.mode)`**：

```ts
// context-builder.ts 追加
const M2_BUDGET_TOKENS = 800

/** 异步版：M2 作品记忆节（memory:* 读盘，预算 800，失败降级仅 M1） */
export async function buildAgentSystemSegmentsAsync(mode: AgentMode): Promise<{ base: string; memory: string }> {
  const { base, memory: m1 } = buildAgentSystemSegments(mode)
  const memoryParts: string[] = []
  if (m1) memoryParts.push(m1)
  try {
    const list = (await ipc.invoke('memory:list')) as { file: string; kind: 'chapters' | 'volume' | 'book'; stale: boolean }[]
    const fresh = list.filter(f => !f.stale)
    const book = fresh.find(f => f.kind === 'book')
    // ⚠️ 审阅修正：volume-010.md 字典序在 volume-002.md 前——按文件名中的卷号数值排序（最新卷优先）
    const volumes = fresh.filter(f => f.kind === 'volume').sort((a, b) => {
      const n = (f: string) => Number(f.match(/volume-(\d+)\.md/)?.[1] ?? 0)
      return n(b.file) - n(a.file)
    })
    const chapters = fresh.filter(f => f.kind === 'chapters').sort((a, b) => b.file.localeCompare(a.file)) // 最近区间优先（零填充格式字典序=数值序）
    const picks = [book, ...volumes.slice(0, 1), ...chapters.slice(0, 1)].filter(Boolean) as { file: string }[]
    const sections: string[] = []
    let used = 0
    for (const p of picks) {
      if (used >= M2_BUDGET_TOKENS) break
      const raw = await ipc.invoke('memory:read', p.file) as string | null
      if (!raw) continue
      const { body } = parseMemoryFile(raw) ?? { body: raw }
      const remaining = M2_BUDGET_TOKENS - used
      const excerpt = truncateToTokenBudget(body, remaining)
      sections.push(excerpt)
      used += estimateTokens(excerpt)
    }
    if (sections.length > 0) {
      memoryParts.push(`${t('memory.injectedHeader')}\n${sections.join('\n\n')}`)
    }
  } catch {
    // M2 读盘失败降级：仅 M1
  }
  return { base, memory: memoryParts.join('\n\n---\n\n') }
}
```

（`ipc`/`parseMemoryFile` 加入 import；`buildAgentSystemPrompt` 保持同步调用 buildAgentSystemSegments；**sendMessage（agent-store.ts:421）切到 `await buildAgentSystemSegmentsAsync`**——同步→异步改造点仅此一处，调用方 await 即可）

- [ ] **Step 4: sendMessage 切异步版 + 门禁**

agent-store.ts 的 `let systemPrompt = buildAgentSystemPrompt(currentConv.mode)` 改 `let systemPrompt = await buildAgentSystemPromptAsync(currentConv.mode)`（该构造点在 async sendMessage 内，直接 await；同步版 buildAgentSystemPrompt 保留给既有测试/其他调用方——全仓 grep 确认无其他调用方后可选删，P1 保守保留）。

Run: `npx vitest run src/services/agent/` + 门禁
```bash
git add src/services/agent/context-builder.ts src/services/agent/context-builder.test.ts src/stores/agent-store.ts
git commit -m "feat: M2 作品记忆注入（async segments + 节选 800 tokens + 失败降级 M1）"
```

---

### Task 5: 记忆查看器（ProjectTree 记忆组）

**Files:**
- Create: `src/components/panels/sidebar/MemoryGroup.tsx`
- Modify: `src/components/panels/sidebar/ProjectTree.tsx`（挂载）
- Modify: `src/stores/memory-store.ts`（新建——记忆列表状态：load/refresh/rebuild）

**Interfaces:**
- Consumes: Task 1 `memory:*` 5 通道、Task 3 `invalidateMemoryFiles`（手动重建 = 标记 stale 后重新生成）
- Produces:
  - `export const useMemoryStore = create<MemoryState>()(...)`——`{ files: MemoryFileMeta[]; loading: boolean; load(): Promise<void>; refresh(): Promise<void> }`
  - `MemoryGroup` 组件：文件列表（kind 徽标 + stale 徽标「待重建」）+ 内容查看（memory:read 只读）+ 手动重建按钮（分卷/全书：调用生成逻辑；章节级：标记 stale 提示走定稿重建）

- [ ] **Step 1: memory-store（状态 + load/refresh）**

```ts
// src/stores/memory-store.ts
import { create } from 'zustand'
import { ipc } from '../services/ipc-client'
import type { MemoryFileMeta } from '../services/memory/memory-codec'

interface MemoryState {
  files: MemoryFileMeta[]
  loading: boolean
  load: () => Promise<void>
  refresh: () => Promise<void>
}

let memoryLoadSeq = 0 // loadSeq 防竞态（项目惯例）

export const useMemoryStore = create<MemoryState>()((set) => ({
  files: [],
  loading: false,
  load: async () => {
    const mySeq = ++memoryLoadSeq
    set({ loading: true })
    try {
      const files = (await ipc.invoke('memory:list')) as MemoryFileMeta[]
      if (mySeq !== memoryLoadSeq) return
      set({ files, loading: false })
    } catch {
      if (mySeq === memoryLoadSeq) set({ loading: false })
    }
  },
  refresh: async () => {
    await useMemoryStore.getState().load()
  },
}))
```

- [ ] **Step 2: MemoryGroup 组件**

仿 VolumeGroup 结构（自绘 section：标题行「AI 记忆」+ 刷新按钮 + 折叠；列表行：文件类型徽标（章节/分卷/全书）+ 文件名/范围 + stale 徽标 + 查看展开 + 重建按钮）。**必须实现的交互清单**（实现前先读 `src/components/panels/sidebar/VolumeGroup.tsx` 参照同构结构）：① 挂载时 load + 折叠状态 useState（默认展开）② 每行点击切换查看（memory:read 内容 pre-wrap 只读区，max-h 滚动）③ 刷新按钮 re-load ④ stale 徽标（`memory.stale`）⑤ 重建按钮：`memory:mark-stale` 标记后 toast（`memory.rebuildHint`）——章节级重建走下次定稿 DAG，分卷/全书同规则（P1 简化）⑥ 空态（`memory.empty`）⑦ 全部文案 t()：

```tsx
// src/components/panels/sidebar/MemoryGroup.tsx（骨架——完整实现按 VolumeGroup 同构展开）
import { useEffect, useState } from 'react'
import { useMemoryStore } from '../../../stores/memory-store'
import { ipc } from '../../../services/ipc-client'
import { t } from '../../../shared/locale'

export default function MemoryGroup() {
  const { files, loading, load, refresh } = useMemoryStore()
  const [open, setOpen] = useState(true)
  const [viewing, setViewing] = useState<string | null>(null)
  const [content, setContent] = useState('')

  useEffect(() => { load() }, [load])

  const openFile = async (file: string) => {
    if (viewing === file) { setViewing(null); return }
    setViewing(file)
    const raw = await ipc.invoke('memory:read', file) as string | null
    setContent(raw ?? '')
  }

  return (
    <div className="...">
      {/* 标题行：AI 记忆 + 数量 + 刷新 + 折叠 */}
      {/* 列表：files.map → kind 徽标（章节/分卷/全书）+ 文件名 + stale「待重建」徽标 + 点击查看 + 手动重建按钮 */}
      {/* 查看区：viewing 时只读展示 content（pre-wrap） */}
    </div>
  )
}
```

（完整 JSX 按 VolumeGroup/PublicationGroup 同构实现——Self-drawn section：muted 操作按钮 + 折叠按钮最后 + hover 行；i18n key 见 Task 6）

- [ ] **Step 3: ProjectTree 挂载**（`src/components/panels/sidebar/ProjectTree.tsx`——在 PublicationGroup 附近追加 `<MemoryGroup />`，import 加入）

- [ ] **Step 4: 手动重建（审阅修正——真实重建，非仅标 stale）**

- **卷级重建**（`volume-NNN.md` 行）：直接复用聚合逻辑——从对应章节文件（`computeMemoryFileRange` 定位卷起始窗口）解析条目 → `buildVolumeSummaryFile` 组装 → `memory:write` 覆盖（**分卷重建是纯函数聚合，无 LLM 成本**，即时完成；进行中卷 → 提示 `memory.rebuildHint` 不可重建）
- **章节级重建**（`chapters-*.md` 行）：标记 stale + toast（`memory.rebuildHint`）——章节条目来自定稿 LLM 提取，重建走下次定稿 DAG（重定稿即恢复非 stale）
- **全书重建**（`book-state.md`）：P1 无自动生成链路——仅标 stale + 提示（P2）
- 重建完成后 `refresh()` 刷新列表（stale 徽标消失）

- [ ] **Step 5: 门禁 + 提交**

Run: `pnpm run typecheck && pnpm run lint`（jsdom 组件测试可省——项目 UI 组件测试惯例少）
```bash
git add src/stores/memory-store.ts src/components/panels/sidebar/MemoryGroup.tsx src/components/panels/sidebar/ProjectTree.tsx
git commit -m "feat: 记忆查看器（侧栏 AI 记忆组 + 只读查看 + stale 徽标 + 重建入口）"
```

---

### Task 6: i18n + 全量验证

**Files:**
- Modify: `src/shared/locale-data.ts`

**Interfaces:**
- Consumes: 前 5 任务所有 t() 引用（memory.* + workflow.chapterMemory + log.finalize.memoryDone/memoryFailed）

- [ ] **Step 1: 新增 i18n key（三语）**

```
⚠️ **审阅修正（解析锚点不翻译）**：`memory.summaryPrompt` 是 LLM 输入侧模板，其字段标签（关键事件/出场角色/伏笔/新设定/当前状态）是 `generateChapterSummary` 的**解析锚点**——三语界面共用同一份 **zh 模板**（模型按 zh 标签输出、parser 按 zh 锚点解析，任何界面语言下自洽；i18n-standard「解析依赖中文键不可翻译」先例，与 P0 `ccr.summaryPrompt` 的做法一致——P0 该 key 已按三语翻译但压缩摘要无字段解析需求，此处字段解析场景必须锚点固定）。`memory.draftLabel` 等 UI 文案照常三语。

```
memory.summaryPrompt      zh/en/ru 共用（解析锚点固定中文）: 请为第 {n} 章「{title}」生成章节记忆摘要。逐行输出以下六个字段（每个字段一行，格式「标签：内容」）：\n关键事件：本章核心事件（≤80 字）\n出场角色：本章出场的角色名（逗号分隔）\n伏笔：本章埋设或回收的伏笔（无则写「无」）\n新设定：本章新出现的世界观/物品/技能（无则写「无」）\n当前状态：本章结束时主角/局势状态（≤60 字）\n只输出字段行，不要多余文字。
memory.draftLabel         zh: 本章正文：/ en: Chapter text:/ ru: Текст главы:
memory.injectedHeader     zh: ## 作品记忆（自动生成，非用户输入） / en: ## Story Memory (auto-generated, not user input) / ru: ## Память произведения (создано автоматически, не ввод пользователя)
memory.groupTitle         zh: AI 记忆 / en: AI Memory / ru: Память ИИ
memory.kindChapters       zh: 章节 / en: Chapters / ru: Главы
memory.kindVolume         zh: 分卷 / en: Volume / ru: Том
memory.kindBook           zh: 全书 / en: Book / ru: Книга
memory.stale              zh: 待重建 / en: Needs rebuild / ru: Требует пересборки
memory.rebuild            zh: 重建 / en: Rebuild / ru: Пересобрать
memory.rebuildHint        zh: 已标记待重建——下次定稿/检查点自动生成 / en: Marked for rebuild — regenerated on next finalize/checkpoint / ru: Отмечено — будет пересобрано при следующей финализации
memory.empty              zh: 暂无记忆——定稿章节后自动生成 / en: No memory yet — generated after finalizing chapters / ru: Память пока пуста — создаётся после финализации глав
workflow.chapterMemory    zh: 章节记忆 / en: Chapter Memory / ru: Память главы
log.finalize.memoryDone   zh: 📝 章节记忆已更新（{file}） / en: 📝 Chapter memory updated ({file}) / ru: 📝 Память главы обновлена ({file})
log.finalize.memoryFailed zh: ⚠️ 章节记忆生成失败 / en: ⚠️ Chapter memory generation failed / ru: ⚠️ Ошибка генерации памяти главы
```

（18 个 key 三语；`memory.summaryPrompt` 的字段标签「关键事件/出场角色/伏笔/新设定/当前状态」与 Task 2 的解析字段**必须一致**——zh 为解析锚点，en/ru 界面下字段标签随 locale 需同步解析（parseMemoryFile 侧按 locale 选标签），P1 首版以 zh 为解析锚点并文档化（同 i18n-standard「解析依赖中文键不可翻译」先例））

- [ ] **Step 2: 残留扫描 + 全量门禁**

Run: `pnpm run typecheck` / `pnpm run lint` / `pnpm run test`（全量 **559/559 全过**——activity-repository 已随 better-sqlite3 ABI 恢复修复（2026-08-21 rebuild 后实测通过），**无豁免**）+ grep 核对 memory.* 引用无缺失
Expected: 零错误零警告 + **全量全过**

（非 zh 界面解析验证：`memory.summaryPrompt` 三语共用 zh 模板——模型按 zh 标签输出，parser 按 zh 锚点解析，任何界面语言自洽；如未来需验证可加 locale 切换用例，P1 以锚点固定为设计）

- [ ] **Step 3: 提交**

```bash
git add src/shared/locale-data.ts
git commit -m "feat: 作品记忆 i18n（memory.* 18 key 三语）+ 全量验证"
```

---

## 验收对照（设计 §5 + §10 P1）

| 设计验收项 | 对应任务 |
|-----------|---------|
| 定稿后 chapters-NNN-NNN.md 自动生成/增量更新（upsert 块边界替换 + stale 闭环） | Task 2（章节级） |
| 已闭合分卷全部定稿 → 聚合生成 volume-NNN.md（触发条件 = 卷内章节全部定稿；进行中卷跳过） | Task 2（卷级聚合 ensureVolumeSummary，纯函数零 LLM） |
| 失效规则生效（重定稿覆盖即清 stale；卷成员变更 → VolumeDialog 钩子标记） | Task 2/3（章节增删无独立操作由重定稿覆盖，文档化） |
| M2 注入 system（预算内节选 + 工具按需读全文） | Task 4（async 版 + 800 tokens 节选 + 失败降级 M1） |
| 记忆查看器可浏览三级记忆、查看 stale、手动重建（卷级真实聚合重建） | Task 5 |

**范围外（P2）**：进行中卷的卷级聚合、全书状态 book-state.md 自动生成（P1 仅标 stale + 提示）、跨会话复用 / 全局统计 / 手动编辑、v14 cached_tokens 迁移。
