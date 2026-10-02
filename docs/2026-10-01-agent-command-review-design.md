# 对话命令审查与输出格式设计（向 CC / dsh 学习）

**日期**：2026-10-01
**状态**：设计方向文档——**未开始实施；2026-10-02 已自审并拆分为三份实施 spec**（见下指引）。
**已拍板（2026-10-01）**：① 直出处置 = 方案 B（线①）；② 澄清 / 增强分支保留；③ 输出格式**连视觉一并照搬** dsh（线②）。
**指定约束**（用户）：

1. 命令审查机制（判据 / 审查）学习 Claude Code 与 dsh；
2. **AGENT 窗口输出格式采取 dsh**；
3. **工作流输出格式采取 dsh**。

> **2026-10-02：已自审并拆分**（实施主体）——
> ① 命令审查：`docs/superpowers/specs/2026-10-02-command-review-design.md`
> ② 输出格式：`docs/superpowers/specs/2026-10-02-agent-output-format-design.md`
> ③ 手动 AI 产出审查（已纳入）：`docs/superpowers/specs/2026-10-02-manual-ai-output-review-design.md`
> 原 §3 设计内容已迁入三份 spec；§4 更新为拆分指引；本文保留共享背景（§1/§2）、证据索引（§5）与自审记录（§6）。

本文的出发点是一条既有结论：

> 它们是同一病灶的上下两层——上层是「用正则猜命令」（判据不可靠），下层是「猜完直接执行、不设审查」（信任放错位置）。CC/dsh 的对策恰好是两条对称的：判据显式化、执行前必审查。

---

## 1. 现状：同一病灶的上下两层

### 1.1 上层——用正则猜命令

`sendMessage`（`src/stores/agent-store.ts:507`）把输入分成两条路：

- **`/` 开头**：`parseSlashCommand` 精确分派（`agent-store.ts:515-578`）——内置 4 条（`clear` / `new` / `help` / `status`）+ 全部 skill 注册为命令（`src/services/agent/intent-router.ts:55-104`）。这是「判据显式」的做法，与 CC/dsh 同形。
- **其余全部输入**：`detectWritingIntent(trimmedContent)` 本地正则预路由（`agent-store.ts:590`）。文件头自述：「意图预路由（阶段 A）——本地零 LLM 成本的自然语言意图识别」（`src/services/agent/writing-intent.ts:1-5`）。

正则模式库（`writing-intent.ts:40-125`）覆盖写稿 / 修稿 / 角色 / 大纲，历次加固包括中文章号解析、助词回溯孔、查询动词护栏（`QUERY_VERB`）、负向白名单、配置兜底等。**加固史本身就是判据不可靠的证据**：五次修复提交（见 1.3）全部在打磨正则。

### 1.2 下层——猜完直接执行、不设审查

强命中 → `handleWritingIntent` 返回 `status: 'handled'` → `sendMessage` 直接 `return`（`agent-store.ts:594-595`）。**不进 ReAct、不过模型。**

`handleWritingIntent`（`agent-store.ts:1166-1254`）的强命中分支全部是**直接启动工作流**：

- `chapter_creation` → `startChapterWorkflow('generate_draft', n)`（`:1229`）；章号区间（「写五到八章」= 连发 4 个工作流）→ 串行直接启动（`:1224-1227`）；
- `refine` → `startChapterWorkflow('refine', chap)`（`:1240`）；
- `architecture` → `startBlueprintWorkflow()` / `startArchitectureWorkflow()`（`:1245-1247`）。

随后只 append 一条「已开始{name}{chapter}」（`makeStartedMsg`，`:1207-1212`）。全链唯一的「审查」就是正则本身——无确认、无审批、无模型复核。

**刺眼对照**：同一个动作，两条路径，审查不对称——

- 工具路径（模型判断后触发）：`start_workflow` 工具 `requiresConfirmation: true`（`src/services/agent/tools/start-workflow.tool.ts:40`）→ 引擎确认流程（`agent-engine.ts:488`）→ A 档审批决策（`src/services/agent/approval/policy.ts:17-59`：critical 硬拒绝 / 只读直放 / 规则命中 / 兜底 prompt）→ `ConfirmCard`；
- 正则路径（本地正则命中后触发）：以上全无。

即：**经过模型的路径有审查，绕过模型的路径没有审查**——而正则恰是判得最不准的判据。

