# 记忆分层（常驻 / 自动 / 手动）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让「哪些作品记忆每轮进上下文、哪些按需披露」成为用户可编辑的显式分层（常驻 / 自动 / 手动），并给模型一条 `read_memory` 按名/关键词取正文的通道。

**Architecture:** 记忆文件的 frontmatter 增 `load_mode`（`resident|auto|manual`，缺省 `auto`），主进程 `memory:list` 顺带回传 `loadMode` + `brief`（它本来就逐个读文件做 kind 分类，零额外 IO）。注入时 **常驻条目全文进「常驻段」（独立预算，硬上限 4000 tokens）+ 其余条目只进「名字目录段」（800 tokens，三级降级）**；目录行带 `[manual]` 标记但不含正文，正文由模型调 `read_memory` 自取，或用户在消息里 `@文件名` 显式引用（**仅本轮注入，不进会话历史**）。

**Tech Stack:** Electron 主进程（better-sqlite3 无关，纯 fs）+ React 19 + Zustand + TypeScript 6 + vitest，全部按现有 CJS / strict TS / ESLint `--max-warnings 0` 约束。

**Spec:** `docs/superpowers/specs/2026-09-26-memory-layering-design.md`（本计划依据它写成；下面两处修正**不在 spec 里**——是写计划时发现的问题，请随计划一并评审）

## ⚠️ 对 spec 的两处修正（执行前请确认）

### 修正 1：常驻段的预算口径（spec §3.2 内部矛盾）

spec 同时写了「常驻段硬上限 4000」与「常驻段参与 `assembleFinalPrompt` 的 4700 降级链」。这两条合起来是自相矛盾的：

- 系统提示词现有总上限 `TOTAL_BUDGET_TOKENS = 4700`（identity+L0+L1+Tool+技能目录 ≈ 3400 已占去大半）；
- 降级链第二步就是**整段丢弃 `memoryM2`**（`context-builder.ts:176`）；
- 于是常驻段一旦超过约 1300 tokens，就会在降级链里被**整段丢掉** —— 4000 的硬上限永远够不到，用户设了常驻却什么都看不到，且无任何提示。

**修正为：** 常驻段有**独立预算**（`RESIDENT_MEMORY_BUDGET_TOKENS = 4000`，超限整段不注入并按 spec 记 warn），最终上限 = `TOTAL_BUDGET_TOKENS + 常驻段实际 tokens`；降级链只作用于 M2 → M1（常驻段不参与）。理由：常驻段是用户**显式声明必须进上下文**的内容，它已经在自己的硬上限内被严格约束，不应再被另一条上限二次截断。既有 6 条 `assembleFinalPrompt` 测试（不传 `memoryResident`）行为完全不变。

### 修正 2：目录段的既有内容注入被替换（行为变更，需你确认）

现状：`buildAgentSystemSegmentsAsync` 会把 book / 最新卷 / 最近章节 / shared **正文节选**（800 tokens 预算）注入每轮上下文。分层后（spec §3.2 表格）：

| load_mode | 旧行为 | 新行为 |
|---|---|---|
| （缺省 → auto） | 正文节选自动进上下文 | **只进名字目录**（`- [全书] book-state：<brief>`），正文需 `read_memory` 取 |
| resident | — | 全文进常驻段（≤4000） |
| manual | — | 目录带 `[manual]`，正文仅显式引用时进 |

即：**升级后既有项目的记忆默认不再自动注入正文**。缓解：(1) `brief` 取正文首个非标题行（含列表符剥离），目录本身就有信息量（如 `shared` 的首条事实、章节文件的「关键事件」行）；(2) 用户对新 UI 里任一文件点「常驻」即可恢复全文注入（一次点击）；(3) 模型可随时 `read_memory` 按名取。若你希望「缺省 = 保持旧行为」，请在评审时说明——那需要把缺省值改成 `resident` 或保留 auto 正文注入，两者都与 spec 的 §3.1/§3.2 冲突，改的是设计不是实现。

## Global Constraints

- 模块系统 **CJS**（`"type": "commonjs"`）；TS strict（`noUnusedLocals`/`noUnusedParameters`）；ESLint `--max-warnings 0`。
- **不新增 IPC 通道**：复用 `memory:list` / `memory:read` / `memory:write`。`src/shared/ipc-channel-parity.test.ts`（含通道总数快照）**不应有任何改动**。
- 走既有 UI 刻度：窄面板内新增控件用 `ui/SegmentedControl`（`size="sm"`），禁止原生 `<select>` 与硬编码像素/颜色；正文列宽度受 264px 面板约束，标签只用两字（常驻/自动/手动），解释文案挂 `title`。
- 所有用户可见文案**三语齐全**（zh-CN / en-US / ru-RU），一律经 `t()`；新增 key 必须同时进 `src/shared/locale-data/*.ts` 的三语分支（`i18n-key-guard.test.ts` + `locale.test.ts` 会双向校验）。
- 颜色只用 `var(--color-*)` 令牌（`color-token-guard.test.ts` 强制）；字号/圆角/阴影按既有刻度；不得硬编码 `#xxx`。
- 测试：vitest。每个任务按 RED → GREEN 走；任务收口统一跑 `npx tsc --noEmit && npx eslint . && npx vitest run`（三条都必须零错误）。
- 提交保持项目惯例：一个提交一件事，中文提交信息用 `git commit -F <file>`（消息含中文/特殊字符时不走 `-m`）。**攒够本次工作单元（6 笔）再推**，推送与 CI 核对放在本计划全部任务 + 评审修复之后。

## Review Focus

以下输入/失败模式 spec 没有明说、单靠各任务既有断言容易漏，每个都在**拥有该代码的任务**里补了测试：

1. **记忆文件没有 frontmatter**（纯正文，用户手写）时读写 `load_mode` —— 期望：写回**不破坏正文**，且不凭空造出 `load_mode: auto` 行。
2. **常驻合计超硬上限** —— 期望：**不静默截断**，整段不注入 + 明细面板与 `console.warn` 双留痕（这是「诚实」的核心，spec §3.2 只写了「记 warn」）。
3. **常驻条目在装配期间读失败/已被删除**（`memory:read` → null）—— 期望：跳过该条、不崩、其余条目照常注入。
4. **manual 条目同时是 stale** 且被 `@` 提及 —— 期望：**不注入**（stale 过滤先于分层）。
5. **目录条目数极多**（40+ 条）—— 期望：不超预算、有「还有 N 条」提示、模型仍能发现记忆存在。
6. **关键词含正则元字符**（如 `第1章(`）：期望不抛错（实现走 `includes`/`indexOf`，不得用 `new RegExp`）。
7. **编辑器里同一记忆文件有未保存修改**时切换加载方式 —— 期望：不覆盖用户的未保存内容（脏检查拦截 + 提示）。

---

### Task 1: 分层类型与 `load_mode` 解析（codec + 列表 + IPC 类型）

**Files:**
- Create: `src/shared/memory-types.ts`
- Create: `src/shared/memory-types.test.ts`
- Modify: `electron/utils/memory-codec.ts`（`MemoryFileMeta` 增 `loadMode`/`brief`；新增 `extractMemoryBrief` / `setLoadModeFrontmatter`）
- Modify: `electron/controllers/memory-controller.ts`（抽出纯函数 `buildMemoryFileMeta`，`memory:list` 回传 `loadMode`/`brief`）
- Modify: `src/shared/ipc-channels.ts:1115-1118`（`memory:list` 返回类型）
- Modify: `src/services/memory/memory-codec.test.ts`（补 `extractMemoryBrief` / `setLoadModeFrontmatter` 用例）
- Modify: `electron/controllers/memory-controller.test.ts`（补 `buildMemoryFileMeta` 用例）
- Modify: `src/components/panels/sidebar/MemoryGroup.test.tsx:23-26`（`FILES` 字面量补两个新字段——类型改动后必须同步）

**Interfaces:**
- Produces:
  - `MemoryLoadMode = 'resident' | 'auto' | 'manual'`；`MEMORY_LOAD_MODES`；`normalizeLoadMode(raw?: string | null): MemoryLoadMode`（缺省/非法 → `'auto'`，不抛）
  - `MemoryFileMeta = { file; kind; loadMode: MemoryLoadMode; brief: string; range?; stale; mtime }`
  - `extractMemoryBrief(raw: string): string`（正文首个非空**非标题**行、剥 `- ` 前缀、截断 120 字符；无此行为空串）
  - `setLoadModeFrontmatter(raw: string, mode: MemoryLoadMode): string`（幂等；`auto` 表示「不写该键」）
  - `buildMemoryFileMeta(name: string, raw: string, mtime: number): MemoryFileMeta`（主进程纯函数，供 `memory:list` 与单测）

- [ ] **Step 1: 写失败测试**（`src/shared/memory-types.test.ts`）

```ts
import { describe, it, expect } from 'vitest'
import { MEMORY_LOAD_MODES, normalizeLoadMode } from './memory-types'

describe('normalizeLoadMode（C 档第一轮：三值分层）', () => {
  it('三值原样通过', () => {
    expect(normalizeLoadMode('resident')).toBe('resident')
    expect(normalizeLoadMode('auto')).toBe('auto')
    expect(normalizeLoadMode('manual')).toBe('manual')
  })
  it('缺省/空/非法一律回落 auto（fail-safe，不抛）', () => {
    expect(normalizeLoadMode(undefined)).toBe('auto')
    expect(normalizeLoadMode(null)).toBe('auto')
    expect(normalizeLoadMode('')).toBe('auto')
    expect(normalizeLoadMode('always')).toBe('auto')
    expect(normalizeLoadMode('RESIDENT')).toBe('resident') // 大小写与空白宽容
    expect(normalizeLoadMode(' manual ')).toBe('manual')
  })
  it('三值集合固定（UI 选择器与解析共用同一枚举）', () => {
    expect([...MEMORY_LOAD_MODES]).toEqual(['resident', 'auto', 'manual'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/memory-types.test.ts`
Expected: FAIL —— `Failed to resolve import "./memory-types"`

- [ ] **Step 3: 建 `src/shared/memory-types.ts`**

```ts
/**
 * 记忆分层共享类型（C 档第一轮）—— load_mode 三值：常驻 / 自动 / 手动。
 *
 * 主进程（electron/utils/memory-codec.ts）与渲染层（装配 / UI）共用；零运行时依赖，
 * 可被 preload 侧安全引用。缺省与非法值一律回落 auto（fail-safe：坏 frontmatter 不该让
 * 记忆整体失效，也不该悄悄变成「每轮全量进上下文」）。
 */
export type MemoryLoadMode = 'resident' | 'auto' | 'manual'

/** 三值枚举（UI 选择器与解析共用的单一真源） */
export const MEMORY_LOAD_MODES: readonly MemoryLoadMode[] = ['resident', 'auto', 'manual']

/** 缺省分层：进名字目录，正文按需取（与「不写 load_mode 键」等价） */
export const DEFAULT_MEMORY_LOAD_MODE: MemoryLoadMode = 'auto'

export function normalizeLoadMode(raw: string | null | undefined): MemoryLoadMode {
  const v = (raw ?? '').trim().toLowerCase()
  return (MEMORY_LOAD_MODES as readonly string[]).includes(v)
    ? (v as MemoryLoadMode)
    : DEFAULT_MEMORY_LOAD_MODE
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/shared/memory-types.test.ts`
Expected: PASS 3/3

- [ ] **Step 5: 写 codec 失败测试**（追加到 `src/services/memory/memory-codec.test.ts` 末尾）

```ts
import { extractMemoryBrief, setLoadModeFrontmatter } from './memory-codec'

describe('extractMemoryBrief（C 档第一轮：目录 brief）', () => {
  it('取首个非空、非标题行；剥列表符', () => {
    expect(extractMemoryBrief('---\ntype: shared\n---\n\n# 跨会话可复用事实\n- 用户偏好爽文节奏\n- 主角名苏晚晴'))
      .toBe('用户偏好爽文节奏')
    expect(extractMemoryBrief('# 全书精要\n\n主角是苏晚晴')).toBe('主角是苏晚晴')
  })
  it('正文只有标题时回落标题文本', () => {
    expect(extractMemoryBrief('# 章节记忆 001-015')).toBe('章节记忆 001-015')
  })
  it('无 frontmatter 的纯正文同样可用', () => {
    expect(extractMemoryBrief('纯正文首行\n第二行')).toBe('纯正文首行')
  })
  it('超 120 字符截断加省略号；空文件为空串', () => {
    const long = '详'.repeat(200)
    expect(extractMemoryBrief(long)).toBe(`${'详'.repeat(120)}…`)
    expect(extractMemoryBrief('   \n\n ')).toBe('')
  })
})

describe('setLoadModeFrontmatter（C 档第一轮：写入分层）', () => {
  it('无 frontmatter 的纯正文：追加块且正文逐字保留', () => {
    expect(setLoadModeFrontmatter('纯正文', 'resident')).toBe('---\nload_mode: resident\n---\n纯正文')
  })
  it('已有其他键：保留并追加 load_mode', () => {
    expect(setLoadModeFrontmatter('---\nstatus: stale\n---\n正文', 'manual'))
      .toBe('---\nstatus: stale\nload_mode: manual\n---\n正文')
  })
  it('已有 load_mode：原位替换（不重复追加）', () => {
    expect(setLoadModeFrontmatter('---\ntype: shared\nload_mode: auto\n---\n正文', 'resident'))
      .toBe('---\ntype: shared\nload_mode: resident\n---\n正文')
  })
  it('切回 auto = 删除该键（缺省即 auto，不留冗余行）', () => {
    expect(setLoadModeFrontmatter('---\nstatus: ok\nload_mode: resident\n---\n正文', 'auto'))
      .toBe('---\nstatus: ok\n---\n正文')
    expect(setLoadModeFrontmatter('---\nload_mode: resident\n---\n正文', 'auto')).toBe('正文')
  })
  it('幂等：已是目标值（含 auto 无键）时原样返回', () => {
    const resident = '---\nload_mode: resident\n---\n正文'
    expect(setLoadModeFrontmatter(resident, 'resident')).toBe(resident)
    const plain = '无 frontmatter 正文'
    expect(setLoadModeFrontmatter(plain, 'auto')).toBe(plain)
  })
  it('非法既有值 + auto → 清掉非法键（不保留坏值）', () => {
    expect(setLoadModeFrontmatter('---\nload_mode: bogus\n---\n正文', 'auto')).toBe('正文')
  })
  it('空内容返回原样（parseMemoryFile 为 null 分支，不抛）', () => {
    expect(setLoadModeFrontmatter('', 'resident')).toBe('')
  })
})
```

