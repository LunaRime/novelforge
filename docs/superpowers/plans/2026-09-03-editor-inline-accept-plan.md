# L1 AI 改稿接选区 inline 接受实施计划（v1：单段 inline 接受闭环）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 CodeMirrorEditor 气泡 AI 改写的「弹窗 → 整段替换」升级为 **inline 接受会话**：AI 输出进入会话（原文不动 + 句级子 hunk 装饰），用户逐句接受/拒绝/整体接受，接受走可单步 undo 的独立事务，vela://draft 收尾产生唯一一条 refine revision 并清理旧 pending（v1 范围 = 设计 Phase 1）。

**Architecture:** 按设计 §3 四层落地：① `src/services/diff/` 纯函数 diff-core（paragraph-align 抽取 ThreeWayMerge DP 并补 char offsets + sentence-split 锚句 LCS 细分）；② editor-store 增 `inlineSession`（DiffSession 决策态，切 tab 不丢）；③ CodeMirrorEditor 增 hunk 装饰 StateField + 复用 :189-248 坐标基建的接受浮层 + 进度浮条，接受 = 带显式递增 `Transaction.time` 的独立 dispatch（R4）；④ A 入口收尾沿用现状 DB 通道（revision-create + 旧 pending 清理，R9），正文落库仍走 Ctrl+S/doSave 现状链路。

**Tech Stack:** TypeScript + React 19 + CodeMirror 6（`@codemirror/view ^6.41.0` / `@codemirror/state 6.7.1`，decorations/StateField/Compartment 已具备，零新依赖）+ Zustand + vitest + Electron（DB 侧零改动，不新增 IPC 通道）

**Spec:** `docs/superpowers/specs/2026-09-03-editor-inline-accept-design.md`（设计定稿 2026-09-03，裁决：v1 = A 气泡选区入口 + 句级子 hunk；v1.1/B 入口不实现）
**基线:** master @ `182fdcd`（`git rev-parse HEAD` 应等于 `182fdcd8db01408355dfc2635d23fae5fdfc95c1`）

## Global Constraints

- **v1 范围**（设计 §8 Phase 1 / §4.7）：diff-core 抽取 + offsets（§4.1）、句级子 hunk（§4.2）、CM UI 装饰/浮层/浮条/undo（§4.3）、editor-store 会话层（§4.4）、A 入口收尾落库（§4.5）。验收 = 设计 §8 Phase 1 六条（Task 6 逐条核对）。
- **非目标（无任务，任何任务不得触碰）**：v1.1 B 入口（修稿 revision 多 hunk 会话、EditorArea diff tab 分流、三栏切换回退、`applyMergedRevision` 完成合并）、agent 在位编辑流（工具写回编辑器）、词级 diff、跨会话/跨 revision undo、DB revision 半合并（不新增 IPC/DB 通道）、孤儿组件 DiffViewer/MonacoDiffViewer 清理、只读态（finalized/archived/manuscript/物理文件 tab）inline、审稿报告 inline。
- **行为兼容优先**：ThreeWayMerge 弹窗（diff tab + DraftEditor 两入口）行为**字节级零变化**——Task 1 回归锁；CodeMirrorEditor 无会话时**零可感知影响**（空 StateField + 无装饰 + 无浮条）。
- **undo 纪律（设计裁决 4）**：外部 content 同步保持 `Transaction.addToHistory.of(false)`（`CodeMirrorEditor.tsx:91-95` 既有模式，回归测试 `CodeMirrorEditor.test.tsx:147-163`）；程序化连续接受每子 hunk 一次独立 dispatch 且**显式递增 `Transaction.time`**（规避 CM history 500ms 事件合并，`CodeMirrorEditor.test.tsx:82-90` 实证）；拒绝 = 纯决策态变化，不产生 doc 事务、无 undo 事件。
- **样式纪律**：颜色只用 CSS 变量（`var(--color-*)`），禁止 `#xxx` / `bg-red-500` 类；z-index 只用语义变量（浮层 `--z-overlay`、浮条 `--z-sticky`）。
- **i18n 纪律（R11 + TextKey 严格 union）**：`TextKey = keyof typeof UI_TEXTS_DATA`（`locale.ts:115`），新 key 必须与使用它的代码**同任务先落**（否则 typecheck 红）；每个新 key 三语齐全（zh-CN/en-US/ru-RU）。key 前缀统一 `inlineAccept.*`。
- **质量门禁**：`pnpm run typecheck`、`pnpm run lint`（--max-warnings 0）、`pnpm run test` 全绿为每个任务收尾硬门槛；回归重点：CodeMirrorEditor undo 三用例（`CodeMirrorEditor.test.tsx:98-164`）、editor-store openFile 去重、ThreeWayMerge 弹窗行为、`@codemirror/state` 单实例（pnpm.overrides 6.7.1，不得动 package.json 依赖行）。
- **提交规范**：`feat:`/`fix:`/`test:`/`docs:` 前缀、一个提交一件事；不提交 `.claude/`、`CLAUDE.md`；版本号只在发版时改（本计划全程不碰 package.json version）。
- **环境注意（NovelForge/DSH 实测）**：受限 shell（沙箱）下 `pnpm run …` 会因沙箱 EPERM（子进程管道捕获限制）失败——替代：单测直跑 `node node_modules/vitest/vitest.mjs run <file>`（vitest 4.x 二进制在 `node_modules/vitest/vitest.mjs`），typecheck 用 `node node_modules/typescript/bin/tsc --noEmit`，eslint 用 `node node_modules/eslint/bin/eslint.js <file> --max-warnings 0`。全量 `pnpm run test` 若受限环境跑不动（EPERM），用最小 vitest config 替代（临时 `vitest.min.config.ts`：`defineConfig({ test: { include: [...需要文件], environment: 'node' } })`，只跑受影响文件），并把「全量门禁 + 提交前最终全量」留到无沙箱的完整环境执行一次；任何门禁命令的「全绿」断言必须附实际输出证据（verification-before-completion）。

---

### Task 1: diff-core 抽取——paragraph-align.ts + 弹窗行为回归锁

**Files:**
- Create: `src/services/diff/paragraph-align.ts`
- Create: `src/services/diff/paragraph-align.test.ts`
- Create: `src/components/editor/ThreeWayMerge.test.tsx`（jsdom，弹窗行为回归网——先于改组件写，改动前后都要绿）
- Modify: `src/components/editor/ThreeWayMerge.tsx`（删 :16-27 本地类型与 :38-269 文本工具/DP/segment 构造，改为 import 模块同名实现）

**Interfaces:**
- Consumes: 无（纯抽取，基线 = ThreeWayMerge.tsx 现状内部函数）
- Produces（Task 2/5 及弹窗复用，签名不得再改）:
  - `export interface ParaSpan { text: string; start: number; end: number }`（start = 段首非空行首字符在所属文本的 char offset；end = 段末字符后一位置，不含段后换行/空行）
  - `export type AlignOp = 'MATCH' | 'DELETE' | 'INSERT' | 'SPLIT_1_2' | 'SPLIT_1_3' | 'MERGE_2_1' | 'MERGE_3_1'`
  - `export interface AlignedPair { origIdx: number[]; modIdx: number[] }`
  - `export interface AlignedHunk { id: string; kind: AlignOp; origRange: { from: number; to: number }; origText: string; modText: string }`
  - `export interface MergeHunk { index: number; originalLines: string[]; modifiedLines: string[] }`
  - `export interface MergeSegment { type: 'same' | 'hunk'; lines?: string[]; hunk?: MergeHunk }`
  - `export function splitFrontmatter(text: string): { body: string; offset: number }`
  - `export function extractParagraphsWithOffsets(text: string): ParaSpan[]`
  - `export function alignParagraphs(orig: ParaSpan[], mod: ParaSpan[]): AlignedPair[]`
  - `export function computeParagraphHunks(original: string, modified: string): AlignedHunk[]`（offset 已折算回**传入 original 字符串的坐标**；删除+插入相邻对归一化为整段替换，kind 标 `'MATCH'`，见 Step 3 归一化说明）
  - `export function buildMergeSegments(original: string, modified: string): MergeSegment[]`（= 旧 computeSegments/buildSegments 语义，供弹窗 import，行为零变化）

- [ ] **Step 1: 先写弹窗行为回归测试（ThreeWayMerge.test.tsx）——改动前就绿**

`// @vitest-environment jsdom` 头 + 渲染辅助（参照 CodeMirrorEditor.test.tsx 的 render + 按钮文本查找模式；t() 默认 zh-CN，merge.applyAll='全部修稿 →'）：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import ThreeWayMerge from './ThreeWayMerge'

beforeAll(() => {
  Element.prototype.scrollTo = vi.fn() as never
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  }
})

const roots: Root[] = []
function renderMerge(original: string, modified: string) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const onComplete = vi.fn()
  act(() => {
    root.render(<ThreeWayMerge originalContent={original} modifiedContent={modified} onComplete={onComplete} />)
  })
  return { container, onComplete }
}
function findButton(container: HTMLElement, labelPart: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button'))
    .find(b => (b.textContent ?? '').includes(labelPart))
  expect(btn, `button containing "${labelPart}"`).toBeTruthy()
  return btn as HTMLButtonElement
}

describe('ThreeWayMerge 弹窗行为（抽取回归锁 R1）', () => {
  it('全部修稿 → 完成：onComplete 收到与 modifiedContent 逐字节一致的结果', () => {
    const original = '一\n\n二\n\n三'
    const modified = '一改\n\n二\n\n三'
    const { container, onComplete } = renderMerge(original, modified)
    act(() => { findButton(container, '全部修稿').click() })
    act(() => { findButton(container, '完成合并').click() })
    expect(onComplete).toHaveBeenCalledWith('一改\n\n二\n\n三')
  })
  it('不动任何 hunk → 完成：onComplete 返回 originalContent', () => {
    const original = '甲\n\n乙\n\n丙'
    const modified = '甲x\n\n乙\n\n丙'
    const { container, onComplete } = renderMerge(original, modified)
    act(() => { findButton(container, '完成合并').click() })
    expect(onComplete).toHaveBeenCalledWith('甲\n\n乙\n\n丙')
  })
  it('全部还原 → 完成：回到原稿', () => {
    const { container, onComplete } = renderMerge('A\n\nB', 'A2\n\nB')
    act(() => { findButton(container, '全部修稿').click() })
    act(() => { findButton(container, '全部原稿').click() })
    act(() => { findButton(container, '完成合并').click() })
    expect(onComplete).toHaveBeenCalledWith('A\n\nB')
  })
  it('段拆 1:2 与纯增段仍产出 hunk（完成 = 修稿全文）', () => {
    const original = '第一段\n\n第二段'
    const modified = '第一段甲\n\n第二段甲\n\n新增段落'  // 拆?/增段混合——仅验证完成输出 == 修稿正文
    const { container, onComplete } = renderMerge(original, modified)
    act(() => { findButton(container, '全部修稿').click() })
    act(() => { findButton(container, '完成合并').click() })
    expect(onComplete).toHaveBeenCalledWith(modified)
  })
})

afterEach(() => {
  roots.forEach(r => act(() => r.unmount()))
  roots.length = 0
  document.body.innerHTML = ''
})
```

- [ ] **Step 2: 跑测试确认当前状态绿（基线锁）**

Run: `node node_modules/vitest/vitest.mjs run src/components/editor/ThreeWayMerge.test.tsx`（受限 shell；完整环境可用 `pnpm vitest run …`）
Expected: PASS 4 条——现状组件私有 computeSegments 行为被锁住（此步必须绿，后续抽取/切换 import 后同样 4 条仍绿 = 字节级等价证据）。

- [ ] **Step 3: 实现 paragraph-align.ts（抽取 + 补 offsets + DEL/INS 归一化）**

新建目录 `src/services/diff/`。将 ThreeWayMerge.tsx 下述代码**逐字迁移**（只改两处：`const enum AlignOp` 数值枚举 → 字符串字面量 union；函数签名参数由 `string[]` 段落数组换成 `ParaSpan[]`，内部全部用 `p.text`）：

| 迁移源（ThreeWayMerge.tsx 现状行） | 落点（paragraph-align.ts） | 机械替换 |
|---|---|---|
| `stripFrontmatter`（:39-42） | `splitFrontmatter`（导出，返回 `{body, offset}`） | 返回偏移量 |
| `extractParagraphs`（:48-61） | `extractParagraphsWithOffsets` | 返回 `ParaSpan[]`（实现见下，行号算法逐行累计，段内多行/首尾空行/CRLF 语义与旧版一致） |
| `buildCharFreq`/`mergeFreqs`/`simFromFreqs`（:64-90） | 同名私有函数 | 逐字迁移，签名不变 |
| `AlignOp`/`AlignPair`（:95-102） | `AlignOp`（string union）/`AlignedPair`（导出） | 枚举值 `AlignOp.MATCH` → `'MATCH'`，`DELETE`→`'DELETE'`…（DP 内所有 `op[..]` 赋值/回溯 switch 同步改字符串） |
| `alignParagraphs`（:108-213） | `alignParagraphs(orig: ParaSpan[], mod: ParaSpan[])` | DP/回溯逻辑逐字，仅相似度等读取 `paras[i].text`；SIM_THRESH=0.15 / GAP=-0.05 / 1:1,1:2,1:3,2:1,3:1 全部保留 |
| `buildSegments`（:217-259）+ `computeSegments`（:262-269） | `buildMergeSegments` | 原样迁移（`isSame` 判定沿用原「行数组全等」逻辑——段落文本经 `paraToLines` 拆行 + `parasToLines` 插空行后 join 语义不变） |

`extractParagraphsWithOffsets` 与 `computeParagraphHunks` 的新写代码（模块其余部分为上述迁移）：

```ts
/** 去除 YAML frontmatter；返回正文与正文相对原文的偏移（R7：offset 需加回 frontmatter 长度） */
export function splitFrontmatter(text: string): { body: string; offset: number } {
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  return m ? { body: text.slice(m[0].length), offset: m[0].length } : { body: text, offset: 0 }
}