真机症状（提交自述，`f6f9240`）：用户说「列出小说大纲」，正则把「大纲」当「生成大纲」，直接启动架构工作流 → 前置条件不满足报错（`writing-intent.ts:60-63` 注释原文）。

### 1.3 时间线：审查设施落地时，直出路径没接上

| 日期 | 提交 | 内容 |
|---|---|---|
| 2026-04-21 | `4c88178` | 开源首版：`requiresConfirmation` 已在工具路径上 |
| 2026-08-27 | `9ddcb3c` | 意图预路由模式库落地（「零 LLM 成本」的即时性取舍，直出无审查） |
| 08-27 → 09-13 | `8cc4634` `0a7011e` `974cc44` `04d2718` `f6f9240` | 五次修复**全部在打磨正则**，无一给直出加门 |
| 2026-09-26 | `a986a51` | A 档：审批决策类型 + 危险操作硬拒绝规则（接在**工具路径**；直出路径至今未接） |

### 1.4 设计时要区分保留的部分

预路由有三种产出，只有第一种违反不变量：

1. **直接执行**（chapter / refine / architecture 强命中）——**违反**「一句话不得绕过审查变成动作」；
2. **澄清消息**（ambiguous：「你想写第几章？请指定章节号」，`agent-store.ts:1262-1274`）——不产生动作；
3. **内容增强**（character：改写用户消息为「创建角色：X\n\n原文」交主流程走模型，`:1256-1260`）——不产生动作。

另有两个可直接复用的既有资产：

- 「交给模型」先例：`/status` **故意不拦截**——「不拦截，作为普通消息让 Agent 处理（它会调用 read_project_state）」（`agent-store.ts:554-557`）；
- 「执行前确认」词汇：A 档同步确认（`ConfirmCard` + `approval/policy.ts`）与 D 档自动化策略（`ActionPolicy = 'auto_run' | 'confirm' | 'notify_only'`，`src/services/automation/types.ts:18`；confirm / notify_only 入收件箱等确认，`scheduler.ts:148-167`）。

---

## 2. 参照系：CC 与 dsh 的做法

### 2.1 Claude Code（`D:\Code\Claude-code-2.1.188-源码学习\Claude-Code-main\src`）

- **斜杠命令 = 客户端确定性精确分派**：静态注册表（`commands.ts:258`）+ 运行时聚合 skills / plugins / MCP；分派是「纯语法前缀 + 精确名匹配，无模型参与」（`utils/handlePromptSubmit.ts:229`；`findCommand` 全等比较，`commands.ts:688-698`）；未命中 → `Unknown skill` 且 `shouldQuery: false`（`utils/processUserInput/processSlashCommand.tsx:347`）——**不静默降级为普通提示**。
- **自然语言无客户端意图分类**：路由判据只有语法信号（`!` bash / `/` 命令 / `@agent-` 附件 / 字面关键词），其余原样包成 `UserMessage` 进模型（`utils/processUserInput/processTextPrompt.ts:19-31, 96-99`）；全仓无用户输入意图分类器（仅有的关键词检测用于埋点）。
- **执行前必审查**：模型输出永不直接执行工具；统一落点 `canUseTool`（`services/tools/toolExecution.ts:921` → `hasPermissionsToUseTool`，`utils/permissions/permissions.ts:473`）。校验顺序：工具级 deny 规则（最高）→ ask 规则 → 工具自检 → 内容级规则 → bypass → allow 规则 → 兜底转 ask（`permissions.ts:1158-1319`）。危险操作默认降级为**带多选项的人工确认**（默认 `"Do you want to proceed?"`；选项含 `Yes` / `Yes, and don't ask again…` / `No`，`components/permissions/FallbackPermissionRequest.tsx:160-198`）；硬拒绝只来自显式策略（deny 规则 / bypass 免疫的 safetyCheck / hook deny）。
- 加持：UserPromptSubmit hook 可在**输入送模型前**阻断或改写（`utils/processUserInput/processUserInput.ts:182-224`）。

### 2.2 dsh（`D:\Code\deepseek-harness`，Web / Electron；React + cordis）

**命令 = 本地精确分派，绝不交给模型猜**：