- [ ] **Step 6: 跑测试确认失败**

Run: `npx vitest run src/services/memory/memory-codec.test.ts`
Expected: FAIL —— `extractMemoryBrief is not a function`

- [ ] **Step 7: 实现 codec（`electron/utils/memory-codec.ts`）**

顶部加 import，`MemoryFileMeta` 增两字段，并在 `stripStatusFrontmatter` 之后追加两个函数：

```ts
import { DEFAULT_MEMORY_LOAD_MODE, normalizeLoadMode, type MemoryLoadMode } from '../../src/shared/memory-types'

// 主进程与渲染层都从这里取分层类型（渲染侧的 src/services/memory/memory-codec.ts 整体 re-export 本文件）
export { MEMORY_LOAD_MODES, DEFAULT_MEMORY_LOAD_MODE, normalizeLoadMode } from '../../src/shared/memory-types'
export type { MemoryLoadMode } from '../../src/shared/memory-types'
```

```ts
export interface MemoryFileMeta {
  file: string
  /** F9：白名单分类——unknown = 非 book-state/chapters-/volume-/shared 的任意 .md，不参与 M2 注入 */
  kind: 'chapters' | 'volume' | 'book' | 'shared' | 'unknown'
  /** C 档第一轮：分层（frontmatter load_mode；缺省/非法 → auto） */
  loadMode: MemoryLoadMode
  /** C 档第一轮：目录行摘要（正文首个非标题行，≤120 字符） */
  brief: string
  range?: string
  stale: boolean
  mtime: number
}
```

```ts
/** 记忆目录 brief 的字符上限（Denova 目录只放一行摘要的 NF 版） */
export const MEMORY_BRIEF_MAX_CHARS = 120

/**
 * 目录/常驻展示用的 brief：正文**首个非空非标题行**，剥列表符（`- `）后截断。
 * 标题行（`# 全书精要`）没有信息量，故只在整篇没有正文行时回落标题文本——
 * shared.md 因此得到「用户偏好爽文节奏」这样的首条事实，而不是文件名。
 */