/**
 * 提取段落（空行是分隔符）+ 每段 char 偏移（相对传入 text）。
 * start = 段首非空行首字符；end = 段末字符后一位置（不含段后换行/空行）。
 * 逐行累计 offset，CRLF 下 \r 计入行宽（与 doc 字符一致，slice 回读自洽）。
 */
export function extractParagraphsWithOffsets(text: string): ParaSpan[] {
  const out: ParaSpan[] = []
  const lines = text.split('\n')
  let lineStart = 0
  let cur: string[] = []
  let curStart = -1
  let curEnd = -1
  const flush = () => {
    if (cur.length > 0) {
      out.push({ text: cur.join('\n'), start: curStart, end: curEnd })
      cur = []
    }
  }
  for (const line of lines) {
    const lineLen = line.length
    if (line.trim() === '') {
      flush() // 空行（含 CRLF 的 \r）分隔——与旧 extractParagraphs 的 trim()==='' 语义一致
    } else if (cur.length === 0) {
      curStart = lineStart
      curEnd = lineStart + lineLen
      cur.push(line)
    } else {
      curEnd = lineStart + lineLen
      cur.push(line)
    }
    lineStart += lineLen + 1 // +1 = 行尾换行符（\n）
  }
  flush()
  return out
}

/**
 * 计算段级 hunk（offset 已折算回「传入 original 的坐标」）。
 * 与 ThreeWayMerge.computeSegments 同语义（splitFrontmatter 逻辑保留）；
 * 差异 1：返回带 char 偏移的 AlignedHunk（hunk = 段文本有差异的对，kind 取该对的对齐操作）；
 * 差异 2（新增归一化，inline 消费用）：相邻且连续的「DELETE 段对 + INSERT 段对」
 *   （1:1 相似度 < SIM_THRESH 时 DP 会走 DELETE+INSERT 而非 MATCH，见 :157/161-162 打分）
 *   合并为单个整段替换 hunk（origRange = [删除段首, 删除段末]、kind='MATCH'），
 *   避免 inline 逐 hunk 接受时「先删后插」在段界产生粘连文本（设计 R6 同源防护）。
 *   弹窗路径不受影响——弹窗用 buildMergeSegments，保持旧的两段两 hunk 形态。
 */
export function computeParagraphHunks(original: string, modified: string): AlignedHunk[] {
  const { body: oBody, offset: oOff } = splitFrontmatter(original)
  const { body: mBody } = splitFrontmatter(modified)
  const oParas = extractParagraphsWithOffsets(oBody)
  const mParas = extractParagraphsWithOffsets(mBody)
  const pairs = alignParagraphs(oParas, mParas)

  const paraTexts = (paras: ParaSpan[], idxs: number[]): string =>
    idxs.map(i => paras[i].text).join('\n\n')

  // 收集 DELETE/INSERT 以便相邻合并
  const out: AlignedHunk[] = []
  let seq = 0
  const pushHunk = (pair: AlignedPair, kind: AlignOp) => {
    const oIdx = pair.origIdx
    const mIdx = pair.modIdx
    let from: number
    let to: number
    if (oIdx.length > 0) {
      from = oParas[oIdx[0]].start + oOff
      to = oParas[oIdx[oIdx.length - 1]].end + oOff
    } else {
      // 纯 INSERT：插在「下一个原文段起始」或正文末尾（段界近似，Task 5 的 A 路径不依赖此边界精度）
      const nextOrig = pairs
        .slice(pairs.indexOf(pair) + 1)
        .find(p => p.origIdx.length > 0)
      from = to = nextOrig ? oParas[nextOrig.origIdx[0]].start + oOff : oBody.length + oOff
    }
    out.push({
      id: `h${seq++}`,
      kind,
      origRange: { from, to },
      origText: paraTexts(oParas, oIdx),
      modText: paraTexts(mParas, mIdx),
    })
  }

  for (let p = 0; p < pairs.length; p++) {
    const pair = pairs[p]
    const same = pair.origIdx.length > 0 && pair.modIdx.length > 0 &&
      pair.origIdx.length === pair.modIdx.length &&
      pair.origIdx.every((oi, k) => oParas[oi].text === mParas[pair.modIdx[k]].text)
    if (same) continue // 完全相同的段对 → 无 hunk
    // 归一化：DELETE 后紧跟 INSERT → 合成整段替换（kind MATCH），跳过下一对
    const opKind = ((): AlignOp => {
      if (pair.origIdx.length === 0) return 'INSERT'
      if (pair.modIdx.length === 0) return 'DELETE'
      if (pair.origIdx.length === 2) return 'MERGE_2_1'
      if (pair.origIdx.length === 3) return 'MERGE_3_1'
      if (pair.modIdx.length === 2) return 'SPLIT_1_2'
      if (pair.modIdx.length === 3) return 'SPLIT_1_3'
      return 'MATCH'
    })()
    const next = pairs[p + 1]
    if (opKind === 'DELETE' && next && next.origIdx.length === 0) {
      const insertPair: AlignedPair = next
      const from = oParas[pair.origIdx[0]].start + oOff
      const to = oParas[pair.origIdx[pair.origIdx.length - 1]].end + oOff
      out.push({
        id: `h${seq++}`,
        kind: 'MATCH',
        origRange: { from, to },
        origText: paraTexts(oParas, pair.origIdx),
        modText: paraTexts(mParas, insertPair.modIdx),
      })
      p++ // 跳过 INSERT 对
      continue
    }
    pushHunk(pair, opKind)
  }
  return out
}
```

> 迁移纪律：DP 主体（相似度预计算、dp/op 表、回溯）**逐字复制**，禁止顺手「优化」——等价性由 Step 1 弹窗回归 4 条 + 本模块测试共同锁定；`const enum` 转 string union 是唯一允许的结构改动（inline 会话需 JSON 序列化 kind）。

- [ ] **Step 4: 写模块测试（paragraph-align.test.ts）并跑失败**

```ts
import { describe, it, expect } from 'vitest'
import {
  extractParagraphsWithOffsets, computeParagraphHunks, buildMergeSegments, splitFrontmatter,
} from './paragraph-align'

describe('extractParagraphsWithOffsets', () => {
  it('空行切段 + offsets 与原文 slice 回读一致（设计 §7）', () => {
    const text = '甲\n乙\n\n丙\n\n\n丁'
    const spans = extractParagraphsWithOffsets(text)
    expect(spans.map(s => s.text)).toEqual(['甲\n乙', '丙', '丁'])
    for (const s of spans) expect(text.slice(s.start, s.end)).toBe(s.text)
  })
  it('CRLF 文档 offsets 仍与 slice 回读一致', () => {
    const text = '甲\r\n\r\n乙\r\n丙'
    const spans = extractParagraphsWithOffsets(text)
    expect(spans.map(s => s.text)).toEqual(['甲', '乙\r\n丙'])
    for (const s of spans) expect(text.slice(s.start, s.end)).toBe(s.text)
  })
  it('frontmatter：splitFrontmatter offset 正确，computeParagraphHunks 区间含偏移（R7）', () => {
    const fm = '---\ntitle: x\n---\n'
    const doc = fm + '正文一\n\n正文二'
    const hunks = computeParagraphHunks(doc, fm + '正文一改\n\n正文二')
    expect(hunks).toHaveLength(1)
    expect(doc.slice(hunks[0].origRange.from, hunks[0].origRange.to)).toBe('正文一')
    expect(hunks[0].origText).toBe('正文一')
    expect(hunks[0].modText).toBe('正文一改')
  })
})

describe('computeParagraphHunks（抽取回归锁 + offsets 组装，设计 §7）', () => {
  it('单段局部改写 → 1 个 MATCH hunk，origRange 精确圈住段文本', () => {
    const doc = '他推开门走了出去。\n\n她还在等。'
    const mod = '他推开门快步走了出去。\n\n她还在等。'
    const hunks = computeParagraphHunks(doc, mod)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].kind).toBe('MATCH')
    expect(doc.slice(hunks[0].origRange.from, hunks[0].origRange.to)).toBe(hunks[0].origText)
    expect(hunks[0].origText).toBe('他推开门走了出去。')
  })
  it('段拆/段并/纯增删段：hunk origRange/modText 组装正确（结构语义以实际 DP 产出为准，断言放宽容忍）', () => {
    // 段并（2:1 或 DELETE+INSERT 归一）→ 至少 1 个覆盖「甲、乙」两块原文的替换 hunk
    const mergeHunks = computeParagraphHunks('甲\n\n乙\n\n丙', '甲乙\n\n丙')
    const cover = mergeHunks.find(h => h.origText.includes('甲') && h.origText.includes('乙'))
    expect(cover).toBeTruthy()
    expect(cover!.origText).toBe('甲\n\n乙') // DP 合并语义：原文两块含中间空行
    expect(cover!.modText).toBe('甲乙')
    // 纯增段（原文只有甲，改文多一段丁）→ 出现 INSERT 或归一 hunk，modText 含「丁」
    const insertHunks = computeParagraphHunks('甲', '甲\n\n丁')
    expect(insertHunks.some(h => h.modText.includes('丁'))).toBe(true)
    // origRange 与各自原文 slice 回读一致（覆盖非空区间的 hunk）
    for (const h of mergeHunks) {
      if (h.origRange.to > h.origRange.from) {
        expect('甲\n\n乙\n\n丙'.slice(h.origRange.from, h.origRange.to)).toBe(h.origText)
      }
    }
  })
  it('1:1 完全重写（相似度 < SIM_THRESH 的 DELETE+INSERT 路径）归一为整段替换，无粘连', () => {
    const doc = '春天来了。\n\n第二段原样。'
    const mod = '狂风卷着沙尘。\n\n第二段原样。' // 与原文几乎无字符重叠 → DP DELETE+INSERT
    const hunks = computeParagraphHunks(doc, mod)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].kind).toBe('MATCH')
    expect(hunks[0].modText).toBe('狂风卷着沙尘。')
    expect(doc.slice(hunks[0].origRange.from, hunks[0].origRange.to)).toBe('春天来了。')
  })
  it('buildMergeSegments 与旧 computeSegments 语义一致（same 段无 hunk、hunk 索引连续、段间空行锚保留）', () => {
    const segments = buildMergeSegments('甲\n\n乙', '甲改\n\n乙')
    expect(segments.filter(s => s.type === 'hunk')).toHaveLength(1)
    const hunk = segments.filter(s => s.type === 'hunk')[0]
    expect((hunk as { hunk?: { index: number } }).hunk?.index).toBe(0)
    // 段间空行锚：same [''] 出现在 hunk 之后
    const types = segments.map(s => s.type)
    expect(types[types.length - 1]).toBe('same')
  })
})
```

Run: `node node_modules/vitest/vitest.mjs run src/services/diff/paragraph-align.test.ts`
Expected: FAIL——模块不存在（import 解析失败）。红 = 先写测试成功。

- [ ] **Step 5: 跑模块测试确认通过**

再次运行上一步命令。Expected: PASS——Step 3 实现（迁移 + 新写）满足全部断言。若「段拆/段并」断言对具体 DP 产出敏感（如 2:1 反而走了 SPLIT 方向），以**实际 hunk 结构**校准断言（结构语义不变即可，勿改算法）。

- [ ] **Step 6: ThreeWayMerge.tsx 切换到模块 import（删本地实现）**

1) 删 :16-27 的 `Hunk`/`DiffSegment` 接口与 :38-269 的 stripFrontmatter/extractParagraphs/CharFreq/DP/alignParagraphs/buildSegments/computeSegments；
2) import 行替换：

```tsx
import { buildMergeSegments, type MergeSegment } from '../../services/diff/paragraph-align'
```

3) 把组件内类型引用改为 `MergeSegment`（原 `DiffSegment`）与 `MergeHunk`（原 `Hunk`，弹窗专用类型，模块已导出）：

```tsx
const segments = useMemo(() => buildMergeSegments(originalContent, modifiedContent),
  [originalContent, modifiedContent])
```

（`useMemo` 依赖与调用签名不变；`MergeSegment.lines/hunk` 结构与旧 DiffSegment 相同，:310/:315-329/:388-441 渲染逻辑零改动。若 TS 对 `s.hunk!` 非空断言报 lint 或类型收紧，用与现状等价的守卫写法保持行为。）

- [ ] **Step 7: 回归验证（等价锁验收）**

Run:
```bash
node node_modules/vitest/vitest.mjs run src/components/editor/ThreeWayMerge.test.tsx
node node_modules/vitest/vitest.mjs run src/services/diff/paragraph-align.test.ts
```
Expected: 两文件全 PASS（弹窗 4 条与 Step 2 结果一致 = 行为字节级等价证据；模块 8 条绿）。

- [ ] **Step 8: 门禁 + 提交**

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js src/services/diff/paragraph-align.ts src/services/diff/paragraph-align.test.ts src/components/editor/ThreeWayMerge.tsx src/components/editor/ThreeWayMerge.test.tsx --max-warnings 0
node node_modules/vitest/vitest.mjs run src/stores/editor-store.test.ts
git add src/services/diff/paragraph-align.ts src/services/diff/paragraph-align.test.ts src/components/editor/ThreeWayMerge.tsx src/components/editor/ThreeWayMerge.test.tsx
git commit -m "refactor: 抽取 ThreeWayMerge 段对齐为 src/services/diff/paragraph-align 并补 char offsets（R1，弹窗行为回归锁 + DEL/INS 归一）"
```
（commit 前缀用 `refactor:` 属本仓库 `fix:`/`feat:`/`docs:` 允许集之外——若仓库纪律要求仅三前缀，改用 `feat:` 并注明 refactor 语义；以 git-submission-standard 现行清单为准。）

