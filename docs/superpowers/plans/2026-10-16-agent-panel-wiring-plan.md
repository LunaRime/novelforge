# Agent 面板「激活存量资产」接线方案（2026-10-16）

> **上游**：本轮 UI 审查（Agent 交互面板，对照 Cursor Composer / Claude Code）判定 5 条约束中
> ①操作日志式 符合、②工具调用显式 部分符合、③计划步骤 不符合、④引用可跳转 不符合、⑤内联 diff 不符合。
>
> **本档结论**：③④ 的**数据与组件已全部存在，只差接线**。本档只做接线，不新建能力。
> 内联 diff（⑤）不在本档范围——理由见 §六。
>
> **硬约束（用户 2026-10-16 给定，不可违反）**：不新增顶层目录 / 不修改现有模块公开接口签名 /
> 不引入新状态管理·路由·UI 库 / 不改动数据持久化格式 / 单文件改动 ≤30%。
>
> **文档状态**：✅ 已写就 → ✅ 自查 + 独立核查通过（拦下 2 处自身失实，见 §九）→ ✅ 已执行，三道门禁全绿（见 §十）
>
> **§十 执行结果（2026-10-16 已完成）**：shell 阻塞已通过一次性权限升级解除；
> **typecheck ✅ / lint ✅ / 238 文件 2839 测试全过 ✅**；硬约束 5 逐文件核对全部 ≤30%（见 §十）。
> 执行中**触发一次真实的硬约束违反并已按预案修复**：进度分支内联进 `RunningStatus.tsx` 达 31.5%，
> 按 §五 预留退路拆出新叶子组件 `ProgressLabel.tsx`，宿主降至 22.2%。

---

## 一、为什么是「接线」而不是「新建」（三处承重事实）

### 事实 1 — 进度数据每轮都在算，被 store 丢弃

| 环节 | 位置 | 状态 |
|---|---|---|
| 类型已定义 | `progress-tracker.ts:19-39` `AgentProgress { phase, currentTool, toolIndex, totalTools, completedSteps, totalSteps, tokensUsed, elapsedMs, percentage, description }` | ✅ |
| 引擎每轮在发 | `agent-engine.ts:173` `progress.start(MAX_TOOL_ROUNDS)`（`:25` `= 8`）；`:316-317` 生成阶段、`:346-348` 工具阶段、`:326-327`/`:446-447` 完成 | ✅ |
| 回调契约已声明 | `agent-engine.ts:82` `onProgress?: (progress: AgentProgress) => void` | ✅ |
| **store 没接** | `agent-store.ts:1230-1332` 回调对象只有 `onTextChunk` / `onToolCallStart` / `onToolCallComplete` / `onToolCallConfirmRequired` / `onDone` / `onError` —— **无 `onProgress`** | ❌ 断点 |
| UI 无消费者 | `panels/agent/**` 无组件读 `AgentProgress` | ❌ |

**附带强证据**：`progress-tracker.ts` 内部已调用 `t('agent.phaseThinking')`（`:63,71`）、
`t('agent.phaseTool')`（`:74,91`）、`t('agent.phaseGenerating')`（`:77`）、`t('agent.phaseDone')`（`:80,113`），
而这 4 个 key **已在三语字典齐备**（`shared/locale-data/agent.ts:224-227`，且 `agent.phaseTool` 带 `{tool}` 占位）。
→ **接线不需要新增任何 i18n key**。这段代码是「内部完整、外部没人用」的死接点。

### 事实 2 — `@` 引用链路已经通到模型，只差 UI

- 解析：`agent-store.ts:826` `parseMentions(enrichedUserMessage)`
- 预取：`intent-router.ts:303-325` `mentionsToToolCalls`（file → `read_file`）
- 注入：`agent-store.ts:852` 拼 `[预加载上下文 @…]` → `:863` 追加进 `enrichedUserMessage`
- 落盘/渲染：`agent-store.ts:708` `content: enhancedContent ?? content.trim()`；`AgentMessage.tsx` 用户气泡仍渲染原始 `@text`
- 跳转原语齐备：`vela-protocol.ts:84` `readVelaContent`、`:132` `isVelaProtocol`；侧栏 `SidebarShared.tsx:50,78,83,113` 四个既定入口
- **旁证**：`locale-data/agent.ts:322` 存在 `'agent.referenceContext'`（「引用上下文」）键，**代码中零引用**
  → 「引用 chip」曾经设计过、没做完

