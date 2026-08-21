# 作品记忆三级摘要 + 记忆查看器（P1）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AI 建立「作品记忆」——已定稿章节按 15 章/分卷聚合为 .md 记忆文件（章节级 → 分卷级 → 全书状态三级），定稿后自动生成、失效自动标记，M2 记忆注入 system 提示词，项目结构侧栏提供记忆查看器。

**Architecture:** 存储：`{project}/.vela/memory/*.md`（章节级 `chapters-{start}-{end}.md` 15 章滚动按分卷边界对齐、分卷级 `volume-{n}.md`、全书 `book-state.md`），YAML frontmatter 承载 `status: stale` 失效标记。生成：章节摘要挂定稿后处理 DAG 新步骤（非关键，content_audit 同模式）；分卷/全书摘要经检查点触发或查看器手动重建。失效：重定稿/章节增删/卷成员变更 → 受影响区间文件标记 stale（与重定稿共用同一条失效规则）。注入：`buildAgentSystemSegments` 的 memory 段扩展 M2 节（预算 800，节选 book-state 精要 + 当前分卷 + 最近章节；完整文件走 read_file 按需读取）。查看器：ProjectTree 新增记忆组（文件列表 + 内容查看 + 手动重建 + stale 徽标）。

**Tech Stack:** Electron 41 + React 19 + TypeScript 6 + Zustand + Vitest。复用：`estimateTokens`/`truncateToTokenBudget`（token-budget.ts）、`buildAgentSystemSegments`（context-builder.ts，P0 已拆 memory 段）、`getCurrentProjectPath`（database.ts）、`getModelForPurpose('summarize')`（llm-store，budget 路由）、定稿 DAG `buildFinalizePostProcessSteps`（finalize-chapter.command.ts）。

**Spec:** [docs/2026-08-21-ccr-memory-design.md](2026-08-21-ccr-memory-design.md) §5（作品记忆三级摘要 + 记忆查看器）+ §3 注入顺序 + §8 风险表

## Global Constraints

- 聚合粒度：**章节级 → 分卷级 → 全书状态**三级；「十几章一个文件」是聚合产物粒度（存储主档仍是 chapter 级 DB 行 + volumes 表）
- 章节摘要：15 章滚动，**优先按分卷边界对齐**（有分卷按分卷、无分卷按 15 章）；分卷摘要仅在分卷定稿/检查点重建，**绝不在每轮对话生成**
- 失效规则统一：重定稿旧章 / 章节插入删除 / 卷成员变更 → 受影响区间文件 frontmatter `status: stale` 待重建（与重定稿共用一条失效规则，防边界漂移）
- M2 注入：system memory 段（M1 会话摘要 + M2 作品记忆）总预算 ≈1100 tokens（M1 300 + M2 800），节选 = book-state 精要 + 当前分卷摘要 + 最近章节摘要；**完整文件走 read_file 工具按需读取，不每轮全量注入**
- M2 生成调用：LLM budget 路由（`getModelForPurpose('summarize')`）+ 温度 0.2 + purpose 落库 `memory_summary`（区别于 'ccr_summary'/'agent'）
- 非关键步骤失败不阻断 workflow（content_audit 模式：critical: false + try/catch 容错）
- memory 目录读写：主进程 `getCurrentProjectPath()` 定位 `{project}/.vela/memory/`（SANDBOX_ROOTS 不含项目盘符——不走 fs: 沙箱通道，主进程封装专用通道），UTF-8 强制
- 质量门禁：tsc 零错误 / lint 零警告 / 测试全过（全量允许 activity-repository 1 例已知既有失败）；每任务独立 commit

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