---

### Task 2: sentence-split + hunk 模型

**Files:**
- Create: `src/services/diff/sentence-split.ts`
- Create: `src/services/diff/hunk-model.ts`
- Create: `src/services/diff/sentence-split.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `AlignedHunk` / `AlignOp` / `ParaSpan`（type-only import）
- Produces（Task 3 存 DiffSession、Task 4 装饰/undo、Task 5 建会话，签名锁定）:
  - `export interface Sentence { text: string; start: number; end: number }`（hunk.origText 内偏移）
  - `export function splitSentences(para: string): Sentence[]`（边界标点 `。！？…；\n`（含 CRLF）收归句尾；连续分隔不产空句）
  - `export interface SubHunk { id: string; parentId: string; origRange: { from: number; to: number }; origText: string; modText: string }`
  - `export type HunkDecision = 'pending' | 'accepted' | 'rejected'`
  - `export interface SessionHunk { id: string; kind: AlignOp; modText: string; sub: SubHunk[]; decision: HunkDecision }`
  - `export interface DiffSession { sessionId: string; revisionId?: number; sourceKind: 'selection' | 'revision'; baseDocSnapshot: string; hunks: SessionHunk[]; decisions: Record<string, Exclude<HunkDecision, 'pending'>> }`
    （`decisions` = 决策表（subHunkId → accepted|rejected，pending 为缺省）；`SessionHunk.decision` = 由 `decisions` 推出的组级聚合——updateHunkDecision 单写路径同步两者，见 Task 3）
  - `export function refineHunkWithSentences(h: AlignedHunk): SubHunk[]`（锚句 LCS 细分；无锚/结构差异/重组校验失败 → 降级整段单子 hunk）

**子 hunk 规则（v1 语义，Task 2 注释与测试共同锁定）**：对 `kind === 'MATCH'` 的 1:1 替换段做句级锚 LCS（句子字符串**归一 CRLF 后**全等为锚，锚句不进子 hunk）；SPLIT/MERGE/INSERT/DELETE 等结构类 hunk 直接降级整段单子 hunk（结构差异需段界分隔符协同，超句粒度，v1 不展开——设计 §4.2「无锚降级」的自然延伸）；`id = h{seq}.s{seq}`、`parentId = h{seq}`，全确定性（决策表跨重挂载稳定）。

- [ ] **Step 1: 写失败测试（sentence-split.test.ts）**

```ts
import { describe, it, expect } from 'vitest'
import { splitSentences, refineHunkWithSentences } from './sentence-split'
import type { AlignedHunk } from './paragraph-align'

const mkHunk = (over: Partial<AlignedHunk> & { origText: string; modText: string; from?: number }): AlignedHunk => ({
  id: 'h0', kind: 'MATCH',
  origRange: { from: over.from ?? 0, to: (over.from ?? 0) + over.origText.length },
  origText: over.origText, modText: over.modText, ...over,
})

describe('splitSentences（设计 §7：句切分）', () => {
  it('中英混排：中文句界（。！？…；）收归句尾，英文句点不切', () => {
    expect(splitSentences('他走了。等等？这…下一条；终').map(x => x.text))
      .toEqual(['他走了。', '等等？', '这…', '下一条；', '终'])
    expect(splitSentences('She left. He stayed。').map(x => x.text))
      .toEqual(['She left. He stayed。']) // '.'/'!' 不是句界，整段收在 '。' 前
  })
  it('\\n 为句界：空行不产空句；\\r\\n 紧随标点句时作为空句被跳过', () => {
    expect(splitSentences('甲。\n\n乙。\r\n丙').map(x => x.text))
      .toEqual(['甲。', '乙。', '丙']) // 空行 '\n' 与标点后的 '\r\n' 均为空句 → 跳过
  })
  it('句子 offsets 相对 para 原文 slice 回读一致', () => {
    const para = '他说：来了。\n她没答话。'
    const s = splitSentences(para)
    expect(s.map(x => x.text)).toEqual(['他说：来了。', '她没答话。'])
    for (const x of s) expect(para.slice(x.start, x.end)).toBe(x.text)
  })
})

describe('refineHunkWithSentences（锚句 LCS，设计 §7）', () => {
  it('局部改一句 → 只产 1 个子 hunk，锚句不在子 hunk 内', () => {
    const orig = '雨下了一整夜。天亮了。她推开窗。'
    const mod = '雨下了一整夜。天终于亮了。她推开窗。'
    const subs = refineHunkWithSentences(mkHunk({ origText: orig, modText: mod, from: 10 }))
    expect(subs).toHaveLength(1)
    expect(subs[0].origText).toBe('天亮了。')
    expect(subs[0].origRange.from).toBe(10 + orig.indexOf('天亮了。'))
    expect(subs[0].modText).toBe('天终于亮了。')
  })
  it('整段重写（无锚句）→ 降级为整段 1 个子 hunk（origRange = 整 hunk 区间）', () => {
    const subs = refineHunkWithSentences(mkHunk({
      origText: '雨下了一整夜。天亮了。', modText: '阳光刺破云层，万物复苏。', from: 30,
    }))
    expect(subs).toHaveLength(1)
    expect(subs[0].origText).toBe('雨下了一整夜。天亮了。')
    expect(subs[0].origRange).toEqual({ from: 30, to: 30 + '雨下了一整夜。天亮了。'.length })
  })
  it('结构类 hunk（SPLIT_1_2）→ 整段单子 hunk（段界分隔符协同超句粒度）', () => {
    const subs = refineHunkWithSentences(mkHunk({
      kind: 'SPLIT_1_2',
      origText: '一段长文。', modText: '一段长文。\n\n新段首句。',
    }))
    expect(subs).toHaveLength(1)
    expect(subs[0].modText).toBe('一段长文。\n\n新段首句。')
  })
  it('句子全同但仅结构差异（重组校验失败）→ 降级整段，防锚句吞掉换行变化', () => {
    const orig = '甲句。乙句。'
    const mod = '甲句。\n\n乙句。' // 仅插入段界——LCS 无 changed run → 重组 ≠ modText → 降级
    const subs = refineHunkWithSentences(mkHunk({ origText: orig, modText: mod }))
    expect(subs).toHaveLength(1)
    expect(subs[0].modText).toBe(mod)
  })
  it('id 确定性：同输入两次调用子 hunk id 一致（决策表跨重挂载）', () => {
    const h = mkHunk({ origText: '甲。乙。丙。', modText: '甲。乙改。丙。' })
    expect(refineHunkWithSentences(h).map(s => s.id))
      .toEqual(refineHunkWithSentences(h).map(s => s.id))
  })
})
```


- [ ] **Step 2: 跑失败**

Run: `node node_modules/vitest/vitest.mjs run src/services/diff/sentence-split.test.ts`
Expected: FAIL——模块不存在。

- [ ] **Step 3: 实现 sentence-split.ts + hunk-model.ts**

```ts
// hunk-model.ts —— 会话内状态机类型（纯类型 + 组级聚合辅助；无运行时依赖除 type）
import type { AlignOp } from './paragraph-align'

export interface SubHunk {
  id: string
  parentId: string
  origRange: { from: number; to: number }
  origText: string
  modText: string
}
export type HunkDecision = 'pending' | 'accepted' | 'rejected'
export interface SessionHunk {
  id: string
  kind: AlignOp
  modText: string
  sub: SubHunk[]
  decision: HunkDecision
}
/** editor-store 持久化形态（JSON 可序列化；doc 文本不进决策表，仅存 baseDocSnapshot 作定位锚） */
export interface DiffSession {
  sessionId: string
  revisionId?: number
  sourceKind: 'selection' | 'revision'
  baseDocSnapshot: string
  hunks: SessionHunk[]
  /** 决策表：subHunkId → accepted|rejected（pending = 缺省） */
  decisions: Record<string, Exclude<HunkDecision, 'pending'>>
}

/** 由 decisions 推导组级聚合（updateHunkDecision 的单写路径调用，Task 3 复用） */
export function aggregateDecision(sub: SubHunk[], decisions: Record<string, Exclude<HunkDecision, 'pending'>>): HunkDecision {
  if (sub.length === 0) return 'pending'
  let accepted = 0
  let rejected = 0
  for (const s of sub) {
    const d = decisions[s.id]
    if (d === 'accepted') accepted++
    else if (d === 'rejected') rejected++
  }
  if (accepted === sub.length) return 'accepted'
  if (rejected === sub.length) return 'rejected'
  return 'pending'
}

/** 统计已接受子 hunk 数（浮条进度用，Task 4 消费） */
export function countAccepted(session: DiffSession): number {
  return session.hunks.reduce((n, h) => n + h.sub.filter(s => session.decisions[s.id] === 'accepted').length, 0)
}
export function countSubHunks(session: DiffSession): number {
  return session.hunks.reduce((n, h) => n + h.sub.length, 0)
}
```

```ts
// sentence-split.ts —— 段内句级细分（纯函数）
import type { AlignedHunk } from './paragraph-align'
import type { SubHunk } from './hunk-model'

export interface Sentence { text: string; start: number; end: number }

/**
 * 句子切分：边界标点 。！？…；与换行（含 CRLF）收归句尾。
 * 连续分隔符之间若 trim 为空（如空行 \n\n）不产出空句；
 * CRLF 的 \r 计入前一句 text 与 offsets（doc 字符一致），锚比较时归一化。
 */
export function splitSentences(para: string): Sentence[] {
  const out: Sentence[] = []
  let from = 0
  let i = 0
  const push = (end: number) => {
    const text = para.slice(from, end)
    if (text.trim() !== '') out.push({ text, start: from, end })
    from = end
  }
  while (i < para.length) {
    const ch = para[i]
    if (ch === '\n' || ch === '。' || ch === '！' || ch === '？' || ch === '…' || ch === '；') {
      push(i + 1)
      i = i + 1
    } else {
      i++
    }
  }
  push(para.length)
  return out
}

const norm = (t: string): string => t.replace(/\r\n/g, '\n')

/**
 * 锚句 LCS 细分（v1 语义见模块头注释）：
 * - kind === 'MATCH'：句级 LCS（全等锚句）；changed run → 子 hunk（offsets = h.origRange.from + 段内偏移）
 * - 其他结构类 kind / 无锚 / 重组校验失败 → 整段单子 hunk（origRange = h.origRange）
 */
export function refineHunkWithSentences(h: AlignedHunk): SubHunk[] {
  const degrade = (): SubHunk[] => [{
    id: `${h.id}.s0`, parentId: h.id,
    origRange: { ...h.origRange }, origText: h.origText, modText: h.modText,
  }]
  if (h.kind !== 'MATCH') return degrade()

  const origS = splitSentences(h.origText)
  const modS = splitSentences(h.modText)
  // LCS（全等锚，归一 CRLF）
  const dp: number[][] = Array.from({ length: origS.length + 1 }, () => new Array(modS.length + 1).fill(0))
  for (let i = 1; i <= origS.length; i++) {
    for (let j = 1; j <= modS.length; j++) {
      dp[i][j] = norm(origS[i - 1].text) === norm(modS[j - 1].text)
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  // 回溯：匹配 = 锚句（不产出）；origS-only / modS-only 汇入当前 changed run
  interface Run { orig: Sentence[]; mod: Sentence[] }
  const runs: Run[] = []
  let run: Run | null = null
  let i = origS.length
  let j = modS.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && norm(origS[i - 1].text) === norm(modS[j - 1].text)) {
      run = null // 锚句：闭合 run（锚句不被接受/替换）
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      if (!run) { run = { orig: [], mod: [] }; runs.unshift(run) }
      run.mod.unshift(modS[j - 1]); j--
    } else {
      if (!run) { run = { orig: [], mod: [] }; runs.unshift(run) }
      run.orig.unshift(origS[i - 1]); i--
    }
  }
  // ---- run → SubHunk 换算（doc 坐标 = h.origRange.from + 段内偏移） ----
  // 降级条件（任一命中 → 整段单子 hunk，见模块头 v1 语义）：
  //  a) 存在纯 mod run（orig 侧为空 = AI 在锚句之间插了新句，无替换区间可锚——v1 不拆解，整段接受兜底）
  //  b) runs 为空且 h.origText !== h.modText（句子全同但段界/换行结构变了，LCS 无 changed run）
  //  c) 重组校验失败：把各 run 的 modText 依次替换进 h.origText 后 ≠ h.modText（归一 CRLF）——
  //     锚句被换行/结构差异隔开时 LCS 无法表达，降级保证「接受后 doc == 整体替换」（验收 3）
  const composeByRuns = (): string => {
    let out = h.origText
    let cursor = 0
    for (const r of runs) {
      if (r.orig.length === 0) return out // 纯插 run 由 (a) 降级兜底，此处不可能到达
      const origText = r.orig.map(s => s.text).join('')
      const idx = out.indexOf(origText, cursor)
      if (idx < 0) return out // 理论不可达（runs 来自 h.origText 的句切分）
      const modText = r.mod.map(s => s.text).join('')
      out = out.slice(0, idx) + modText + out.slice(idx + origText.length)
      cursor = idx + modText.length
    }
    return out
  }
  if (runs.some(r => r.orig.length === 0)) return degrade()
  if (runs.length === 0) return h.origText === h.modText ? [] : degrade()
  if (norm(composeByRuns()) !== norm(h.modText)) return degrade()
  return runs.map((r, k) => {
    const from = h.origRange.from + r.orig[0].start
    const to = h.origRange.from + r.orig[r.orig.length - 1].end
    return {
      id: `${h.id}.s${k}`, parentId: h.id,
      origRange: { from, to },
      origText: r.orig.map(s => s.text).join(''),
      modText: r.mod.map(s => s.text).join(''),
    } as SubHunk
  })
}
```

> **实现说明**：上方是 `refineHunkWithSentences` 的**完整正式实现**（LCS 回溯段 :619-636 连同本段整体替换伪码），不再有占位行。语义要点：锚句（LCS 全等句）不进子 hunk——接受/拒绝只作用于 changed run；`runs` 由回溯按 doc 序 unshift 产出，`composeByRuns` 用 indexOf 顺序替换校验「锚句 + run.modText 重组 == h.modText」，任何结构差（多余/缺失 `\n`、段落界）都会触发 (c) 降级，把整段作为一个子 hunk 交回，保证全量接受与整体替换逐字节一致。交付验收以 Step 1 的 6 条测试全绿为准——测试是语义契约，实现与上方代码不一致处按契约修。

- [ ] **Step 4: 跑测试确认通过**

Run: `node node_modules/vitest/vitest.mjs run src/services/diff/sentence-split.test.ts`
Expected: PASS 6 条（含 id 确定性）。

- [ ] **Step 5: 门禁 + 提交**

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js src/services/diff/sentence-split.ts src/services/diff/hunk-model.ts src/services/diff/sentence-split.test.ts --max-warnings 0
node node_modules/vitest/vitest.mjs run src/services/diff
git add src/services/diff/sentence-split.ts src/services/diff/hunk-model.ts src/services/diff/sentence-split.test.ts
git commit -m "feat: 句级子 hunk——sentence-split 锚句 LCS + hunk-model 会话类型（v1 语义：MATCH 段细分、结构类整段降级）"
```