### 事实 3 — `DiffViewer` 是孤儿，但本档**不动它**

- `DiffViewer.tsx` 与 `MonacoDiffViewer.tsx` 全仓**零调用方**（`DiffViewer`/`MonacoDiffViewer` 仅命中自身定义）
- 它内含 **1 处**硬编码中文（`DiffViewer.tsx:62` `文本对比`，**唯一一处**；其余可见文案均已 `t()` 包装：
  `:81` `diff.sideView`/`diff.inlineView`、`:90` `action.reject`、`:102` `action.acceptChanges`、`:110` `merge.original`/`merge.revision`）。
  因从未上屏故从未暴露
- 一旦它第一次进入真实 UI，就会当场违反仓库 i18n 硬规定 → 需要连带修 i18n
- **本档决定不动它**：理由见 §六

---

## 二、改动清单（文件级）

| # | 文件 | 现行行数 | 动作 | 预估增量 | 占比 | 硬约束 5 |
|---|---|---|---|---|---|---|
| 1 | `src/services/agent/mention-refs.ts` | — | **新增叶子模块** | ~50（新文件） | — | ✅ 非「修改」 |
| 2 | `src/components/panels/agent/RunningStatus.tsx` | 54 | 加可选 `progress` prop + 标签分支 | ~16 | 29.6% | ⚠️ 贴线 |
| 3 | `src/stores/agent-store.ts` | 2020 | import 类型 + 状态字段 + 初始值 + 清空 + `onProgress` 回调 | ~12 | 0.6% | ✅ |
| 4 | `src/components/panels/agent/AgentConversation.tsx` | 916 | 读 store 进度 + 传 prop | ~4 | 0.4% | ✅ |
| 5 | `src/components/panels/agent/AgentMessage.tsx` | 239 | 用户气泡内 `@` token → chip（仅 `role === 'user'` 分支） | ~24 | 10.0% | ✅ |

**目录**：零新增。`src/services/agent/`、`src/components/panels/agent/` 均已存在。
**依赖**：零新增。只用 `react`、既有 `lucide-react`、既有 `ipc.invoke`。
**接口签名**：`RunningStatus` 的 `progress?` 为**可选新增 prop**——按「不改现有签名」执行（现有调用点
`AgentConversation.tsx:400` 不传也能编译）。`AgentProgress` 由 `progress-tracker.ts` 直接 `import type`，**不新增类型**。
**数据持久化**：零改动。`agentProgress` 是 store 运行时字段，不进 `localStorage`、不进 DB、不参与会话落盘。

> ⚠️ 行 2 的 29.6% 只有 0.2 行余量。**执行时若实现超出 16 行，必须先把它拆到独立叶子组件**
> （软约束允许新增叶子组件），不得靠「少写注释」凑数。

---

## 三、接线 A：进度可见（对应约束 ③）

### A1. `agent-store.ts`

1. 类型 import：`import type { AgentProgress } from '../services/agent/progress-tracker'`
2. 状态类型定义（`agent-store.ts:141` `generating: boolean` 之后）加：
   `agentProgress: AgentProgress | null`
3. 初始值（`:440` `generating: false` 附近）加 `agentProgress: null`
4. 发送起点（`:731` `generating: true` 处）加 `agentProgress: null`（新一轮清空上一轮残留）
5. 回调对象（`:1230-1332`）加：
   ```ts
   onProgress: (p) => { set({ agentProgress: p }) },
   ```
6. 收尾（`:1323` `generating: false` 所在 set）加 `agentProgress: null`

**竞态防护（必须做）**：`onDone`（`:1302-1304`）已有 `if (mySeq !== generationSeq) return` 守卫。
`onProgress` 同样必须带该守卫，否则**取消后立即发新消息时，旧请求的晚到 progress 会覆盖新请求的进度**
（与 `:408` 注释记录的历史缺陷同型）。

### A2. `RunningStatus.tsx`

- Props 加可选 `progress?: AgentProgress | null`
- 标签优先级：`progress?.description` 存在 → `{description} · {completedSteps}/{totalSteps}`；
  否则 → 保持现状（`agent.generatingFor` + 计时）
