# 对话命令审查与输出格式设计（向 CC / dsh 学习）

**日期**：2026-10-01
**状态**：设计方向文档——**未开始实施**。
**指定约束**（用户）：

1. 命令审查机制（判据 / 审查）学习 Claude Code 与 dsh；
2. **AGENT 窗口输出格式采取 dsh**；
3. **工作流输出格式采取 dsh**。

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

- **命令 = 本地精确分派，绝不交给模型猜**：菜单 / 空格 / 回车三条判定全部基于会话目录精确匹配（`packages/client/ui-commands/src/client/service.ts:252-349`）；解析先按 `descriptor.name` 精确匹配、再按本地化别名表回落（`resolution.ts:44-59`）；README 原文：「a command line is never silently downgraded to a plain prompt」（`ui-commands/README.md:12`）。命令本身不进会话日志（宿主写审计事件）。
- **自然语言无本地分类**：唯一本地判定是「行首 `/`」（`service.ts:279`、`ui-conversation/.../InputBar.tsx:308`）；其余一切输入作为普通 user message 提交。
- **执行前必审查（fail-closed）**：审批**接管输入区**（composer takeover），不进聊天流；会话策略 `ask`（默认；无 answerer 时 fail closed）/ `never`（`packages/interaction/user-approval/src/index.ts:54-75`）；结果词汇 `allowed-once | rejected | cancelled | unavailable`——**授权仅对请求的那一次动作生效**（`types.ts:32`）；沙箱三档（read-only / workspace-write / danger-full-access），被拒调用可经**一次性**用户审批升级（`packages/sandbox/README.md:5-9`）；审批卡 = 「拒绝」/「允许一次」+ Enter/Esc（`packages/client/ui-approval/src/client/ApprovalPanel.tsx:59-87`）。权限档位在输入区单独选择，选高危档先勾「我已了解风险」。

### 2.3 两条不变量（NF 现状对照）

| 不变量 | CC | dsh | NF 现状 |
|---|---|---|---|
| ① 判据显式：只有显式命令是确定性的 | `/` 精确分派 | 行首 `/` 精确分派 | ✅ 已同形（`agent-store.ts:515`） |
| ② 自然语言不做本地分类 | 无分类器 | 唯一本地判定 = `/` | ❌ 正则预路由（`writing-intent.ts`） |
| ③ 一句话永不直接变成动作 | 一切经 `canUseTool` | 审批 fail-closed | ❌ 直出路径绕过全部审查 |
| ④ 动作与执行之间有审查落点 | 多选项弹窗 + 规则 | composer 接管 + 按钮 | ◐ 仅工具路径有（`ConfirmCard`） |

---

## 3. 设计方向

### 3.1 命令层：判据显式化（学习 CC / dsh）

- 保留 `/` 命令体系作为**唯一的「确定性直达」通道**（已与 CC/dsh 同形；后续可增量吸收 dsh 的别名 / 装饰思路）。
- 非 `/` 输入取消「本地分类 → 执行」。`writing-intent` 三种产出按 §1.4 分别处置：直接执行分支移除或改道（见 3.2）；澄清 / 增强分支可保留（无动作）或一并交模型。

### 3.2 审查层：执行前必审查

目标不变量：**任何一句话都不会绕过审查变成动作**。三个方案：

- **方案 A（最小接线）**：保留强命中，但在 `startChapterWorkflow` 等调用前插入与工具路径同级的确认（`ConfirmCard` 级）——点「批准执行」才起工作流。直出仍零模型；正则误判的代价从「误执行」降为「误弹确认」（噪音但无害）。
- **方案 B（对齐 CC / dsh，推荐）**：移除直出分支——全部自然语言 → ReAct → 模型调 `start_workflow` 工具 → 确认卡 + approval policy → 执行。NF 的审查设施已齐（`requiresConfirmation` + `approval/policy.ts`），唯一代价是「说写第三章」多一轮模型往返；换来判据统一（确定性判据只剩 `/` 命令与模型）与全路径审查。
- **方案 C（折中）**：仅保留「整句恰为最严形态」（如 `^写第\d+章$` 全句匹配）走方案 A，其余交模型。注意：C 保留的仍是「猜」，只是把射程收窄；B 才是与 CC/dsh 完全同构的终态。

若未来扩展 D 档自动化触发写作，直出路径的审查语义应与 `ActionPolicy` 的 `confirm` 一致（确认后才执行）。

### 3.3 AGENT 窗口输出格式 = dsh

dsh 形态速记（信息架构级）：

1. 用户消息：右对齐气泡 + 附件卡 + 悬停动作行；
2. 助手：流式 markdown，中断追加「已停止」；
3. 思考：24px 折叠行「思考」+ **首行摘要** + 流式尾部渐隐；展开为 compact markdown；
4. 工具：**24px 单行**「[icon] 标题 · 摘要」（2px 点分隔、摘要单行省略）；状态靠颜色 + shimmer（错误红 / 中断琥珀）；展开为 IN/OUT 双栏卡或专用卡（terminal / diff / read / search / web / image）；子调用左竖线缩进 22px；
5. **过程组**：连续工具 / 思考自动折叠为一行「正在…」→ 结束变「已读取文件、执行了命令」（单行 + 计数）；
6. **审批 / 提问 / 计划审批不进聊天流**，接管输入区（composer takeover，2-3 按钮 + Enter/Esc；聊天流里故意不双渲染）；
7. 元信息三层：流内实时「深度求索中，用时 x」→ turn 收尾「已完成，用时 x」→ 输入区统计药丸（轮 / 步、TPS、缓存命中）+ 点击 dialog；
8. 错误：Turn 级专用行（状态点 + 人类化文案 + code）；另有重试行 / token 上限行；
9. 状态点全站统一语义：绿 done / 琥珀 attention / 灰 loading / 红 error / 中性 idle。

