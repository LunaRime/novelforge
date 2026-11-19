# V3 U5 写作搭档、提案与任务施工计划

**目标**。作者在写作态与构建态之间可以继续同一对话，从任务区回到待处理的提案，并看清每个操作对应的章节、任务及实际回执。

**实施条件**。样板使用合成对话与回执。正式接入采用 U1 的面板召回、U2 的文档会话，以及第 42 号计划第 0 节签收的项目类型和读写能力。[V3 总计划](42-v3-frontend-delivery-plan.md#0-后端交接与前端职责)、[U1 工作台](44-v3-u1-workbench-plan.md)、[U2 正文与版本](46-v3-u2-editor-plan.md)

## Storybook 预验收

在 **NovelForge Workbench → V3 Partner Tasks** 打开 `Proposal`、`Cancellation` 和 `Saved Index Pending`。Chromium 验证了三语的 1440×900 和 684×428 提案召回与暂存。键盘从任务回到同一提案，预览和暂存保持原正文，接受后由模拟回执更新正文。三语窄窗另验关闭面板期间由正在取消进入已取消，以及已保存但索引待重建。真实工具审批和流式输出沿下文接入。[样板源码](../../src/stories/V3PartnerTasks.stories.tsx)

## 1. 搭档、输出与任务共享运行状态

- [ ] `AIPanel.tsx`、`AgentConversation.tsx` 和 `AgentInputBox.tsx` 沿用现有会话、模型、引用及消息发送入口。工作状态和面板开关由布局层管理，任务持续归属原项目、会话和运行实例。召回后恢复当前会话、未发送输入和仍有效的审批。
- [ ] `WorkflowProgressEntry.tsx`、`AIOutputPanel.tsx` 和 `BottomPanel.tsx` 按原运行身份订阅进度、流式输出和结果。用户主动阅读旧消息时保留位置，回到最新消息后恢复跟随。核对多个任务并行、同路径项目重开、拖动窗口和面板往返期间的事件顺序。[运行实例与项目隔离](35-runtime-instances-plan.md)
- [ ] 审批项沿用 `PendingToolConfirmation.tsx` 和原审批处理顺序。只从真实待审批事件创建批准、拒绝及对应范围的控件。从任务区跳回审批时定位同一调用。复测已处理审批、等待期间取消、迟到批准和另一会话的同名任务。

## 2. 区分预览、修稿和正文提交

| 操作 | 接线与回执 | 验收 |
| --- | --- | --- |
| 预览单条建议 | 候选文件使用现有 `proposalId`、文档定位符和 `revision`。并排展示原文与替换文本，窄窗顺序排列 | 预览、关闭和丢弃均保留当前正文。切换章节、文档外改或手动编辑后按现有规则提示冲突 |
| 保存为待合并修稿 | 候选 `project:file-editor-agent-resolve-edit` 返回 `staged`，使用回执更新待合并列表。打开已保存修稿时沿用既有版本预览 | 正文及原 revision 保持可回读。重开后可预览修稿，合并前校验已预览内容与当前正文 |
| 接受并保存 | 候选走 `apply`，收到 `saved` 回执后显示实际正文和版本。`indexed: false` 显示正文已保存、索引待重建 | 模拟索引更新失败与中断恢复。正文写入一次，重试前核对已有回执与当前版本 |
| SQLite 修稿与合并 | 交接确认后复用当前修稿适配器、比较视图及原子合并用例。沿用正文身份和已读内容校验 | 分别覆盖发送前截取、手动保存交错、已处理结果和合并后刷新失败。核对原有撤销与版本语义 |

[候选提案与恢复](41-file-commit-recovery.md#agent-正文问答与修改提案)、[SQLite 修稿合并](16-revision-merge-application-plan.md)

## 3. 取消、终态与打包验收

- [ ] 每次取消指向当前 `runId` 或对应对话轮次。等待结果时对外公布正在取消，收到运行时确认后再显示终态。若已进入提交区间，使用真实提交结果或待恢复记录核验，然后给出对应反馈。
- [ ] 窄高窗口保留搭档、任务、上下文选择和审批入口，通过键盘执行并核对焦点。触发控件隐藏或不可用时，焦点移至仍可见的状态说明或可继续的操作。三语、长章名及坏网络模拟下核对按钮和状态布局。
- [ ] 用 U0 合成长稿与同一流式节奏比较停留旧消息、切布局、恢复跟随时的正文输入延迟。回归高频流只更新所属消息与任务。打包版登记项目类型、包版本、操作标识及真实回执。[U0 输入延迟基线](43-v3-u0-baseline.md#输入延迟基线)、[每批检查](42-v3-frontend-delivery-plan.md#3-每批的检查与交付)

```powershell
corepack pnpm run test src/components/panels/agent/AgentConversation.test.tsx src/components/panels/agent/AgentInputBox.menu.test.tsx src/components/panels/agent/PendingToolConfirmation.test.tsx src/components/panels/agent/WorkflowProgressEntry.test.tsx src/services/agent/agent-runtime.test.ts src/services/workflows/workflow-runtime.test.ts src/services/agent-adapters/file-project-agent.test.ts src/services/editor/merge-revision.test.ts src/components/dialogs/FileProjectEditorDialog.test.tsx electron/services/file-draft-lifecycle.test.ts electron/controllers/file-project-editor-controller.test.ts --maxWorkers 4
```