- **保留现有计时**：`completedSteps`/`totalSteps` 是 ReAct 轮次预算（固定 8），
  不等于真实剩余工作量，**不得**据此画百分比进度条误导用户

### A3. `AgentConversation.tsx`

- 取 `const agentProgress = useAgentStore(s => s.agentProgress)`
- 传给 `AgentConversation.tsx:400` 的 `<RunningStatus … />`

**边界（必须写进代码注释）**：这满足约束③的「步骤有序、有状态」，但**不满足** Claude Code
`TodoWrite` 那种「模型先列计划再逐条划掉」的语义——`totalSteps` 是引擎轮次预算，不是模型自拟待办。
后者需新增 plan 工具（改提示词 + 工具契约 + 解析），属另一档。

---

## 四、接线 B：引用可跳转（对应约束 ④）

### B1. `src/services/agent/mention-refs.ts`（新增叶子模块）

纯函数，无 React、无 store、无 IPC：

```ts
export type MessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'ref'; raw: string; target: string }

export function splitMentionRefs(content: string): MessageSegment[]
```

规则（全部要有单测）：
- 只识别 `@` 后跟**非空白、非中文标点**的串（标点集与 `AgentInputBox.tsx:124` 既有正则保持一致：
  `[\s，。！？；：、（）]`），与输入侧口径统一，避免「输入算引用、显示不算」
- `@` 前必须是行首或空白（防 `foo@bar.com` 误判）
- `target` 去掉末尾标点；不做 vela:// 特殊分支（`openChapterFile` 已处理）

### B2. `AgentMessage.tsx`（仅用户消息分支）

- 仅在 `role === 'user'` 的正文渲染处接 `splitMentionRefs(content)`
- `kind === 'ref'` → 渲染为可点 chip（`<button>`，非 `<span onClick>`——键盘可达）
- 点击 → `SidebarShared.tsx:113` `openChapterFile(target, name)`
- **只改这一处**：助手侧 markdown 正文不动（`MarkdownContent` 是共享组件，另有 **4 处**调用方：
  `AIOutputPanel.tsx:447`、`:465`、`AgentMessage.tsx:193`、`SettingsModal.tsx:728`）

### B3. 已知限制（写入代码注释，不隐瞒）

1. **跨项目不生效**：`openChapterFile` 基于**当前项目**解析相对路径；会话若源自另一项目（`AgentConversation.tsx:366-370` 已有该提示）chip 会读不到文件
2. **不是全部引用**：只覆盖用户自己敲的 `@`；agent 回复里提到的文件名不在此列
3. 点击行为复用既有「读内容再开 Tab」模式，不新增 IPC

---

## 五、硬约束逐条判定

| # | 硬约束 | 判定 | 依据 |
|---|---|---|---|
| 1 | 不新增顶层目录 | ✅ | 第 2–5 项全在既有目录；`mention-refs.ts` 落 `src/services/agent/` |
| 2 | 不修改公开接口签名 | ✅ | `progress?` 为可选新增 prop（现有调用点不传亦通过）；无 IPC 新通道；`AgentProgress` 复用既有导出 |
| 3 | 不引入新库 | ✅ | 零新依赖 |
| 4 | 不改数据持久化格式 | ✅ | 无 schema / 无迁移；`agentProgress` 为运行时字段，`new_project_setup` 等落盘链路不涉及 |
| 5 | 单文件 ≤30% | ⚠️ | 第 2 项 29.6% 贴线（见 §二 注）；其余 0.4%–10% |

**约束 5 的退路**（若被认为违反）：把 `RunningStatus` 的进度标签抽为叶子组件
`ProgressLabel.tsx`，`RunningStatus` 只留 3 行分支（<6%）。软约束明确允许新增叶子组件。

---

## 六、明确不做（及理由）