NF 现状 → 目标差距表：

| 元素 | NF 现状 | 建议（采取 dsh） |
|---|---|---|
| 用户消息 | 右对齐气泡、纯文本（`AgentMessage.tsx:125-149`） | 已对齐；补附件卡 / 悬停动作行形态 |
| 助手 | 流式 markdown +「_已停止生成_」 | 已对齐 |
| 思考 | **双链路**：`_思考过程_` 前缀 + `<think>` 标签（`AgentMessage.tsx:37-41`、`MarkdownContent.tsx:273-332`） | **单链路化** + 首行摘要 + 渐隐 |
| 工具行 | 折叠块（chevron + wrench + 名字 + 摘要 + 状态图标，`ToolCallBlock.tsx:81-171`） | 单行化（icon + 标题 · 摘要 + 点分隔 + shimmer + 错误红 / 中断琥珀） |
| 工具展开 | 参数 JSON + 结果（maxH 200） | IN/OUT 双栏 + 专用卡分层（至少 diff / read / search） |
| 过程组 | ❌ 无 | **采纳**（dsh 最强的降噪机制） |
| 审批 | `ConfirmCard` 内联流内；子 agent 确认在输入框上方 | **流内审批改接管输入区**（已有一半先例） |
| 错误 | 写进正文 markdown | 专用错误行（状态点 + 人类化 + code） |
| 元信息 | `ContextBudgetBar`（输入框下） | 三层化（至少收尾「已完成，用时」+ 统计药丸） |

### 3.4 工作流输出格式 = dsh

dsh 的对应物（三类并存）：

- **过程组**（流内）：多步执行折叠为一行动词标题 + 计数；
- **WorkflowRunPanel**（流内节点）：run → phase → member 三层折叠 + 状态点 + 计数摘要（「已完成 2 · 运行中 1」）+ 成员可点进子会话；自动展开策略（非 clean 自动展开、转 clean 延迟收起）；
- **结束后交付物**：turn 尾部交付物卡（变更文件卡 + 显式呈递文件卡 + 计划文档卡；超过 4 个折叠）。

NF 现状：底部 tasks 面板（步骤树：竖线连接器 + 状态图标 + 进度条 + 「下一步 / 继续执行」确认条，`BottomPanel.tsx:243-394`）+ 右侧 ai-output（步骤流式正文 + 思考块 + 整体进度条 + 「整个工作流已全部完成」，`AIOutputPanel.tsx:313-477`）；启动即双开（`workflow-store.ts:427-432`）；对话内仅 `workflow_started` 产物卡做跳转（`ArtifactCard.tsx:96-98`）。

映射建议：

| dsh 元素 | NF 映射 |
|---|---|
| WorkflowRunPanel run → phase → member | NF：run = WorkflowRun、member = WorkflowStep（phase 暂无，不强行造）；面板信息架构向三层折叠 + 计数摘要对齐 |
| 状态点五态 | 统一语义核对（NF 现图标已接近：CheckCircle2 / Spinner / XCircle…） |
| 过程组（流内单行 + 计数） | **对话内新增单行折叠组**作进度入口（详情仍在下方 / 右侧面板） |
| 自动展开策略 | running / 异常自动展开，转 clean 延迟收起 |
| turn 尾部交付物卡 | 完成后在对话尾挂交付物卡（对齐 NF 既有 `ArtifactCard` 12 类产物） |

---

## 4. 实施边界与建议分期

- 本文档**不含实施**。若批准，建议拆两条独立线：
  - 线①「命令审查」（小）：按 3.2 方案 B（或 C→B）改 `agent-store.ts` + `writing-intent.ts` + 测试；真机用例：「列出小说大纲」不再启动任何东西、「写第三章」经确认后启动；
  - 线②「输出格式」（大）：3.3 AGENT 窗口 + 3.4 工作流输出两批 UI 重构。
- 建议顺序：线① 先（信任边界优先），线② 后。

**开放决策点（待拍板）**：

1. 直出处置：A / B / C 选哪个（推荐 B）；
2. 澄清 / 增强分支是否保留（建议保留或一并交模型）；
3. 输出格式：按既有口径「信息架构照 dsh、视觉服从 NF 令牌」执行；如需连视觉一并照搬 dsh 请指出。

---

## 5. 证据索引

**NF**（`E:\vela\11\vela-1`）：

- `src/stores/agent-store.ts:507`（分派入口）/ `:515-578`（slash 精确分派）/ `:554-557`（/status 交模型）/ `:590-595`（预路由分叉）/ `:1166-1254`（handleWritingIntent 直出）
- `src/services/agent/writing-intent.ts:1-125`；`src/services/agent/intent-router.ts:55-104`
- `src/services/agent/tools/start-workflow.tool.ts:40`；`src/services/agent/agent-engine.ts:488`；`src/services/agent/approval/policy.ts:17-59`
- `src/services/automation/types.ts:18`；`src/services/automation/scheduler.ts:148-167`
- UI：`AgentMessage.tsx`、`ToolCallBlock.tsx`、`ConfirmCard.tsx`、`ArtifactCard.tsx:96-98`、`BottomPanel.tsx:243-394`、`AIOutputPanel.tsx:313-477`
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