```ts
// src/services/memory/memory-codec.ts
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

export function buildChapterSummaryFile(range: string, entries: ChapterSummaryEntry[]): string {
  const lines = [
    '---', `range: ${range}`, '---', '',
    `# 章节记忆 ${range}`,
  ]
  for (const e of entries) {
    lines.push('', `## 第 ${e.chapterNumber} 章 · ${e.title || '（无题）'}`, `- 关键事件：${e.keyEvents || '无'}`, `- 出场角色：${e.characters || '无'}`, `- 伏笔：${e.foreshadowing || '无'}`, `- 新设定：${e.newElements || '无'}`, `- 当前状态：${e.currentState || '无'}`)
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

  it('进行中卷内 → 卷起始到 15 章滚动', () => {
    // 卷 2 无上界：第 16 章起滚动 15 章
    expect(computeMemoryFileRange(20, volumes).file).toMatch(/^chapters-\d+-\d+\.md$/)
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

/** 15 章滚动窗口（无分卷/未命中时） */
const CHAPTERS_PER_FILE = 15

/** 章节 → 记忆文件：优先按分卷边界对齐（卷内章节聚合到卷起始的 15 章窗口） */
export function computeMemoryFileRange(
  chapterNumber: number,
  volumes: { volumeNumber: number; chapterStart: number; chapterEnd: number }[],
): { file: string; range: string } {
  const vol = volumes.find(v => chapterNumber >= v.chapterStart && (v.chapterEnd === 0 || chapterNumber <= v.chapterEnd))
  const start = vol ? vol.chapterStart : Math.max(1, Math.floor((chapterNumber - 1) / CHAPTERS_PER_FILE) * CHAPTERS_PER_FILE + 1)
  const end = vol ? (vol.chapterEnd === 0 ? start + CHAPTERS_PER_FILE - 1 : vol.chapterEnd) : start + CHAPTERS_PER_FILE - 1
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

/** 读现有文件 → 按章节号替换/追加 → 写回（防重定稿重复追加） */
export async function upsertChapterMemory(entry: ChapterSummaryEntry, file: string): Promise<{ file: string; success: boolean }> {
  try {
    const raw = await ipc.invoke('memory:read', file) as string | null
    const existing = parseMemoryFile(raw ?? '')
    // 用「第 N 章 ·」标题块拆分定位；命中替换、未命中追加
    const header = `## 第 ${entry.chapterNumber} 章`
    const lines = existing ? existing.body.split('\n') : []
    const idx = lines.findIndex(l => l.startsWith(header))
    const newBlock = buildChapterSummaryFile('', [entry]).split('\n').slice(2).join('\n') // 复用组装格式（去掉 frontmatter）
    const body = idx >= 0 ? [...lines.slice(0, idx), newBlock, ...lines.slice(idx).filter(l => l.startsWith('## 第') && l !== lines[idx])] : [...lines, newBlock]
    // 保留原 frontmatter（range）——从现有文件头部提取
    const fm = existing?.frontmatter ? `---\n${Object.entries(existing.frontmatter).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n` : ''
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

/** 章节文件写入后调用：卷内章节条目完整（覆盖卷范围）→ 聚合生成 volume-N.md */
export async function ensureVolumeSummary(
  volume: { volumeNumber: number; title: string; chapterStart: number; chapterEnd: number },
  chapterFile: string,
): Promise<{ file: string | null; success: boolean }> {
  try {
    const raw = await ipc.invoke('memory:read', chapterFile) as string | null
    if (!raw) return { file: null, success: false }
    const { body } = parseMemoryFile(raw) ?? { body: raw }
    // 从章节文件正文解析条目（按「## 第 N 章 ·」块）
    const entries: ChapterSummaryEntry[] = []
    const blocks = body.split('\n## 第 ')
    for (const b of blocks.slice(1)) {
      const numMatch = b.match(/^(\d+) 章/)
      if (!numMatch) continue
      const field = (label: string) => { const m = b.match(new RegExp(`${label}：([^\\n]+)`)); return m ? m[1].trim() : '' }
      entries.push({ chapterNumber: Number(numMatch[1]), title: '', keyEvents: field('关键事件'), characters: field('出场角色'), foreshadowing: field('伏笔'), newElements: field('新设定'), currentState: field('当前状态') })
    }
    // 完整性检查：卷内章节号连续覆盖（chapterStart..end，end=0 时取已录入最大）
    const end = volume.chapterEnd === 0 ? Math.max(...entries.map(e => e.chapterNumber), volume.chapterStart) : volume.chapterEnd
    const expected = Array.from({ length: end - volume.chapterStart + 1 }, (_, i) => volume.chapterStart + i)
    const has = expected.every(n => entries.some(e => e.chapterNumber === n))
    if (!has) return { file: null, success: false } // 未完整，跳过
    const file = `volume-${volume.volumeNumber}.md`
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

（`db:volume-get-all` 通道需确认存在——volume-store 已有 `db:volume-*` 4 通道（记忆：getAll/getByNumber/getByChapter/upsert/delete 5 通道）；若为 `db:volume-get-all` 直接复用，否则用 volume-store 现有 API。`useLLMStore` 已在 finalize-chapter.command.ts 或按需 import）

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
  it('重定稿章节 → 仅当前章所在记忆文件', () => {
    const files = affectedFiles(8, [{ volumeNumber: 1, chapterStart: 1, chapterEnd: 15 }])
    expect(files).toEqual([{ file: 'chapters-001-015.md', reason: 'finalize' }])
  })

  it('章节插入（10 → 11 的边界）→ 受影响文件标记', () => {
    // 章节号 10 插入使 11-15 后移——保守策略：重定稿（10）与其所在文件同区间即覆盖
    const files = affectedFiles(10, [])
    expect(files.length).toBeGreaterThanOrEqual(1)
    expect(files[0].reason).toBe('finalize')
  })

  it('卷成员变更（卷边界改）→ 涉及相邻文件', () => {
    // 简化：卷 1 结束从 15 变 12 → 12-15 章节落入新区间
    const files = affectedFiles(12, [{ volumeNumber: 1, chapterStart: 1, chapterEnd: 12 }, { volumeNumber: 2, chapterStart: 13, chapterEnd: 0 }])
    const names = files.map(f => f.file)
    expect(names).toContain('chapters-013-027.md')
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
 * 失效规则（设计 §5.2）：
 * - 重定稿旧章 → 当前章所在记忆文件 stale（定稿 DAG 内调用方在重定稿时执行）
 * - 章节插入/删除/卷成员变更 → 受影响区间（新边界所在窗口 + 旧边界窗口）stale
 * P0 保守策略：所有触发统一走「当前章所在窗口 + 相邻窗口」双文件失效，防边界漂移遗漏。
 */
export function affectedFiles(
  chapterNumber: number,
  volumes: { volumeNumber: number; chapterStart: number; chapterEnd: number }[],
): AffectedFile[] {
  const { file } = computeMemoryFileRange(chapterNumber, volumes)
  const out: AffectedFile[] = [{ file, reason: 'finalize' }]
  // 相邻窗口：下一窗口起始（15 章滚动）或下一卷起始
  const nextStart = (Math.floor(chapterNumber / 15) + 1) * 15 + 1
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

- [ ] **Step 4: 重定稿分支接入**（finalize-chapter.command.ts 重定稿路径调用 `invalidateMemoryFiles(affectedFiles(...))`——挂载点以现有重定稿流程为准；非关键，失败仅日志）

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
    const volumes = fresh.filter(f => f.kind === 'volume').sort((a, b) => b.file.localeCompare(a.file)) // 最新卷优先
    const chapters = fresh.filter(f => f.kind === 'chapters').sort((a, b) => b.file.localeCompare(a.file)) // 最近区间优先
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

- [ ] **Step 4: 手动重建**（分卷/全书重建按钮：调 `invalidateMemoryFiles` 标 stale 后提示「下次定稿/检查点自动重建」或直接触发对应生成逻辑——P1 简化：章节级重建 = 标记 stale（走定稿 DAG）；分卷/全书 = 标记 stale + 提示；真正重建链路 P2 完整化）

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
memory.summaryPrompt      zh: 请为第 {n} 章「{title}」生成章节记忆摘要。逐行输出以下六个字段（每个字段一行，格式「标签：内容」）：\n关键事件：本章核心事件（≤80 字）\n出场角色：本章出场的角色名（逗号分隔）\n伏笔：本章埋设或回收的伏笔（无则写「无」）\n新设定：本章新出现的世界观/物品/技能（无则写「无」）\n当前状态：本章结束时主角/局势状态（≤60 字）\n只输出字段行，不要多余文字。
                           en: Generate a chapter memory summary for chapter {n} "{title}". Output exactly six lines in the format "Label: content":\nKey events: core events (≤80 chars)\nCharacters: character names appearing (comma-separated)\nForeshadowing: planted or resolved (write "None" if none)\nNew elements: new worldbuilding/items/skills (write "None" if none)\nCurrent state: protagonist/situation state at chapter end (≤60 chars)\nOutput only the field lines, no extra text.
                           ru: Создайте краткую памятку главы {n} «{title}». Выведите ровно шесть строк в формате «Метка: содержимое»:\nКлючевые события: ...\nПерсонажи: ...\nСюжетные нити: ...\nНовые элементы: ...\nТекущее состояние: ...
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

Run: `pnpm run typecheck` / `pnpm run lint` / `pnpm run test`（全量；activity-repository 1 例已知既有失败允许）+ grep 核对 memory.* 引用无缺失
Expected: 零错误零警告 + 全量通过（除已知 1 例）

- [ ] **Step 3: 提交**

```bash
git add src/shared/locale-data.ts
git commit -m "feat: 作品记忆 i18n（memory.* 18 key 三语）+ 全量验证"
```

---

## 验收对照（设计 §5 + §10 P1）

| 设计验收项 | 对应任务 |
|-----------|---------|
| 定稿后 chapters-NNN-NNN.md 自动生成/增量更新 | Task 2（章节级，upsert 防重定稿重复追加） |
| 分卷定稿生成 volume-N.md（触发条件 = 卷内章节全部定稿） | Task 2（卷级聚合 ensureVolumeSummary，纯函数组装） |
| 失效规则生效（重定稿/章节增删/卷变更 → stale 标记） | Task 3 |
| M2 注入 system（预算内节选 + 工具按需读全文） | Task 4（async 版 + 800 tokens 节选 + 失败降级 M1） |
| 记忆查看器可浏览三级记忆、查看 stale、手动重建 | Task 5 |

**范围外（P2）**：全书状态 book-state.md 自动生成（P1 查看器可浏览已有文件 + 手动重建入口，低频聚合链路 P2）、跨会话复用 / 全局统计 / 手动编辑、v14 cached_tokens 迁移。