- 菜单 / 空格 / 回车三条判定全部基于会话目录精确匹配（`packages/client/ui-commands/src/client/service.ts:252-349`）；解析先按 `descriptor.name` 精确匹配、再按本地化别名表回落（`resolution.ts:44-59`）；README 原文：「a command line is never silently downgraded to a plain prompt」（`ui-commands/README.md:12`）。命令本身不进会话日志（宿主写审计事件），结果以单行命令卡呈现（`GenericCommandCard.tsx`：命令名 + 结果摘要 + 展开 `<pre>`）。
- 校验失败可见且不丢输入：未知 / 畸形命令 → 错误卡（`service.ts:406-409`）；不接受附件的命令 → 输入条 Toast「请先移除附件」，草稿与附件原位保留（`input/facade.ts:333-337`）。
- 输入 `/` 弹 combobox 菜单（`ui-input-trigger/.../MenuView.tsx:94-220`：Add 区 + Commands 区、本地过滤、面包屑下钻、textarea 不失焦）。

**自然语言无本地分类**：唯一本地判定是「行首 `/`」（`service.ts:279`、`ui-conversation/.../InputBar.tsx:308`）；其余一切输入作为普通 user message 提交。

**审批（执行前必审查，fail-closed）**——判定链路四阶段（`packages/core/tools/src/index.ts`）：

1. `tools/pre-execute` 瀑布（`:1505-1511`）：词表 `allow | deny | cancel | ask`（`:598-611`）；auto-review 以 `prepend` 排最前（`experimental/auto-review/src/index.ts:686-726`）；
2. `ask` → 审批服务（`:1709-1768`）：无审批服务 / 无 agent 可路由 / `unavailable` 一律 **deny**——注释原文「missing approval support turns ask into denial」；
3. 会话策略先于一切应答者（`interaction/user-approval/src/index.ts:243-306`）：`never` 就地拒绝；无终端应答者 → `unavailable`；与 abort 竞速，先到者胜；
4. 单调 guard（`:724-730`）：只能拒绝、不能翻案——「listener ordering cannot turn a denial back into permission」。

**授权语义**：`allowed-once | rejected | cancelled | unavailable`（`user-approval/src/types.ts:32`）——授权仅对请求的那一次动作生效。沙箱三档（read-only / workspace-write / danger-full-access）只允许**严格更宽**的一次性升级，且 `sandbox_permissions` + `justification` 必须成对（`packages/sandbox/sandbox/src/escalation.ts:28-61, 171-208`）。auto-review 判 deny：策略 `never` → 直接拒绝（结构化 `AUTO_REVIEW_DENIED`），否则转问用户（`auto-review/src/index.ts:710-718`）。「直接拒绝而不询问」的典型条件：策略 `never` / 无应答者（fail-closed 归一 `unavailable`）/ abort / guard 命中 / hook 合并出 deny（`hook-protocol/src/merge.ts`：`deny > ask > allow`）。

**审批生命周期与呈现**：审批期间 turn 保持 open、agent loop 阻塞在该调用内（`user-approval/src/index.ts:215-223`）；审计 `approval/asked` + `approval/decided` 成对、**log-only 不进对话流**（`types.ts:35-59`）；策略中途变更追加一条 user 消息告知模型（`:186-195`）。客户端审批**接管输入区**（composer takeover，与输入条互为兄弟座、共用同高上限）：pending 期间输入不可达、双 Esc 停止键被禁用（`ui-conversation/.../stop-shortcut.ts:44-53`）；审批卡 Enter=`allowed-once`、Esc=`rejected`（`ApprovalPanel.tsx:46-58`，含 IME 防护）。权限档位在输入区单独选择，选高危档先勾「我已了解风险」。

### 2.3 两条不变量（NF 现状对照）

| 不变量 | CC | dsh | NF 现状 |
|---|---|---|---|
| ① 判据显式：只有显式命令是确定性的 | `/` 精确分派 | 行首 `/` 精确分派 | ✅ 已同形（`agent-store.ts:515`） |
| ② 自然语言不做本地分类 | 无分类器 | 唯一本地判定 = `/` | ❌ 正则预路由（`writing-intent.ts`） |
| ③ 一句话永不直接变成动作 | 一切经 `canUseTool` | 审批 fail-closed | ❌ 直出路径绕过全部审查 |
| ④ 动作与执行之间有审查落点 | 多选项弹窗 + 规则 | composer 接管 + 按钮 | ◐ 仅工具路径有（`ConfirmCard`） |

---

## 3. 设计（已拆分为三份实施 spec）

### 3.1 / 3.2 → 已迁出

> 命令层与审查层的设计（原 §3.1 / §3.2：判据显式化、方案 B 拍板、A / C 留档、授权语义备注）已迁入
> **`docs/superpowers/specs/2026-10-02-command-review-design.md`（线①）**——实施以该档为准，本文不再保留副本。