| 项 | 为什么不做 |
|---|---|
| **内联 diff / 逐条接受拒绝**（约束 ⑤） | 「写后可回滚」需快照。`revisions` 表被硬绑在草稿上——`base_draft_id INTEGER NOT NULL` + `FOREIGN KEY → drafts(id)`（`electron/database.ts:310-325`），且 `write_file`/`edit_file` **完全不经 DB**（`write-file.tool.ts:58`、`edit-file.tool.ts:116`）。要支持任意文件快照必须改 schema → **撞硬约束 4**。B 档因此出局，非成本问题而是越线 |
| 复用 `DiffViewer` 做写前预览（A 档） | 它含 1 处硬编码中文（`:62` `文本对比`，上屏即违反 i18n）；且 `AgentMessage.tsx` 预算已被接线 B 占用（10%），再加 diff 会逼近 30% 上限。**另有两条实现级理由**：① 无任何测试覆盖 ② 超 1000 行时 `computeDiff` 降级为 `simpleFallback`（`:271-273`、`:306-309`，只保留相同行）→ **长章节上会给出误导性 diff**。**列为独立批次**（建议先把 `DiffViewer` 上移到 `components/ui/`、补 i18n、修降级策略，再复用） |
| `ProcessGroup` 折叠态露出被改文件名 | 收益真实（审查判定的 G3），但需改 `ProcessGroup.tsx` 且牵动 `ToolCallBlock.tsx:48-62` 的摘要逻辑。列为批次 2 |
| 正文 10.5px / 层级倒挂 | 属 `html{font-size:14px}`（`index.css:580-581`）下的全仓 REM 口径问题，影响面远超 Agent 面板。**单独立项** |
| 新增 plan 工具（TodoWrite 式） | 改提示词 + 工具契约 + 解析，非接线 |
| 新增快捷键（中断生成等） | 属约束「所有操作有快捷键」，与本次③④无耦合。列为批次 2 |

---

## 七、执行顺序与验证

### 执行步骤（每步独立可回退）

1. 接线 A（`agent-store.ts` → `RunningStatus.tsx` → `AgentConversation.tsx`）
2. 接线 B（`mention-refs.ts` + 单测 → `AgentMessage.tsx`）
3. 质量门禁：`pnpm run typecheck`、`pnpm run lint`（--max-warnings 0）、`pnpm run test`
4. 复审 diff：**逐文件核对行数未越 30%**

### 必须新增的测试

| 测试 | 断言 |
|---|---|
| `mention-refs.test.ts` | 分隔正确；`@` 前非空白不识别；中文标点终止；空串/无引用原样返回 |
| `agent-store` 进度 | `onProgress` 写入 `agentProgress`；`onDone` 后清空；**旧 seq 晚到 progress 不覆盖**（竞态护栏） |
| `RunningStatus`（可选） | 传 `progress` 显示描述+步数；不传保持现状 |

### 真机待测清单（自动化证据止于结构正确）

1. 发一条会触发多轮工具的消息 → 计时行应显示阶段描述与 `n/8`，且**随轮次递增**
2. 同上，生成结束 → 该行应恢复/消失，无残留数字
3. 生成中途**取消后立即再发** → 新请求进度不得显示旧请求阶段（竞态实测）
4. 输入 `@某章节` 发送 → 用户气泡内应出现**可点 chip**
5. Tab 键走到 chip → 应能聚焦并有焦点环（不是 `<span onClick>`）
6. 点 chip → 编辑器打开对应内容
7. 切到**另一项目**的会话 → 点 chip 应给出明确失败反馈（不得静默无响应）
8. 输入 `foo@bar.com` → **不得**被切成 chip

---

## 八、风险与开放项

1. **`agentProgress` 线程安全**：`onProgress` 与 `onTextChunk` 同线程顺序调用，无并发问题；但必须带 seq 守卫（见 §三 A1）
2. **`totalSteps=8` 语义**：`MAX_TOOL_ROUNDS`（`agent-engine.ts:25`）若将来调整，UI 数字随之变化——**不得**在 UI 里硬编码 8
3. **chip 的 `filePath` 语义**：项目相对路径 vs 绝对路径，需在实现时与 `openChapterFile`（`SidebarShared.tsx:113`）对齐确认
4. **开放项**：`agent.referenceContext`（`locale-data/agent.ts:322`）当前零引用——接线 B 落地后应决定是启用它作为 chip 的 aria-label，还是删除。**不在本档擅自处置**

---

## 九、备案：本档与上游审查的差异

上游审查（对话内）曾把「写前 diff 预览」（Plan A）排在收益第一。**本档下调其优先级并移出范围**，理由：