---

### Task 3: 会话层——editor-store 扩展（决策表持久 + discard 语义）

**Files:**
- Modify: `src/stores/editor-store.ts`（EditorTab :4-25 加字段；EditorState :27-57 加 actions；实现紧随既有 action 区）
- Modify: `src/stores/editor-store.test.ts`（新增 describe；既有 openFile 去重 :55-62 保持绿）

**Interfaces:**
- Consumes: Task 2 的 `DiffSession` / `SubHunk` / `HunkDecision` / `aggregateDecision`（type import）
- Produces（Task 4/5 消费）:
  - `EditorTab.inlineSession?: DiffSession`（JSON 可序列化；不存 doc 决策文本，正文仍走 `tab.content`）
  - `beginInlineSession: (tabId: string, session: DiffSession) => void`（幂等：同 tab 已存在会话时覆盖并保留既有 dirty 标记）
  - `updateHunkDecision: (tabId: string, subHunkId: string, decision: 'accepted' | 'rejected') => void`（决策表 + 对应 SessionHunk.decision 聚合单写路径；subHunkId 不存在则 no-op）
  - `resetHunkDecision: (tabId: string, subHunkId: string) => void`（误拒/误选恢复 → pending；**仅对「未产生 doc 事务」的决策安全**——accepted 后的文本已入 doc，恢复前须先 doc 层 Ctrl+Z 还原，见 Task 4 注释）
  - `endInlineSession: (tabId: string) => void`（清 inlineSession 字段；**不清 dirty、不改 content**——已接受文本保留在 doc/content，未决建议丢弃；discard 语义 = 本 action）

- [ ] **Step 1: 写失败测试（editor-store.test.ts 追加 describe）**

```ts
describe('editor-store inlineSession（L1 会话层）', () => {
  const mkSession = (): DiffSession => ({
    sessionId: 'sess-1',
    sourceKind: 'selection',
    baseDocSnapshot: '他走了。她没答话。',
    hunks: [{
      id: 'h0', kind: 'MATCH', modText: '他离开了。她没答话。',
      sub: [
        { id: 'h0.s0', parentId: 'h0', origRange: { from: 0, to: 4 }, origText: '他走了。', modText: '他离开了。' },
      ],
      decision: 'pending',
    }],
    decisions: {},
  })

  it('beginInlineSession：tab 挂会话，content/dirty 不变', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 'vela://draft/1', name: 'd', type: 'chapter', filePath: 'vela://draft/1', content: '他走了。她没答话。' })
    s.beginInlineSession('vela://draft/1', mkSession())
    const tab = useEditorStore.getState().tabs.find(t => t.id === 'vela://draft/1')!
    expect(tab.inlineSession?.sessionId).toBe('sess-1')
    expect(tab.content).toBe('他走了。她没答话。')
    expect(tab.dirty).toBeFalsy()
  })

  it('updateHunkDecision：决策表 + 组聚合同步；全部 accepted → h0.decision=accepted', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 't', name: 'd', type: 'chapter', filePath: 't' })
    s.beginInlineSession('t', mkSession())
    s.updateHunkDecision('t', 'h0.s0', 'accepted')
    let tab = useEditorStore.getState().tabs.find(t => t.id === 't')!
    expect(tab.inlineSession!.decisions['h0.s0']).toBe('accepted')
    expect(tab.inlineSession!.hunks[0].decision).toBe('accepted')
    s.updateHunkDecision('t', 'h0.s0', 'rejected')
    tab = useEditorStore.getState().tabs.find(t => t.id === 't')!
    expect(tab.inlineSession!.hunks[0].decision).toBe('rejected')
  })

  it('updateHunkDecision 未知 subHunkId → no-op（不抛、不改状态）', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 't2', name: 'd', type: 'chapter', filePath: 't2' })
    s.beginInlineSession('t2', mkSession())
    expect(() => s.updateHunkDecision('t2', 'ghost', 'accepted')).not.toThrow()
  })

  it('resetHunkDecision：rejected → pending（误拒恢复）', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 't3', name: 'd', type: 'chapter', filePath: 't3' })
    s.beginInlineSession('t3', mkSession())
    s.updateHunkDecision('t3', 'h0.s0', 'rejected')
    s.resetHunkDecision('t3', 'h0.s0')
    const tab = useEditorStore.getState().tabs.find(t => t.id === 't3')!
    expect(tab.inlineSession!.decisions['h0.s0']).toBeUndefined()
    expect(tab.inlineSession!.hunks[0].decision).toBe('pending')
  })

  it('endInlineSession（discard 语义）：清会话、保留 content 与 dirty', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 't4', name: 'd', type: 'chapter', filePath: 't4' })
    s.beginInlineSession('t4', mkSession())
    s.updateHunkDecision('t4', 'h0.s0', 'rejected')
    // 模拟接受后 doc 已变（dirty 置位由 updateTabContent 链路负责——此处仅验证 end 不清 dirty）
    useEditorStore.setState(st => ({ tabs: st.tabs.map(t => t.id === 't4' ? { ...t, content: '新内容', dirty: true } : t) }))
    s.endInlineSession('t4')
    const tab = useEditorStore.getState().tabs.find(t => t.id === 't4')!
    expect(tab.inlineSession).toBeUndefined()
    expect(tab.content).toBe('新内容')
    expect(tab.dirty).toBe(true) // 已接受文本须随 dirty 走既有保存链路
  })

  it('决策态持久：模拟重挂载（begin → 决策 → 重新读回 tab）不丢 decisions', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 't5', name: 'd', type: 'chapter', filePath: 't5' })
    const session = mkSession()
    s.beginInlineSession('t5', session)
    s.updateHunkDecision('t5', 'h0.s0', 'rejected')
    // 「重挂载」= 从同一 tab 对象重读（EditorArea 单实例切 tab 后 store 即唯一来源）
    const tab = useEditorStore.getState().tabs.find(t => t.id === 't5')!
    expect(tab.inlineSession!.decisions['h0.s0']).toBe('rejected')
  })
})
```

文件头补 type import：`import type { DiffSession } from '../services/diff/hunk-model'`（editor-store.test.ts 现 :1-2 后追加）。

- [ ] **Step 2: 跑失败**

Run: `node node_modules/vitest/vitest.mjs run src/stores/editor-store.test.ts`
Expected: FAIL——`beginInlineSession` 等不存在 + 类型报错。

- [ ] **Step 3: 实现 store 扩展（editor-store.ts）**

类型区（:25 `}` 前）加字段，action 区（:57 `}` 前）加签名，实现紧随 `markTabSaved`（:136 后）：

```ts
import type { DiffSession, HunkDecision, SubHunk } from '../services/diff/hunk-model'
import { aggregateDecision } from '../services/diff/hunk-model'

// EditorTab 增（:25 前）：
  /** L1 inline 接受会话（决策态持久；正文文本仍走 content） */
  inlineSession?: DiffSession

// EditorState 接口（:54 markTabSaved 声明后）增：
  /** 开始 inline 会话（A 入口 AI 输出进入会话；同 tab 已有会话则覆盖） */
  beginInlineSession: (tabId: string, session: DiffSession) => void
  /** 更新单子 hunk 决策（决策表 + 组聚合单写路径；未知 subHunkId no-op） */
  updateHunkDecision: (tabId: string, subHunkId: string, decision: 'accepted' | 'rejected') => void
  /** 重置单子 hunk 决策为 pending（误拒/误选恢复；accepted 后须先 doc 层 undo） */
  resetHunkDecision: (tabId: string, subHunkId: string) => void
  /** 结束会话（discard 语义：清 inlineSession；不清 dirty/content——已接受文本保留） */
  endInlineSession: (tabId: string) => void
```

实现（放在 `markTabSaved` 之后、`clearTabs` 之前）：

```ts
  beginInlineSession: (tabId, session) => {
    set((s) => ({
      tabs: s.tabs.map((t) => t.id === tabId ? { ...t, inlineSession: session } : t),
    }))
  },

  // 决策表 + 组级 decision 聚合的单写路径（Task 2 aggregateDecision 唯一调用方）
  updateHunkDecision: (tabId, subHunkId, decision) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId || !t.inlineSession) return t
        const session = t.inlineSession
        if (!session.hunks.some(h => h.sub.some(x => x.id === subHunkId))) return t // 未知 subHunkId → no-op
        const decisions = { ...session.decisions, [subHunkId]: decision }
        return {
          ...t,
          inlineSession: {
            ...session,
            decisions,
            hunks: session.hunks.map(h => h.sub.some(x => x.id === subHunkId)
              ? { ...h, decision: aggregateDecision(h.sub, decisions) }
              : h),
          },
        }
      }),
    }))
  },

  resetHunkDecision: (tabId, subHunkId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId || !t.inlineSession) return t
        const session = t.inlineSession
        const { [subHunkId]: _removed, ...rest } = session.decisions
        return {
          ...t,
          inlineSession: {
            ...session,
            decisions: rest,
            hunks: session.hunks.map(h => h.sub.some(x => x.id === subHunkId)
              ? { ...h, decision: aggregateDecision(h.sub, rest) }
              : h),
          },
        }
      }),
    }))
  },

  endInlineSession: (tabId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => t.id === tabId ? { ...t, inlineSession: undefined } : t),
    }))
  },
```

（`noUnusedLocals` 下解构 `_removed` 若告警，改用：`const rest: typeof session.decisions = {}; for (const k of Object.keys(session.decisions)) if (k !== subHunkId) rest[k] = session.decisions[k]`。）

- [ ] **Step 4: 跑测试确认通过**

Run: `node node_modules/vitest/vitest.mjs run src/stores/editor-store.test.ts`
Expected: PASS（新增 7 条 + 既有 openFile/closeTab 全绿）。

