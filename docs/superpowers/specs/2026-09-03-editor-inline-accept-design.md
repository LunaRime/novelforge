# L1 设计：AI 改稿接选区 inline 接受（2026-09-03）

> 状态：设计定稿（2026-09-03 用户评审通过——裁决① v1 入口 = 气泡选区 A 先行、整章 revision B 放 v1.1；裁决② 句级子 hunk 进 v1）
> 日期：2026-09-03
> 对应实施计划：`docs/superpowers/plans/2026-08-29-cc-remaining-implementation.md` 档 3 Task L1（:90-96，计划判定的 NF 最大用户可感知代差）
> 设计依据：`docs/2026-08-26-claude-code-compare.md` §五.1（:97「无 hunk 级接受、无 agent 在位编辑流…AI 改稿接选区 inline 接受是短路径」）+ §六.2（:107 编辑器集成提级）
> 范本对齐：`docs/superpowers/specs/2026-08-29-agent-tool-result-compression-design.md`、`2026-08-26-agent-conversation-upgrade-design.md`

## 1. 背景与目标

### 1.1 背景

CC 对比报告 §五.1 判定 NF 与 Claude Code 的**最大用户可感知代差**是「agent 与编辑器集成形态」：AI 改写 = 弹窗 → 整段替换；修稿走 diff 标签页 + 段落级三栏合并；无 hunk 级接受、无 agent 在位编辑流。仓库已有 ThreeWayMerge 的 DP 段落对齐（`ThreeWayMerge.tsx:108-213`），因此「AI 改稿接选区 inline 接受」被判定为**短路径**（计划 L1，优先级 P1 最高）。

### 1.2 目标

本文产出 L1 的**设计文档（只设计不实现）**，核心交付一个裁决集：

1. **定位链路**：AI 改稿输出（修订版正文）如何与当前编辑器选区/全文对齐 → 生成 hunk 列表（每 hunk = 原文区间 ↔ 改文区间）。
2. **hunk 粒度**：词 / 句 / 段的裁决与 UI 呈现。
3. **inline 接受交互**：编辑器内 hunk 标记形态（气泡/行内），接受后内容更新与 diff 状态清理。
4. **undo 集成**：核实 C3 已修的 undo 机制（`CodeMirrorEditor.tsx:69-102` 外部同步 `addToHistory:false`，落地提交 `104c9d0` / `3c6295f`），hunk 接受序列的 undo 语义。
5. **数据流**：与 DB revision 的关系、draft-store/editor-store 状态机。
6. **与现有 diff 标签页/三栏合并的关系**：共存 vs 替代的渐进路径。
7. **范围边界**：v1 最小可用（单段 inline 接受）vs 完整 agent 在位编辑流（明确非目标）。

约束：只产出设计文档，不改源码；调研发现的 L1 前置缺口如实记录于 §6/§10。

## 2. 现状盘点（代码锚点表——均实读核实，HEAD `45d6aec`）