### 3.3 → 已迁出

> AGENT 窗口输出格式（原 §3.3：dsh 形态速记、NF 差距表、视觉照搬源与行前导置换）已迁入
> **`docs/superpowers/specs/2026-10-02-agent-output-format-design.md`（线②）**——实施以该档为准，本文不再保留副本。

### 3.4 → 已迁出

> 工作流输出格式（原 §3.4：dsh 三类对应物、NF 现状、映射表）已迁入
> **`docs/superpowers/specs/2026-10-02-agent-output-format-design.md`（线②）**——实施以该档为准，本文不再保留副本。

### 3.5 → 已迁出

> 手动 AI 产出审查（原 §3.5：镜像面判断、16 处入口现状、五层改法）已迁入
> **`docs/superpowers/specs/2026-10-02-manual-ai-output-review-design.md`（线③，已纳入）**——实施以该档为准，本文不再保留副本。

---

## 4. 实施边界与已拍板事项（拆分后）

- 三条工作线（全档不含实施）——实施主体已拆出（见 §3 指引）：
  - 线①「命令审查」（小）：`docs/superpowers/specs/2026-10-02-command-review-design.md`；建议先做；
  - 线②「输出格式」（大）：`docs/superpowers/specs/2026-10-02-agent-output-format-design.md`；建议线①后；
  - 线③「手动 AI 产出审查」（已纳入，排①/②后）：`docs/superpowers/specs/2026-10-02-manual-ai-output-review-design.md`。
- **已拍板存档（2026-10-01，用户）**：① 直出处置 = 方案 B（直出退场，全走模型 + 工具 + 确认）；② 澄清 / 增强分支保留；③ 输出格式连视觉一并照搬 dsh。
- 实施期待定（已随拆分落到各 spec 的「待定」节）：线① D1 区间行为 / D2 模式库收留；线② D1 主题映射 / D3 授权记忆（**D0 批 1–4 取消、D2 箭头按 dsh 已于 2026-10-02 拍板**）。

---

## 5. 证据索引

**NF**（`E:\vela\11\vela-1`）：

- `src/stores/agent-store.ts:507`（分派入口）/ `:515-578`（slash 精确分派）/ `:554-557`（/status 交模型）/ `:590-595`（预路由分叉）/ `:1166-1254`（handleWritingIntent 直出）
- `src/services/agent/writing-intent.ts:1-125`；`src/services/agent/intent-router.ts:55-104`
- `src/services/agent/tools/start-workflow.tool.ts:40`；`src/services/agent/agent-engine.ts:488`；`src/services/agent/approval/policy.ts:17-59`
- `src/services/automation/types.ts:18`；`src/services/automation/scheduler.ts:148-167`
- UI：`AgentMessage.tsx`、`ToolCallBlock.tsx`、`ConfirmCard.tsx`、`ArtifactCard.tsx:96-98`、`BottomPanel.tsx:243-394`、`AIOutputPanel.tsx:313-477`
- 手动 AI 入口盘点（§3.5）：`NovelConfigEditor.tsx:75-137, 322-329`、`GenerateConfigDialog.tsx:46-65, 81-114`、`generate-field.command.ts:55-67`、`architecture.command.ts:56-108`、`architecture-workflow.ts:102-119`（配置双实现）；`AIActionDialog.tsx:19-26`（唯一 caller = DraftEditor）、`ReviewReport.tsx:434-470`（复制体）、`CharacterEditor.tsx:119-141` + `CharactersView.tsx:59-82`（重复状态机）；`CodeMirrorEditor.tsx:686-744, 817-843`（闭环范本）
- 提交：`4c88178` / `9ddcb3c` / `8cc4634` / `0a7011e` / `974cc44` / `04d2718` / `f6f9240` / `a986a51`

**Claude Code**（`D:\Code\Claude-code-2.1.188-源码学习\Claude-Code-main\src`）：

- `commands.ts:258, 688-698`；`utils/handlePromptSubmit.ts:229`；`utils/processUserInput/processUserInput.ts:182-224, 517-588`；`utils/processUserInput/processTextPrompt.ts:19-31, 96-99`
- `utils/permissions/permissions.ts:473, 1158-1319`；`services/tools/toolExecution.ts:921`；`types/permissions.ts:16-38`；`components/permissions/FallbackPermissionRequest.tsx:160-198`

**dsh**（`D:\Code\deepseek-harness`）：