export function extractMemoryBrief(raw: string): string {
  const parsed = parseMemoryFile(raw)
  const body = parsed?.body ?? raw
  let heading = ''
  for (const line of body.split('\n')) {
    const text = line.trim()
    if (!text) continue
    if (text.startsWith('#')) {
      if (!heading) heading = text.replace(/^#+\s*/, '')
      continue
    }
    const stripped = text.replace(/^[-*]\s+/, '')
    return stripped.length > MEMORY_BRIEF_MAX_CHARS ? `${stripped.slice(0, MEMORY_BRIEF_MAX_CHARS)}…` : stripped
  }
  return heading.length > MEMORY_BRIEF_MAX_CHARS ? `${heading.slice(0, MEMORY_BRIEF_MAX_CHARS)}…` : heading
}

/**
 * 写入 load_mode（读-改-写：保留其他 frontmatter 键与正文逐字不动）。
 * `auto` 表示**删除该键**——缺省即 auto，不留冗余行（同 stripStatusFrontmatter 的处置）。
 * 空内容/无 frontmatter 均安全；已是目标值时原样返回（幂等，避免无谓写盘）。
 */
export function setLoadModeFrontmatter(raw: string, mode: MemoryLoadMode): string {
  const parsed = parseMemoryFile(raw)
  if (!parsed) return raw
  const declared = parsed.frontmatter.load_mode
  if (mode === DEFAULT_MEMORY_LOAD_MODE ? declared === undefined : normalizeLoadMode(declared) === mode) {
    return raw
  }
  const entries = Object.entries(parsed.frontmatter).filter(([k]) => k !== 'load_mode')
  if (mode !== DEFAULT_MEMORY_LOAD_MODE) entries.push(['load_mode', mode])
  const fm = entries.length > 0
    ? `---\n${entries.map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n`
    : ''
  return `${fm}${parsed.body}`
}
```

- [ ] **Step 8: 跑测试确认通过**

Run: `npx vitest run src/services/memory/memory-codec.test.ts`
Expected: PASS（既有用例 + 新增 11 条全绿）

- [ ] **Step 9: 写 controller 失败测试**（追加到 `electron/controllers/memory-controller.test.ts`）

```ts
import { buildMemoryFileMeta } from './memory-controller'

describe('buildMemoryFileMeta（C 档第一轮：列表回传分层与 brief）', () => {
  it('声明 resident → loadMode=resident；缺省 → auto', () => {
    expect(buildMemoryFileMeta('book-state.md', '---\nload_mode: resident\n---\n# 全书精要\n主角是苏晚晴', 1).loadMode).toBe('resident')
    expect(buildMemoryFileMeta('book-state.md', '# 全书精要\n主角是苏晚晴', 1).loadMode).toBe('auto')
  })
  it('非法值回落 auto（坏 frontmatter 不放大成「每轮全文注入」）', () => {
    expect(buildMemoryFileMeta('shared.md', '---\nload_mode: always\n---\n- 事实', 1).loadMode).toBe('auto')
  })
  it('brief 与 kind 一并回传（列表读盘本来就为了分类，零额外 IO）', () => {
    const meta = buildMemoryFileMeta('shared.md', '---\ntype: shared\n---\n\n# 跨会话可复用事实\n- 用户偏好爽文节奏', 3)
    expect(meta).toMatchObject({ file: 'shared.md', kind: 'shared', loadMode: 'auto', brief: '用户偏好爽文节奏', stale: false, mtime: 3 })
  })
  it('chapters 文件带 range、stale 标记沿用既有口径', () => {
    const meta = buildMemoryFileMeta('chapters-001-015.md', '---\nstatus: stale\n---\n\n# 章节记忆 001-015\n\n## 第 1 章 · 开局\n- 关键事件：主角觉醒', 7)
    expect(meta).toMatchObject({ kind: 'chapters', range: '001-015', stale: true, brief: '关键事件：主角觉醒' })
  })
})
```

- [ ] **Step 10: 跑测试确认失败**

Run: `npx vitest run electron/controllers/memory-controller.test.ts`
Expected: FAIL —— `buildMemoryFileMeta is not a function`（或导出未定义）

- [ ] **Step 11: 实现 `buildMemoryFileMeta` 并接入 `memory:list`**

`electron/controllers/memory-controller.ts`：import 改为 `import { parseMemoryFile, markStaleFrontmatter, extractMemoryBrief, normalizeLoadMode } from '../utils/memory-codec'`，新增导出函数，并把 `memory:list` 的循环体改为调用它：

```ts
/**
 * 单行元数据（纯函数，供 memory:list 与单测）：列表循环本来就逐个读文件做 kind 分类，
 * 分层与 brief 顺带算出 —— 不额外读盘。
 */
export function buildMemoryFileMeta(name: string, raw: string, mtime: number): MemoryFileMeta {
  const parsed = parseMemoryFile(raw)
  const kind = classifyMemoryFileKind(name, raw)
  return {
    file: name,
    kind,
    loadMode: normalizeLoadMode(parsed?.frontmatter.load_mode),
    brief: extractMemoryBrief(raw),
    range: kind === 'chapters' ? name.replace(/^chapters-(\d+)-(\d+)\.md$/, '$1-$2') : undefined,
    stale: parsed ? parsed.frontmatter.status === 'stale' : false,
    mtime,
  }
}
```

```ts
// memory:list 循环体内替换原 out.push({...})：
        out.push(buildMemoryFileMeta(e.name, raw, stat.mtimeMs))
```

- [ ] **Step 12: 同步类型声明与既有字面量**

`src/shared/ipc-channels.ts:1117` 的 `memory:list` 返回类型改为：

```ts
    return: Array<{ file: string; kind: 'chapters' | 'volume' | 'book' | 'shared' | 'unknown'; loadMode: 'resident' | 'auto' | 'manual'; brief: string; range?: string; stale: boolean; mtime: number }>
```

`src/components/panels/sidebar/MemoryGroup.test.tsx:23-26`：

```ts
const FILES: MemoryFileMeta[] = [
  { file: 'chapters-1-3.md', kind: 'chapters', loadMode: 'auto', brief: '关键事件：主角醒来', range: '1-3', stale: true, mtime: 3 },
  { file: 'book-state.md', kind: 'book', loadMode: 'resident', brief: '主角是苏晚晴', stale: false, mtime: 1 },
]
```

> `book-state.md` 设为 `resident`：Task 5 的选择器测试要有非 auto 的现状值可断言。

- [ ] **Step 13: 全量门禁**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run`
Expected: 三条全绿。若 `tsc` 报「`MemoryFileMeta` 缺 loadMode/brief」→ 还有未同步的字面量，按报错逐个补（这是类型改动的必要连带，不是新增范围）。

- [ ] **Step 14: 提交**

```bash
git add src/shared/memory-types.ts src/shared/memory-types.test.ts electron/utils/memory-codec.ts electron/controllers/memory-controller.ts src/shared/ipc-channels.ts src/services/memory/memory-codec.test.ts electron/controllers/memory-controller.test.ts src/components/panels/sidebar/MemoryGroup.test.tsx
git commit -F /tmp/commit-t1.txt   # feat: 记忆分层 load_mode 解析与列表回传（C 档第一轮 T1）
```

---

### Task 2: 分层纯函数（常驻段 / 目录段三级降级 / @ 提及匹配 / 关键词打分）

**Files:**
- Create: `src/services/agent/memory-layers.ts`
- Create: `src/services/agent/memory-layers.test.ts`
- Modify: `src/shared/locale-data/ui.ts`（追加 `memory.*` 文案，三语）
- Modify: `src/shared/locale-data/agent.ts`（追加 `context.segSourceResident` / `context.segSourceCatalog` / `context.seg.memory-resident` / `context.seg.memory-catalog` / `context.seg.memory-manual`，三语）

**Interfaces:**
- Consumes: `MemoryLoadMode` / `normalizeLoadMode`（Task 1）
- Produces:
  - `MemoryLayerEntry = { file; kind: 'chapters'|'volume'|'book'|'shared'|'unknown'; loadMode: MemoryLoadMode; brief: string; range?: string }`
  - `RESIDENT_MEMORY_BUDGET_TOKENS = 4000`、`RESIDENT_MEMORY_WARN_TOKENS = 2000`、`MEMORY_CATALOG_BUDGET_TOKENS = 800`
  - `residentEntries(entries): MemoryLayerEntry[]`（按文件名排序——前缀稳定）
  - `catalogEntries(entries): MemoryLayerEntry[]`（非 resident 且 kind !== 'unknown'）
  - `buildResidentSection(contents: Array<{file, body}>): { text; tokens; overCap }`
  - `buildMemoryCatalog(entries): { text; level: 1|2|3 }`
  - `matchMentionedManuals(userText, entries): string[]`
  - `scoreMemoryEntry(entry, body, keyword): number`、`findLineHint(body, keyword, maxChars?): string`

- [ ] **Step 1: 写失败测试**（`src/services/agent/memory-layers.test.ts`）

```ts
import { describe, it, expect } from 'vitest'
import {
  buildMemoryCatalog, buildResidentSection, catalogEntries, matchMentionedManuals,
  residentEntries, scoreMemoryEntry, findLineHint,
  MEMORY_CATALOG_BUDGET_TOKENS, RESIDENT_MEMORY_BUDGET_TOKENS,
  type MemoryLayerEntry,
} from './memory-layers'
import { estimateTokens } from './token-budget'

const e = (file: string, loadMode: MemoryLayerEntry['loadMode'], brief = '摘要', kind: MemoryLayerEntry['kind'] = 'book'): MemoryLayerEntry =>
  ({ file, kind, loadMode, brief })

describe('residentEntries / catalogEntries（分层归属）', () => {
  it('resident 只挑常驻并按文件名排序（前缀稳定：mtime 排序会让每轮前缀漂移）', () => {
    const sorted = residentEntries([e('b.md', 'resident'), e('a.md', 'resident'), e('c.md', 'auto')])
    expect(sorted.map(x => x.file)).toEqual(['a.md', 'b.md'])
  })
  it('目录含 auto + manual，排除 resident 与 unknown（F9 隐式白名单）', () => {
    const list = catalogEntries([e('a.md', 'resident'), e('b.md', 'auto'), e('c.md', 'manual'), e('d.md', 'auto', '摘要', 'unknown')])
    expect(list.map(x => x.file)).toEqual(['b.md', 'c.md'])
  })
})

describe('buildResidentSection（常驻全文段 + 硬上限）', () => {
  it('全文拼接（不做节选），token 数与文本一致', () => {
    const body = '第一章内容'.repeat(50)
    const { text, tokens, overCap } = buildResidentSection([{ file: 'book-state.md', body }])
    expect(overCap).toBe(false)
    expect(text).toContain(body)              // 逐字进上下文（旧 M2 会截断，分层后常驻不再截）
    expect(text).toContain('book-state.md')   // 带来源标注
    expect(tokens).toBe(estimateTokens(text))
  })
  it('超硬上限 → 整段不入上下文（overCap=true，text 为空；由调用方记 warn，绝不静默截断）', () => {
    const { text, tokens, overCap } = buildResidentSection([{ file: 'a.md', body: '详'.repeat(6000) }])
    expect(overCap).toBe(true)
    expect(text).toBe('')
    expect(tokens).toBeGreaterThan(RESIDENT_MEMORY_BUDGET_TOKENS) // 报出真实用量供告警文案
  })
  it('空输入 → 空段（不产生只有标题的空段）', () => {
    expect(buildResidentSection([])).toEqual({ text: '', tokens: 0, overCap: false })
  })
})

describe('buildMemoryCatalog（名字目录 + 三级降级）', () => {
  it('级别 1：brief 完整；manual 带 [manual] 标记、kind 带标签', () => {
    const { text, level } = buildMemoryCatalog([e('a.md', 'manual', '短摘要'), e('b.md', 'auto')])
    expect(level).toBe(1)
    expect(text).toContain('[manual]')
    expect(text).toContain('短摘要')
    expect(estimateTokens(text)).toBeLessThanOrEqual(MEMORY_CATALOG_BUDGET_TOKENS)
  })
  it('级别 2：brief 超预算 → 截 72 字 + 提示（提示里点名 read_memory）', () => {
    const long = e('a.md', 'auto', '详'.repeat(150))
    const { text, level } = buildMemoryCatalog(Array.from({ length: 6 }, (_, i) => ({ ...long, file: `f${i}.md` })))
    expect(level).toBe(2)
    expect(text).toContain('…')
    expect(text).toMatch(/read_memory/)
  })
  it('级别 3：仍超预算 → 只留名字 + 提示 + 「还有 N 条」（模型仍能发现记忆存在）', () => {
    const many = Array.from({ length: 40 }, (_, i) => e(`file-${String(i).padStart(2, '0')}-with-a-long-name.md`, 'auto', '详'.repeat(150)))
    const { text, level } = buildMemoryCatalog(many)
    expect(level).toBe(3)
    expect(text).toContain('file-00-with-a-long-name')
    expect(text).toMatch(/还有|and \d+ more|ещё/)   // 三语文案之一
    expect(estimateTokens(text)).toBeLessThanOrEqual(MEMORY_CATALOG_BUDGET_TOKENS)
  })
  it('无目录条目 → 空串（不注入空标题）', () => {
    expect(buildMemoryCatalog([e('a.md', 'resident')]).text).toBe('')
  })
})

describe('matchMentionedManuals（manual 硬门控的判定）', () => {
  const entries = [e('book-state.md', 'manual'), e('chapters-001-015.md', 'manual'), e('shared.md', 'auto')]
  it('@文件名 与 @文件名去后缀 都能命中；返回文件名', () => {
    expect(matchMentionedManuals('帮我看看 @book-state 的设定', entries)).toEqual(['book-state.md'])
    expect(matchMentionedManuals('@book-state.md 呢', entries)).toEqual(['book-state.md'])
  })
  it('中文行文中的提及（@ 后紧跟名字、后接空格/中文标点）', () => {
    expect(matchMentionedManuals('@chapters-001-015，对比一下', entries)).toEqual(['chapters-001-015.md'])
  })
  it('未提及 / 非 manual 条目提及 → 不注入（auto 本来就在目录里）', () => {
    expect(matchMentionedManuals('随便聊聊', entries)).toEqual([])
    expect(matchMentionedManuals('@shared 呢', entries)).toEqual([])
  })
  it('大小写不敏感；前缀不同的名字不误命中', () => {
    expect(matchMentionedManuals('@BOOK-STATE', entries)).toEqual(['book-state.md'])
    expect(matchMentionedManuals('@book 呢', entries)).toEqual([])
  })
})

describe('scoreMemoryEntry / findLineHint（关键词检索）', () => {
  it('name > kind > brief > 正文命中次数', () => {
    expect(scoreMemoryEntry(e('fog.md', 'auto', '无关'), '', 'fog')).toBeGreaterThan(scoreMemoryEntry(e('a.md', 'auto', '无关'), '', 'fog'))
    expect(scoreMemoryEntry(e('a.md', 'auto', '本章伏笔回收'), '', '伏笔')).toBeGreaterThan(scoreMemoryEntry(e('a.md', 'auto', '无关'), '正文提到伏笔', '伏笔'))
    expect(scoreMemoryEntry(e('a.md', 'auto', '无关'), '正文提到伏笔', '伏笔')).toBeGreaterThan(0)
    expect(scoreMemoryEntry(e('a.md', 'auto', '无关'), '毫不相关', '伏笔')).toBe(0)
  })
  it('正则元字符不抛错（实现走 indexOf/includes，不构造 RegExp）', () => {
    expect(() => scoreMemoryEntry(e('a.md', 'auto', 'x'), '第1章(上)', '第1章(')).not.toThrow()
    expect(scoreMemoryEntry(e('a.md', 'auto', 'x'), '第1章(上)', '第1章(')).toBeGreaterThan(0)
  })
  it('findLineHint 给出首批命中行、超长截断、无命中为空串', () => {
    expect(findLineHint('第一行\n伏笔：玉佩是关键\n第三行', '玉佩')).toBe('伏笔：玉佩是关键')
    expect(findLineHint('短', '不存在')).toBe('')
    expect(findLineHint(`x${'详'.repeat(200)}`, 'x')).toHaveLength(81) // 80 + 省略号
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/services/agent/memory-layers.test.ts`
Expected: FAIL —— `Failed to resolve import "./memory-layers"`

- [ ] **Step 3: 追加三语文案**

`src/shared/locale-data/ui.ts` 的 `'memory.openProjectHint'` 之前插入（每行三语齐全）：

```ts
  // --- 记忆分层（C 档第一轮：常驻 / 自动 / 手动，见 memory-layers.ts）---
  'memory.residentHeader': { 'zh-CN': '## 常驻记忆（每轮进上下文）', 'en-US': '## Resident memory (in every request)', 'ru-RU': '## Постоянная память (в каждом запросе)' },
  'memory.catalogHeader': { 'zh-CN': '## 记忆目录', 'en-US': '## Memory catalog', 'ru-RU': '## Каталог памяти' },
  'memory.catalogHintTruncated': { 'zh-CN': '（摘要已截断——用 read_memory 按名取正文，或用关键词收窄）', 'en-US': '(summaries truncated — use read_memory by name, or narrow with a keyword)', 'ru-RU': '(сводки урезаны — используйте read_memory по имени или уточните ключевым словом)' },
  'memory.catalogHintNamesOnly': { 'zh-CN': '（仅列名字——用 read_memory 按名取正文，或用关键词收窄）', 'en-US': '(names only — use read_memory by name, or narrow with a keyword)', 'ru-RU': '(только имена — используйте read_memory по имени или уточните ключевым словом)' },
  'memory.catalogOmitted': { 'zh-CN': '…还有 {n} 条未列出', 'en-US': '…and {n} more not listed', 'ru-RU': '…и ещё {n} не показано' },
  'memory.residentNearLimit': { 'zh-CN': '常驻记忆 {tokens} tokens，接近上限 {cap}', 'en-US': 'Resident memory {tokens} tokens, near the {cap} limit', 'ru-RU': 'Постоянная память {tokens} токенов, близко к лимиту {cap}' },
  'memory.residentOverCap': { 'zh-CN': '常驻记忆合计 {tokens} tokens，超过上限 {cap}——本轮未注入，请减少常驻记忆或改用自动/手动', 'en-US': 'Resident memory totals {tokens} tokens, over the {cap} limit — not injected this turn; trim resident memory or switch to auto/manual', 'ru-RU': 'Постоянная память {tokens} токенов, больше лимита {cap} — не добавлена в этот запрос; сократите её или переключите на авто/вручную' },
  'memory.manualMentionHeader': { 'zh-CN': '## 本轮显式引用的手动记忆', 'en-US': '## Manual memory referenced this turn', 'ru-RU': '## Память, явно запрошенная в этом сообщении' },
  // 加载方式选择器（AgentMemoryView；hint 文案是选型的唯一解释面）
  'memory.loadModeLabel': { 'zh-CN': '加载方式', 'en-US': 'Load mode', 'ru-RU': 'Режим загрузки' },
  'memory.loadModeResident': { 'zh-CN': '常驻', 'en-US': 'Resident', 'ru-RU': 'Постоянно' },
  'memory.loadModeAuto': { 'zh-CN': '自动', 'en-US': 'Auto', 'ru-RU': 'Авто' },
  'memory.loadModeManual': { 'zh-CN': '手动', 'en-US': 'Manual', 'ru-RU': 'Вручную' },
  'memory.loadModeResidentHint': { 'zh-CN': '每轮进上下文（全文，上限 4000 tokens）', 'en-US': 'Into every request (full text, 4000-token cap)', 'ru-RU': 'В каждый запрос (полностью, лимит 4000 токенов)' },
  'memory.loadModeAutoHint': { 'zh-CN': '进名字目录，模型可自取正文', 'en-US': 'Listed in the catalog; the model fetches the body on demand', 'ru-RU': 'В каталоге; модель запрашивает текст по необходимости' },
  'memory.loadModeManualHint': { 'zh-CN': '仅显式引用时才加载（对话里 @文件名）', 'en-US': 'Loaded only when explicitly referenced (@file name in chat)', 'ru-RU': 'Загружается только при явном упоминании (@имя файла в чате)' },
  'memory.loadModeSaved': { 'zh-CN': '加载方式已更新', 'en-US': 'Load mode updated', 'ru-RU': 'Режим загрузки обновлён' },
  'memory.loadModeFailed': { 'zh-CN': '加载方式保存失败：{error}', 'en-US': 'Failed to save load mode: {error}', 'ru-RU': 'Не удалось сохранить режим: {error}' },
  'memory.loadModeDirty': { 'zh-CN': '编辑器里这条记忆有未保存的修改，请先保存再切换加载方式', 'en-US': 'This memory has unsaved edits in the editor — save first, then switch load mode', 'ru-RU': 'В редакторе есть несохранённые правки — сначала сохраните, затем переключите режим' },
  'memory.residentTotal': { 'zh-CN': '常驻记忆 {tokens} / {cap} tokens', 'en-US': 'Resident memory {tokens} / {cap} tokens', 'ru-RU': 'Постоянная память {tokens} / {cap} токенов' },
```

`src/shared/locale-data/agent.ts` 的 `'context.seg.memory-m1'` 之后插入：

```ts
  'context.segSourceResident': { 'zh-CN': '常驻记忆（{files}）', 'en-US': 'Resident memory ({files})', 'ru-RU': 'Постоянная память ({files})' },
  'context.segSourceCatalog': { 'zh-CN': '{n} 条记忆目录', 'en-US': '{n} memory entries in catalog', 'ru-RU': '{n} записей в каталоге памяти' },
  'context.seg.memory-resident': { 'zh-CN': '常驻记忆', 'en-US': 'Resident memory', 'ru-RU': 'Постоянная память' },
  'context.seg.memory-catalog': { 'zh-CN': '记忆目录', 'en-US': 'Memory catalog', 'ru-RU': 'Каталог памяти' },
  'context.seg.memory-manual': { 'zh-CN': '手动记忆（本轮引用）', 'en-US': 'Manual memory (this turn)', 'ru-RU': 'Память по запросу (это сообщение)' },
```

- [ ] **Step 4: 跑测试确认仍失败（缺实现）**

Run: `npx vitest run src/shared/locale.test.ts src/shared/i18n-key-guard.test.ts`
Expected: PASS（文案先落地；此时 `memory-layers.ts` 还不存在，下一步才写）

- [ ] **Step 5: 实现 `src/services/agent/memory-layers.ts`**

```ts
/**
 * 记忆分层（C 档第一轮）—— 常驻 / 自动 / 手动的装配与匹配**纯函数**。
 *
 * 分工：本模块只做「条目 → 文本/判定」的纯计算（无 IPC，便于单测）；读盘与编排在
 * context-builder（注入）与 read-memory.tool（模型自取）。
 * 参照 Denova internal/book/lore/：resident 全文段 + 非 resident 名字目录 + 分级降级。
 */
import { t } from '../../shared/locale'
import { estimateTokens } from './token-budget'
import type { MemoryLoadMode } from '../../shared/memory-types'

/** 记忆条目（memory:list 的行 + 分层字段；stale 条目由调用方先行过滤） */
export interface MemoryLayerEntry {
  file: string
  kind: 'chapters' | 'volume' | 'book' | 'shared' | 'unknown'
  loadMode: MemoryLoadMode
  brief: string
  range?: string
}

/** 常驻段硬上限：超过 → **整段不入上下文**（不静默截断），明细面板与日志双留痕 */
export const RESIDENT_MEMORY_BUDGET_TOKENS = 4000
/** 常驻段警告阈值：超过 → 明细面板标注「接近上限」（仅提示，不拦） */
export const RESIDENT_MEMORY_WARN_TOKENS = 2000
/** 记忆目录段预算（很小，且是模型发现记忆的唯一途径——与技能目录段同口径） */
export const MEMORY_CATALOG_BUDGET_TOKENS = 800
/** 降级档 2 的 brief 截断长度 */
const CATALOG_BRIEF_MAX_CHARS = 72

/** 常驻条目：按**文件名**排序——常驻段位于前缀最前部，mtime 排序会让缓存前缀每轮漂移 */
export function residentEntries(entries: MemoryLayerEntry[]): MemoryLayerEntry[] {
  return entries.filter(e => e.loadMode === 'resident').sort((a, b) => a.file.localeCompare(b.file))
}

/** 目录条目：非 resident；未知前缀文件不进目录（F9 隐式白名单——显式 resident 另行处理） */
export function catalogEntries(entries: MemoryLayerEntry[]): MemoryLayerEntry[] {
  return entries.filter(e => e.loadMode !== 'resident' && e.kind !== 'unknown')
}

/**
 * 常驻段：全文拼接（**不做节选/截断**）+ 来源标注。
 * 超硬上限 → 整段丢弃（text 空、overCap 真），tokens 仍报真实用量供告警文案使用。
 */
export function buildResidentSection(contents: Array<{ file: string; body: string }>): { text: string; tokens: number; overCap: boolean } {
  if (contents.length === 0) return { text: '', tokens: 0, overCap: false }
  const blocks = contents.map(c => `## ${c.file}\n\n${c.body.trim()}`)
  const text = `${t('memory.residentHeader')}\n\n${blocks.join('\n\n')}`
  const tokens = estimateTokens(text)
  return tokens > RESIDENT_MEMORY_BUDGET_TOKENS
    ? { text: '', tokens, overCap: true }
    : { text, tokens, overCap: false }
}