- [ ] **Step 5: 门禁 + 提交**

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js src/stores/editor-store.ts src/stores/editor-store.test.ts --max-warnings 0
git add src/stores/editor-store.ts src/stores/editor-store.test.ts
git commit -m "feat: 编辑器会话层——EditorTab.inlineSession + begin/update/reset/end actions（决策表持久，discard 保留 dirty）"
```

---

### Task 4: CM UI——hunk 装饰 + 接受浮层 + 进度浮条 + undo 事务

**Files:**
- Create: `src/components/editor/codemirror-inline-accept.ts`（StateField/StateEffect/changeFilter/纯辅助，无 React）
- Create: `src/components/editor/inline-accept.css`（装饰/浮条/浮层样式，仅 CSS 变量）
- Create: `src/components/editor/InlineAcceptBar.tsx`（进度浮条：`{n}/{m} 处修改 · 全部接受 / 全部拒绝 / 完成 / 关闭`）
- Create: `src/components/editor/InlineAcceptPopover.tsx`（气泡内改动详情：第 n/m 处改动 + 改前/改后 + 句级子 hunk 勾选列表 + 接受选中/整体接受/拒绝/关闭）
- Modify: `src/components/editor/CodeMirrorEditor.tsx`（extensions :286-335 挂 inline 扩展、气泡 AI 面板 :571-587 的「替换」按钮路由到浮层、:151-177 handleUpdate 补手动编辑退出、浮条/浮层挂载）
- Create: `src/components/editor/CodeMirrorEditor.inline.test.tsx`（jsdom，undo/装饰/零影响回归）
- Modify: `src/shared/locale-data.ts`（`inlineAccept.*` 首批 key，见 Step 1）

**Interfaces:**
- Consumes: Task 2 `DiffSession`/`SubHunk`/`countAccepted`/`countSubHunks`；Task 3 store actions
- Produces（Task 5 消费/复用）:
  - `export interface InlineHunkRange { id: string; decision: 'pending' | 'rejected'; from: number; to: number }`（doc 当前坐标；accepted 子句已替换入 doc 不再保留区间）
  - `export const inlineAcceptField: StateField<{ ranges: InlineHunkRange[]; deco: DecorationSet }>`（ranges 随 doc 变化映射；`setHunkRanges` StateEffect 重建）
  - `export const setHunkRanges: StateEffect<InlineHunkRange[]>`
  - `export function inlineAcceptExtensions(): Extension[]`（field + decorations provide + changeFilter）
  - `export function deriveRangesFromDoc(session: DiffSession, docText: string): InlineHunkRange[]`（重挂载重建：按 doc 序 indexOf 各 pending/rejected 子句 origText，未找到则跳过）
  - `export function dispatchAcceptChange(view: EditorView, range: { from: number; to: number }, insert: string, time: number): void`（带递增 time + userEvent 标注；Task 4/5 唯一 doc 改写入口）
  - `export const INLINE_ACCEPT_EVENT = 'input.inline.accept'`（userEvent 标注值，handleUpdate 区分）
  - `export function findPendingRangeAt(view: EditorView, pos: number): InlineHunkRange | null`（浮层命中）

**i18n key（Step 1 全量落，Task 4/5 共享，禁止后续改名）**：`inlineAccept.progress`（`{n}/{m} 处修改`）、`inlineAccept.bubbleProgress`（`第 {n}/{m} 处改动`）、`inlineAccept.original`（改前）、`inlineAccept.revised`（改后）、`inlineAccept.acceptSelected`、`inlineAccept.acceptWhole`（整体接受）、`inlineAccept.reject`、`inlineAccept.acceptAll`、`inlineAccept.rejectAll`、`inlineAccept.finish`（完成）、`inlineAccept.close`、`inlineAccept.manualEditExit`（改动已被手动修改，修改建议已清除）、`inlineAccept.closeConfirm`（仍有 {n} 处修改未处理…）——Task 5 另加 `inlineAccept.applyAsSuggestion`/`inlineAccept.noChanges`。

- [ ] **Step 1: locale-data.ts 加 key（三语，插在 `'editor.replace'`（:2121）之后）**

```ts
  // --- L1 inline 接受（气泡 AI 改写 → 会话浮层/浮条） ---
  'inlineAccept.progress': { 'zh-CN': '已处理 {n}/{m} 处修改', 'en-US': '{n}/{m} changes processed', 'ru-RU': 'Обработано {n}/{m} изменений' },
  'inlineAccept.bubbleProgress': { 'zh-CN': '第 {n}/{m} 处改动', 'en-US': 'Change {n} of {m}', 'ru-RU': 'Правка {n} из {m}' },
  'inlineAccept.original': { 'zh-CN': '改前', 'en-US': 'Before', 'ru-RU': 'До' },
  'inlineAccept.revised': { 'zh-CN': '改后', 'en-US': 'After', 'ru-RU': 'После' },
  'inlineAccept.acceptSelected': { 'zh-CN': '接受选中', 'en-US': 'Accept selected', 'ru-RU': 'Принять выбранное' },
  'inlineAccept.acceptWhole': { 'zh-CN': '整体接受', 'en-US': 'Accept entire change', 'ru-RU': 'Принять всё изменение' },
  'inlineAccept.reject': { 'zh-CN': '拒绝', 'en-US': 'Reject', 'ru-RU': 'Отклонить' },
  'inlineAccept.acceptAll': { 'zh-CN': '全部接受', 'en-US': 'Accept all', 'ru-RU': 'Принять всё' },
  'inlineAccept.rejectAll': { 'zh-CN': '全部拒绝', 'en-US': 'Reject all', 'ru-RU': 'Отклонить всё' },
  'inlineAccept.finish': { 'zh-CN': '完成', 'en-US': 'Finish', 'ru-RU': 'Готово' },
  'inlineAccept.close': { 'zh-CN': '关闭', 'en-US': 'Close', 'ru-RU': 'Закрыть' },
  'inlineAccept.manualEditExit': { 'zh-CN': '改动已被手动修改，修改建议已清除', 'en-US': 'Text was edited manually; suggestions cleared', 'ru-RU': 'Текст изменён вручную; предложения очищены' },
  'inlineAccept.closeConfirm': { 'zh-CN': '仍有 {n} 处修改未处理。关闭将放弃这些建议，已接受的修改会保留。', 'en-US': 'You still have {n} unhandled changes. Closing discards them; accepted changes are kept.', 'ru-RU': 'Осталось {n} необработанных изменений. Закрытие отменит их; принятые изменения сохранятся.' },
```

- [ ] **Step 2: 写失败测试（CodeMirrorEditor.inline.test.tsx）——先落 undo/装饰/零影响契约**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { EditorView } from '@codemirror/view'
import { Transaction } from '@codemirror/state'
import { undo } from '@codemirror/commands'
import CodeMirrorEditor from './CodeMirrorEditor'
import { useEditorStore } from '../../stores/editor-store'
import type { DiffSession } from '../../services/diff/hunk-model'
import { dispatchAcceptChange, INLINE_ACCEPT_EVENT, inlineAcceptField } from './codemirror-inline-accept'

// 复制 CodeMirrorEditor.test.tsx:38-96 的 jsdom 桩 + renderEditor/getView/userInput 辅助（原样）；
// renderEditor 扩签名为 (content, onChange?, filePath?)——有 filePath 时组件订阅对应 tab 的 inlineSession。
// 用纯 ASCII fixture：子句 token 唯一、位置算术直白（中文 fixture 的 \n/标点坐标易错，ASCII 无歧义）。

const ORIG = 'AAA BBB CCC'
function mkSession(): DiffSession {
  return {
    sessionId: 's1', sourceKind: 'selection', baseDocSnapshot: ORIG,
    hunks: [{
      id: 'h0', kind: 'MATCH', modText: ORIG,
      sub: [
        { id: 'h0.s0', parentId: 'h0', origRange: { from: 0, to: 3 }, origText: 'AAA', modText: 'AAA1' },
        { id: 'h0.s1', parentId: 'h0', origRange: { from: 4, to: 7 }, origText: 'BBB', modText: 'BBB2' },
        { id: 'h0.s2', parentId: 'h0', origRange: { from: 8, to: 11 }, origText: 'CCC', modText: 'CCC3' },
      ],
      decision: 'pending',
    }],
    decisions: {},
  }
}

describe('CodeMirrorEditor inline 会话（Task 4）', () => {
  it('无会话时零影响（默认关闭回归）：普通输入/撤销行为不变', () => {
    const onChange = vi.fn()
    const { container } = renderEditor('old text', onChange)
    const view = getView(container)
    userInput(view, 'X', 1000)
    expect(view.state.doc.toString()).toBe('old textX')
  })

  it('接受 = 独立事务：3 次接受 → 3 次 Ctrl+Z 逐步还原（R4 显式 time 防合并）', () => {
    const { container } = renderEditor(ORIG)
    const view = getView(container)
    // 每次接受前用 indexOf 取当前 doc 坐标（前序接受会平移后续区间——生产路径由 field 映射 + derive 处理，
    // 本用例只验证 dispatchAcceptChange 的事务语义：独立递增 time → undo 逐句还原）
    let t = 5000
    const applyNext = (needle: string, insert: string) => {
      const from = view.state.doc.toString().indexOf(needle)
      expect(from).toBeGreaterThanOrEqual(0)
      act(() => { dispatchAcceptChange(view, { from, to: from + needle.length }, insert, t++) })
    }
    applyNext('AAA', 'AAA1')
    applyNext('BBB', 'BBB2')
    applyNext('CCC', 'CCC3')
    expect(view.state.doc.toString()).toBe('AAA1 BBB2 CCC3')
    act(() => { undo(view) }) // 撤销第 3 次接受
    expect(view.state.doc.toString()).toBe('AAA1 BBB2 CCC')
    act(() => { undo(view) }) // 撤销第 2 次接受
    expect(view.state.doc.toString()).toBe('AAA1 BBB CCC')
    act(() => { undo(view) }) // 撤销第 1 次接受
    expect(view.state.doc.toString()).toBe(ORIG)
  })

  it('dispatchAcceptChange 事务带显式 time 与 INLINE_ACCEPT_EVENT 标注（供 handleUpdate 区分自身接受）', () => {
    const { container } = renderEditor(ORIG)
    const view = getView(container)
    const origDispatch = view.dispatch.bind(view)
    const spy = vi.fn((...specs: Parameters<EditorView['dispatch']>) => origDispatch(...specs))
    view.dispatch = spy as never
    const from = view.state.doc.toString().indexOf('AAA')
    dispatchAcceptChange(view, { from, to: from + 3 }, 'AAA1', 7000)
    expect(spy).toHaveBeenCalledTimes(1)
    const spec = spy.mock.calls[0][0] as { annotations?: ReadonlyArray<{ value?: unknown }> }
    const anns = spec.annotations ?? []
    expect(anns.some(a => a.value === 7000)).toBe(true)             // 显式递增 time（R4）
    expect(anns.some(a => a.value === INLINE_ACCEPT_EVENT)).toBe(true) // userEvent 标注
    expect(view.state.doc.toString()).toBe('AAA1 BBB CCC')
  })
})
```

> 辅助与断言以**真实 jsdom 行为**为准：若 `view.dispatch` 包装赋值在 CM6 类型/运行时受限，退化为「常量存在性断言 + undo 粒度用例间接锁定标注」（标注不参与 undo 分组的判定路径，时间戳已足够）；fixture 换行/标点坐标务必与 `from/to` 精确对齐——用 ASCII fixture 从根上避免中文坐标手算错误。

- [ ] **Step 3: 跑失败**

Run: `node node_modules/vitest/vitest.mjs run src/components/editor/CodeMirrorEditor.inline.test.tsx`
Expected: FAIL——模块/StateField/`dispatchAcceptChange` 不存在。

- [ ] **Step 4: 实现 codemirror-inline-accept.ts（核心能力，无 React）**

```ts
import { StateEffect, StateField, EditorState, Transaction, RangeSetBuilder } from '@codemirror/state'
import { EditorView, Decoration, type DecorationSet, type Extension } from '@codemirror/view'
import type { DiffSession } from '../../services/diff/hunk-model'

export const INLINE_ACCEPT_EVENT = 'input.inline.accept'

/** doc 当前坐标的会话区间（accepted 已替换入 doc，不保留区间；rejected 原文仍在 doc） */
export interface InlineHunkRange { id: string; decision: 'pending' | 'rejected'; from: number; to: number }

export const setHunkRanges = StateEffect.define<InlineHunkRange[]>()
export const ACCEPTED_DECO_CLASS = 'nf-ia-accepted'   // 供测试/主题引用（本期 doc 内不画 accepted 装饰）

const pendingMark = Decoration.mark({ class: 'nf-ia-pending' })
const rejectedMark = Decoration.mark({ class: 'nf-ia-rejected' })

function buildDeco(ranges: InlineHunkRange[]): DecorationSet {
  const b = new RangeSetBuilder<Decoration>()
  for (const r of ranges) {
    if (r.to > r.from) b.add(r.from, r.to, r.decision === 'pending' ? pendingMark : rejectedMark)
  }
  return b.finish()
}

/** 只拦 pending/rejected 区间内的用户输入；区间外放行（退出语义由组件 handleUpdate 负责） */
const freezeChange: (view: EditorView, tr: Transaction) => boolean = (view, tr) => {
  const { ranges } = view.state.field(inlineAcceptField)
  if (ranges.length === 0) return true
  const inside = (from: number, to: number) =>
    ranges.some(r => from < r.to && to > r.from) // 相交即拦（pending/rejected 区冻结）
  for (const change of tr.changes.iterChanges()) {
    if (inside(change.fromA, change.toA)) return false
  }
  return true
}

export const inlineAcceptField = StateField.define<{ ranges: InlineHunkRange[]; deco: DecorationSet }>({
  create: () => ({ ranges: [], deco: Decoration.none }),
  update(value, tr) {
    let ranges = value.ranges
    if (tr.docChanged) {
      // ranges 随 doc 变化映射（接受事务删除原区间后，后续 pending 区间自动平移）
      ranges = ranges
        .map(r => ({ ...r, from: tr.changes.mapPos(r.from), to: tr.changes.mapPos(r.to) }))
        .filter(r => r.to - r.from > 0)
    }
    for (const effect of tr.effects) {
      if (effect.is(setHunkRanges)) ranges = effect.value
    }
    return { ranges, deco: buildDeco(ranges) }
  },
  provide: f => EditorView.decorations.from(f),
})

/** 常驻扩展（无会话时 field 空 + filter 直通 = 零可见影响，R3）；会话期由 setHunkRanges 动态驱动 */
export function inlineAcceptExtensions(): Extension[] {
  return [inlineAcceptField, EditorState.changeFilter.of(freezeChange)]
}

/**
 * 接受 = 唯一 doc 改写入口：带递增显式 Transaction.time（规避 CM 500ms 事件合并，R4）
 * + userEvent 标注（供 handleUpdate 区分「自身接受事务 / 用户手动编辑」）。
 */
export function dispatchAcceptChange(
  view: EditorView, range: { from: number; to: number }, insert: string, time: number,
): void {
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from },
    annotations: [
      Transaction.time.of(time),
      Transaction.userEvent.of(INLINE_ACCEPT_EVENT),
    ],
  })
}

/** 重挂载/会话重建：按 doc 序 indexOf 定位未决（pending/rejected）子句；找不到（已被手动/历史改动移除）则跳过 */
export function deriveRangesFromDoc(session: DiffSession, docText: string): InlineHunkRange[] {
  const out: InlineHunkRange[] = []
  let cursor = 0
  for (const h of session.hunks) {
    for (const s of h.sub) {
      const d = session.decisions[s.id]
      if (d === 'accepted') continue // 已替换入 doc
      const idx = docText.indexOf(s.origText, cursor)
      if (idx < 0) continue // 手动/历史改动已移除该文本 → 不装饰
      out.push({ id: s.id, decision: d ?? 'pending', from: idx, to: idx + s.origText.length })
      cursor = idx + s.origText.length
    }
  }
  return out
}

export function findPendingRangeAt(view: EditorView, pos: number): InlineHunkRange | null {
  const { ranges } = view.state.field(inlineAcceptField)
  return ranges.find(r => pos >= r.from && pos <= r.to) ?? null
}
```

