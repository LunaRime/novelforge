# AGENT 输出格式（线②）：AGENT 窗口 + 工作流输出 = dsh 实施设计

> **日期**：2026-10-02（自 `docs/2026-10-01-agent-command-review-design.md` §3.3 / §3.4 拆分）
> **状态**：方向已拍板（**输出格式连视觉一并照搬 dsh**，2026-10-01）——**待实施**（大）；建议线①之后。
> **拆分来源**：总纲 §3.3 / §3.4 / §5 视觉源（内容已迁入本文，总纲不再保留副本）。

## 0. 与《2026-09-28 UI 重构》批 1–4 的关系（**已拍板：批 1–4 取消，由本线取代**）

两条**均未执行**的轨道改同一批组件：

- 《`2026-09-28-ui-refactor-design.md`》批 1（AI 面板·会话列表族）/ 批 2（消息卡族：`AgentMessage` / `ThinkingCollapse` / `CompressedBatchCard` / `ToolCallBlock`）/ 批 3（产物与任务族 + 收件箱）/ 批 4（底部面板）；
- 本线 2a（AGENT 窗口 = 上述组件族）+ 2b（工作流输出 = 底栏任务面板 + `AIOutputPanel`）。

**目标语言不同**：批 1–4 = NF 行片化 + 悬停置换 + 32×32（NF 令牌，批 0 已定型）；本线 = dsh 照搬（工具单行化 / 过程组 / 审批接管 / 视觉变量）。

**已拍板（2026-10-02，用户）**：**批 1–4 不执行（取消）**——AI 面板 / 消息族 / 产物族 / 底部面板的形态由本线按 dsh 统一负责（不并轨、不重复改造）；09-28 spec 已同步标注（批 1–4 ❌、批 5–9 保留）。

## 1. 范围与视觉源

- **2a AGENT 窗口输出**（§2）；**2b 工作流输出**（§3）；**视觉一并照搬**（下述）。
- dsh 视觉源头（照搬指针）：

  - **语义变量层**：`packages/client/ui-theme/src/styles/design-platform.css`——`--dsw-static-*`（静态色板）→ `--dsw-alias-*`（语义别名）两层，亮 / 暗各一份（选择器 `body[data-ds-dark-theme]`），含 `--dsw-specific-bubble` 等聊天专属变量；
  - **基础层**：`base.css`（字体栈 + 圆角刻度 4/8/12/16/20/28）、`gradient-shadow-text.css`（字号轴派生 `--dsh-content-font-delta` / `-secondary` + 阴影 `--dsw-shadow-lv*`）；
  - **行语言三原语**：`ui-primitives` 的 `DisclosureRow` + `StateDot` + `TextShimmer`——dsh 所有「流程行」（工具 / 思考 / 命令 / 工作流成员）都是这三者组合，照搬这三个等于拿到整套行语言的骨架；
  - **行前导置换（悬停）**：不悬停时显示语义图标；悬停时 100ms 交叉渐隐为 chevron（`DisclosureRow.module.css:63-83`；`DisclosureRow.tsx:71-81` 注释「Replaces the collapsed icon with a chevron while the row is hovered」）；展开态固定为静态上折角；行文字同步 tertiary → secondary 提色。dsh 全部流程行通用（工具 / 思考 / 命令卡 / 工作流 phase / 过程组头 `ChatGroupSeat.tsx:117-122`）；斜杠菜单的行不做置换。NF 已有同族 `HoverSwapIcon`（`src/components/ui/HoverSwapIcon.tsx`，2026-09-28 批 0，`group-hover` + `group-focus-within` 双触发）——统一口径：**按 dsh**（2026-10-02 拍板，见 §4 D2）。
  - 关键样式文件清单见总纲 §5「视觉源」。

## 2. 2a：AGENT 窗口（dsh 形态速记）

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
| 思考 | **双链路**：`_思考过程_` 前缀 + `<think>` 标签（`AgentMessage.tsx:37-41`、`src/components/ui/MarkdownContent.tsx:271-332`） | **单链路化** + 首行摘要 + 渐隐（覆盖范围见下方注记） |
| 工具行 | 折叠块（chevron + wrench + 名字 + 摘要 + 状态图标，`ToolCallBlock.tsx:81-171`） | 单行化（icon + 标题 · 摘要 + 点分隔 + shimmer + 错误红 / 中断琥珀） |
| 工具展开 | 参数 JSON + 结果（maxH 200） | IN/OUT 双栏 + 专用卡分层（至少 diff / read / search） |
| 过程组 | ❌ 无 | **采纳**（dsh 最强的降噪机制） |
| 审批 | `ConfirmCard` 内联流内；子 agent 确认在输入框上方 | **流内审批改接管输入区**（已有一半先例） |
| 错误 | 写进正文 markdown | 专用错误行（状态点 + 人类化 + code） |
| 元信息 | `ContextBudgetBar`（输入框下） | 三层化（至少收尾「已完成，用时」+ 统计药丸） |

> **单链路化注意（自审补充）**：NF 的 `_思考过程_` 前缀是 **agent-engine 拼装格式**，且是 **issue #34 的产物**（架构等五命令带思考可见，`architecture.command.ts:110`）；`<think>` 标签由 `MarkdownContent` 的 ThinkingBlock 渲染；存储层 `conversation-recovery.ts:17` 以 `_思考过程：_` 引用形态保全。单链路化**须同时覆盖这三处**，不得让 #34 的可见性回退。

## 3. 2b：工作流输出（dsh 对应物）

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

## 4. 待定（实施前需定）

- ~~D0~~ **（已定 2026-10-02）：批 1–4 取消**——由本线取代（§0）；09-28 批 5–9 不受影响；
- **D1 主题映射**：dsh 亮 / 暗两套主题 vs NF 多主题（4 套）——映射方式实施时决定；
- **D2（已定 2026-10-02）：按照 dsh**——箭头对 `⌄/⌃`、14px、tertiary → secondary 行色、100ms；两份标准已同步收窄（原「全侧栏统一 `›/⌄`、禁 `⌃`」改为**限侧栏/导航行**，AI 面板流程行按 dsh）；
- **D3 授权记忆**：dsh 一次性授权（`allowed-once`）vs NF「本项目内始终允许」的去留（总纲 §3.2 原待定）；
- **D4**：`group-focus-within` 键盘等价保留（NF 无障碍要求，建议保留）。

## 5. 批次建议

- **2a**：消息族（用户 / 助手 / 思考 / 工具行 / 过程组）→ 审批接管输入区 → 元信息三层 → 错误行；
- **2b**：流内进度入口（单行折叠组）→ `BottomPanel` 三层折叠对齐 → 交付物卡 → 自动展开策略；
- 每批：门禁三绿 + 标准同步（`card-affordance-standard` / `ui-interaction-standard` / `ui-layout-standard`）。

## 6. 验收

- 门禁三绿；
- 真机走查（按 computer-use 约束另立文档）：工具单行 / 过程组折叠 / 审批接管输入区（Enter = 允许一次、Esc = 拒绝）/ 元信息三层 / 错误行 / 工作流面板三层折叠 / 交付物卡。

## 7. 证据索引（切片）

- NF：`AgentMessage.tsx` / `ToolCallBlock.tsx` / `ConfirmCard.tsx` / `ArtifactCard.tsx:96-98` / `BottomPanel.tsx:243-394` / `AIOutputPanel.tsx:313-477` / 思考三处（§2 注记）；
- dsh：总纲 §5「dsh」全部条目（命令卡 / 审批判定链路 / 审批生命周期与接管 / 视觉源）。