- `packages/client/ui-commands/src/client/service.ts:252-349`、`resolution.ts:44-59`、`README.md:12`
- `packages/interaction/user-approval/src/index.ts:54-75`、`types.ts:32`；`packages/sandbox/README.md:5-9`；`packages/client/ui-approval/src/client/ApprovalPanel.tsx:59-87`
- `packages/client/ui-chat/src/client/chat/`（`MessageItem.tsx:162-234`、`ReasoningRow.tsx:76-101`、`process-groups.ts`、`ChatGroupSeat.tsx:91-128`）
- `packages/client/ui-tool/src/client/tool/components/ToolRow.module.css:1-7`、`ToolCallTree.tsx`
- `packages/client/ui-workflow-run/src/client/WorkflowRunPanel.tsx:203-344`；`packages/client/ui-deliverables/src/client/Deliverables.tsx:68-129`；`packages/client/ui-primitives/src/client/StateDot.tsx:5-9`
- 审批判定链路（深挖）：`packages/core/tools/src/index.ts:598-611, 724-730, 1505-1511, 1709-1768`；`packages/interaction/user-approval/src/index.ts:186-306`、`types.ts:32-59`；`packages/sandbox/sandbox/src/escalation.ts:28-61, 171-208`；`packages/experimental/auto-review/src/index.ts:686-726`；`packages/hooks/hook-protocol/src/merge.ts:1-8`
- 审批生命周期 / 接管（深挖）：`packages/client/ui-approval/src/client/contract/slots.ts:74-176`、`index.ts:36-103`、`ApprovalPanel.tsx:46-87`；`packages/client/ui-conversation/src/client/stop-shortcut.ts:44-53`
- 命令补充（深挖）：`packages/client/ui-chat/src/client/chat/GenericCommandCard.tsx`；`packages/client/ui-input-trigger/src/client/MenuView.tsx:94-220`；`packages/client/ui-conversation/src/client/input/facade.ts:333-337`
- **视觉源**：`packages/client/ui-theme/src/styles/design-platform.css`、`base.css`、`gradient-shadow-text.css`；`packages/client/ui-primitives/src/{DisclosureRow,StateDot,TextShimmer}.module.css`；`packages/client/ui-approval/.../ApprovalPanel.module.css`、`ui-tool/.../ToolRow.module.css`、`ui-chat/.../{ChatView,MessageItem,ReasoningRow}.module.css`、`ui-workflow-run/.../WorkflowRunPanel.module.css`

---

## 6. 自审记录（2026-10-02）

对本文 + 所引代码做了一轮核对（行号以 2026-10-02 实测；相关文件自 10-01 起未改动）：

**核实为准确**：时间线 5 项提交日期全部对上（`4c88178` 2026-04-21 / `9ddcb3c` 08-27 / 五次加固 08-27~09-13 / `f6f9240` 09-13 / `a986a51` 09-26）；内置 4 命令（clear / new / help / status，`agent-store.ts:519-558`）与 `/status` 不拦截注释（`:554-557`）属实；`requiresConfirmation`（`start-workflow.tool.ts:40`）与确认流程（`agent-engine.ts:488`）属实；**消费者核查**：`detectWritingIntent` 仅 agent-store 一处消费——线① 改动面可收窄。

**修正 / 补强（已随拆分落入各 spec）**：

1. 行号微漂移（±3-5 行；如 `onGenerated` 实为 `NovelConfigEditor.tsx:325-327`）——各 spec 已标「动手前复核」；
2. 线① 补充：直出移除的**配套死码**（`workflow-starter` 动态 import、`makeStartedMsg`、`WorkflowStartError` catch `:1278-1296`）此前未列；
3. 线① 新增待定 D1：区间（「写五到八章」）在案 B 下的目标行为未定义；
4. 线② 新增 D0：与《2026-09-28 UI 重构》批 1–4 **改同一批组件**——两条未执行轨道需先定关系；
5. 线② 新增 D2：箭头语义冲突（dsh `⌄/⌃` vs NF 批 0 已拍板 `›/⌄` 且禁 `⌃`）；
6. 线② 补强：思考单链路化须覆盖 `_思考过程_`（含 **#34** 工作流命令产出）+ `<think>` 渲染 + `conversation-recovery` 存储语义三处，不得让 #34 回退。

**相邻、不属本档**：`base-command.ts:214` 未传 modelId（工作流命令全走默认模型）——另行分诊。