function kindLabel(kind: MemoryLayerEntry['kind']): string {
  switch (kind) {
    case 'chapters': return t('memory.kindChapters')
    case 'volume': return t('memory.kindVolume')
    case 'book': return t('memory.kindBook')
    case 'shared': return t('memory.kindShared')
    default: return t('memory.kindUnknown')
  }
}

function catalogLine(e: MemoryLayerEntry, level: 1 | 2 | 3): string {
  const label = `[${kindLabel(e.kind)}]${e.loadMode === 'manual' ? '[manual]' : ''} ${e.file.replace(/\.md$/, '')}`
  if (level === 3) return `- ${label}`
  const brief = level === 2 && e.brief.length > CATALOG_BRIEF_MAX_CHARS
    ? `${e.brief.slice(0, CATALOG_BRIEF_MAX_CHARS)}…`
    : e.brief
  return brief ? `- ${label}：${brief}` : `- ${label}`
}

/** 「…还有 N 条未列出」尾部提示的预算预留（降级档 2/3 才可能出现；不留预留会让整段超预算） */
const CATALOG_SUFFIX_RESERVE_TOKENS = 30

function renderCatalog(list: MemoryLayerEntry[], level: 1 | 2 | 3): { text: string; omitted: number } {
  const hint = level === 1 ? '' : level === 2 ? t('memory.catalogHintTruncated') : t('memory.catalogHintNamesOnly')
  const head = hint ? `${t('memory.catalogHeader')}\n${hint}` : t('memory.catalogHeader')
  // 档 2/3 可能带尾部「还有 N 条」提示，其预算先预留（档 1 无提示、不预留）
  let used = estimateTokens(head) + (level === 1 ? 0 : CATALOG_SUFFIX_RESERVE_TOKENS)
  const lines: string[] = []
  let omitted = 0
  for (const e of list) {
    const line = catalogLine(e, level)
    const cost = estimateTokens(line) + 1 // +1 ≈ 换行
    if (used + cost > MEMORY_CATALOG_BUDGET_TOKENS) { omitted++; continue } // 跳过而非中断（技能目录的 I2 教训）
    lines.push(line)
    used += cost
  }
  const suffix = omitted > 0 ? `\n${t('memory.catalogOmitted').replace('{n}', String(omitted))}` : ''
  return { text: `${head}\n${lines.join('\n')}${suffix}`, omitted }
}

/**
 * 名字目录：三级降级 —— ① brief 全 → ② brief 截 72 + 提示 → ③ 仅名字 + 提示。
 * 取第一个「无条目被挤出」的档位；三档都挤不完则用第三档并附「还有 N 条」。
 */
export function buildMemoryCatalog(entries: MemoryLayerEntry[]): { text: string; level: 1 | 2 | 3 } {
  const list = catalogEntries(entries)
  if (list.length === 0) return { text: '', level: 1 }
  for (const level of [1, 2, 3] as const) {
    const r = renderCatalog(list, level)
    if (r.omitted === 0) return { text: r.text, level }
  }
  return { text: renderCatalog(list, 3).text, level: 3 }
}

/** @ 提及 token（与 intent-router.parseMentions 阶段 2 同字符类，故用户输入习惯一致） */
const MENTION_TOKEN_RE = /@([^\s，。！？；：、（）《》【】·—…""'']+)/g

/**
 * manual 硬门控的判定：本轮消息是否**显式引用**了某条手动记忆（@文件名 / @去后缀名）。
 * 零 LLM 成本、零 IPC；只认完整 token 相等（`@book` 不会命中 `book-state`）。
 * 注：记忆文件在 `.novelforge/` 下，不在项目文件树的 @ 菜单里——这里是**独立判定**，
 * 不依赖 parseMentions（后者搜的是项目文件树）。
 */
export function matchMentionedManuals(userText: string, entries: MemoryLayerEntry[]): string[] {
  if (!userText) return []
  const manuals = entries.filter(e => e.loadMode === 'manual')
  if (manuals.length === 0) return []
  const tokens = new Set<string>()
  MENTION_TOKEN_RE.lastIndex = 0 // 共享 /g 实例有 lastIndex 状态，跨调用必须重置
  let m: RegExpExecArray | null
  while ((m = MENTION_TOKEN_RE.exec(userText)) !== null) tokens.add(m[1].toLowerCase())
  if (tokens.size === 0) return []
  return manuals
    .filter(e => tokens.has(e.file.toLowerCase()) || tokens.has(e.file.replace(/\.md$/, '').toLowerCase()))
    .map(e => e.file)
    .sort((a, b) => a.localeCompare(b))
}

/** 关键词打分（Denova 思路的 NF 版）：文件名 > 类型 > brief > 正文命中次数 */
export function scoreMemoryEntry(e: MemoryLayerEntry, body: string, keyword: string): number {
  const k = keyword.trim().toLowerCase()
  if (!k) return 0
  let score = 0
  if (e.file.toLowerCase().includes(k)) score += 4
  if (e.kind.toLowerCase().includes(k)) score += 3
  if (e.brief.toLowerCase().includes(k)) score += 2
  const hay = body.toLowerCase()
  let hits = 0
  let idx = hay.indexOf(k)
  while (idx >= 0 && hits < 10) {
    hits++
    idx = hay.indexOf(k, idx + k.length)
  }
  if (hits > 0) score += 1 + Math.min(hits, 3) * 0.1
  return score
}