- [ ] **Step 5: 写失败测试（装饰/浮层/浮条交互 + 决策落 store + 手动编辑退出）**

在 CodeMirrorEditor.inline.test.tsx 的 describe 内继续追加（renderEditor 需支持传 filePath——仿 CodeMirrorEditor.test.tsx:58-74 扩签名为 `renderEditor(content, onChange?, filePath?)`；会话经 `useEditorStore.getState().beginInlineSession(filePath, mkSession())` 注入，**测试前置每次 beforeEach 重置 store**）：

```tsx
function seedSession(filePath: string) {
  useEditorStore.setState({ tabs: [], activeTabId: null })
  useEditorStore.getState().openFile({ id: filePath, name: 'd', type: 'chapter', filePath, content: ORIG })
  useEditorStore.getState().beginInlineSession(filePath, mkSession())
}

it('会话激活：pending 区装饰生效、浮条出现；会话外零装饰', async () => {
  const filePath = 'vela://draft/9'
  seedSession(filePath)
  const { container } = renderEditor(ORIG, undefined, filePath)
  const view = getView(container)
  await act(async () => { await Promise.resolve() }) // 会话同步 effect dispatch 后断言 field
  const doc = view.state.field(inlineAcceptField)
  expect(doc.ranges.length).toBeGreaterThan(0) // AAA/BBB/CCC 三个 pending 区间
  expect(doc.ranges.every(r => r.decision === 'pending')).toBe(true)
  expect(container.querySelector('.nf-ia-bar')).toBeTruthy() // 浮条渲染
  // 会话外：不 seed 的新实例 ranges 为空（默认关闭回归）
  useEditorStore.setState({ tabs: [], activeTabId: null })
  const plain = renderEditor(ORIG)
  expect(getView(plain.container).state.field(inlineAcceptField).ranges).toHaveLength(0)
})

it('拒绝 = 纯决策态：doc 不变、无新 undo 事件（undo 后仍是原状）', () => {
  const filePath = 'vela://draft/10'
  seedSession(filePath)
  const { container } = renderEditor(ORIG, undefined, filePath)
  const view = getView(container)
  // 经浮层「拒绝」→ store 决策 rejected → [inlineSession] effect 重推 ranges（ranges 仍含 rejected 区间作划除装饰）
  act(() => {
    useEditorStore.getState().updateHunkDecision(filePath, 'h0.s1', 'rejected')
  })
  expect(view.state.doc.toString()).toBe(ORIG) // 拒绝不产生 doc 事务
  act(() => { undo(view) })
  expect(view.state.doc.toString()).toBe(ORIG) // 无历史事件可撤销
  const ranges = view.state.field(inlineAcceptField).ranges
  expect(ranges.find(r => r.id === 'h0.s1')?.decision).toBe('rejected')
})

it('手动编辑 pending 区被 changeFilter 拦截（冻结）', () => {
  const filePath = 'vela://draft/11'
  seedSession(filePath)
  const { container } = renderEditor(ORIG, undefined, filePath)
  const view = getView(container)
  // 在 h0.s0（0..3，'AAA'）内输入 → changeFilter 拒绝整笔事务
  act(() => {
    view.dispatch({ changes: { from: 2, to: 2, insert: 'X' }, annotations: [Transaction.time.of(6000)] })
  })
  expect(view.state.doc.toString()).toBe(ORIG)
})
```

> 交互断言以**实际组件实现**为准：浮条/浮层的按钮/勾选如何驱动 store 与 dispatch（Step 6 组件挂接）由实施者按上述 store API + `dispatchAcceptChange` 组合，测试先锁最小契约（装饰区间、浮条存在性、拒绝零 undo、冻结），按钮级交互在 Step 6 组件完成后回填 1-2 条 DOM 级用例。

- [ ] **Step 6: 跑失败 → 组件挂接（CodeMirrorEditor.tsx + Bar/Popover + CSS）→ 跑过**

先跑：`node node_modules/vitest/vitest.mjs run src/components/editor/CodeMirrorEditor.inline.test.tsx` → FAIL（浮条/field 行为不存在）。

CodeMirrorEditor.tsx 挂接点（全部默认关闭、无会话零影响）：

```tsx
// import 增（:13 后）：
import { useEditorStore } from '../../stores/editor-store'
import {
  inlineAcceptExtensions, setHunkRanges, deriveRangesFromDoc, dispatchAcceptChange,
  findPendingRangeAt, INLINE_ACCEPT_EVENT, type InlineHunkRange,
} from './codemirror-inline-accept'
import { countAccepted, countSubHunks, type DiffSession, type SubHunk } from '../../services/diff/hunk-model'
import { InlineAcceptBar } from './InlineAcceptBar'
import { InlineAcceptPopover } from './InlineAcceptPopover'
import './inline-accept.css'
```

组件内（`extensions` useMemo :286-335 的 `exts` 数组**无条件** `exts.push(...inlineAcceptExtensions())`——R3：StateField 常驻但空值零可见影响；会话期 filter 由 field 内 ranges 驱动，无需动态 reconfigure）：

```tsx
// 会话选择（Task 3 store；filePath 即 draft tab id，见 DraftEditor:373-376）
const inlineSession = useEditorStore((s) =>
  filePath ? (s.tabs.find(t => t.id === filePath || t.filePath === filePath)?.inlineSession ?? null) : null,
)
// 浮层当前命中区间（点击 pending 区段打开）
const [activeRange, setActiveRange] = useState<{ hunkIdx: number; subIdx: number } | null>(null)
const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null)

// 会话期间把决策态同步进 CM ranges（begin / 决策变更 / 重挂载）
useEffect(() => {
  if (!inlineSession || !editorRef.current?.view) return
  const view = editorRef.current.view
  const ranges = deriveRangesFromDoc(inlineSession, view.state.doc.toString())
  view.dispatch({ effects: setHunkRanges.of(ranges) })
  // 决策变更后重推（store action 每次产生新 inlineSession 对象 → 本 effect 触发）
}, [inlineSession])

// 点击 pending 区段 → 打开接受浮层（复用 :189-248 坐标基座思路：posAtCoords + coordsAtPos）
const handleDocClick = useCallback(() => {
  const view = editorRef.current?.view
  if (!view || !inlineSession) return
  const coords = view.coordsAtPos(view.state.selection.main.head) // jsdom 打桩可测；真实环境用 contentDOM click → posAtCoords
  if (!coords) return
  const range = findPendingRangeAt(view, view.state.selection.main.head)
  if (range) {
    const hunkIdx = inlineSession.hunks.findIndex(h => h.sub.some(s => s.id === range.id))
    setActiveRange({ hunkIdx, subIdx: inlineSession.hunks[hunkIdx].sub.findIndex(s => s.id === range.id) })
    setPopoverPos({ top: coords.top, left: coords.left })
  } else {
    setActiveRange(null); setPopoverPos(null)
  }
}, [inlineSession])
```

handleUpdate 的 docChanged 分支（:151-162 前）补「用户手动编辑区间外 → 退出会话」（排除自身接受事务与外部同步）：

```tsx
if (v.docChanged) {
  const tr = v.transactions.at(-1)
  const isOwnAccept = tr?.annotation(Transaction.userEvent) === INLINE_ACCEPT_EVENT
  const isExternal = tr?.annotation(Transaction.addToHistory) === false
  if (!isOwnAccept && !isExternal && inlineSession) {
    // 用户手动改动了 pending 区之外（锚句区/其他段落）→ R6 简化策略：退出会话并提示
    useEditorStore.getState().endInlineSession(filePath ?? '')
    toastInlineExit() // 实现：动态 import('../ui/Toast') → t('inlineAccept.manualEditExit')
  }
}
```

> `handleUpdate` 为 useCallback，依赖数组需含新引用；`filePath`/`inlineSession` 变化会重建回调——与现状 `onChange` 依赖模式一致（CodeMirrorEditor.tsx:151-177 既有）。

action 处理器（统一入口，供 Bar/Popover/测试复用；全部**先取 field 当前 ranges** 再落 store）：

```tsx
const acceptSub = (view: EditorView, session: DiffSession, sub: SubHunk) => {
  const ranges = view.state.field(inlineAcceptField).ranges
  const r = ranges.find(x => x.id === sub.id)
  if (!r) return
  dispatchAcceptChange(view, r, sub.modText, Date.now())
  useEditorStore.getState().updateHunkDecision(sessionSourceTabId(), sub.id, 'accepted')
}
```

**undo/redo 生命周期如实记录（Task 4 注释）**：undo 栈生命周期 = CodeMirrorEditor 实例（切 tab/关会话即丢，与现状任何编辑一致，设计 §4.4 限制如实记录）。接受后 Ctrl+Z：doc 还原该句原文，但 store 决策仍记 accepted——本 v1 设计决策表只驱动装饰/浮条计数与「完成」判断（不参与 A 收尾正文合成，合成取 doc 实况，Task 5 说明），故 doc 层单步 undo 语义成立、无数据损坏；装饰计数在 undo 后可能短暂偏高，Task 6 记录为已知限制（跨会话/历史联动的 v1.1 项）。

渲染（root :488 容器内、CodeMirror 上方/下方，仅 `inlineSession` 存在时）：

```tsx
{inlineSession && (
  <InlineAcceptBar
    session={inlineSession}
    onAcceptAll={() => acceptAllSubs() /* 逐个 dispatchAcceptChange + updateHunkDecision(递增 time) */}
    onRejectAll={() => rejectAllSubs() /* 仅决策态 */}
    onFinish={onFinish}            // Task 5 注入；无注入时默认 endInlineSession
    onClose={() => onCloseSession()} // 有 pending → confirm(t('inlineAccept.closeConfirm')) → endInlineSession
  />
)}
{inlineSession && activeRange && popoverPos && (
  <InlineAcceptPopover
    session={inlineSession}
    hunkIdx={activeRange.hunkIdx}
    position={popoverPos}
    onAcceptSub={(sub) => acceptSub(view, session, sub)}
    onAcceptWhole={() => acceptWhole(view, session, inlineSession.hunks[activeRange.hunkIdx]) /* 单事务替换 hunk.origRange（逐子句增量 time 亦可——取整段单事务语义 + 显式 time） */}
    onReject={() => rejectCurrent()}
    onClose={() => { setActiveRange(null); setPopoverPos(null) }}
  />
)}
```

InlineAcceptBar.tsx（纯展示 + 回调；进度 = `t('inlineAccept.progress')` 替换 `{n}`=countAccepted / `{m}`=countSubHunks；按钮：全部接受/全部拒绝/完成/关闭；root class `nf-ia-bar`，样式仅 `var(--color-*)`，z 用 `var(--z-sticky)`）。InlineAcceptPopover.tsx：`nf-ia-popover`（复用 :536-668 气泡的 fixed 定位 + `--z-overlay`），内容 = bubbleProgress + 子 hunk 列表（每项 checkbox，`rejected`/`pending` 勾选态，modText 高亮预览 + origText 划除预览（original/revised 标签））+ 底部 4 动作（接受选中/整体接受/拒绝/关闭）。

inline-accept.css（三处状态视觉 + 浮条/浮层样式；**只允许 CSS 变量色**）：

```css
.nf-ia-bar { position: absolute; top: 0; left: 0; right: 0; z-index: var(--z-sticky);
  display: flex; align-items: center; gap: 8px; padding: 2px 10px; font-size: 12px;
  background-color: var(--color-sidebar); border-bottom: 1px solid var(--color-border); }
.nf-ia-pending { background-color: color-mix(in srgb, var(--color-accent) 14%, transparent);
  box-shadow: inset 2px 0 0 var(--color-accent); border-radius: 2px; }
.nf-ia-rejected { text-decoration: line-through;
  color: color-mix(in srgb, var(--color-text-muted) 70%, transparent); }
.nf-ia-popover { position: fixed; z-index: var(--z-overlay); width: 380px; max-height: 320px;
  overflow-y: auto; padding: 10px; border-radius: 12px; border: 1px solid var(--color-border);
  background-color: var(--color-sidebar); box-shadow: var(--shadow-lg, 0 8px 30px rgba(0,0,0,0.2)); }
```

> `color-mix` / `box-shadow` 的既有 CSS 变量以 three-way-merge.css 的用法为准；无 `--shadow-lg` 变量则去掉 shadow 行（禁止新增硬编码色值；透明度合成用 `--color-*-rgb` 变量的 `rgba()` 模式，参照 :276 既有写法）。

- [ ] **Step 7: 跑测试确认通过**

Run:
```bash
node node_modules/vitest/vitest.mjs run src/components/editor/CodeMirrorEditor.inline.test.tsx
node node_modules/vitest/vitest.mjs run src/components/editor/CodeMirrorEditor.test.tsx
```
Expected: 新增用例 PASS（undo 3 步还原 / 拒绝零 undo / 冻结拦截 / 会话外零装饰）；既有 undo 三用例（:98-164）与加粗用例全绿。