| 锚点 | 现状结论 |
|---|---|
| `src/components/editor/ThreeWayMerge.tsx:48-61` | `extractParagraphs`：按空行切段、保留段内多行——纯函数，未导出 |
| `ThreeWayMerge.tsx:95-97,108-213` | `alignParagraphs` DP 段落对齐（SIM_THRESH=0.15 / GAP=-0.05 @110；1:1/1:2/1:3/2:1/3:1 对齐操作）——**NF 唯一成型的段落对齐算法，但埋在组件文件内未导出、无 char 偏移信息** |
| `ThreeWayMerge.tsx:217-259,262-269` | `buildSegments`/`computeSegments`：对齐结果 → `same/hunk` DiffSegment；hunk 内 `originalLines/modifiedLines`（行数组，**丢失段级 char 区间**） |
| `ThreeWayMerge.tsx:331-359` | 合并文本 = 逐 segment 文本 `join('\n')`（:331-333）；hunk 级 toggle 已存在（:335-346 单 hunk 采用/还原、:348-353 applyAll、:355-359 revertAll）——**「hunk 级接受」能力雏形只存在于三栏弹窗内** |
| `ThreeWayMerge.tsx:370-376,428-438` | 工具栏进度「n/total + 全部还原/全部采用/完成」；右栏每 hunk « / ✓ 按钮 |
| `src/components/editor/DiffViewer.tsx:14-17,40,93-104,224-263` | 行级 diff 查看器雏形：`onAccept/onReject` props、side/inline 切换、**accept = 整文 `onAccept(modified)`**、行级 LCS（>1000 行降级）。**全仓库无调用方（grep 仅自身匹配）——孤儿组件** |
| `src/components/editor/MonacoDiffViewer.tsx:16-19,117-128` | 同款孤儿 diff 查看器（Monaco DiffEditor），accept = 整文；统计为占位假数据（:49-51） |
| `src/components/editor/CodeMirrorEditor.tsx:61` | `editorRef: ReactCodeMirrorRef`——选区/编辑器命令唯一访问点 |
| `CodeMirrorEditor.tsx:69-102` | **C3 undo 修复（已落地）**：外部 content 同步 = `view.dispatch({ changes 整文, annotations: [Transaction.addToHistory.of(false)] })`（:91-95）——外部回写不进 undo 栈；配合 pnpm.overrides 统一 `@codemirror/state@6.7.1` 消除双实例（提交 `3c6295f`、`104c9d0`） |
| `CodeMirrorEditor.tsx:151-177` | `handleUpdate`：docChanged → `onChange` → store（DraftEditor :373-376 → `updateTabContent`）；selection → `selectionRange {from,to}`（**doc char offsets**，:164-170）——气泡开关判定 |
| `CodeMirrorEditor.tsx:189-248` | 气泡坐标跟随基建：`coordsAtPos` + DOM Range rect + scroll/resize 监听——hover/选择浮层可直接复用 |
| `CodeMirrorEditor.tsx:286-335` | extensions：`history()`（:288，**undo 栈唯一来源**）、search、keymap、markdown —— **无 decorations/StateField（inline 高亮需新增）** |
| `CodeMirrorEditor.tsx:338-380,436-468` | **报告所指「弹窗→整段替换」**：`handleAIAction` 流式生成（50ms 节流）；`handleAcceptAI`（:436-468）整段替换 `view.dispatch({changes: {from,to,insert}})`（:458-462）+ vela://draft 时 `db:revision-create`（:441-455，**无旧 pending 清理**）；:536-668 气泡预览面板（替换/取消按钮 :571-587） |
| `CodeMirrorEditor.tsx:594-615` | 气泡内 undo/redo 按钮（`undo(view)`/`redo(view)`） |
| `src/components/editor/DraftEditor.tsx:57-74` | 挂载即读 meta + `getPendingRevisions(chapterDir, version)`（草稿 tab 已知自身 pending 修稿） |
| `DraftEditor.tsx:102-145` | `doSave`：vela://draft → `db:draft-update-content`（:113）+ 通知刷新——**只写草稿正文，不翻转 revision 状态** |
| `DraftEditor.tsx:151-167` | 工具栏「AI 修稿」→ `createRefineOnlyWorkflow`（改稿工作流入口） |
| `DraftEditor.tsx:229-262` | `openPendingRevision`（工具条待合并 → mergeData）+ `handleMergeComplete`（:241-262 → `applyMergedRevision`）——**DraftEditor 内第二个三栏弹窗入口** |
| `DraftEditor.tsx:366-378` | CodeMirrorEditor 挂载：`onChange → updateTabContent(filePath, text)`（:373-376，vela 草稿 tab 的 id===filePath） |
| `src/stores/editor-store.ts:4-25` | EditorTab 模型：type 含 `'diff'`（:7）、`originalContent`（:11）、`revisionPath`（:16）、`chapterDir`（:22）——**store 无任何 undo/history 字段**（undo 全在 CM 会话内） |
| `editor-store.ts:63-98` | `openFile`：diff 仅按 id 去重（:66-70）；diff/review-report 强制覆盖并激活（:73-77） |
| `editor-store.ts:118-136` | `updateTabContent`（置 dirty）/ `syncTabContent`（静默）/ `markTabSaved` |
| `src/stores/editor-store.test.ts:57-58` | diff tab 按 id 打开去重语义测试 |
| `src/components/panels/EditorArea.tsx:604-610` | DraftEditor **单实例**挂载（`key={activeTab.id}`）——切 tab 即卸载编辑器 → **CM history/会话状态丢失（现状限制）** |
| `EditorArea.tsx:678-745` | diff tab 打开 = 全屏三栏弹窗：`open` 判定 + Dialog（:679-705）；complete → `applyMergedRevision`（:709-739）；**onCancel = closeTab 不落库也不标 discarded**（:740）；gating `chapterDir && filePath && revPath`（:716，VersionHistory 只读对比 diff 被短路） |
| `src/stores/draft-store.ts:156-216` | `applyMergedRevision`：`db:draft-update-content`（:171）→ `db:draft-update-status 'revised'`（:188）→ `markRevisionMerged`（:195）→ 编辑器 `syncTabContent`（:203-205）→ 刷新侧栏——**「合并完成」的唯一落库原子语义，inline 接受应收敛到它** |
| `src/services/draft-index.ts:35-48,195-236` | RevisionEntry 兼容模型；`markRevisionMerged`（纯数字 id 直达 `db:revision-mark-merged` :201-208） |
| `src/services/workflows/commands/refine-draft.command.ts:86-113` | **修稿产物链**：next-index → 旧 pending 全部 `revision-mark-discarded`（:89-92，只留最新一条）→ `revision-create`（整章改文，:94-100）→ `openFile({type:'diff', originalContent, content, revisionPath})`（:102-113） |
| `src/services/workflows/commands/refine-from-review.command.ts:50-78` | 同款（revisionType `'review-fix'`） |
| `src/services/workflows/commands/refine-paragraphs.command.ts:1-8,104-136` | 头注释声称「diff-match-patch 逐段接受」——**实测陈旧**：全仓库无调用（grep 仅注释/自身/locale 命中）；实现 = 段文本拼接（:104-107）+ 整章 revision（:119-136）；CodeMirrorEditor:32 仅复用其 5 模式标签 |
| `src/services/agent/tools/open-editor.tool.ts:11-80` | `open_editor`：仅物理文件 → `fs:read-file` → openFile 章 tab（:66-72）——**无 vela:// 草稿、无写回、无 diff 参数 = agent 在位编辑流零基础** |
| `src/services/agent/tools/start-workflow.tool.ts:31,93-110` | agent 改稿入口 = `start_workflow workflow:'refine'` → 修稿工作流 → refine-draft 命令 → diff tab（agent 只能经由工作流产物触发编辑器动作） |
| `src/services/agent/tools/read-drafts.tool.ts:76-83` | agent 读草稿（`db:draft-get-full` 全文进工具结果）；写草稿无工具 |
| `src/components/panels/agent/ArtifactCard.tsx:58-77` | 产物卡片点击 = fs 读取 + openFile（artifact- id，无 revision 联动） |
| `src/components/editor/VersionHistory.tsx:70-90` | 版本对比 → openFile type:'diff'（**无 revisionPath → EditorArea 弹窗 complete 被 :716 guard 短路 = 纯对比不落库**） |
| `src/components/editor/EditorToolbar.tsx:214-221` | 「待合并修稿 (n)」按钮 → `onOpenRevision(pendingRevisions[0])` → DraftEditor 三栏弹窗 |
| `electron/repositories/revision-repository.ts:51-163` | revisions 表 + contents 联动：create/list/getPending/getFull/nextIndex/**markMerged(:142-151)/markDiscarded(:154-162)**——**无任何「更新 revision 正文」方法** |
| `src/shared/ipc-channels.ts:523-529` | revisions 全部 7 通道（create/list/get-pending/get-full/next-index/mark-merged/mark-discarded）——**无 revision 半合并/内容更新通道（前置缺口）** |
| `src/components/editor/CodeMirrorEditor.test.tsx:1-27,82-90,98-164` | C3 undo 修复的根因文档化 + 回归用例；:82-90 实证 **CM history 500ms 事件合并**（测试用显式 `Transaction.time` 拉开间隔）——程序化连续 dispatch 会并组的坑位 |
| `package.json` | `@codemirror/view ^6.41.0` / `@codemirror/state ^6.7.1`（pnpm.overrides 锁 6.7.1）/ `@codemirror/language ^6.12.3` / `@uiw/react-codemirror ^4.25.9`——**decorations/StateField/Compartment 能力齐备，无需新依赖**；无 diff-match-patch 依赖（refine-paragraphs 注释为陈旧说明） |

### 2.1 现状关键认知

1. **「逐 hunk 接受」能力雏形存在但只活在三栏弹窗里**：`ThreeWayMerge` 有 hunk 级 toggle/applyAll/进度，其宿主（diff tab 弹窗 + 工具条弹窗）是**脱离正文编辑器的全屏弹层**——用户无法在创作上下文里逐段裁决。
2. **两条 AI 改稿入口互不相通**：① 编辑器气泡 AI 改写 = 弹窗→整段替换（revision 落库无 pending 清理、无 diff 呈现）；② 修稿工作流产物 = diff tab → 三栏弹窗（整章 revision 落库语义完整）。**L1 要把两者收敛到同一「inline 接受内核」**。
3. **undo 已修好且路径清晰**（C3）：外部回写走 `addToHistory:false` 不进栈（`CodeMirrorEditor.tsx:91-95` + 测试）；用户编辑/程序化替换走默认进栈。新路径必须沿用同一约定，且要规避 **500ms 历史事件合并**（测试 :82-90 已实证）。
4. **DB revision 无部分接受语义**：revision 只支持 pending → merged/discarded 整条状态翻转，正文不可更新（ipc-channels.ts:523-529）。inline 的逐 hunk 裁决只能发生在**编辑器交互层**，DB 侧保持「会话收尾时全量落库」。
5. **对齐引擎没有 char 偏移、且不可复用**：DP 算法与文本工具是 ThreeWayMerge.tsx 内的非导出函数，输出是行数组。L1 第一前置任务 = 抽取为独立纯函数模块并补 offsets。
6. **两个行级 diff 查看器（DiffViewer / MonacoDiffViewer）是孤儿组件**：无人调用，不应作为 L1 的复用地（无 hunk accept API、Monaco 体积、中文小说正文行级 diff 价值低），清理另立。

## 3. 总体架构

```
┌─ 来源层（两种 AI 改稿入口，产出同一候选结构）────────────┐
│ A. 编辑器气泡 AI 改写（选区→LLM 流式输出）               │
│ B. 修稿工作流产物（revision：整章原稿 ↔ 整章改文）        │
└──────────────────────┬───────────────────────────────────┘
                       ▼
┌─ ① diff-core（渲染进程纯函数，无 electron/react 依赖）───┐
│   paragraph-align（抽取 ThreeWayMerge DP + 补 char 偏移） │
│   sentence-split + 锚句 LCS 细分（段→子 hunk）            │
│   输出：DiffSession { hunks: Hunk[] }                     │
└──────────────────────┬───────────────────────────────────┘
                       ▼
┌─ ② 会话层（editor-store 扩展）───────────────────────────┐
│   InlineDiffSession（revisionId/hunk 决策表/源快照）      │
│   begin/accept/reject/finish/discard                      │
└──────────────────────┬───────────────────────────────────┘
                       ▼
┌─ ③ 编辑器 UI 层（CodeMirrorEditor 扩展）─────────────────┐
│   hunk 装饰（StateField + 动态 decoration）              │
│   气泡接受/拒绝（复用 :189-248 坐标基建 + 气泡样式）       │
│   工具栏浮条（n/m 进度 + 查看改动/接受/拒绝/完成）         │
│   接受 = 带显式 Transaction.time 的 dispatch（进 undo 栈） │
└──────────────────────┬───────────────────────────────────┘
                       ▼
┌─ ④ 落库层（复用现状语义，不新增 DB 通道）────────────────┐
│   A：Ctrl+S/doSave → db:draft-update-content（现状）      │
│   B：完成合并 → draft-store.applyMergedRevision（现状 :156）│
└────────────────────────────────────────────────────────────┘
```

分层原则：① 纯函数可单测、无 UI 依赖（对齐 D6/D7 的引擎可测性纪律）；② 会话决策态放 store（切 tab/重挂载不丢 hunk 裁决——正文内容仍走既有 tab.content）；③ UI 只做「显示 + 事务派发」；④ 不新增 IPC/DB 通道（v1）。

## 4. 分模块设计

### 4.1 模块 ① diff-core：对齐引擎抽取与 hunk 模型

**新目录**：`src/services/diff/`（与 `text-stats`/`draft-index` 同级，纯函数模块；ThreeWayMerge.tsx 改为从该模块 import，行为零变化——第一步回归锁）。

**数据模型（关键接口，草案）**：

```ts
// paragraph-align.ts —— 从 ThreeWayMerge.tsx:48-269 抽取并扩展
export interface ParaSpan {
  text: string            // 段文本（可含段内换行）
  start: number           // 在所属全文中的 char offset（含前导分隔）
  end: number             // 段末 char offset（不含段后换行/空行）
}
export type AlignOp = 'MATCH' | 'DELETE' | 'INSERT' | 'SPLIT_1_2' | 'SPLIT_1_3' | 'MERGE_2_1' | 'MERGE_3_1'

export interface AlignedHunk {
  id: string                    // `h{seq}`（会话内稳定）
  kind: AlignOp
  origRange: { from: number; to: number }   // 编辑器 doc offsets（原文侧）
  origText: string
  modText: string               // 改文侧对应全文段（多个原文段→拼接改文）
}

export function extractParagraphsWithOffsets(text: string): ParaSpan[]
export function alignParagraphs(orig: ParaSpan[], mod: ParaSpan[]): AlignedPair[] // 现 DP 回溯 + offsets 组装
export function computeParagraphHunks(original: string, modified: string): AlignedHunk[]
// 与 ThreeWayMerge.computeSegments 同语义（stripFrontmatter 逻辑保留，但返回 offsets）
```

```ts
// sentence-split.ts —— 段内句级细分
export function splitSentences(para: string): Sentence[]          // 边界标点：。！？…；\n（含 CRLF），标点归属句尾
export function refineHunkWithSentences(h: AlignedHunk): SubHunk[]
// 锚句 LCS（句子字符串全等为锚）；连串非锚句 → 一个子 hunk；无锚句 → 整段单子 hunk（降级）

// hunk-model.ts —— 会话内状态机
export interface SubHunk { id: string; parentId: string; origRange: {from:number;to:number}; origText: string; modText: string }
export type HunkDecision = 'pending' | 'accepted' | 'rejected'
export interface DiffSession {                 // editor-store 持久化形态（JSON 可序列化）
  sessionId: string
  revisionId?: number                           // B 来源：DB revision id
  sourceKind: 'selection' | 'revision'          // A / B 入口
  baseDocSnapshot: string                       // 会话开始时全文快照（定位锚）
  hunks: Array<{ id: string; kind: AlignOp; modText: string; sub: SubHunk[]; decision: HunkDecision }>
}
```

定位链路（裁决点 1 的落点）：`modified`（AI 输出）与 `original`（B：会话开始时编辑器 doc 快照——revision.originalContent 仅作兜底；A：选区两端之外的正文不变、选区文本 = origText）送 `computeParagraphHunks` → 段级 hunk（origRange 为编辑器 doc offsets）→ 每 hunk 内 `refineHunkWithSentences` 细分（见 4.2）。

**offsets 换算注意**：编辑器 doc 无 frontmatter 时 `origRange` 直接用；若 doc 含 frontmatter（`stripFrontmatter` 语义），须把对齐偏移加回 frontmatter 长度——v1 仅处理草稿正文（A/B 都是纯正文，DraftEditor content），frontmatter 情况记入 §6 风险。

### 4.2 hunk 粒度（裁决点 2 的落点）

- **骨架 = 段**：diff-core 段对齐直接产 hunk（复用 ThreeWayMerge DP 的全部能力：段拆 1:2/1:3、段并 2:1/3:1、增删段）。
- **默认展示 = 句级子 hunk**：对每个段 hunk 做「锚句 LCS」细分——**模型保持原句 = 灰显锚、被改句 = 可单独接受/拒绝的子 hunk**。锚句无匹配（整段重写）时自动降级为整段一个子 hunk，UI 不感知差异。
- 粒度模型的动机：小说正文段长（100–500 字）且 LLM 润色常只动其中几句；**整段接受会把用户已认可的句子一并覆盖（今日弹窗整段替换的痛点），句级接受把裁决面收到实际改动上**。词级不做（中文无空格、词边界与 LLM 改写的映射不稳定，价值/成本比低）。

UI 呈现：段 hunk 收进一个折叠组（见 4.3），展开逐句裁决；折叠时显示「5 处改动 / 已接受 3」。

### 4.3 模块 ③ UI：inline 接受交互（裁决点 3 的落点）

CodeMirrorEditor 新增能力（props/受控扩展，默认关闭、无会话时零影响）：

- **hunk 装饰**：新增 `hunks` StateField + 一个 `setHunks` StateEffect（`@codemirror/view` 已具备，见 package.json 锚点）；渲染：pending 子 hunk 段首竖条/段底纹（CSS 变量色）、accepted 淡绿、rejected 划除淡灰（仅 pending 醒目）。**装饰不做内联改前/改后并排**（prose 无 gutter、内联并排会推挤正文），改前/改后内容放浮层。
- **浮层复用现有气泡基建**（`:189-248` 坐标跟随 + `:536-668` 气泡样式）：点击 pending 段（或键盘 Enter 在段上）→ 气泡内展示：
  - 「第 n/m 处改动」+ 改前（划除预览）/改后（高亮）切换；
  - 句级子 hunk 逐个列出（勾选 = 接受该句改动，锚句只读灰显）；
  - 底部动作：`拒绝`（清状态，不改 doc）/ `接受选中`（把勾选子 hunk 的 modText 按序合成一次 dispatch 替换 origRange）/ `整体接受` / `关闭`（回到普通编辑）。
- **编辑冻结**：会话激活期间，pending 区 doc 段被「只读变更拦截」（`changeFilter` 仅拦 pending origRange 内的用户输入；锚句区之外照常可编辑，编辑即自动退出会话并提示「改动已被手动修改，修改建议已清除」——简化的 offset 漂移防护，见 §6 风险 R6）。
- **工具栏浮条**（编辑器顶部或 CodeMirror 下方细条）：`n/m 处修改 · [全部接受] [全部拒绝] [完成]`——对齐 ThreeWayMerge 工具栏（:370-376）的既有 UX 语言。

接受后 diff 状态清理：接受/拒绝 → 该子 hunk 决策置位 + 装饰刷新 + 计数更新；全部决策完成 → 浮条提示「完成」（落库语义见 4.5）；会话被「关闭」且仍有 pending → 明确二次确认（挂起决策，revision 仍 pending，可在工具条「待合并修稿」重入）。

### 4.4 模块 ② 会话层与 undo 集成（裁决点 4 的落点）

**editor-store 扩展**（EditorTab 新字段 + actions）：

```ts
// editor-store.ts（新增，模型与既有 EditorTab 共存）
export interface InlineSessionMeta { sessionId: string; revisionId?: number; sourceKind: 'selection' | 'revision' }
// EditorTab 增：inlineSession?: InlineSessionMeta

// actions（均为纯状态操作，doc 文本不进 store 决策表）
beginInlineSession: (tabId: string, meta: InlineSessionMeta) => void
updateHunkDecision: (tabId: string, subHunkId: string, decision: 'accepted' | 'rejected') => void
endInlineSession: (tabId: string) => void        // 完成合并/关闭会话后清场
```

- hunk 决策表放 store（而非组件）：EditorArea 单实例挂载（`:604-610`）切 tab 卸载 CodeMirrorEditor 时，正文内容本就走 `tab.content` 持久，**hunk 决策同样不丢**（重挂载后经 `updateHunkDecision` 重建装饰）。
- **undo 语义（裁决：每子 hunk 一次独立可撤销事务）**：
  - 接受 = `view.dispatch({ changes: {from,to,insert}, annotations: [Transaction.time.of(now + i)] })`——**带递增显式 time**，规避 CM 500ms 事件合并（`CodeMirrorEditor.test.tsx:82-90` 实证），保证 Ctrl+Z **单步还原单句接受**、Ctrl+Y 恢复；
  - 拒绝 = 纯决策态变更（无 doc 变化 → 无 undo 事件）；误拒恢复 = 会话内「重置该 hunk 决策」动作（不依赖 CM 历史）；
  - 全部接受 = **逐个独立 dispatch（递增 time）**——多步 undo 可逐句撤销（确定性、单条代码路径）；备选「单事务批量（一步撤销全部）」见 §5 决策 4 备选 B；
  - 落库回写（finish → syncTabContent → content prop）自动走既有 `addToHistory:false` 外部同步（`:91-95`），**不新增可撤销事件**（回归测试 :147-163 覆盖）；
  - 接受后 `docChanged → onChange → updateTabContent` 链路现状不变（内容进 store、dirty 置位）；
  - **限制如实记录**：undo 栈生命周期 = CodeMirrorEditor 实例（切 tab/关会话即丢，与现状任何编辑一致）；不做跨会话 undo。

### 4.5 模块 ④ 数据流与落库（裁决点 5 的落点）

- **revision 语义不变**：AI 改稿经修稿工作流落 revision（整章，refine-draft.command.ts:94-100）或气泡接受落 revision（段级，CodeMirrorEditor.tsx:441-455 语义保留但补 pending 清理，见下）。**inline 会话不新建 revision**——会话是「接受形态」而非「版本形态」。
- **A 来源（气泡选区）v1 收尾**：会话完成（有接受子句）→ 若 filePath 是 vela://draft：先按 refine-draft 语义清理该 draft 的旧 pending refine revision（对齐 :89-92，修复现状气泡反复累积 pending 的缺陷），再 `revision-create`（content = 会话最终采纳文本的合成串、userPrompt 带动作标签）；随后 doc 已就地更新，由用户 Ctrl+S / 自动保存经 doSave 落 `db:draft-update-content`（现状 :113）。
- **B 来源（修稿 revision）v1.1 收尾**：会话「完成合并」→ 快照当前 doc → `draft-store.applyMergedRevision(chapterDir, chapterNumber, filePath, revPath, docText)`（现状 :156-216：draft-update-content → status 'revised' → revision-mark-merged → 编辑器 syncTabContent → 侧栏刷新）——**与三栏弹窗完成按钮同一函数，零新 DB 通道**。
- **store 状态机**：

```
idle ──beginInlineSession──▶ session（编辑器 doc 快照 + hunk 决策表）
session ──accept/reject(逐子hunk)──▶ session（决策累积；doc 随接受事务变化）
session ──finish（A: 合成采纳文本→revision-create；B: applyMergedRevision）──▶ saved ──endInlineSession──▶ idle
session ──discard/关闭──▶ idle（pending 决策丢弃；B 源 revision 保持 pending 可经工具条重入）
session ──会话中用户手动改 pending 区──▶ 自动退出（决策丢弃，提示）
```

- 中途 Ctrl+S（A/B 通用）：只写正文（doSave 现状语义），**不翻转 revision 状态**（pending 保留）——与「完成合并」是两件事，语义分离；§6 R8 记录叠加写同一草稿行的边界。

### 4.6 与现有 diff 标签页/三栏弹窗的关系（裁决点 6 的落点）

- **v1（A 入口先行）零冲突**：气泡 AI 改写的「整段替换」升级为「inline 会话」；修稿工作流产物（B 入口）在 v1 维持现状（diff tab + 三栏弹窗），作为对照基线。
- **v1.1（B 入口接入）渐进替代**：refine-draft/review-fix 完成后的 `openFile type:'diff'` 语义从「立即弹三栏」改为「打开/激活草稿 tab 并 `beginInlineSession`（diff tab 保留为会话数据锚，EditorArea 弹窗逻辑按 `inlineSession` 存在与否分流）；编辑器浮条提供「切换三栏模式」回退入口（同源同落库函数，共存而非双轨）。VersionHistory 生成的只读对比 diff（无 revisionPath，EditorArea :716 guard 已短路）**保持弹窗对比语义，不进 inline**。
- 孤儿组件 DiffViewer/MonacoDiffViewer 不参与 L1（无 hunk API），清理/归档另立任务。

### 4.7 范围边界（裁决点 7 的落点）

**v1（本设计交付，单段 inline 接受闭环）**：
1. diff-core 抽取 + offsets（前置，附回归锁）；
2. A 入口：气泡 AI 改写结果 → inline 会话（句级子 hunk）→ 接受/拒绝/undo → 落 revision + 保存链正确；
3. 会话决策态进 editor-store；i18n 三语；测试。

**v1.1（同内核延展，本设计不实现）**：B 入口整章 revision 多 hunk 会话（段+句两级）、EditorArea diff tab 分流、三栏切换、`applyMergedRevision` 完成合并。

**明确非目标（后续窗口）**：
- agent 在位编辑流：工具结果回写编辑器（现状 agent 写草稿无工具，open-editor 只读物理文件——`open-editor.tool.ts:59-72`；需新增写回工具 + 回写即 diff 化，属 L1 后续扩展）；
- 词级 diff；跨 revision/跨会话混合接受；DB revision 半合并快照（需新通道，见 §10）；只读态（finalized/archived/manuscript/物理文件 tab）inline；审稿报告 inline。

## 5. 裁决记录（逐项方案 + 理由 + 备选）

| # | 裁决点 | 方案（已选） | 理由 | 备选（未选） |
|---|---|---|---|---|
| 1 | 定位链路 | **抽取 ThreeWayMerge DP 为 `src/services/diff/` 纯函数模块并补 char offsets**；hunk = 原文区间 ↔ 改文区间；original 基准 = 会话开始时的编辑器 doc 快照（revision.originalContent 兜底）；选区（A）经整文快照对齐后只保留选区对应 hunk | 对齐算法现成（ThreeWayMerge.tsx:108-213）但不可复用、无 offsets——抽取是复用前提；doc 快照基准保证 hunk 定位与用户所见一致 | 渲染层直接调 ThreeWayMerge（函数未导出、行数组无 offsets → 需另写映射，重复实现）；diff-match-patch 整文（无中文依赖 + 需新依赖） |
| 2 | hunk 粒度 | **段骨架 + 句级子 hunk（锚句 LCS，无锚降级整段）**；词级不做 | 段 = 复用 DP 的天然单位；句 = 小说正文裁决面的真实粒度（LLM 润色常局部动句），锚句 LCS 纯函数可测、失败降级干净；中文词边界不可靠 | 纯段落（实现最简但整段接受覆盖未动句，痛点在）；词级（边界不稳、价值低） |
| 3 | inline 接受交互 | **原文保持为工作文本 + hunk 装饰标记 pending 区 + 复用气泡基建的「查看改动/接受选中/整体接受/拒绝」浮层 + 编辑器内进度浮条**；pending 区编辑冻结，改动即退出会话 | 装饰不推挤正文（prose 无 gutter）；气泡坐标/样式基建现成（CodeMirrorEditor :189-248/:536-668）；冻结规避 offset 漂移（v1 简单正确） | 侧栏 hunk 列表导航（信息密但遮正文、实现重，v1.1 可加）；内联改前/改后并排渲染（行级插件复杂度高、中文正文排版风险） |
| 4 | undo 集成 | **每子 hunk 一次带显式递增 `Transaction.time` 的 dispatch（单步 undo 每句）**；拒绝无历史事件；全部接受 = 逐个独立事务；落库回写沿用 C3 的 `addToHistory:false` 外部同步 | CM history 是唯一 undo 栈（CodeMirrorEditor.tsx:288）；C3 已保证外部回写不进栈（:91-95）；递增 time 规避 500ms 事件合并（测试 :82-90 实证）；单条代码路径、确定性 | 全部接受合并单事务（一步撤销整批——交互更简但 undo 粒度粗、与单句 undo 语义分叉）；store 级自建 history（与 CM 双轨、复杂度高） |
| 5 | 数据流 | **inline 会话不新建 revision；A 收尾 revision-create（补旧 pending 清理）+ 草稿保存走现状通道；B 收尾收敛到 `applyMergedRevision`（现状函数，零新 DB 通道）**；会话决策态在 editor-store | revision 语义（pending→merged/discarded 整条）不动则 DB 零改动、行为兼容；「接受形态 ≠ 版本形态」避免 revision 爆炸 | revision 每条子 hunk 落库（需新通道/表，DB revision 无内容更新通道——ipc-channels.ts:523-529 实证，deferred 见 §10） |
| 6 | 与现有 diff 标签页关系 | **v1 零冲突（A 先行）；v1.1 渐进替代（B 入口从「立即弹三栏」改为「草稿 tab inline 会话」，三栏保留为浮条可切换的对照视图，同一落库函数）**；孤儿 DiffViewer/MonacoDiffViewer 不参与 | 修稿产物链路（diff tab/applyMergedRevision）是现成且自洽的落库通道，inline 只是换了接受形态；三栏对整章通读仍有价值 | 全面替换并删除三栏（丢失对照视图）；两套接受并存各自为政（双轨心智） |
| 7 | 范围边界 | **v1 = 单段（选区）inline 接受闭环（模块①+③+会话层+落库链路）**；agent 在位编辑流与词级 diff 等列入非目标 | 计划 L1 的「AI 改稿接选区 inline 接受」最短闭环 = 选区→AI 输出→就地裁决；v1 可独立验收、不触碰工作流产物链路 | v1 直接覆盖整章 revision 多 hunk（改动面横跨 EditorArea/diff tab 语义，风险集中，放 v1.1） |

## 6. 影响面与风险表

| # | 项 | 风险/坑位 | 缓解 |
|---|---|---|---|
| R1 | 前置：对齐引擎抽取 | ThreeWayMerge 现为三栏弹窗唯一实现，抽取改动可能影响弹窗行为 | 抽取保持字节级等价（先抽再锁：computeSegments 输出对比测试）；弹窗继续用同一模块 |
| R2 | 前置缺口：DB revision 无内容更新通道 | 无法把「部分接受结果」写回 revision（ipc-channels.ts:523-529 / revision-repository.ts 无 update） | v1 不写回（B 收尾 = 现状 applyMergedRevision 全量语义）；半合并快照列 deferred（需新通道 + db-migration-standard 评审） |
| R3 | 前置依赖：decorations 为新增能力 | CodeMirrorEditor 现有 extensions（:286-335）无 decorations/StateField——需新增而**非换库** | `@codemirror/view ^6.41.0`/state 6.7.1 已具备（package.json 锚点）；StateEffect 动态刷新不触发全量 reconfigure |
| R4 | undo 500ms 事件合并 | 程序化连续接受会被 CM history 并入一个 undo 事件（CodeMirrorEditor.test.tsx:82-90 实证） | 每事务显式递增 `Transaction.time`；单测锁定「连点 3 句接受 → 3 步 undo」 |
| R5 | 会话生命周期 | EditorArea 单实例挂载（:604-610）切 tab 即卸载 CM——undo 栈丢（与现状一致），若 hunk 决策存组件内会连决策一起丢 | 决策表进 editor-store；关闭会话走 dirty/未决二次确认（复用 tryCloseTab :254-264 模式） |
| R6 | offset 漂移 | 会话中用户在 pending 区手改 → hunk 区间失效 | pending 区 changeFilter 冻结；改动触发自动退出并提示（v1 简单策略；CM changes 映射留 v1.1） |
| R7 | frontmatter/边界 | `stripFrontmatter` 会使 offsets 偏移（ThreeWayMerge.tsx:39-42）；修订前后段落数变化时 join/空行锚点（:253-256）易错 | v1 仅草稿纯正文（A/B 源均无 frontmatter）；段边界以 extractParagraphs 的空行语义为准并单测拆/并段偏移 |
| R8 | 双保存通道并存 | B 会话中途 Ctrl+S（写正文）与「完成合并」（写正文 + 翻 revision）写同一 drafts 行 | 语义分离：Ctrl+S 不翻转 revision（现状 doSave :102-145）；冲突边界 = 中途保存后 revision 仍 pending，可经工具条重入（降级路径不损坏数据） |
| R9 | 气泡 AI 现状缺陷带入 | 现状 handleAcceptAI revision 落库无 pending 清理（:441-455） | v1 A 收尾补清理（对齐 refine-draft :89-92），行为收敛到「同一草稿只留最新 pending refine revision」 |
| R10 | 孤儿组件 | DiffViewer/MonacoDiffViewer 无人调用（grep 实证），现状盘点易误导后续维护 | 文档标注孤儿；清理另立任务，不在 L1 |
| R11 | 质量门禁/i18n | 新增用户可见文本（会话浮条/按钮/提示）须三语 + 零 warning（AGENTS.md 约束） | 对照 i18n-standard 建 key（inlineAccept.*）；typecheck/lint/test 全绿为验收硬门槛 |
| R12 | jsdom 测试限制 | 装饰/气泡坐标依赖布局（测试已用 coordsAtPos 桩，CodeMirrorEditor.test.tsx:206-217） | 逻辑（对齐/句细分/决策表）纯函数单测；事务/undo 走 view.dispatch 断言（现测试模式 :98-164）；坐标桩模式复用 |
| R13 | agent 入口缺口 | agent 无 vela:// 草稿写回工具（open-editor 只读物理文件 :59-72、read-drafts 只读）——「agent 在位编辑流」零基础 | 明确非目标；本设计只做「AI 输出 → 编辑器 inline 接受」的接收侧，agent 侧（发送侧）后续扩展 |

## 7. 测试策略

| 层 | 用例（要点） |
|---|---|
| diff-core（纯函数，新） | extractParagraphsWithOffsets：空行切段、段内多行、首尾空行、CRLF；offsets 与原文 slice 回读一致；frontmatter 处理（R7） |
|  | computeParagraphHunks：等价于现 ThreeWayMerge 段 diff（抽取回归锁——同输入同 hunk 序列）；拆段 1:2/1:3、并段 2:1/3:1、纯增/删段的 origRange/modText 组装 |
|  | splitSentences/refineHunkWithSentences：中英混排句切分；锚句保留为 same；局部改动只产 1 子 hunk；整段重写降级整段；无锚句降级 |
| 会话层（editor-store） | begin/decision/end 状态机；决策表持久（模拟重挂载后重建装饰数据）；discard 语义（revision 仍 pending） |
| CM 事务（组件级，沿用 CodeMirrorEditor.test 模式） | 接受 = 单事务进 undo：连点 3 子 hunk → 3 次 Ctrl+Z 逐步还原（显式 time 防合并，R4）；拒绝无 undo 事件；落库回写不进栈（复用 :147-163 既有断言）；pending 区 changeFilter 拦截；会话外零装饰（默认关闭回归） |
| A 入口集成 | 选区→AI 输出→进入会话（doc 未变）→整体/部分接受→doc 更新 + dirty；vela://draft 收尾 revision-create 一条 + 旧 pending 清理（R9）；拒绝无 revision |
| 既有回归 | CodeMirrorEditor undo 三用例（:98-164）、editor-store openFile 去重、ThreeWayMerge 弹窗行为（抽取后）全绿 |
| 门禁 | typecheck / lint（--max-warnings 0）/ 全量 test |

## 8. 分期与验收标准

### Phase 1（v1，独立可交付）—— 单段 inline 接受闭环

范围：diff-core 抽取（§4.1）+ 会话层（§4.4）+ UI 层（§4.3）+ A 入口落库收尾（§4.5）→ CodeMirrorEditor 气泡 AI 改写结果以 inline 会话呈现与裁决。

验收标准：
1. 选段触发 AI 改写（五种动作任一）后，流式结果出现「应用为修改建议」而非直接替换；
2. 进入会话：原文不变、pending 区有装饰标记、浮条显示 n/m；
3. 逐句接受可 Ctrl+Z 单步撤销、Ctrl+Y 重做；拒绝/误拒恢复可用；全部接受后 doc 与「整体替换」一致；
4. vela://draft 收尾产生且仅产生一条 refine revision（旧 pending 被清理），Ctrl+S 落库正文；
5. 会话关闭（含切 tab 重进、有未决决策时二次确认）不丢已接受内容、不损坏 revision 状态；
6. 全部门禁 + §7 用例绿。

### Phase 2（v1.1，另行设计评审）—— 修稿 revision 多 hunk 会话

范围：B 入口接入同内核（整章段+句 hunk 会话）、EditorArea diff tab 分流、三栏切换、`applyMergedRevision` 完成合并。依赖 R2 的决策（是否引入 revision 半合并快照通道）。

### 非目标（后续窗口）

agent 在位编辑流（工具结果回写编辑器）、词级 diff、跨会话 undo、DB revision 半合并、只读态 inline、孤儿组件清理。

## 9. 参考锚点（供实施计划核对）

- 对齐引擎来源：`ThreeWayMerge.tsx:48-269`（抽取源，行号随实施微移）
- undo 机制：`CodeMirrorEditor.tsx:69-102`（C3 修复）+ `CodeMirrorEditor.test.tsx:1-27,98-164`（回归锁）+ 提交 `104c9d0`/`3c6295f`
- revision 落库链：`refine-draft.command.ts:86-113`、`refine-from-review.command.ts:50-78`、`revision-repository.ts:51-163`
- 合并落库：`draft-store.ts:156-216`（applyMergedRevision）
- diff tab 宿主：`EditorArea.tsx:678-745`、`editor-store.ts:63-98`
- 气泡基建：`CodeMirrorEditor.tsx:189-248,536-668`

## 10. 前置缺口与调研发现（如实记录）

1. **DB revision 无更新/半合并通道（阻塞 v1.1 的「部分合并落库」，不阻塞 v1）**：revisions 通道仅 7 个（ipc-channels.ts:523-529），repository 无 update 方法（revision-repository.ts:142-162 只有 merged/discarded 状态翻转）。v1 通过「会话收尾全量落库（applyMergedRevision）」绕开；若要 revision 记录「半采纳」需新通道 + 可能的表结构调整，须走 db-migration-standard。
2. **CodeMirror decorations 为新增能力但依赖齐备**：CodeMirrorEditor 现有 extensions 无装饰/StateField（:286-335），需新增而非引入外部库（`@codemirror/view ^6.41.0` 已含所需 API）。非阻塞。
3. **对齐引擎不可直接复用**：ThreeWayMerge 的纯函数非导出且输出无 char offsets（组件文件内实现，:48-269）——v1 第一前置任务 = 抽取 + 补 offsets + 等价回归锁。
4. **CM history 500ms 事件合并**（CodeMirrorEditor.test.tsx:82-90 实证）：程序化连续 hunk 接受需显式 `Transaction.time` 分隔，否则 undo 粒度不可控。
5. **切 tab 丢 CM undo 栈**（EditorArea.tsx:604-610 单实例挂载）：现状限制，L1 仅将 hunk 决策表移入 store 缓解，跨会话 undo 明确不做。
6. **agent 侧缺口**：`open_editor` 只读物理文件（open-editor.tool.ts:59-72）、无 vela:// 草稿写回工具——「agent 在位编辑流」的发送侧完全缺失，属 L1 后续扩展而非本设计范围。
7. **气泡 AI revision 落库缺陷**（CodeMirrorEditor.tsx:441-455 无 pending 清理）：v1 A 收尾顺手对齐 refine-draft 语义（:89-92），行为收敛。