/** 正文中首批命中行的提示（read_memory 关键词结果给出「在哪」） */
export function findLineHint(body: string, keyword: string, maxChars = 80): string {
  const k = keyword.trim().toLowerCase()
  if (!k) return ''
  for (const line of body.split('\n')) {
    const text = line.trim()
    if (text && text.toLowerCase().includes(k)) {
      return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
    }
  }
  return ''
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run src/services/agent/memory-layers.test.ts`
Expected: PASS。⚠️ 三条降级档位用例的**条数**是按 `estimateTokensHeuristic` 估算配的（zh-CN 下 CJK×1.5）；若实测档位不符，只调用例里的条数/`repeat` 次数（不得放宽断言），并在 ledger 记 Ruling。

- [ ] **Step 7: 三语守卫**

Run: `npx vitest run src/shared/locale.test.ts src/shared/i18n-key-guard.test.ts src/shared/i18n-structure-guard.test.ts`
Expected: PASS（新 key 三语齐全、被代码引用）

- [ ] **Step 8: 提交**

```bash
git add src/services/agent/memory-layers.ts src/services/agent/memory-layers.test.ts src/shared/locale-data/ui.ts src/shared/locale-data/agent.ts
git commit -F /tmp/commit-t2.txt   # feat: 记忆分层纯函数（常驻段/目录三级降级/@匹配/关键词打分）（C 档第一轮 T2）
```

---

### Task 3: 注入重构（常驻段 + 目录段 + manual 本轮注入 + 独立预算）

**Files:**
- Modify: `src/services/agent/context-builder.ts`（`buildAgentSystemSegmentsAsync` 重构；`assembleFinalPrompt` 增 `memoryResident`；删 `M2_BUDGET_TOKENS`/`SHARED_FLOOR_TOKENS`/`excerptLatestChapters`）
- Modify: `src/services/agent/context-usage.ts`（`ContextSegment` 增 `warning?: string`）
- Modify: `src/stores/agent-store.ts:592`（把本轮用户消息传给装配器）
- Modify: `src/services/agent/context-builder.test.ts`（改 3 条 + 新 6 条）

**Interfaces:**
- Consumes: Task 1 的 `MemoryFileMeta.loadMode/brief` 与 `normalizeLoadMode`；Task 2 的 `MemoryLayerEntry` / `residentEntries` / `catalogEntries` / `buildResidentSection` / `buildMemoryCatalog` / `matchMentionedManuals` / 三个预算常量
- Produces:
  - `buildAgentSystemSegmentsAsync(mode: AgentMode, userMessage?: string): Promise<AgentSystemSegmentsAsync>`，其中 `AgentSystemSegmentsAsync = { base; memoryResident; memoryM2; memoryM1; segments: ContextSegment[] }`
  - `assembleFinalPrompt(segments: { base; memoryM1; memoryM2; memoryResident?: string })`（上限 = `4700 + 常驻段 tokens`；降级链只丢 M2 → M1）

- [ ] **Step 1: 改既有测试为「新契约」（RED）**

`src/services/agent/context-builder.test.ts`：

1. **删除** `'章节文件尾部节选：满窗口时注入最新章节而非最早章节（F5）'` 整条（节选机制随分层取消）与 `'P3：shared 段保底——book 占满预算时 shared 保底配额仍注入'` 整条（保底配额取消）。
2. **替换** `'P3：kind=shared 文件参与 M2 节选（unknown 仍不注入）'` 为：

```ts
  it('P3 改造：shared 进名字目录（brief 到模型），正文不再自动注入；unknown 仍排除', async () => {
    mockInvoke.mockImplementation(async (ch: string, file?: string) => {
      if (ch === 'memory:list') return [
        { file: 'shared.md', kind: 'shared', loadMode: 'auto', brief: '用户偏好爽文节奏', stale: false, mtime: 3 },
        { file: 'notes.md', kind: 'unknown', loadMode: 'auto', brief: '私人笔记', stale: false, mtime: 2 },
      ]
      if (ch === 'memory:read') return file === 'shared.md'
        ? buildSharedFile(['用户偏好爽文节奏', '主角名苏晚晴'])
        : '# notes 私人笔记\n不该注入的内容'
      return null
    })
    const { memoryM2 } = await buildAgentSystemSegmentsAsync('quick')
    expect(memoryM2).toContain('用户偏好爽文节奏')   // brief 行
    expect(memoryM2).toContain('[共享]')             // kind 标签
    expect(memoryM2).not.toContain('主角名苏晚晴')   // 目录不含第二条正文
    expect(memoryM2).not.toContain('不该注入的内容')
  })
```

3. **新增** 六条用例（本任务的验收面）：

```ts
describe('记忆分层注入（C 档第一轮）', () => {
  // ⚠️ 本 describe 自建 mock：既有的 mockInvoke 声明在 M2 那个 describe 内部，此处不在作用域内
  const layerList = (files: Array<{ file: string; kind: string; loadMode: string; brief: string; stale: boolean; mtime: number }>) => files
  let mockInvoke: ReturnType<typeof vi.fn>
  beforeEach(() => {
    mockInvoke = vi.fn(async (ch: string): Promise<unknown> => (ch === 'memory:list' ? [] : null))
    Object.defineProperty(window, 'velaAPI', { value: { invoke: mockInvoke }, configurable: true })
    useAgentStore.setState({ conversations: [], activeConversationId: null })
  })

  it('常驻文件：全文进 memoryResident 段（不节选）+ 逐段明细', async () => {
    const body = '# 全书精要\n\n主角是苏晚晴，复仇线为主。'
    mockInvoke.mockImplementation(async (ch: string, file?: string) => {
      if (ch === 'memory:list') return layerList([{ file: 'book-state.md', kind: 'book', loadMode: 'resident', brief: '主角是苏晚晴', stale: false, mtime: 1 }])
      if (ch === 'memory:read') return file === 'book-state.md' ? `---\nload_mode: resident\n---\n${body}` : null
      return null
    })
    const seg = await buildAgentSystemSegmentsAsync('quick')
    expect(seg.memoryResident).toContain('主角是苏晚晴，复仇线为主。')
    expect(seg.memoryM2).toBe('')                                  // 常驻不进目录
    const detail = seg.segments.find(s => s.key === 'memory-resident')
    expect(detail?.tokens).toBeGreaterThan(0)
    expect(detail?.source).toContain('book-state.md')
  })

  it('常驻合计超硬上限：整段不注入 + 明细面板告警（不静默截断）', async () => {
    mockInvoke.mockImplementation(async (ch: string) => {
      if (ch === 'memory:list') return layerList([{ file: 'a.md', kind: 'book', loadMode: 'resident', brief: 'x', stale: false, mtime: 1 }])
      if (ch === 'memory:read') return `---\nload_mode: resident\n---\n${'详'.repeat(6000)}`
      return null
    })
    const seg = await buildAgentSystemSegmentsAsync('quick')
    expect(seg.memoryResident).toBe('')
    const detail = seg.segments.find(s => s.key === 'memory-resident')
    expect(detail?.tokens).toBe(0)
    expect(detail?.warning).toBeTruthy()
    expect(detail?.warning).toContain('4000')
  })

  it('常驻接近上限：仍注入，但明细带「接近上限」告警', async () => {
    mockInvoke.mockImplementation(async (ch: string) => {
      if (ch === 'memory:list') return layerList([{ file: 'a.md', kind: 'book', loadMode: 'resident', brief: 'x', stale: false, mtime: 1 }])
      if (ch === 'memory:read') return `---\nload_mode: resident\n---\n${'详'.repeat(2000)}`
      return null
    })
    const seg = await buildAgentSystemSegmentsAsync('quick')
    expect(seg.memoryResident).not.toBe('')
    expect(seg.segments.find(s => s.key === 'memory-resident')?.warning).toBeTruthy()
  })

  it('manual 硬门控：@提及 → 本轮注入正文；未提及 → 只有目录行', async () => {
    mockInvoke.mockImplementation(async (ch: string, file?: string) => {
      if (ch === 'memory:list') return layerList([{ file: 'book-state.md', kind: 'book', loadMode: 'manual', brief: '主角是苏晚晴', stale: false, mtime: 1 }])
      if (ch === 'memory:read') return file === 'book-state.md' ? '---\nload_mode: manual\n---\n# 全书精要\n主角是苏晚晴，复仇线为主。' : null
      return null
    })
    const without = await buildAgentSystemSegmentsAsync('quick', '帮我写第 3 章')
    expect(without.memoryM2).toContain('[manual]')          // 目录里知道它存在
    expect(without.memoryM2).not.toContain('复仇线为主')     // 但正文不注入
    const withMention = await buildAgentSystemSegmentsAsync('quick', '参考 @book-state 写第 3 章')
    expect(withMention.memoryM2).toContain('复仇线为主')
    expect(withMention.memoryM2).toContain('本轮显式引用')
  })

  it('stale 优先于分层：stale 的 manual 即使被 @ 也不注入', async () => {
    mockInvoke.mockImplementation(async (ch: string, file?: string) => {
      if (ch === 'memory:list') return layerList([{ file: 'book-state.md', kind: 'book', loadMode: 'manual', brief: 'x', stale: true, mtime: 1 }])
      if (ch === 'memory:read') return file === 'book-state.md' ? '---\nload_mode: manual\n---\n过期正文' : null
      return null
    })
    const seg = await buildAgentSystemSegmentsAsync('quick', '@book-state')
    expect(seg.memoryM2).not.toContain('过期正文')
  })

  it('常驻条目读盘失败（已删除）→ 跳过该条不崩，其余条目照常', async () => {
    mockInvoke.mockImplementation(async (ch: string, file?: string) => {
      if (ch === 'memory:list') return layerList([
        { file: 'gone.md', kind: 'book', loadMode: 'resident', brief: 'x', stale: false, mtime: 2 },
        { file: 'ok.md', kind: 'book', loadMode: 'resident', brief: 'y', stale: false, mtime: 1 },
      ])
      if (ch === 'memory:read') return file === 'gone.md' ? null : '---\nload_mode: resident\n---\n还在的记忆'
      return null
    })
    const seg = await buildAgentSystemSegmentsAsync('quick')
    expect(seg.memoryResident).toContain('还在的记忆')
  })
})

describe('assembleFinalPrompt 常驻段独立预算（C 档第一轮修正 1）', () => {
  const big = '内容'.repeat(4000)
  it('常驻段不参与降级链：超限时丢的是 M1 → M2，常驻保留', () => {
    const out = assembleFinalPrompt({ base: '## 身份', memoryM1: `M1=${big}`, memoryM2: `M2=${big}`, memoryResident: `R=常驻原文` })
    expect(out).toContain('R=常驻原文')
    expect(out).not.toContain('M1=')
    expect(out).not.toContain('M2=')
    expect(estimateTokens(out)).toBeLessThanOrEqual(4700 + estimateTokens('R=常驻原文'))
  })
  it('不传常驻段时上限仍为 4700（既有 6 条用例的行为不变）', () => {
    const out = assembleFinalPrompt({ base: '## 身份', memoryM1: `M1=${big}`, memoryM2: `M2=${big}` })
    expect(estimateTokens(out)).toBeLessThanOrEqual(4700)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/services/agent/context-builder.test.ts`
Expected: FAIL —— `memoryResident` 不存在 / manual 正文未注入 / 常驻未注入

- [ ] **Step 3: 实现（context-builder.ts）**

删掉 `M2_BUDGET_TOKENS`、`SHARED_FLOOR_TOKENS`、`excerptLatestChapters`（分层后无调用点）；顶部两处预算注释同步改写（`TOTAL_BUDGET_TOKENS` 的定义注释与文件头 L0-L2 说明），写清「4700 = 非常驻部分上限；常驻段按其自身硬上限另计」。import 换成：

```ts
import { parseMemoryFile } from '../memory/memory-codec'
import type { MemoryFileMeta } from '../memory/memory-codec'
import { normalizeLoadMode } from '../../shared/memory-types'
import {
  buildMemoryCatalog, buildResidentSection, catalogEntries, matchMentionedManuals, residentEntries,
  RESIDENT_MEMORY_BUDGET_TOKENS, RESIDENT_MEMORY_WARN_TOKENS,
  type MemoryLayerEntry,
} from './memory-layers'
```

`assembleFinalPrompt`（改动只有索引与 budget 两处，其余渐进式降级逻辑照旧）：

```ts
export function assembleFinalPrompt(segments: { base: string; memoryM1: string; memoryM2: string; memoryResident?: string }): string {
  const join = (xs: Array<string | undefined>) => xs.filter((x): x is string => Boolean(x)).join('\n\n---\n\n')
  // 索引：0=base，1=memoryResident，2=M2，3=M1
  const resident = segments.memoryResident ?? ''
  const parts: Array<string | undefined> = [segments.base, resident, segments.memoryM2, segments.memoryM1]
  const full = join(parts)
  // C 档第一轮修正 1：常驻段有**独立预算**（RESIDENT_MEMORY_BUDGET_TOKENS，超限整段丢弃而非截断）。
  // 若把它算进 4700，常驻一超 ~1300 tokens 就会在降级链里被整段丢掉——4000 的硬上限永远够不到，
  // 用户设了常驻却什么都看不到且无提示。故最终上限 = 4700 + 常驻实际 tokens。
  const budget = TOTAL_BUDGET_TOKENS + estimateTokens(resident)

  if (estimateTokens(full) <= budget) {
    return appendOutputLanguage(full, getCurrentLocale())
  }

  console.warn(`[ContextBuilder] 系统提示词过大 (${estimateTokens(full)} tokens)，按 M1 → M2 → L1 → Tool 顺序降级`)
  const langSuffix = appendOutputLanguage('', getCurrentLocale())
  const langTokens = estimateTokens(langSuffix)
  // 1. 先丢 M1 会话摘要段（压缩滚动摘要，非创作必需）
  parts[3] = undefined
  // 2. 仍超限丢 M2 作品记忆段（名字目录 + 本轮 manual 正文；常驻段 parts[1] 不参与降级）
  if (estimateTokens(join(parts)) > budget) parts[2] = undefined
  // 3. base 拆回节数组……（以下与现状一致，仅把所有 TOTAL_BUDGET_TOKENS 换成 budget）
```

> 第 3/4/5 步（L1 裁剪 / Tool 截断 / 兜底硬截断）的代码**保持原样**，只把 `TOTAL_BUDGET_TOKENS` 全部替换成 `budget`（`toolBudget`、`mainBudget` 两处）；`parts.slice(1)` 语义不变（现覆盖 resident+M2+M1，属正确口径）。

`buildAgentSystemSegmentsAsync` 全量替换：

```ts
/** 异步装配结果（C 档第一轮）：常驻段独立成段，明细段供 context 面板，M1/M2 保持既有降级语义 */
export interface AgentSystemSegmentsAsync {
  base: string
  /** 常驻记忆段（全文，独立预算，不进 4700 降级链） */
  memoryResident: string
  /** 名字目录 + 本轮显式引用的 manual 正文 */
  memoryM2: string
  memoryM1: string
  segments: ContextSegment[]
}

/**
 * 异步版：base + M1（同步段）+ 记忆分层两段（常驻 / 目录）。
 * `userMessage` 用于 manual 的**硬门控**判定（@文件名）——只影响本轮 system 段，
 * 不进会话历史，故后续轮次不会继承（每次 sendMessage 都重新装配）。
 */
export async function buildAgentSystemSegmentsAsync(mode: AgentMode, userMessage = ''): Promise<AgentSystemSegmentsAsync> {
  const { base, memory: m1, segments } = buildAgentSystemSegments(mode)
  let residentText = ''
  let m2 = ''
  try {
    const list = (await ipc.invoke('memory:list')) as MemoryFileMeta[]
    // stale 先行过滤（与既有口径一致）；F9 白名单保留——但**用户显式声明 resident 时尊重其选择**
    const entries: MemoryLayerEntry[] = list
      .filter(f => !f.stale)
      .filter(f => f.kind !== 'unknown' || normalizeLoadMode(f.loadMode) === 'resident')
      .map(f => ({
        file: f.file, kind: f.kind, loadMode: normalizeLoadMode(f.loadMode), brief: f.brief ?? '', range: f.range,
      }))

    // ===== 段 1：常驻记忆（全文，独立预算）=====
    const residents = residentEntries(entries)
    if (residents.length > 0) {
      const contents: Array<{ file: string; body: string }> = []
      for (const e of residents) {
        const raw = await ipc.invoke('memory:read', e.file) as string | null
        if (!raw) continue // 读失败/已被删除：跳过该条，不阻断其余条目
        contents.push({ file: e.file, body: (parseMemoryFile(raw) ?? { body: raw }).body })
      }
      const built = buildResidentSection(contents)
      const files = contents.map(c => c.file).join(', ')
      if (built.overCap) {
        console.warn(`[ContextBuilder] 常驻记忆 ${built.tokens} tokens 超过上限 ${RESIDENT_MEMORY_BUDGET_TOKENS}，本轮未注入`)
        segments.push({
          key: 'memory-resident', tokens: 0, chars: 0,
          warning: t('memory.residentOverCap')
            .replace('{tokens}', String(built.tokens))
            .replace('{cap}', String(RESIDENT_MEMORY_BUDGET_TOKENS)),
        })
      } else if (built.text) {
        residentText = built.text
        segments.push({
          key: 'memory-resident', tokens: built.tokens, chars: built.text.length,
          source: t('context.segSourceResident').replace('{files}', files),
          warning: built.tokens > RESIDENT_MEMORY_WARN_TOKENS
            ? t('memory.residentNearLimit')
              .replace('{tokens}', String(built.tokens))
              .replace('{cap}', String(RESIDENT_MEMORY_BUDGET_TOKENS))
            : undefined,
        })
      }
    }

    // ===== 段 2：名字目录（三级降级）+ 本轮 @ 提及的 manual 正文 =====
    const parts: string[] = []
    const catalog = buildMemoryCatalog(entries)
    if (catalog.text) {
      parts.push(catalog.text)
      segments.push({
        key: 'memory-catalog', tokens: estimateTokens(catalog.text), chars: catalog.text.length,
        source: t('context.segSourceCatalog').replace('{n}', String(catalogEntries(entries).length)),
      })
    }
    const bodies: string[] = []
    for (const file of matchMentionedManuals(userMessage, entries)) {
      const raw = await ipc.invoke('memory:read', file) as string | null
      if (!raw) continue
      bodies.push(`## ${file}\n\n${(parseMemoryFile(raw) ?? { body: raw }).body.trim()}`)
    }
    if (bodies.length > 0) {
      const manualText = `${t('memory.manualMentionHeader')}\n\n${bodies.join('\n\n')}`
      parts.push(manualText)
      // source 留空：段标签由 context.seg.memory-manual 提供（明细面板按 key 取标签）
      segments.push({
        key: 'memory-manual', tokens: estimateTokens(manualText), chars: manualText.length,
        source: bodies.map(b => b.split('\n')[0].replace(/^##\s*/, '')).join(', '),
      })
    }
    if (parts.length > 0) m2 = `${t('memory.injectedHeader')}\n\n${parts.join('\n\n')}`
  } catch {
    // 记忆读盘失败降级：base + M1 照常（不阻断对话）
  }
  return { base, memoryResident: residentText, memoryM2: m2, memoryM1: m1, segments }
}
```

同步入口 `buildAgentSystemPrompt` 与 `buildAgentSystemPromptAsync` 适配：

```ts
export function buildAgentSystemPrompt(mode: AgentMode): string {
  const segments = buildAgentSystemSegments(mode)
  return assembleFinalPrompt({ base: segments.base, memoryM1: segments.memory, memoryM2: '' })
}

export async function buildAgentSystemPromptAsync(mode: AgentMode, userMessage = ''): Promise<string> {
  const s = await buildAgentSystemSegmentsAsync(mode, userMessage)
  return assembleFinalPrompt({ base: s.base, memoryM1: s.memoryM1, memoryM2: s.memoryM2, memoryResident: s.memoryResident })
}
```

`src/services/agent/context-usage.ts`（`ContextSegment` 增一个可选字段）：

```ts
  /** 该段发生过截断（预算裁剪） */
  truncated?: boolean
  /** C 档第一轮：需在明细面板告警的原因（接近上限 / 超上限未注入） */
  warning?: string
```

`src/stores/agent-store.ts:592`：

```ts
      // 构建系统提示词（含项目上下文 + Tool 列表 + 记忆分层；manual 硬门控需要本轮用户消息）
      let systemPrompt = await buildAgentSystemPromptAsync(currentConv.mode, content.trim())
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/services/agent/context-builder.test.ts`
Expected: PASS（改写的既有用例 + 新增 8 条全绿）

- [ ] **Step 5: 全量门禁**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run`
Expected: 三条全绿。⚠️ `AgentConversation.test.tsx` 的两条记忆段用例会红：mock 的 `book-state.md` 缺 `loadMode` → 落到 auto（记忆段只剩目录），且常驻不再节选（`<= 800` 的断言不再成立）。本步先做最小可行修复让它转绿——mock 补 `loadMode: 'resident'` + 断言上限改 `RESIDENT_MEMORY_BUDGET_TOKENS`（4000）；Task 6 再用 `segments` 做完整改造。

- [ ] **Step 6: 提交**

```bash
git add src/services/agent/context-builder.ts src/services/agent/context-builder.test.ts src/services/agent/context-usage.ts src/stores/agent-store.ts
git commit -F /tmp/commit-t3.txt   # feat: 记忆分层注入重构（常驻段 + 目录段 + manual 硬门控）（C 档第一轮 T3）
```

---

### Task 4: `read_memory` 工具（按名 / 关键词 / 目录）

**Files:**
- Create: `src/services/agent/tools/read-memory.tool.ts`
- Create: `src/services/agent/tools/read-memory.tool.test.ts`
- Modify: `src/services/agent/tools/index.ts`（注册在 `readFileTool` 之后——靠前，避开工具提示词 1200 token 截断）
- Modify: `src/shared/locale-data/tool.ts`（`tool.readMemory*` 文案，三语）

**Interfaces:**
- Consumes: Task 1 的 `memory:list`（含 `loadMode`/`brief`）、`memory:read`；Task 2 的 `scoreMemoryEntry` / `findLineHint` / `buildMemoryCatalog` / `MemoryLayerEntry`
- Produces: `readMemoryTool`（`name: 'read_memory'`，`requiresConfirmation: false` → `isReadOnly: true`）

- [ ] **Step 1: 写失败测试**（`src/services/agent/tools/read-memory.tool.test.ts`）

```ts
/**
 * read_memory — 模型按名/关键词取作品记忆正文（C 档第一轮）。
 * 契约要点：manual 也放行（显式指定即「明确引用」）；未知名 → 错误 + 目录；
 * 关键词检索零 LLM 成本且对正则元字符安全。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readMemoryTool } from './read-memory.tool'
import { buildSharedFile } from '../../memory/shared-memory'
import { t } from '../../../shared/locale'

const LIST = [
  { file: 'book-state.md', kind: 'book', loadMode: 'manual', brief: '主角是苏晚晴', stale: false, mtime: 1 },
  { file: 'chapters-001-015.md', kind: 'chapters', loadMode: 'auto', brief: '关键事件：主角觉醒', range: '001-015', stale: false, mtime: 2 },
  { file: 'shared.md', kind: 'shared', loadMode: 'auto', brief: '用户偏好爽文节奏', stale: false, mtime: 3 },
]

const BODIES: Record<string, string> = {
  'book-state.md': '---\nload_mode: manual\n---\n# 全书精要\n\n主角是苏晚晴，复仇线为主。',
  'chapters-001-015.md': '---\nrange: 001-015\n---\n\n# 章节记忆 001-015\n\n## 第 1 章 · 开局\n- 关键事件：主角觉醒',
  'shared.md': buildSharedFile(['用户偏好爽文节奏', '主角名苏晚晴']),
}

beforeEach(() => {
  Object.defineProperty(window, 'velaAPI', {
    value: { invoke: vi.fn(async (ch: string, file?: string) => {
      if (ch === 'memory:list') return LIST
      if (ch === 'memory:read') return BODIES[file ?? ''] ?? null
      return null
    }) },
    configurable: true,
  })
})

describe('read_memory 工具', () => {
  it('只读、免确认（buildAgentTool 默认 isReadOnly = !requiresConfirmation）', () => {
    expect(readMemoryTool.requiresConfirmation).toBe(false)
    expect(readMemoryTool.isReadOnly).toBe(true)
  })

  it('按名取全文：manual 也放行（显式指定 = 明确引用）；返回正文而非 frontmatter 噪音', async () => {
    const res = await readMemoryTool.execute({ name: 'book-state' })     // 去后缀名可接受
    expect(res.success).toBe(true)
    expect(res.content).toContain('主角是苏晚晴，复仇线为主。')
    expect(res.content).not.toContain('load_mode')
  })

  it('未知名 → 失败 + 附可用记忆目录（模型能自行改道）', async () => {
    const res = await readMemoryTool.execute({ name: 'nope' })
    expect(res.success).toBe(false)
    expect(res.error).toContain('nope')
    expect(res.error).toContain('shared')      // 目录里点名可用文件
  })

  it('关键词：命中 name/kind/brief/正文并给出位置提示；正则元字符不抛错', async () => {
    const hit = await readMemoryTool.execute({ keyword: '觉醒' })
    expect(hit.success).toBe(true)
    expect(hit.content).toContain('chapters-001-015')
    expect(hit.content).toContain('关键事件：主角觉醒')
    const meta = await readMemoryTool.execute({ keyword: '第1章(' })
    expect(meta.success).toBe(true)            // 无命中也是成功（内容为空提示）
    expect(meta.content).toContain(t('tool.readMemoryNoMatch').split('{')[0])
  })

  it('type 过滤：只检索指定 kind', async () => {
    const res = await readMemoryTool.execute({ keyword: '苏晚晴', type: 'shared' })
    expect(res.content).toContain('shared')
    expect(res.content).not.toContain('book-state')
  })

  it('无参数 → 返回名字目录（与注入的目录段同源；含 kind 标签）', async () => {
    const res = await readMemoryTool.execute({})
    expect(res.success).toBe(true)
    expect(res.content).toContain('[共享] shared')
    expect(res.content).toContain('[全书][manual] book-state')
  })

  it('无记忆文件 → 明确空态提示（不是失败）', async () => {
    ;(window.velaAPI.invoke as ReturnType<typeof vi.fn>).mockImplementation(async (ch: string) => (ch === 'memory:list' ? [] : null))
    const res = await readMemoryTool.execute({})
    expect(res.success).toBe(true)
    expect(res.content).toBe(t('tool.readMemoryEmpty'))
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/services/agent/tools/read-memory.tool.test.ts`
Expected: FAIL —— `Failed to resolve import "./read-memory.tool"`

- [ ] **Step 3: 追加三语文案**（`src/shared/locale-data/tool.ts` 末尾 `'tool.updateConfigInvalidNumber'` 之后）

```ts
  // --- 记忆分层：read_memory（C 档第一轮）---
  'tool.readMemoryDesc': { 'zh-CN': '读取作品记忆文件（.novelforge/memory/*.md：全书精要 / 分卷 / 章节区间 / 跨会话共享事实）。系统提示词里的「记忆目录」只给出一行摘要——需要某条记忆的正文时用本工具按名或关键词取。与 search_knowledge 的分工：后者查知识库（向量/FTS 检索导入的参考文档），本工具查**作品自身的结构化记忆**。', 'en-US': 'Read story memory files (.novelforge/memory/*.md: book summary / volume / chapter ranges / cross-session shared facts). The memory catalog in the system prompt only lists one-line summaries — use this tool to fetch the body by name or keyword. Difference from search_knowledge: that one searches the knowledge base (vector/FTS over imported references); this one reads the book\'s own structured memory.', 'ru-RU': 'Чтение файлов памяти произведения (.novelforge/memory/*.md: сводка книги / том / диапазоны глав / общие факты). Каталог памяти в системном запросе даёт только строку-сводку — этим инструментом запрашивается полный текст по имени или ключевому слову. Отличие от search_knowledge: тот ищет по базе знаний, этот — по собственной структурированной памяти произведения.' },
  'tool.readMemoryName': { 'zh-CN': '记忆文件名（可省略 .md 后缀）。例如 "book-state"、"chapters-001-015"、"shared"', 'en-US': 'Memory file name (.md suffix optional), e.g. "book-state", "chapters-001-015", "shared"', 'ru-RU': 'Имя файла памяти (суффикс .md необязателен), напр. "book-state", "chapters-001-015", "shared"' },
  'tool.readMemoryKeyword': { 'zh-CN': '关键词（与 name 二选一）：按 文件名 > 类型 > 摘要 > 正文 打分，返回命中最高的若干条及其位置提示', 'en-US': 'Keyword (alternative to name): scores by file name > type > summary > body and returns the top matches with a location hint', 'ru-RU': 'Ключевое слово (вместо name): оценка по имени > типу > сводке > тексту, возвращает лучшие совпадения с подсказкой места' },
  'tool.readMemoryType': { 'zh-CN': '限定记忆类型（可选）：chapters 章节区间 / volume 分卷 / book 全书 / shared 跨会话共享事实', 'en-US': 'Restrict memory type (optional): chapters / volume / book / shared', 'ru-RU': 'Ограничить тип памяти (необязательно): chapters / volume / book / shared' },
  'tool.readMemoryContent': { 'zh-CN': '📖 记忆文件：{name}\n\n{content}', 'en-US': '📖 Memory file: {name}\n\n{content}', 'ru-RU': '📖 Файл памяти: {name}\n\n{content}' },
  'tool.readMemoryNotFound': { 'zh-CN': '未找到记忆文件：{name}\n\n可用记忆：\n{catalog}', 'en-US': 'Memory file not found: {name}\n\nAvailable memory:\n{catalog}', 'ru-RU': 'Файл памяти не найден: {name}\n\nДоступная память:\n{catalog}' },
  'tool.readMemoryMatches': { 'zh-CN': '匹配「{keyword}」的记忆（{count} 条，按相关度排序）：\n{items}', 'en-US': 'Memory matching "{keyword}" ({count} entries, by relevance):\n{items}', 'ru-RU': 'Память по запросу «{keyword}» ({count} записей, по релевантности):\n{items}' },
  'tool.readMemoryHit': { 'zh-CN': '- {name}（{kind}）：{brief}{hint}', 'en-US': '- {name} ({kind}): {brief}{hint}', 'ru-RU': '- {name} ({kind}): {brief}{hint}' },
  'tool.readMemoryHitHint': { 'zh-CN': '\n  ↳ {line}', 'en-US': '\n  ↳ {line}', 'ru-RU': '\n  ↳ {line}' },
  'tool.readMemoryNoMatch': { 'zh-CN': '没有匹配「{keyword}」的记忆条目。\n\n{catalog}', 'en-US': 'No memory entry matches "{keyword}".\n\n{catalog}', 'ru-RU': 'Нет записей памяти по «{keyword}».\n\n{catalog}' },
  'tool.readMemoryEmpty': { 'zh-CN': '暂无记忆文件（章节定稿后自动生成；也可手动在 .novelforge/memory/ 下添加 .md 文件）', 'en-US': 'No memory files yet (generated after finalizing chapters; you can also add .md files under .novelforge/memory/)', 'ru-RU': 'Файлов памяти пока нет (создаются после финализации глав; можно добавить .md в .novelforge/memory/)' },
```

- [ ] **Step 4: 实现 `src/services/agent/tools/read-memory.tool.ts`**

```ts
/**
 * read_memory — 按名 / 关键词读取作品记忆（C 档第一轮）
 *
 * 定位：系统提示词的「记忆目录」只给一行摘要，正文由此工具按需取（Denova lore 的 NF 版）。
 * 只读、免确认；manual 条目**也放行**——显式按名取就是 spec §3.4 里的「明确引用」。
 * 与 search_knowledge 的分工写在工具描述里（前者查知识库，本工具查作品记忆文件）。
 */
import { t } from '../../../shared/locale'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { parseMemoryFile } from '../../memory/memory-codec'
import type { MemoryFileMeta } from '../../memory/memory-codec'
import { normalizeLoadMode } from '../../../shared/memory-types'
import { buildMemoryCatalog, findLineHint, scoreMemoryEntry, type MemoryLayerEntry } from '../memory-layers'

/** 关键词检索返回条数上限（防止一次拉回整本记忆） */
const MEMORY_SEARCH_TOP_K = 5

function toEntries(list: MemoryFileMeta[]): MemoryLayerEntry[] {
  return list.map(f => ({
    file: f.file, kind: f.kind, loadMode: normalizeLoadMode(f.loadMode), brief: f.brief ?? '', range: f.range,
  }))
}

async function listEntries(): Promise<MemoryLayerEntry[]> {
  const list = await ipc.invoke('memory:list') as MemoryFileMeta[] | null
  return toEntries(Array.isArray(list) ? list : [])
}

async function readBody(file: string): Promise<string | null> {
  const raw = await ipc.invoke('memory:read', file) as string | null
  if (raw === null || raw === undefined) return null
  return (parseMemoryFile(raw) ?? { body: raw }).body.trim()
}

function kindLabel(kind: MemoryLayerEntry['kind']): string {
  switch (kind) {
    case 'chapters': return t('memory.kindChapters')
    case 'volume': return t('memory.kindVolume')
    case 'book': return t('memory.kindBook')
    case 'shared': return t('memory.kindShared')
    default: return t('memory.kindUnknown')
  }
}

export const readMemoryTool = buildAgentTool({
  name: 'read_memory',
  description: t('tool.readMemoryDesc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: t('tool.readMemoryName') },
      keyword: { type: 'string', description: t('tool.readMemoryKeyword') },
      type: { type: 'string', description: t('tool.readMemoryType'), enum: ['chapters', 'volume', 'book', 'shared'] },
    },
  },
  requiresConfirmation: false,
  execute: async (args) => {
    const name = (args.name as string | undefined)?.trim()
    const keyword = (args.keyword as string | undefined)?.trim()
    const type = args.type as MemoryLayerEntry['kind'] | undefined

    let entries: MemoryLayerEntry[]
    try {
      entries = await listEntries()
    } catch {
      return { success: false, content: '', error: t('error.noProject') }
    }
    const scoped = type ? entries.filter(e => e.kind === type) : entries
    const catalog = buildMemoryCatalog(scoped).text

    if (name) {
      // 容忍去后缀名；未知名 → 失败 + 目录（模型据此改道）
      const normalized = name.replace(/\.md$/, '').toLowerCase()
      const hit = scoped.find(e => e.file.toLowerCase() === name.toLowerCase() || e.file.replace(/\.md$/, '').toLowerCase() === normalized)
      const file = hit?.file ?? (/\.md$/i.test(name) ? name : `${name}.md`)
      const body = await readBody(file)
      if (body === null) {
        return { success: false, content: '', error: t('tool.readMemoryNotFound').replace('{name}', file).replace('{catalog}', catalog || t('tool.readMemoryEmpty')) }
      }
      return { success: true, content: t('tool.readMemoryContent').replace('{name}', file).replace('{content}', body) }
    }

    if (keyword) {
      const scored: Array<{ e: MemoryLayerEntry; score: number; hint: string }> = []
      for (const e of scoped) {
        const body = await readBody(e.file)
        if (body === null) continue
        const score = scoreMemoryEntry(e, body, keyword)
        if (score > 0) scored.push({ e, score, hint: findLineHint(body, keyword) })
      }
      scored.sort((a, b) => b.score - a.score || a.e.file.localeCompare(b.e.file))
      const top = scored.slice(0, MEMORY_SEARCH_TOP_K)
      if (top.length === 0) {
        return { success: true, content: t('tool.readMemoryNoMatch').replace('{keyword}', keyword).replace('{catalog}', catalog || t('tool.readMemoryEmpty')) }
      }
      const items = top.map(({ e, hint }) => t('tool.readMemoryHit')
        .replace('{name}', e.file)
        .replace('{kind}', kindLabel(e.kind))
        .replace('{brief}', e.brief || '—')
        .replace('{hint}', hint ? t('tool.readMemoryHitHint').replace('{line}', hint) : '')).join('\n')
      return { success: true, content: t('tool.readMemoryMatches').replace('{keyword}', keyword).replace('{count}', String(top.length)).replace('{items}', items) }
    }

    return { success: true, content: catalog || t('tool.readMemoryEmpty') }
  },
})
```

- [ ] **Step 5: 注册（`src/services/agent/tools/index.ts`）**

```ts
import { readMemoryTool } from './read-memory.tool'
```
```ts
  // 只读 Tool（自动执行）
  readFileTool,
  // 记忆分层（C 档第一轮）：按名/关键词取作品记忆正文 —— 必须靠前：
  // 工具提示词有 1200 token 截断，排太后契约不可见（技能轮 I1 的教训）
  readMemoryTool,
  searchKnowledgeTool,
```

- [ ] **Step 6: 跑工具测试 + 契约可见性测试**

先在 `read-memory.tool.test.ts` 追加一条（同文件，避免测试基建重复）：

```ts
describe('read_memory 在工具提示词中的契约可见性（1200 token 截断线内）', () => {
  it('注册后 buildAgentSystemSegments 的 base 段含 read_memory 与其参数名', async () => {
    vi.resetModules()
    const { registerBuiltinTools } = await import('./index')
    const { buildAgentSystemSegments } = await import('../context-builder')
    registerBuiltinTools()
    const { base } = buildAgentSystemSegments('balanced')
    expect(base).toContain('read_memory')
    expect(base).toContain(t('tool.readMemoryKeyword'))
  })
})
```

Run: `npx vitest run src/services/agent/tools/read-memory.tool.test.ts`
Expected: PASS（`vi.resetModules` 保证注册表干净；若 base 段因残留注册被截断，见 Task 2 的 Ruling 惯例——调断言位置而非放宽内容）

- [ ] **Step 7: 全量门禁**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run`
Expected: 三条全绿

- [ ] **Step 8: 提交**

```bash
git add src/services/agent/tools/read-memory.tool.ts src/services/agent/tools/read-memory.tool.test.ts src/services/agent/tools/index.ts src/shared/locale-data/tool.ts
git commit -F /tmp/commit-t4.txt   # feat: read_memory 工具（按名/关键词/目录取作品记忆）（C 档第一轮 T4）
```

---

### Task 5: 记忆视图 —— 加载方式选择器 + 常驻总量指示

**Files:**
- Create: `src/services/memory/load-mode.ts`
- Create: `src/services/memory/load-mode.test.ts`
- Modify: `src/components/panels/sidebar/MemoryGroup.tsx:118-247`（`MemoryList` / `MemoryRow` 增 `showLoadMode`）
- Modify: `src/components/panels/agent/AgentMemoryView.tsx`（常驻总量指示 + 选择器接线）
- Modify: `src/components/panels/agent/AgentMemoryView.test.tsx`（**已存在**：5 条既有用例；在文件末尾追加一个新 describe，并给既有 `memory:list` mock 补 `loadMode`/`brief` 字段）

**Interfaces:**
- Consumes: Task 1 的 `setLoadModeFrontmatter`、`MemoryFileMeta.loadMode`；Task 2 的 `buildResidentSection` / `RESIDENT_MEMORY_BUDGET_TOKENS` / `RESIDENT_MEMORY_WARN_TOKENS`
- Produces: `changeMemoryLoadMode(file: string, mode: MemoryLoadMode): Promise<LoadModeChangeResult>`；`sumResidentSectionTokens(files: string[]): Promise<{ tokens: number; overCap: boolean }>`；`MemoryList` / `MemoryRow` 的 `showLoadMode?: boolean` + `onLoadModeChange?: (file: string, mode: MemoryLoadMode) => void`

- [ ] **Step 1: 写失败测试**（`src/services/memory/load-mode.test.ts`）

```ts
/** 加载方式写回链路（C 档第一轮）：读-改-写 + 编辑器脏检查守卫 + 常驻合计 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { changeMemoryLoadMode, sumResidentSectionTokens } from './load-mode'
import { useEditorStore } from '../../stores/editor-store'

const TAB_ID = 'vela://memory/book-state.md'
const RAW = '---\ntype: shared\n---\n\n# 全书精要\n主角是苏晚晴'

let invoke: ReturnType<typeof vi.fn>
beforeEach(() => {
  useEditorStore.setState({ tabs: [], activeTabId: null })
  // ⚠️ 只声明用得到的形参：尾部未使用参数会被 tsc 的 noUnusedParameters 拒绝
  invoke = vi.fn(async (ch: string) => {
    if (ch === 'memory:read') return RAW
    if (ch === 'memory:write') return { success: true }
    return null
  })
  Object.defineProperty(window, 'velaAPI', { value: { invoke }, configurable: true })
})

describe('changeMemoryLoadMode', () => {
  it('读-改-写：写回的文件带 load_mode 且原有键与正文保留', async () => {
    const res = await changeMemoryLoadMode('book-state.md', 'resident')
    expect(res).toEqual({ ok: true, mode: 'resident' })
    expect(invoke).toHaveBeenCalledWith('memory:write', 'book-state.md', '---\ntype: shared\nload_mode: resident\n---\n\n# 全书精要\n主角是苏晚晴')
  })
  it('切回 auto → 删除该键', async () => {
    invoke.mockImplementation(async (ch: string) => (ch === 'memory:read' ? '---\nload_mode: resident\n---\n正文' : { success: true }))
    await changeMemoryLoadMode('book-state.md', 'auto')
    expect(invoke).toHaveBeenCalledWith('memory:write', 'book-state.md', '正文')
  })
  it('编辑器里有未保存修改 → 不写盘（不覆盖用户的未保存内容）', async () => {
    useEditorStore.setState({ tabs: [{ id: TAB_ID, name: 'book-state.md', type: 'memory', filePath: TAB_ID, content: '改了一半', dirty: true }] })
    const res = await changeMemoryLoadMode('book-state.md', 'resident')
    expect(res).toEqual({ ok: false, reason: 'dirty' })
    expect(invoke).not.toHaveBeenCalledWith('memory:write', expect.anything(), expect.anything())
  })
  it('编辑器有同一文件的干净标签页 → 写盘后静默同步标签页内容', async () => {
    useEditorStore.setState({ tabs: [{ id: TAB_ID, name: 'book-state.md', type: 'memory', filePath: TAB_ID, content: RAW, dirty: false }] })
    await changeMemoryLoadMode('book-state.md', 'manual')
    expect(useEditorStore.getState().tabs[0].content).toContain('load_mode: manual')
    expect(useEditorStore.getState().tabs[0].dirty).toBe(false)
  })
  it('文件不存在 → readFailed；写盘失败 → writeFailed（都不抛）', async () => {
    invoke.mockImplementation(async (ch: string) => (ch === 'memory:read' ? null : { success: false }))
    expect(await changeMemoryLoadMode('gone.md', 'resident')).toEqual({ ok: false, reason: 'readFailed' })
    invoke.mockImplementation(async (ch: string) => (ch === 'memory:read' ? RAW : { success: false }))
    expect(await changeMemoryLoadMode('book-state.md', 'resident')).toEqual({ ok: false, reason: 'writeFailed' })
  })
})

describe('sumResidentSectionTokens', () => {
  it('与注入同口径（同一个 buildResidentSection）；空列表为 0', async () => {
    expect(await sumResidentSectionTokens([])).toEqual({ tokens: 0, overCap: false })
    const { tokens, overCap } = await sumResidentSectionTokens(['book-state.md'])
    expect(tokens).toBeGreaterThan(0)
    expect(overCap).toBe(false)
  })
  it('读盘失败的文件被跳过（不抛出）', async () => {
    invoke.mockImplementation(async () => null)
    expect(await sumResidentSectionTokens(['a.md', 'b.md'])).toEqual({ tokens: 0, overCap: false })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/services/memory/load-mode.test.ts`
Expected: FAIL —— `Failed to resolve import "./load-mode"`

- [ ] **Step 3: 实现 `src/services/memory/load-mode.ts`**

```ts
/**
 * 记忆加载方式（C 档第一轮）：写回链路 + 编辑器守卫 + 常驻合计。
 *
 * 写回走既有 memory:read → setLoadModeFrontmatter → memory:write（读-改-写，主进程 tmp+rename
 * 原子落盘），**不新增 IPC 通道**。编辑器守卫：同一文件在编辑器里有未保存修改时拒绝切换——
 * 否则用户随后保存会用旧 frontmatter 覆盖刚写入的 load_mode（静默丢失）。
 */
import { ipc } from '../ipc-client'
import { VELA } from '../vela-protocol'
import { useEditorStore } from '../../stores/editor-store'
import { parseMemoryFile, setLoadModeFrontmatter } from './memory-codec'
import { buildResidentSection } from '../agent/memory-layers'
import type { MemoryLoadMode } from '../../shared/memory-types'

export type LoadModeChangeResult =
  | { ok: true; mode: MemoryLoadMode }
  | { ok: false; reason: 'dirty' | 'readFailed' | 'writeFailed' }

export async function changeMemoryLoadMode(file: string, mode: MemoryLoadMode): Promise<LoadModeChangeResult> {
  const tabId = `${VELA.MEMORY}${file}`
  const tab = useEditorStore.getState().tabs.find(t => t.id === tabId || t.filePath === tabId)
  if (tab?.dirty) return { ok: false, reason: 'dirty' }

  const raw = await ipc.invoke('memory:read', file)
  if (raw === null || raw === undefined) return { ok: false, reason: 'readFailed' }
  const updated = setLoadModeFrontmatter(raw, mode)
  const res = await ipc.invoke('memory:write', file, updated)
  if (!res?.success) return { ok: false, reason: 'writeFailed' }
  // 干净标签页静默同步（dirty 不标记也不清除）；脏标签页前面已拦下
  if (tab) useEditorStore.getState().syncTabContent(tab.id, updated)
  return { ok: true, mode }
}

/** 常驻合计（与注入同一口径：同一个 buildResidentSection）——视图里的「常驻 N / 4000」指示 */
export async function sumResidentSectionTokens(files: string[]): Promise<{ tokens: number; overCap: boolean }> {
  const contents: Array<{ file: string; body: string }> = []
  for (const file of files) {
    try {
      const raw = await ipc.invoke('memory:read', file)
      if (raw === null || raw === undefined) continue
      contents.push({ file, body: (parseMemoryFile(raw) ?? { body: raw }).body })
    } catch {
      // 读盘失败跳过该条（与装配口径一致）
    }
  }
  const built = buildResidentSection(contents)
  return { tokens: built.tokens, overCap: built.overCap }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/services/memory/load-mode.test.ts`
Expected: PASS 7/7

- [ ] **Step 5: 写 UI 失败测试**（追加到**既有** `src/components/panels/agent/AgentMemoryView.test.tsx` 末尾）

先给既有文件级 `beforeEach` 的 `memory:list` mock 补两个新字段（TypeScript 不会报错——mock 返回 `unknown`，但 UI 拿不到 `loadMode` 就渲染不出当前值）：

```ts
          if (ch === 'memory:list') {
            return [
              { file: 'book-state.md', kind: 'book', loadMode: 'resident', brief: '主角是苏晚晴', stale: false, mtime: 1 },
              { file: 'shared.md', kind: 'shared', loadMode: 'auto', brief: '用户偏好爽文节奏', stale: true, mtime: 2 },
            ]
          }
```

然后在文件末尾追加（复用文件已有的 `render` / `openProject` 助手与 `as never` 类型绕过惯例）：

```tsx
describe('AgentMemoryView 加载方式选择器 + 常驻总量（C 档第一轮）', () => {
  let invoke: ReturnType<typeof vi.fn>
  const FILES = [
    { file: 'book-state.md', kind: 'book', loadMode: 'resident', brief: '主角是苏晚晴', stale: false, mtime: 1 },
    { file: 'shared.md', kind: 'shared', loadMode: 'auto', brief: '用户偏好爽文节奏', stale: false, mtime: 2 },
  ]

  beforeEach(() => {
    document.body.innerHTML = ''
    useEditorStore.setState({ tabs: [], activeTabId: null })
    invoke = vi.fn(async (ch: string) => {
      if (ch === 'memory:list') return FILES
      if (ch === 'memory:read') return '---\nload_mode: resident\n---\n\n# 全书精要\n主角是苏晚晴'
      if (ch === 'memory:write') return { success: true }
      return null
    })
    Object.defineProperty(window, 'velaAPI', { value: { invoke }, configurable: true })
    openProject()
  })

  it('每行三态选择器 + 三档语义 title（选型解释面）', async () => {
    const { container, root } = render(<AgentMemoryView />)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(container.textContent).toContain('book-state.md')
    for (const label of [t('memory.loadModeResident'), t('memory.loadModeAuto'), t('memory.loadModeManual')]) {
      expect(container.textContent).toContain(label)
    }
    const btns = [...container.querySelectorAll('button')] as HTMLButtonElement[]
    expect(btns.filter(b => b.title === t('memory.loadModeAutoHint')).length).toBe(FILES.length)
    act(() => { root.unmount() })
  })

  it('点「手动」→ 读-改-写 load_mode: manual，并刷新列表', async () => {
    const { container, root } = render(<AgentMemoryView />)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    const manualBtn = [...container.querySelectorAll('button')].find(b => b.textContent === t('memory.loadModeManual')) as HTMLButtonElement
    act(() => { manualBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    // ⚠️ mock 声明的形参只有 (ch)，元组类型长度 1 —— 直接索引 [1]/[2] 会触发 TS2493；
    // 转成 unknown[] 再取（本项目既有踩坑：mock 泛型须显式声明参数类型）
    const write = invoke.mock.calls.find(c => c[0] === 'memory:write') as unknown[] | undefined
    expect(write?.[1]).toBe('book-state.md')          // 第一行是 book-state
    expect(String(write?.[2])).toContain('load_mode: manual')
    act(() => { root.unmount() })
  })

  it('常驻总量指示：与注入同源（常驻 N / 4000 tokens）', async () => {
    const { container, root } = render(<AgentMemoryView />)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(container.textContent).toMatch(/常驻记忆 \d+ \/ 4000 tokens/)
    act(() => { root.unmount() })
  })

  it('编辑器里有该文件未保存修改 → 不写盘（守卫，防静默覆盖用户编辑）', async () => {
    useEditorStore.setState({
      tabs: [{ id: 'vela://memory/book-state.md', name: 'book-state.md', type: 'memory', filePath: 'vela://memory/book-state.md', content: '改了一半', dirty: true }],
    })
    const { container, root } = render(<AgentMemoryView />)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    const manualBtn = [...container.querySelectorAll('button')].find(b => b.textContent === t('memory.loadModeManual')) as HTMLButtonElement
    act(() => { manualBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(invoke.mock.calls.some(c => c[0] === 'memory:write')).toBe(false)
    expect(useEditorStore.getState().tabs[0].content).toBe('改了一半')  // 编辑缓冲不动
    act(() => { root.unmount() })
  })
})
```

> 该 describe 需在文件顶部补 import：`import { t } from '../../../shared/locale'`（若已存在则跳过）。

- [ ] **Step 6: 跑 UI 测试确认失败**

Run: `npx vitest run src/components/panels/agent/AgentMemoryView.test.tsx`
Expected: FAIL —— 找不到「常驻 / 自动 / 手动」标签

- [ ] **Step 7: 实现 UI**

`src/components/panels/sidebar/MemoryGroup.tsx` —— `MemoryList` / `MemoryRow` 增可选开关（侧栏不传 → 行内按钮数不变，既有侧栏测试不受影响）：

```tsx
// MemoryList
export function MemoryList({ files, onRebuild, onSaved, showLoadMode, onLoadModeChange }: {
  files: MemoryFileMeta[]
  onRebuild: (f: MemoryFileMeta) => void
  onSaved: () => Promise<void>
  /** C 档第一轮：AI 面板的记忆视图开启加载方式选择器（侧栏不传——264px 放不下） */
  showLoadMode?: boolean
  onLoadModeChange?: (file: string, mode: MemoryLoadMode) => void
}) {
  return (
    <div className="space-y-1">
      {files.map(f => (
        <MemoryRow key={f.file} meta={f} onRebuild={() => onRebuild(f)} onSaved={onSaved}
          showLoadMode={showLoadMode} onLoadModeChange={onLoadModeChange} />
      ))}
    </div>
  )
}
```

```tsx
// MemoryRow：外层 border 容器内，在既有行 div **之后**（兄弟节点，避开 button 嵌套）追加选择器行
      {showLoadMode && (
        <div className="px-1.5 pb-1.5" style={{ borderTop: '1px solid var(--color-border)' }}>
          <SegmentedControl
            size="sm"
            fill
            value={meta.loadMode}
            onChange={(mode) => onLoadModeChange?.(meta.file, mode)}
            items={[
              { value: 'resident', label: t('memory.loadModeResident'), title: t('memory.loadModeResidentHint') },
              { value: 'auto', label: t('memory.loadModeAuto'), title: t('memory.loadModeAutoHint') },
              { value: 'manual', label: t('memory.loadModeManual'), title: t('memory.loadModeManualHint') },
            ]}
          />
        </div>
      )}
```

> import：`SegmentedControl` from `'../../ui/SegmentedControl'`，`type MemoryLoadMode` from `'../../../shared/memory-types'`。`MemoryRow` 的 props 同步加 `showLoadMode` / `onLoadModeChange`（可选）。

`src/components/panels/agent/AgentMemoryView.tsx`：

```tsx
// 新增 import（选择器本体在 MemoryGroup 的 MemoryRow，本组件只做指示与回调）
import { useState } from 'react'                     // 既有 import 只有 useEffect
import { toast } from '../../ui/Toast'
import { changeMemoryLoadMode, sumResidentSectionTokens } from '../../../services/memory/load-mode'
import { RESIDENT_MEMORY_BUDGET_TOKENS, RESIDENT_MEMORY_WARN_TOKENS } from '../../../services/agent/memory-layers'
import type { MemoryLoadMode } from '../../../shared/memory-types'
```

```tsx
  // 常驻合计（与注入同口径；文件列表变化时重算）——超警告阈值变色
  const [resident, setResident] = useState<{ tokens: number; overCap: boolean } | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const targets = files.filter(f => f.loadMode === 'resident').map(f => f.file)
        const usage = await sumResidentSectionTokens(targets)
        if (!cancelled) setResident(usage)
      } catch {
        if (!cancelled) setResident(null)
      }
    })()
    return () => { cancelled = true }
  }, [files])

  const handleLoadModeChange = async (file: string, mode: MemoryLoadMode) => {
    const res = await changeMemoryLoadMode(file, mode)
    if (res.ok) {
      toast.success(t('memory.loadModeSaved'))
      await load()
    } else {
      toast.error(t(res.reason === 'dirty' ? 'memory.loadModeDirty' : 'memory.loadModeFailed').replace('{error}', res.reason))
    }
  }
```

```tsx
      {/* 常驻合计指示（C 档第一轮）：超警告阈值黄、超硬上限红——用户能一眼看到"常驻吃了多少" */}
      {resident && (
        <div
          className="px-3 py-1 text-micro flex-shrink-0"
          style={{
            borderBottom: '1px solid var(--color-border)',
            color: resident.overCap || resident.tokens > RESIDENT_MEMORY_WARN_TOKENS ? 'var(--color-warning)' : 'var(--color-text-muted)',
          }}
        >
          {t('memory.residentTotal')
            .replace('{tokens}', String(resident.tokens))
            .replace('{cap}', String(RESIDENT_MEMORY_BUDGET_TOKENS))}
        </div>
      )}
```

```tsx
          <MemoryList
            key={projectPath}
            files={files}
            onRebuild={handleRebuild}
            onSaved={refresh}
            showLoadMode
            onLoadModeChange={(file, mode) => void handleLoadModeChange(file, mode)}
          />
```

- [ ] **Step 8: 跑测试确认通过**

Run: `npx vitest run src/components/panels/agent/AgentMemoryView.test.tsx src/components/panels/sidebar/MemoryGroup.test.tsx`
Expected: PASS（AgentMemoryView 既有 5 条 + 新增 4 条；侧栏既有 7 条全绿——侧栏不传 `showLoadMode`，行内按钮数仍为 3）

- [ ] **Step 9: 全量门禁**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run`
Expected: 三条全绿

- [ ] **Step 10: 提交**

```bash
git add src/services/memory/load-mode.ts src/services/memory/load-mode.test.ts src/components/panels/sidebar/MemoryGroup.tsx src/components/panels/agent/AgentMemoryView.tsx src/components/panels/agent/AgentMemoryView.test.tsx
git commit -F /tmp/commit-t5.txt   # feat: 记忆加载方式选择器与常驻总量指示（C 档第一轮 T5）
```

---

### Task 6: 上下文明细面板纳入分层段（含告警）

**Files:**
- Modify: `src/components/panels/agent/ContextBudgetBar.tsx:89-105`（`warning` 渲染）
- Modify: `src/components/panels/agent/AgentConversation.tsx:163-273`（async 段携带 `segments` 与 `memoryResident`）
- Modify: `src/components/panels/agent/AgentConversation.test.tsx`（fixture 改常驻 + 断言上限）

**Interfaces:**
- Consumes: Task 3 的 `AgentSystemSegmentsAsync.segments` / `memoryResident`；`ContextSegment.warning`

- [ ] **Step 1: 改测试（RED）**

`src/components/panels/agent/AgentConversation.test.tsx` 的 `beforeEach` mock 改为（`loadMode` 若已在 Task 3 补过，则本步只改断言）：

```ts
          if (ch === 'memory:list') return [{ file: 'book-state.md', kind: 'book', loadMode: 'resident', brief: '全书精要', stale: false, mtime: 1 }]
```

第一条用例的断言同步改写 —— **常驻不再节选**，上限是常驻段预算而非旧的 800：

```ts
    // 记忆段 = 常驻全文（不节选；分量见 RESIDENT_MEMORY_BUDGET_TOKENS）
    const memoryTokens = readMemoryToken(container)
    expect(memoryTokens).toBeGreaterThan(100)
    expect(memoryTokens).toBeLessThanOrEqual(RESIDENT_MEMORY_BUDGET_TOKENS)
```

并**在同一个 describe 内**（`AgentConversation 预算条记忆段（F3）`——它才有模型 mock 与 `readMemoryToken`）新增一条：

```ts
  it('常驻记忆段并入上下文明细（此前明细不含 M2；分层后常驻/目录/手动各有独立行）', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, messages: [{ id: 'm1', role: 'user', content: '你好', createdAt: Date.now() }] } : c),
    }))
    const { container, root } = render(<AgentConversation />)
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    // 展开明细浮层：圆环按钮的 title 是 ccr.clickForDetail（窄面板里唯一入口）
    const ring = [...container.querySelectorAll('button')].find(b => b.title === t('ccr.clickForDetail')) as HTMLButtonElement
    expect(ring).toBeTruthy()
    act(() => { ring.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(document.body.textContent).toContain(t('context.seg.memory-resident'))
    act(() => { root.unmount() })
  })
```

> 需在文件顶部 import `RESIDENT_MEMORY_BUDGET_TOKENS` from `'../../../services/agent/memory-layers'`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/components/panels/agent/AgentConversation.test.tsx`
Expected: FAIL —— 明细里没有「常驻记忆」行（`segments` 仍是同步段）

- [ ] **Step 3: 实现**

`AgentConversation.tsx`：`useAsyncSegments` 的类型与返回改为透传完整 async 结果：

```ts
/** 预算条 + 明细面板的数据源（C 档第一轮：并入常驻/目录/手动三段与逐段明细） */
type AsyncSegments = {
  base: string
  memoryM1: string
  memoryM2: string
  memoryResident: string
  segments: ContextSegment[]
}

function useAsyncSegments(activeConv: { id?: string; mode?: AgentMode } | null): AsyncSegments | null {
  const [loaded, setLoaded] = useState<{ key: string; segments: AsyncSegments } | null>(null)
  const projectPath = useProjectStore.getState().currentProject?.path ?? null
  const convId = activeConv?.id ?? ''
  const mode = activeConv?.mode ?? 'quick'
  const key = `${convId}|${mode}|${projectPath}`

  useEffect(() => {
    if (!convId) return
    let cancelled = false
    buildAgentSystemSegmentsAsync(mode)
      .then(segments => { if (!cancelled) setLoaded({ key, segments }) })
      .catch(() => { /* M2 读盘失败降级：保持同步兜底 */ })
    return () => { cancelled = true }
  }, [convId, mode, projectPath, key])

  return loaded && loaded.key === key ? loaded.segments : null
}
```

> `buildAgentSystemSegmentsAsync` 的返回类型已是 `AgentSystemSegmentsAsync`（Task 3），与 `AsyncSegments` 同形，故直接赋值即可；若 tsc 报结构不符，以 Task 3 的 `AgentSystemSegmentsAsync` 为准把 `AsyncSegments` 换成 `import type` 引用。

```ts
  const syncSegments = buildAgentSystemSegments(activeConv.mode)
  const usageSegments: AsyncSegments = asyncSegments ?? {
    base: syncSegments.base, memoryM1: syncSegments.memory, memoryM2: '', memoryResident: '', segments: syncSegments.segments,
  }
  ...
  const contextUsage = computeContextUsage({
    base: usageSegments.base,
    // 记忆段 = 常驻 + 目录 + 本轮手动 + M1（与 assembleFinalPrompt 的拼装顺序一致）
    memory: [usageSegments.memoryResident, usageSegments.memoryM2, usageSegments.memoryM1].filter(Boolean).join('\n\n---\n\n'),
    historyMessages: ...,
    currentContent: currentInput,
    modelMax,
    // B6 明细：改取 async 段（含常驻/目录/手动三段；此前只有同步段，M2 缺席）
    segments: usageSegments.segments,
  })
```

`ContextBudgetBar.tsx` 段行渲染改为：

```tsx
                  <span className="truncate">
                    {t(`context.seg.${seg.key}` as never)}
                    {seg.warning
                      ? <span title={seg.warning} style={{ color: 'var(--color-warning)' }}> ⚠</span>
                      : seg.truncated ? ' ✂' : ''}
                  </span>
```

> import 增 `ContextSegment` 类型（`AgentConversation.tsx` 已 import `computeContextUsage`，加 `type ContextSegment`）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/components/panels/agent/AgentConversation.test.tsx`
Expected: PASS（既有 2 条记忆段用例 + 新增 1 条）

- [ ] **Step 5: 全量门禁**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run`
Expected: 三条全绿，测试总数 ≥ 1990（当前 1969 + 本计划新增约 40）

- [ ] **Step 6: 手动冒烟（可选但推荐）**

`pnpm run dev` → 打开一个有记忆文件的项目 → AI 面板「记忆」按钮 → 逐条切换三档（观察常驻合计变化、目录标记）→ 在对话里发 `@book-state 帮我总结设定` → 确认被 `@` 的条目正文进入上下文（明细面板可见「手动记忆（本轮引用）」行）。

- [ ] **Step 7: 提交**

```bash
git add src/components/panels/agent/ContextBudgetBar.tsx src/components/panels/agent/AgentConversation.tsx src/components/panels/agent/AgentConversation.test.tsx
git commit -F /tmp/commit-t6.txt   # feat: 上下文明细纳入记忆分层段与告警（C 档第一轮 T6）
```

---

## 收尾（不在任务内，由执行流程负责）

1. 全量门禁最后一次：`npx tsc --noEmit && npx eslint . && npx vitest run`
2. 独立评审（opus + 新上下文）覆盖 6 笔提交的整段 diff，带本计划的 **Review Focus** 与 ledger 的 `Ruling:` 行
3. 评审的 Critical/Important 走**一次**修复轮（每项先 RED 后 GREEN），Minor 记 ledger 并汇报
4. 修复轮绿后推送并核对三平台 CI：

```powershell
$tok = gh auth token
$env:GIT_TERMINAL_PROMPT='0'; $env:GIT_ASKPASS=''
git -c http.sslBackend=openssl push "https://x-access-token:$tok@github.com/LunaRime/novelforge.git" master:master
```
```bash
gh run list --repo LunaRime/novelforge --limit 2 && gh run view <id> --json status,conclusion,jobs
```