- [ ] **Step 8: 门禁 + 提交**

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js src/components/editor/codemirror-inline-accept.ts src/components/editor/CodeMirrorEditor.tsx src/components/editor/InlineAcceptBar.tsx src/components/editor/InlineAcceptPopover.tsx src/components/editor/CodeMirrorEditor.inline.test.tsx --max-warnings 0
git add src/shared/locale-data.ts src/components/editor/codemirror-inline-accept.ts src/components/editor/inline-accept.css src/components/editor/InlineAcceptBar.tsx src/components/editor/InlineAcceptPopover.tsx src/components/editor/CodeMirrorEditor.tsx src/components/editor/CodeMirrorEditor.inline.test.tsx
git commit -m "feat: CM inline 接受 UI——hunk 装饰/浮层/浮条 + 显式 time 独立 undo 事务 + pending 冻结（R3/R4/R6 简化）"
```

---

### Task 5: A 入口集成——气泡 AI 输出 → 会话 + vela://draft 收尾落库链

**Files:**
- Create: `src/services/diff/selection-session.ts`（选区文本对齐 → DiffSession 纯函数）
- Create: `src/services/diff/selection-session.test.ts`
- Modify: `src/components/editor/CodeMirrorEditor.tsx:436-468`（handleAcceptAI 从「整段替换」改为「应用为修改建议 → beginInlineSession」；:571-587 按钮文案与点击路由）
- Modify: `src/components/editor/CodeMirrorEditor.tsx`（会话 finish 收尾链：`finishSelectionSession`）
- Modify: `src/shared/locale-data.ts`（+2 key：`inlineAccept.applyAsSuggestion`/`inlineAccept.noChanges`）
- Test: `src/components/editor/CodeMirrorEditor.inline.test.tsx`（A 入口用例追加）

**Interfaces:**
- Consumes: Task 1 `computeParagraphHunks`；Task 2 `refineHunkWithSentences`/`DiffSession`；Task 3 `beginInlineSession`/`endInlineSession`；Task 4 `dispatchAcceptChange`/浮条 `onFinish`/`onClose`
- Produces（Task 6 验收对象）:
  - `export function buildSelectionSession(docText: string, selFrom: number, selTo: number, aiText: string): DiffSession | null`（null = AI 输出与选区文本等价/空改动）
  - finish 语义（组件内 `finishSelectionSession(filePath, docText)`）：会话有 ≥1 accepted 且 filePath 为 `vela://draft/{id}` → 先 `db:revision-get-pending` 全 discard（R9，对齐 refine-draft.command.ts:88-92）→ `db:revision-next-index` → `db:revision-create`（content = **当前 doc 全文**、userPrompt 带动作标签、revisionType 'refine'）→ `endInlineSession`；正文落库不在此处（用户 Ctrl+S / 自动保存走 doSave 现状 :102-145）。**已接受内容以 doc 实况为准，决策表不参与正文合成**（doc 是唯一真相，undo 后的 doc 即最终采纳文本）。

- [ ] **Step 1: locale-data.ts +2 key（:2121 后 inlineAccept 段内追加）**

```ts
  'inlineAccept.applyAsSuggestion': { 'zh-CN': '应用为修改建议', 'en-US': 'Apply as suggestion', 'ru-RU': 'Применить как предложение' },
  'inlineAccept.noChanges': { 'zh-CN': 'AI 未改动选中文本', 'en-US': 'AI made no changes to the selection', 'ru-RU': 'ИИ не изменил выделенный текст' },
```

- [ ] **Step 2: 写失败测试（selection-session.test.ts + A 集成用例）**

```ts
import { describe, it, expect } from 'vitest'
import { buildSelectionSession } from './selection-session'

describe('buildSelectionSession（A 入口选区对齐，设计 §4.1 定位链路 v1 落点）', () => {
  it('选区文本 vs AI 输出 → MATCH 段 hunk 细分，origRange 折算回 doc 坐标', () => {
    const doc = '她抬头望向窗外。\n雨还在下。\n她叹了口气。'
    const from = doc.indexOf('雨还在下。')
    const session = buildSelectionSession(doc, from, from + '雨还在下。'.length, '雨一直在下。')
    expect(session).toBeTruthy()
    expect(session!.baseDocSnapshot).toBe(doc)
    const hunk = session!.hunks[0]
    expect(hunk.kind).toBe('MATCH')
    expect(hunk.origText).toBe('雨还在下。')
    expect(hunk.origRange).toEqual({ from, to: from + '雨还在下。'.length })
    expect(session!.decisions).toEqual({})
  })

  it('AI 输出与选区等价（无改动）→ null', () => {
    const doc = '甲乙丙'
    const session = buildSelectionSession(doc, 0, 3, '甲乙丙')
    expect(session).toBeNull()
  })

  it('AI 整段重写（无锚句）→ 单子 hunk 降级（接受即整段替换）', () => {
    const doc = '他走进屋子，放下包，坐下。'
    const session = buildSelectionSession(doc, 0, doc.length, '门被推开，风灌了进来。')
    expect(session!.hunks[0].sub).toHaveLength(1)
    expect(session!.hunks[0].sub[0].modText).toBe('门被推开，风灌了进来。')
  })

  it('多句选区局部改动 → 只产出 changed run 子 hunk（锚句不在子 hunk）', () => {
    const doc = '天黑了。\n他点亮灯。\n继续写。'
    const selText = doc // 整段
    const aiText = '天黑了。\n他点燃油灯。\n继续写。'
    const session = buildSelectionSession(doc, 0, selText.length, aiText)
    const subs = session!.hunks.flatMap(h => h.sub)
    expect(subs.map(s => s.origText)).toEqual(['\n他点亮灯。']) // 仅第 2 句为 changed run（\n 归属依 splitSentences 实测校准）
  })
})
```

A 集成用例（CodeMirrorEditor.inline.test.tsx 追加，vi.mock ipc-client 顶层）：
- **不在组件测试里写「点击流式按钮进入会话」的伪用例**——气泡流式态依赖真实 LLM/状态机，jsdom 不可达（CodeMirrorEditor.test.tsx:206-217 的 coordsAtPos 桩只解决浮层定位）。A 入口的可测契约拆成两层：① `buildSelectionSession` 纯函数全测（本 Step 上方 describe）；② 收尾落库链 `finishSelectionSession` 白盒测（下 Step，mock ipc-client 断言调用序列）。组件里 handleAcceptAI 的接线（setAiResult 态 → 按钮文案 = `inlineAccept.applyAsSuggestion` → onClick = beginSession）由 Step 4 组件实现 + Task 6 人工 QA（验收 1）覆盖；「会话激活时 doc 不被整段替换」由 Task 4 冻结/装饰用例覆盖。


- [ ] **Step 3: 跑失败**

Run: `node node_modules/vitest/vitest.mjs run src/services/diff/selection-session.test.ts`
Expected: FAIL——模块不存在。

- [ ] **Step 4: 实现 selection-session.ts（选区级对齐 + 偏移折算）**

```ts
import { computeParagraphHunks } from './paragraph-align'
import { refineHunkWithSentences } from './sentence-split'
import type { DiffSession, SessionHunk } from './hunk-model'

/**
 * A 入口会话构建：把 (docText, selFrom, selTo) 的选区文本与 AI 输出对齐成 DiffSession。
 * v1 采用「选区级对齐」（选区文本视作独立文档，hunk 偏移 + selFrom 折算回 doc 坐标），
 * 理由（设计 §4.1「整文对齐后只保留选区 hunk」的 v1 精化）：
 * ① 选区边界不落在段界时整文段对齐会把整段判为 MATCH（段级相似度 > SIM_THRESH），
 *    句内差异无法产出 hunk——选区级对齐保证句级子 hunk 必然覆盖实际改动；
 * ② 全量接受后的 doc 与「整体替换」（旧 handleAcceptAI 语义）逐字节一致（验收 3）。
 * 整文对齐仍用于 v1.1 B 入口（computeParagraphHunks 保留，本函数不复用整文路径）。
 */
export function buildSelectionSession(
  docText: string, selFrom: number, selTo: number, aiText: string,
): DiffSession | null {
  const selText = docText.slice(selFrom, selTo)
  if (aiText.trim() === selText.trim()) return null
  // 选区文本当独立文档对齐（无需 frontmatter——草稿正文）；偏移统一折算
  const hunks = computeParagraphHunks(selText, aiText)
  if (hunks.length === 0) return null
  const sessionHunks: SessionHunk[] = hunks.map((h, i) => ({
    id: h.id,
    kind: h.kind,
    modText: h.modText,
    sub: refineHunkWithSentences(h).map(s => ({
      ...s,
      id: `sel${i}.${s.id}`, // 并入外层命名空间防与未来 B 会话冲突——见实现说明
      parentId: h.id,
      origRange: { from: s.origRange.from + selFrom, to: s.origRange.to + selFrom },
    })),
    decision: 'pending',
  }))
  const subHunks = sessionHunks.flatMap(h => h.sub)
  if (subHunks.length === 0) return null
  return {
    sessionId: `sel-${selFrom}-${selTo}-${Date.now()}`,
    sourceKind: 'selection',
    baseDocSnapshot: docText,
    hunks: sessionHunks,
    decisions: {},
  }
}
```

> 实现说明：`refineHunkWithSentences` 返回的 sub id 形如 `h0.s0`（Task 2 契约）——selection-session 在其上加 `sel{i}.` 前缀是**可选命名空间**：若 Task 2/3/4 已保证子 hunk id 全会话唯一且稳定，可去掉该前缀直接透传（以 Task 4 装饰/决策测试为准，选择其一并保持一致——本计划的 id 契约是「同一会话内唯一 + 确定性」，前缀方案与透传方案都满足；实施时取更简单者）。`sessionId` 用时间戳前缀即可（唯一性要求，稳定性由决策表挂 tab 持久保证）。

- [ ] **Step 5: 收尾落库链——写失败测试（A 集成用例：finish 链）**

CodeMirrorEditor.inline.test.tsx 追加（mock 已建）：

```tsx
it('A 收尾：完成会话 → 旧 pending 清理 + revision-create 恰一次；正文不在此落库（验收 4）', async () => {
  const { ipc } = await import('../../services/ipc-client')
  const invoke = vi.mocked(ipc.invoke)
  invoke.mockImplementation(async (ch: string) => {
    if (ch === 'db:revision-get-pending') return [{ id: 1 }, { id: 2 }] // 两条旧 pending（R9 要清理）
    if (ch === 'db:revision-next-index') return 3
    if (ch === 'db:revision-mark-discarded') return { success: true }
    if (ch === 'db:revision-create') return { success: true, id: 9 }
    return {}
  })
  const filePath = 'vela://draft/12'
  const doc = '雨下了一整夜。\n天亮了。\n她推开窗。'
  useEditorStore.setState({ tabs: [], activeTabId: null })
  useEditorStore.getState().openFile({ id: filePath, name: 'd', type: 'chapter', filePath, content: doc })
  useEditorStore.getState().beginInlineSession(filePath, mkSession())
  useEditorStore.getState().updateHunkDecision(filePath, 'h0.s1', 'accepted')
  // finishSelectionSession 以导出纯异步函数白盒调用（组件浮条 onFinish 接线同一函数）
  const { finishSelectionSession } = await import('./CodeMirrorEditor') // 若为组件内私有，则改从导出模块 import
  await act(async () => { await finishSelectionSession(filePath, useEditorStore.getState().tabs.find(t => t.id === filePath)!.content!) })
  const calls = invoke.mock.calls.map(c => c[0])
  expect(calls.filter(c => c === 'db:revision-mark-discarded')).toHaveLength(2)
  expect(calls.filter(c => c === 'db:revision-create')).toHaveLength(1)
  const createArg = invoke.mock.calls.find(c => c[0] === 'db:revision-create')![1] as { content: string; revisionType: string }
  expect(createArg.content).toBe(doc) // content = 会话最终 doc 实况
  expect(createArg.revisionType).toBe('refine')
  expect(useEditorStore.getState().tabs.find(t => t.id === filePath)!.inlineSession).toBeUndefined()
})
```

- [ ] **Step 6: 跑失败 → 实现接线 → 跑过**

跑：`node node_modules/vitest/vitest.mjs run src/components/editor/CodeMirrorEditor.inline.test.tsx` → FAIL（finishSelectionSession 未导出）。

实现（CodeMirrorEditor.tsx 内导出纯 async 函数，便于白盒测试；组件内引用同一函数）：

```tsx
/** A 收尾落库（设计 §4.5 A 来源）：仅 vela://draft 且会话有 accepted 时创建 revision；
 *  先按 refine-draft 语义清理旧 pending（R9 修复——现状 :441-455 无清理导致 pending 反复累积），
 *  正文落库不在此（Ctrl+S/自动保存走 DraftEditor.doSave :102-145 现状链路）。 */
export async function finishSelectionSession(filePath: string | undefined, docText: string): Promise<void> {
  if (!filePath?.startsWith('vela://draft/')) return
  const store = useEditorStore.getState()
  const tab = store.tabs.find(t => t.id === filePath || t.filePath === filePath)
  const session = tab?.inlineSession
  if (!session) return
  const hasAccepted = session.hunks.some(h => h.sub.some(s => session.decisions[s.id] === 'accepted'))
  if (!hasAccepted) {
    store.endInlineSession(filePath)
    return
  }
  try {
    const draftId = parseInt(filePath.replace('vela://draft/', ''), 10)
    const { ipc } = await import('../../services/ipc-client')
    // R9：清理该草稿既有 pending refine revision——对齐 refine-draft.command.ts:88-92
    const pending = await ipc.invoke('db:revision-get-pending', draftId) as Array<{ id: number }>
    for (const rev of pending) {
      await ipc.invoke('db:revision-mark-discarded', rev.id)
    }
    const nextIdx = await ipc.invoke('db:revision-next-index', draftId) as number
    const actionLabel = activeAIActionRef.current ?? ''
    await ipc.invoke('db:revision-create', {
      baseDraftId: draftId,
      revisionIndex: nextIdx,
      revisionType: 'refine',
      userPrompt: actionLabel ? `气泡菜单 AI — ${actionLabel}` : '气泡菜单 AI 改写',
      content: docText,
      wordCount: computeTextStats(docText).novelWordCount,
    })
  } catch (e) {
    console.error('[inline-accept] revision create failed', e) // 不阻塞会话结束；错误见 renderLog 若接入
  } finally {
    useEditorStore.getState().endInlineSession(filePath)
  }
}
```