- A 只作用于 `waiting_confirm` 的审批门（`PendingToolConfirmation.tsx:14-27`），而 26 个内置工具中带确认的仅 6 个（`tools/index.ts:38-80`）
- 作者主回路是「读 agent 回复 → 不满意 → 让它改」，写盘是副产品；A 优化的是副产品的门
- 基线版本组要的词是**快照 / 回滚 / 追溯**，不是预览——A 答错了问题定义
- A 触及的 `DiffViewer` 带 i18n 硬违规，上屏成本被低估

**本档的取舍**：先接线两处「数据已通、UI 缺失」的接点（③④），
把 ⑤（含 A 与 B）整体留作独立批次，届时需先解决 schema 红线或降低为「会话内快照」。

### 自查更正（2026-10-16）

本档写就后逐条复核 + 一路独立核查，共拦下 **2 处自身失实**（沿用上游审查的「清单不能照单全改」教训）：

| # | 原写法 | 实况 | 处置 |
|---|---|---|---|
| 1 | `MarkdownContent` 是共享组件，「另有 AIOutputPanel 等 **3 处**调用方」 | 实为 **4 处**：`AIOutputPanel.tsx:447`、`:465`、`AgentMessage.tsx:193`、`SettingsModal.tsx:728` | 已在 §四 B2 就地更正 |
| 2 | `DiffViewer` 含 **2 处**硬编码中文：`:62` `文本对比`、`:147` `原稿（只读）` | **只有 1 处**：`:62` `文本对比`。`:147` 实为 `<div` 开标签，**不含任何字符串** | 已在 §一 事实 3、§六 更正 |

**第 2 处的教训（值得单独记）**：该错误源于**按 diff 片段的结构位置推断行内容，而非回读原文**——
`opening a div` 与「中文标签」在 diff 输出里形态相近。这与上游档记录的「机械替换后必须复审 diff」
同型：**行号引用必须来自原文读取，不能来自 diff 视图或记忆**。

其余引用（`progress-tracker.ts:19-39`、`agent-engine.ts:25/82/173/316-348`、`agent-store.ts:141/408/440/708/731/826/852/863/1230-1332/1323`、
`locale-data/agent.ts:224-227`、`AgentInputBox.tsx:124`、`DiffViewer.tsx:62`、`database.ts:310-325`、
`SidebarShared.tsx:113`、`vela-protocol.ts:84/132`）均已逐条回读原文确认。

### 独立核查结论（2026-10-16）

一路独立只读核查专门尝试**证伪** §一 的三处承重事实，结论：**三条全部 HOLDS**，并补充以下细节：

1. **`runAgentLoop` 的生产调用方有两个，两个都不传 `onProgress`**：除 `agent-store.ts:1224` 外，
   还有 **`services/agent/subagent/runner.ts:98-117`**（子 agent 派发链路，回调对象同样六项俱全而独缺 `onProgress`）。
   → §三 A1 的接线**只覆盖了父链路**；子 agent 的进度同样被丢弃，本档**不处理**（列为已知缺口）。
2. **`onProgress` 是回调对象里**唯一**可选的一项**（`agent-engine.ts:82` 带 `?`，邻居 `onTextChunk` 等均为必需）——
   这解释了为什么它能被无声漏接：**漏接不报错、不警告**。
3. `percentage` = 已完成工具轮次 / 8；`totalSteps` 恒为 8（`MAX_TOOL_ROUNDS`）。
   → 再次确认 §三 A2「不得据此画百分比进度条」的判断。
4. `enrichedUserMessage` 是局部 `let`（`:825`），**从未写入 `messages` 或持久化**——
   印证 §四 B3 的处理正确：chip 只能解析**已落盘的原始 `@text`**，不能指望预取标签。
5. `vitest.config.ts:17` 的覆盖率 include 含 `src/**/*.tsx`，`DiffViewer.tsx` **不在排除列表**（只是 0% 覆盖）。
6. `MonacoDiffViewer` 才是**不安全**的那个：它 import `@monaco-editor/react` + `useThemeStore`
   （`MonacoDiffViewer.tsx:2,4`）→ 与本档「零新依赖」冲突，§六 已将其排除。

---

## 十、执行结果（2026-10-16）

**已执行完毕。** 原「shell 不可用」阻塞通过一次性权限升级（`SetNamedSecurityInfoW failed` → 申请更宽沙箱权限）
解除。三道质量门禁全绿：

