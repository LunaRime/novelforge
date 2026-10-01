# 对话命令审查与输出格式设计（向 CC / dsh 学习）

**日期**：2026-10-01
**状态**：设计方向文档——**未开始实施**。
**已拍板（2026-10-01）**：① 直出处置 = 方案 B（§3.2）；② 澄清 / 增强分支保留；③ 输出格式**连视觉一并照搬** dsh（§3.3 视觉源）。
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

## 3. 设计方向

### 3.1 命令层：判据显式化（学习 CC / dsh）

- 保留 `/` 命令体系作为**唯一的「确定性直达」通道**（已与 CC/dsh 同形；后续可增量吸收 dsh 的别名 / 装饰思路）。
- 非 `/` 输入取消「本地分类 → 执行」。`writing-intent` 三种产出按 §1.4 分别处置：直接执行分支移除或改道（见 3.2）；澄清 / 增强分支可保留（无动作）或一并交模型。

### 3.2 审查层：执行前必审查

目标不变量：**任何一句话都不会绕过审查变成动作**。

**已拍板（2026-10-01）：方案 B**——直出分支移除，全部自然语言 → ReAct → 模型调 `start_workflow` 工具 → 确认（`requiresConfirmation` + `approval/policy.ts`）→ 执行；**澄清 / 增强分支保留**（不产生动作，§1.4）。判据从此统一为两套：`/` 命令与模型——第三套本地正则不再执行任何东西；代价是「说写第三章」多一轮模型往返。

方案 A / C 留档备查（未选）：

- 方案 A（最小接线）：保留强命中，在 `startChapterWorkflow` 等调用前置 ConfirmCard 级确认；
- 方案 C（折中）：仅「整句恰为最严形态」（如 `^写第\d+章$` 全句匹配）保留直出并加确认，其余交模型。

确认环节的呈现随 §3.3 一并对齐 dsh（接管输入区的审批卡：拒绝 / 允许一次 + Enter/Esc）。注：dsh 的授权语义是**一次性**（仅本次调用），NF 的「本项目内始终允许」是记忆式规则——保留或收敛留实施期决定。若未来扩展 D 档自动化触发写作，审查语义应与 `ActionPolicy` 的 `confirm` 一致。

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

**视觉一并照搬（2026-10-01 拍板；修订原「视觉服从 NF 令牌」口径，§3.3 / §3.4 共用）**。dsh 视觉源头（照搬指针）：

- **语义变量层**：`packages/client/ui-theme/src/styles/design-platform.css`——`--dsw-static-*`（静态色板）→ `--dsw-alias-*`（语义别名）两层，亮 / 暗各一份（选择器 `body[data-ds-dark-theme]`），含 `--dsw-specific-bubble` 等聊天专属变量；
- **基础层**：`base.css`（字体栈 + 圆角刻度 4/8/12/16/20/28）、`gradient-shadow-text.css`（字号轴派生 `--dsh-content-font-delta` / `-secondary` + 阴影 `--dsw-shadow-lv*`）；
- **行语言三原语**：`ui-primitives` 的 `DisclosureRow` + `StateDot` + `TextShimmer`——dsh 所有「流程行」（工具 / 思考 / 命令 / 工作流成员）都是这三者组合，照搬这三个等于拿到整套行语言的骨架；
- **行前导置换（悬停）**：不悬停时显示语义图标；悬停时 100ms 交叉渐隐为 chevron（`DisclosureRow.module.css:63-83`；`DisclosureRow.tsx:71-81` 注释「Replaces the collapsed icon with a chevron while the row is hovered」）；展开态固定为静态上折角；行文字同步 tertiary → secondary 提色。dsh 全部流程行通用（工具 / 思考 / 命令卡 / 工作流 phase / 过程组头 `ChatGroupSeat.tsx:117-122`）；斜杠菜单的行不做置换。NF 已有同族 `HoverSwapIcon`（`src/components/ui/HoverSwapIcon.tsx`，2026-09-28 批 0，`group-hover` + `group-focus-within` 双触发；箭头对 `›/⌄`、12px、accent 色、150ms）——照搬时按 dsh 语义统一（箭头对 `⌄/⌃`、14px、tertiary → secondary 行色、100ms）；NF 的 focus-within 键盘等价建议保留，实施期定。
- 关键样式文件清单见 §5「视觉源」。

实施期待定：dsh 为亮 / 暗两套主题，NF 为多主题体系——映射方式实施时决定。

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

## 4. 实施边界与已拍板事项

- 本文档**不含实施**。两条独立线：
  - 线①「命令审查」（小）：按 3.2 方案 B 改 `agent-store.ts` + `writing-intent.ts` + 测试；真机用例：「列出小说大纲」不再启动任何东西、「写第三章」经确认后启动；
  - 线②「输出格式」（大）：3.3 AGENT 窗口 + 3.4 工作流输出两批 UI 重构（含视觉照搬，源见 §3.3 / §5）。
- 建议顺序：线① 先（信任边界优先），线② 后。

**已拍板（2026-10-01，用户）**：

1. 直出处置：**方案 B**——直出退场，全走模型 + 工具 + 确认；
2. 澄清 / 增强分支：**保留**；
3. 输出格式：**连视觉一并照搬 dsh**（修订原「信息架构照 dsh、视觉服从 NF 令牌」口径）。

实施期待定（非方向性）：dsh 亮 / 暗两套主题与 NF 多主题体系的映射；审批授权记忆（dsh 一次性授权 vs NF「本项目内始终允许」）去留。

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
- 审批判定链路（深挖）：`packages/core/tools/src/index.ts:598-611, 724-730, 1505-1511, 1709-1768`；`packages/interaction/user-approval/src/index.ts:186-306`、`types.ts:32-59`；`packages/sandbox/sandbox/src/escalation.ts:28-61, 171-208`；`packages/experimental/auto-review/src/index.ts:686-726`；`packages/hooks/hook-protocol/src/merge.ts:1-8`
- 审批生命周期 / 接管（深挖）：`packages/client/ui-approval/src/client/contract/slots.ts:74-176`、`index.ts:36-103`、`ApprovalPanel.tsx:46-87`；`packages/client/ui-conversation/src/client/stop-shortcut.ts:44-53`
- 命令补充（深挖）：`packages/client/ui-chat/src/client/chat/GenericCommandCard.tsx`；`packages/client/ui-input-trigger/src/client/MenuView.tsx:94-220`；`packages/client/ui-conversation/src/client/input/facade.ts:333-337`
- **视觉源**：`packages/client/ui-theme/src/styles/design-platform.css`、`base.css`、`gradient-shadow-text.css`；`packages/client/ui-primitives/src/{DisclosureRow,StateDot,TextShimmer}.module.css`；`packages/client/ui-approval/.../ApprovalPanel.module.css`、`ui-tool/.../ToolRow.module.css`、`ui-chat/.../{ChatView,MessageItem,ReasoningRow}.module.css`、`ui-workflow-run/.../WorkflowRunPanel.module.css`