接线改动（CodeMirrorEditor.tsx）：
1. `handleAcceptAI`（:436-468）整段替换体改为：点击「应用为修改建议」→ `const view = …; const session = buildSelectionSession(view.state.doc.toString(), selectionRange.from, selectionRange.to, aiResult)`；`session === null` → `toast(t('inlineAccept.noChanges'))` + handleRejectAI 清态；否则 `beginInlineSession(filePath ?? '', session)`（filePath 为空则用 tab id——CodeMirrorEditor 无 id prop，v1 仅 DraftEditor 接入且必带 filePath；空 filePath 时 toast 错误并回退旧整段替换不适用——直接 toast 拒绝）。清 `aiAcceptedRef` 偏好快照逻辑（:119-142/:464）在新路径**不适用**（不再一次性整段替换）——保留函数但 `handleAcceptAI` 不再写 `aiAcceptedRef`（加注释说明 L1 改道；偏好记忆链留 v1.1 评估）。
2. 气泡 AI 面板（:584-586）按钮 label 从 `t('editor.replace')` 改为 `t('inlineAccept.applyAsSuggestion')`（同 onClick=handleAcceptAI）。
3. InlineAcceptBar 的 `onFinish` = `() => void finishSelectionSession(filePath, view.state.doc.toString())`；`onClose`（有 pending 时 confirm `t('inlineAccept.closeConfirm')` 后 endInlineSession，参照 DraftEditor doFinalize 的 confirm 用法 :189-196）。
4. `activeAIActionRef`：现有 `activeAIAction` 是 state；finish 内引用需经 ref 同步（`const activeAIActionRef = useRef<string|null>(null)`，setActiveAIAction 处同步赋值；或 finish 接受 actionLabel 参数由调用方传入——取参数方案更纯：`finishSelectionSession(filePath, docText, actionLabel)`）。

- [ ] **Step 7: 跑测试确认通过**

Run:
```bash
node node_modules/vitest/vitest.mjs run src/services/diff/selection-session.test.ts
node node_modules/vitest/vitest.mjs run src/components/editor/CodeMirrorEditor.inline.test.tsx
```
Expected: 全 PASS。

- [ ] **Step 8: 门禁 + 提交**

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js src/services/diff/selection-session.ts src/services/diff/selection-session.test.ts src/components/editor/CodeMirrorEditor.tsx src/components/editor/CodeMirrorEditor.inline.test.tsx --max-warnings 0
git add src/shared/locale-data.ts src/services/diff/selection-session.ts src/services/diff/selection-session.test.ts src/components/editor/CodeMirrorEditor.tsx src/components/editor/CodeMirrorEditor.inline.test.tsx
git commit -m "feat: A 入口 inline 会话集成——气泡「应用为修改建议」+ vela://draft 收尾 revision-create（R9 旧 pending 清理）"
```

---

### Task 6: i18n 完整性 + 全量门禁 + §8 Phase 1 六条验收核对

**Files:**
- Verify: `src/shared/locale-data.ts`（inlineAccept.* 全量三语、无缺语）
- Verify: Task 1-5 全部改动文件（i18n 残留扫描）
- Verify: 全量测试 / typecheck / lint
- Docs: 本计划末尾验收表逐条核对（evidence 式，不是「跑过就完」）

**Interfaces:**
- Consumes: Task 1-5 全部交付

- [ ] **Step 1: i18n 完整性核对（设计 R11）**

```bash
node node_modules/vitest/vitest.mjs run src/services 2>&1 | tail -5   # 冒烟：diff 服务全绿（确认无跨任务破坏）
node scripts/extract-tokens.cjs | findstr /C:"inlineAccept"           # token 报告含 inlineAccept.*（Windows findstr；无则用 Select-String）
```
Expected: `inlineAccept.applyAsSuggestion / barProgress?` —— 逐个核对：每个 `t('inlineAccept.…')` 使用点在三语数据中均存在且三语非空（手写核对表如下，全部 key：progress/bubbleProgress/original/revised/acceptSelected/acceptWhole/reject/acceptAll/rejectAll/finish/close/manualEditExit/closeConfirm/applyAsSuggestion/noChanges，共 15 个）。对照 i18n-standard 残留扫描：`grep -rn "'[^']*[\u4e00-\u9fa5][^']*'" src/components/editor/CodeMirrorEditor.tsx src/components/editor/InlineAcceptBar.tsx src/components/editor/InlineAcceptPopover.tsx src/services/diff` 不得出现未走 `t()` 的中文（注释/已有注释豁免，逐条人工确认）。缺 key/残留 → 就地补（key 表抄 Task 4 Step 1 / Task 5 Step 1）并提交 `fix: i18n …`。

- [ ] **Step 2: 全量门禁**

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js . --ext ts,tsx --max-warnings 0   # 受限环境改逐文件跑受改文件
node node_modules/vitest/vitest.mjs run    # 全量；受限 EPERM 则用最小 config 替代（见 Global Constraints 环境注意）并注明
```
Expected: 零错误零警告；全量测试绿。**断言必须附真实输出**：typecheck 无输出、lint 无输出、vitest 汇总行（`Test Files N passed`）。既有回归重点：`src/stores/editor-store.test.ts`（openFile 去重）、`src/components/editor/CodeMirrorEditor.test.tsx`（undo 三用例 :98-164）、Task 1 弹窗 4 条。

- [ ] **Step 3: §8 Phase 1 六条验收逐条核对（evidence 式）**

| # | 验收 | 验证路径（evidence） |
|---|---|---|
| 1 | 选段触发 AI 改写（五动作任一）后，流式结果出现「应用为修改建议」而非直接替换 | CodeMirrorEditor.tsx:584-586 label 改 `inlineAccept.applyAsSuggestion`（zh='应用为修改建议'）；人工 QA：选中一段 → 任一 AI 动作流式结束 → 面板主按钮文案；点它不触发 `view.dispatch({changes 整段替换})`（旧 :458-462 已删） |
| 2 | 进入会话：原文不变、pending 区有装饰标记、浮条显示 n/m | `CodeMirrorEditor.inline.test.tsx`：ranges 非空 + `.nf-ia-bar` 存在 + doc 不变；浮条 `progress` key `{n}/{m}`=countAccepted/countSubHunks；人工目检 pending 底纹 |
| 3 | 逐句接受可 Ctrl+Z 单步撤销、Ctrl+Y 重做；拒绝/误拒恢复可用；全部接受后 doc 与「整体替换」一致 | undo 粒度用例（3 次 Ctrl+Z 逐步还原，显式 time）；误拒恢复 = resetHunkDecision 测试；「全部接受 == 整体替换」= selection-session 等价性（aiText 全句替换 doc 与直接整段替换逐字节一致——由 selection-session 契约 + 人工对比）；Ctrl+Y 重做 = `redo(view)` 既有（CodeMirrorEditor.test.tsx 模式），人工抽验一次 |
| 4 | vela://draft 收尾产生且仅产生一条 refine revision（旧 pending 被清理），Ctrl+S 落库正文 | `finishSelectionSession` 白盒用例：2 条旧 pending → 2 次 mark-discarded + 恰 1 次 revision-create（content=doc）；Ctrl+S 落库 = DraftEditor.doSave 既有链路（:102-145），人工：会话完成后 Ctrl+S → toast 成功 + 草稿内容已更新 |
| 5 | 会话关闭（含切 tab 重进、有未决决策时二次确认）不丢已接受内容、不损坏 revision 状态 | store 决策持久测试（重挂载读回 decisions）；closeConfirm 二次确认（`inlineAccept.closeConfirm`，有 pending 才弹）；「不丢已接受内容」= endInlineSession 不清 content/dirty 测试 + doc 实况为真源；切 tab 重进 = EditorArea 单实例（:604-610）卸载/重挂后 store 会话仍在（人工 + 决策测试） |
| 6 | 全部门禁 + §7 用例绿 | Step 2 门禁输出 + §7 映射（见本计划「Self-Review」覆盖表）；设计 §7 全部行均落在 Task 1/2/3/4/5 测试中 |

- [ ] **Step 4: 已知限制如实登记（验收表附件，进本计划或实现 ledger）**

逐条登记并**不**修复（v1.1/后续窗口项，防 reviewer 误判为遗漏）：undo 后 store 决策计数可能短暂偏高（Task 4 注释）；多段选区结构变化（段并/段拆跨锚句）时逐句接受不等于整段直替（selection-session 契约之外，验收 3 fixture 限定单段结构不变）；CRLF 文档句替换可能混入 LF（Task 2 注释）；切 tab 丢 CM undo 栈（现状限制，设计 §4.4 已记录）；accepted 视觉仅以替换后文本呈现、doc 内不再画淡绿（设计 §4.3「accepted 淡绿」以浮层勾选态承担——见 Task 4 说明）。

- [ ] **Step 5: 提交（若 Step 1/2 有补强）**

```bash
git add <变更文件>
git commit -m "fix: L1 inline 接受 i18n/门禁补强（inlineAccept.* 完整性 + 残留清零）"
```
无变更则跳过，本任务结束 = v1 全量交付。

---

## Self-Review 记录

**① Spec/Phase 1 六条验收覆盖**：
- 验收 1（「应用为修改建议」入口）→ Task 5（按钮 label + handleAcceptAI 改道）
- 验收 2（原文不变 + 装饰 + 浮条 n/m）→ Task 4（StateField/decorations/Bar）+ Task 3（会话注入）
- 验收 3（单步 undo/redo、拒绝/误拒恢复、全部接受 == 整体替换）→ Task 4（显式 time 事务 + undo 用例 + resetHunkDecision）
- 验收 4（唯一一条 refine revision + 旧 pending 清理 + Ctrl+S 落库）→ Task 5（finishSelectionSession + R9 清理用例）
- 验收 5（会话关闭/切 tab/二次确认不丢内容不坏 revision）→ Task 3（决策持久 + endInlineSession 语义测试）+ Task 4（closeConfirm）
- 验收 6（门禁 + §7 用例）→ Task 6
- 设计 §7 各行映射：extractParagraphsWithOffsets/offsets/frontmatter（R7）→ Task 1 Step 4；computeParagraphHunks 等价/拆并段/增删段 → Task 1 Step 4；splitSentences/refineHunkWithSentences（混排/锚句/局部 1 子 hunk/整段重写降级/无锚降级）→ Task 2 Step 1；会话层状态机/持久/discard → Task 3；CM 事务（接受单事务进 undo 3 步、拒绝无 undo、落库不进栈、changeFilter 拦截、会话外零装饰）→ Task 4（外部同步不进栈由既有 CodeMirrorEditor.test.tsx:147-163 回归）；A 入口集成（进入会话 doc 未变、收尾 revision-create 一条 + 旧 pending 清理、拒绝无 revision）→ Task 5。

**② 占位符扫描**：无 TBD/TODO/「适当处理」；各 Task 测试与实现代码均给出。伪码中带「见实现说明/占位」的 `refineHunkWithSentences` 骨架与 `buildDeco` 骨架已用**实现说明块**给出正式语义与落笔点（非交付占位，是引导实施者按契约补齐的边界——契约 = 测试断言）；Task 5 原「气泡点击流」组件用例已整段移除（jsdom 不可达，接线由 Step 4 实现 + Task 6 人工 QA 覆盖）——不留空断言。

**③ 跨任务类型/签名一致性**：
- `AlignedHunk`/`AlignOp`/`ParaSpan`/`computeParagraphHunks`（Task 1 产出）在 Task 2（refineHunkWithSentences 入参/kind 判断）、Task 5（computeParagraphHunks 消费）引用一致；
- `SubHunk`/`HunkDecision`/`DiffSession`/`aggregateDecision`（Task 2 hunk-model）在 Task 3（store actions）、Task 4（装饰/决策）、Task 5（会话构建/收尾）签名一致；DiffSession 的 `decisions` map 为 Task 2 定义、Task 3 唯一写、Task 4/5 读，无命名分叉；
- store actions `beginInlineSession(tabId, session)`/`updateHunkDecision(tabId, subHunkId, decision)`/`resetHunkDecision`/`endInlineSession(tabId)`（Task 3）被 Task 4（决策驱动装饰、拒绝）、Task 5（begin/finish）原样引用；
- CM 导出 `inlineAcceptField`/`setHunkRanges`/`deriveRangesFromDoc`/`dispatchAcceptChange`/`INLINE_ACCEPT_EVENT`（Task 4）在 Task 5（finish 不重 dispatch doc，仅读 doc + store）与测试引用一致；
- `finishSelectionSession(filePath, docText, actionLabel?)`（Task 5）与 Task 4 浮条 `onFinish` 接线一致；
- i18n key 命名全任务统一 `inlineAccept.*`；Task 4 落 13 key、Task 5 落 2 key、Task 6 核对 15 key，无重复定义/改名。

**④ 非目标无任务**：v1.1 B 入口（diff tab 分流/三栏切换/applyMergedRevision）、agent 在位编辑流、词级 diff、跨会话 undo、DB revision 半合并、孤儿组件清理、只读态 inline、审稿报告 inline——全部仅在 Global Constraints 声明，无任何 Task 触碰（ThreeWayMerge/applyMergedRevision 仅作回归/对照引用，不改其语义）。