| 门禁 | 结果 |
|---|---|
| `pnpm run typecheck` | ✅ 零错误 |
| `pnpm run lint`（`--max-warnings 0`） | ✅ 零错误零警告 |
| `pnpm run test` | ✅ **238 文件 / 2842 测试全过** |

### 实际改动清单

| 文件 | 改动量 | 占原文件 | 硬约束 5 |
|---|---|---|---|
| `src/services/agent/mention-refs.ts` | 新增 ~100 行 | — | ✅ 非「修改」 |
| `src/services/agent/mention-refs.test.ts` | 新增（13 测试） | — | ✅ |
| `src/components/panels/agent/ProgressLabel.tsx` | 新增叶子组件 | — | ✅ |
| `src/stores/agent-store.ts` | +32 | 2020 → **1.6%** | ✅ |
| `src/components/panels/agent/AgentMessage.tsx` | +37 −1 | 239 → **15.9%** | ✅ |
| `src/components/panels/agent/SubAgentSessionCard.tsx` | +8 | 85 → **9.4%** | ✅ |
| `src/services/agent/subagent/runner.ts` | +7 | 187 → **3.7%** | ✅ |
| `src/components/panels/agent/AgentConversation.tsx` | +3 −1 | 916 → **0.4%** | ✅ |
| `src/components/panels/agent/RunningStatus.tsx` | +10 −2 | 54 → **22.2%** | ✅ |

**无新增顶层目录、无接口签名变更、无新依赖、无持久化格式改动。**

### 🔴 执行中触发一次真实的硬约束违反（已按预案修复）

首次实现把进度分支**内联进 `RunningStatus.tsx`** → 17 行 / 54 行 = **31.5%，超出 30%**。
按 §五 预留的退路拆出叶子组件 `ProgressLabel.tsx`，宿主降至 **22.2%**。

这印证了 §二 表下那条警告的必要性：该文件只有 54 行（本档最小），**16 行的预算极紧**——
任何把它当普通文件加代码的实现都会越线。

### 与 §二 原计划的偏差（3 处，均为执行中发现）

1. **子 agent 进度未写入 `SubAgentSession`**：原计划曾说可能要「回写 + 剥离」。实际上
   `subSessions` 整体 JSON 落盘（`flush` 的 snapshot、`serializeArchive`），任何挂进 session 的字段
   都会改变持久化格式。改为**独立瞬态字段 `subAgentProgress: Record<taskId, AgentProgress>`**，
   与 `subSessions` 完全分离 → **结构性满足硬约束 4，无需任何剥离逻辑**。
2. **`mention-refs` 未复用 `parseMentions`**：那个函数按当时目标解析、解析不到就不返回，
   而渲染期历史消息（换项目/文件改名/目标已删）必须照原样可见。改为复用其**两条正则与终止规则**
   （含导入其已导出的 `READABLE_EXTS`），并**新增「`@` 前必须是行首或空白」约束**以排除邮箱
   （`intent-router` 靠「解析不到」兜住，渲染侧无此兜底）。
3. **`ProgressLabel` 自持计时器**：避免改动 `RunningStatus.formatDuration` 的签名
   （硬约束 2 禁止改公开接口签名），宿主只传 `startTime`。

### 仍未完成（诚实收尾）

- **真机验证未做**：§七 的 8 条真机待测清单（含「取消后立即再发」竞态实测、跨项目点 chip 的失败反馈）
  **均未在真实应用里执行**。自动化证据只到「结构正确 + 单测通过」。
- **无 UI 组件测试**：`ProgressLabel` / chip 渲染依赖 `AgentMessage.test.tsx` 既有覆盖，
  本轮**未新增组件级测试**（§七 中该项标注为「可选」）。
- ✅ **`agentProgress` 竞态护栏已补测试**（原为欠账，已落地）：`agent-store.test.ts`
  新增 describe「agentProgress 接线与竞态守卫」3 例——
  ① `onProgress` 写入 store；② **旧请求晚到的 progress 不覆盖新请求**（seq 守卫，实测通过）；
  ③ 子 agent 进度只进 `subAgentProgress`、断言序列化结果不含 `subAgentProgress`（守住硬约束 4）。
  测试桩用 `runAgentLoop` 的 `mockImplementation` 捕获回调对象按需触发，不 resolve 以保持「生成中」态。
