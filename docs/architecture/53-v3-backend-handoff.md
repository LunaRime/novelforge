# V3 后端交接与 U1 工作台基线

2026-11-19 核对。交接源码基线为 `2a1faee`，Windows x64 便携应用来自 `3720f5b`，两者之间的差异均为架构文档。U1 首批适用于普通 SQLite 项目的正式工作台。激活文件项目继续从 `project:open` 分流到 `FileProjectEditorDialog`，其身份、保存回执和回退证据见 F3。[实施总计划](42-v3-frontend-delivery-plan.md) · [F3 验收](52-f3-file-storage-acceptance.md)

## C/D 交付核对

以下提交均在交接源码基线的历史中。回归栏列出接入时需要复用的入口与关键断言。

| 批次与提交 | 已交付 | 关键回归 |
| --- | --- | --- |
| C1a/C1c `632ac52`、`22ac0d2` | 蓝图加载、保存和删除由 `createRendererChapterBlueprintApplication` 发起。编辑快照按章核销。 | 保存期间再次编辑仍为 dirty，删除失败保留输入，同路径重开时旧结果失效。[蓝图组件](../../src/components/editor/ChapterCardEditor.test.tsx) |
| C1b `288773d` | `createRendererBinderApplication` 使用实际卷归属和顺序，`db:binder-reorder` 同步更新蓝图与卷区间。 | 失败事务回滚，卷刷新限于原项目会话。[主进程事务](../../electron/services/binder-service.test.ts) · [卷刷新](../../src/stores/volume-store.test.ts) |
| C1d/C1e/C1f `7f04bbe`、`133c8bb`、`2d4c7aa` | 校检、生成目录和补缺口使用同源快照。目录生成提交完整批次，补缺口只插入缺失章。 | 冲突拒绝、批量回滚、并发补入跳过，以及旧会话断点恢复保护。[目录写入](../../electron/services/directory-blueprint-write-service.test.ts) · [补缺口](../../electron/services/blueprint-gap-service.test.ts) · [断点恢复](../../src/stores/workflow-store.checkpoint.test.ts) |
| C1g `0373b7d` | 草稿箱通过应用层打开并归档草稿，以具体稿件 ID 定位版本，同章蓝图只提供展示信息。 | 同章版本打开正确、蓝图读取失败时仍展示草稿、过期操作不刷新新项目。[草稿箱](../../src/components/panels/sidebar/DraftBoxGroup.test.tsx) |
| C2/C3 `4445a83`、`b06ce08` | 角色增删、改名与重复合并由角色编辑 adapter 提交，蓝图引用随事务重写。模板 adapter 使用应用级资源。 | 旧卡片冲突、引用和卡片原子变更、模板跨项目使用。[角色仓储](../../electron/repositories/character-repository.test.ts) · [模板 adapter](../../src/services/characters/character-template-adapter.test.ts) |
| D1/D2 `5c91b7b`、`6e13992` | D1 记录四个 store 的职责。D2 接入配置会话、保存回执、写入互斥及撤销。 | 晚到结果、同路径重开与重新读取后的状态归属。[职责清单](33-store-responsibilities.md) · [项目 store](../../src/stores/project-store.test.ts) · [配置编辑器](../../src/components/editor/NovelConfigEditor.test.tsx) |
| D3 `d5c964d` | Agent 与工作流由实例端口接线，审批、输出、取消和断点归属明确。 | 双实例并行、工具超时、取消时的迟到输出、同路径旧断点防护。[Agent Runtime](../../src/services/agent/agent-runtime.test.ts) · [工作流 Runtime](../../src/services/workflows/workflow-runtime.test.ts) |
| D4 `45a6530` | 用同一应用用例贯通打开、编辑、保存、修稿、审稿与定稿。生产主进程 SQL 事务校验合并及定稿的预期正文。 | 无 UI 业务链路、修稿事务回滚、旧正文冲突、定稿后写入拒绝。[业务链路](../../src/core/application/draft-lifecycle.test.ts) · [修稿事务](../../electron/services/revision-merge-service.test.ts) · [正文事务](../../electron/services/draft-write-service.test.ts) |

## 生产操作契约

| 操作 | 入口、输入与回执 | 提交与失败反馈 |
| --- | --- | --- |
| 打开、保存与重开 | `project:open(path)` 返回普通项目及项目写入凭据，文件项目走 `fileProjectPath`。普通稿通过 `openRendererEditorDocument` 及 `db:draft-get-full(id)` 打开，定位符为 `vela://draft/{draftId}`。`createRendererDraftEditorApplication` 经 `saveDraftContent` 执行 `db:draft-update-content(id, content, wordCount)`。 | adapter 核对项目路径和 `projectSession`。SQLite 写入回执确认本次提交快照，编辑器保留期间产生的新输入。`REFRESH_RESOURCE` 的 `drafts` 投影刷新来自现有 adapter。文件编辑器另持 `token`、`locator`、`revision`，回执 `indexed: false` 表示正文已提交且索引待更新。[打开 adapter](../../src/services/editor/open-editor-document.ts) · [草稿 adapter](../../src/services/editor/draft-editor-adapter.ts) · [文件项目回归](../../electron/controllers/file-project-editor-controller.test.ts) |
| 生成草稿、审稿和修稿 | UI 与 Agent 共用 `startWorkflow`。正文相关请求带项目、章号和适用的草稿定位，当前项目校验后返回 `runId`、`displayName`、`chapterTag`。 | 启动回执用于任务定位，写入节点和运行终态由 Runtime 发布。取消、步骤确认与输出按 `runId` 归属，旧项目结果不得覆盖当前投影。工具超时结束调用方等待，实际停止取决于端口的中止能力。[启动 adapter](../../src/services/workflows/start-workflow.ts) · [启动回归](../../src/services/workflows/workflow-starter.test.ts) · [实例隔离](35-runtime-instances-plan.md) |
| 合并修稿与定稿 | `mergeRendererRevision` 调 `db:revision-merge`，传目标草稿 ID、修稿 ID、项目路径、预期正文与提交正文。`db:draft-finalize` 传项目路径、写入凭据、草稿 ID、章号、预期正文及字数。 | 合并在一个事务内更新正文、草稿与修稿状态。事务冲突保留双方正文。定稿只提交核对过的已保存稿件，同一正文重复定稿可获 `alreadyFinalized`。后续实体文件输出失败独立记入工作流日志。[合并 adapter](../../src/services/editor/merge-revision.ts) · [定稿命令](../../src/services/workflows/commands/finalize-chapter.command.ts) |
| 编辑蓝图、重排与应用生成结果 | 蓝图 adapter 负责单项、批量及删除。`db:binder-reorder` 传章号、目标卷和位置。`db:blueprint-directory-snapshot/commit` 携带范围快照与生成项，`db:blueprint-insert-missing` 返回插入和跳过的章号。 | 快照冲突要求刷新，保留作者输入。卷与章关联随事务变更。确认前只展示生成结果，回执确认后才刷新投影。[蓝图 adapter](../../src/services/chapters/chapter-blueprint-adapter.ts) · [目录提交](29-directory-blueprint-write-plan.md) |
| 保存角色与模板 | `db:character-edit-snapshot` 返回连接作用域和卡片。`db:character-commit-edits`、`db:character-merge` 带作用域、基线及编辑内容，返回提交后的卡片。`templates:list/get/save` 操作应用级模板。 | 卡片和关系引用冲突时整体失败。角色合并提交后通知蓝图投影刷新。项目会话改变时丢弃旧结果。模板导入后的项目写入仍经角色 adapter。[角色 adapter](../../src/services/characters/character-edits-adapter.ts) · [模板 adapter](../../src/services/characters/character-template-adapter.ts) |
| 保存项目配置 | `createRendererNovelConfigApplication` 进入 `project:update-config`，提交 `{ path, writeToken, novelConfig }` 的字段补丁。 | 15 秒提示保存仍在等待。回执丢失进入待核验，重新打开项目读取实际结果后才恢复重复提交。撤销按会话归属。[配置 adapter](../../src/services/config/novel-config-adapter.ts) · [回执处理](../../src/services/config/project-config-save.ts) |

## U1 接入与验证基线

使用 Windows x64 `0.1.7-beta.3` 便携应用和独立配置，通过实际工作台打开普通 SQLite 测试项目。在 1440×900 CSS px 视口，从草稿箱打开稿件并输入未保存正文。F11 往返期间保留同一个 CodeMirror 实例和正文，导航、Agent 和底栏恢复。编辑区宽度依次约为 743、720 和 743 CSS px。Ctrl+S 将正文写入原草稿 ID，撤销和重做仍有效。进程重启后重新打开项目并选中该稿，编辑器和数据库均读回已保存正文。本次重开需要重新选择草稿，自动恢复标签仍需按 U1 验收。

- `App.tsx` 保留启动、快捷键、项目切换和全局对话框接线。U1 首步提取四区布局组合，保持 `sidebar`、`middle`、`editor`、`bottom` 和 `ai-panel` 面板身份、两组尺寸持久化 ID 及 `data-region` 测量点。
- `novelforge:layout` 持久化侧栏、Agent、底栏的开关与当前视图。面板库负责尺寸，F11 专注为临时状态。写作态与构建态接入后继续核对这些旧偏好、编辑区连续挂载以及任务和 Agent 会话的连续性。
- Windows 现有工作台基线覆盖打开、编辑、保存、专注往返和关闭重开。生成、修稿、审稿与定稿在普通 SQLite 项目上已有 C/D 应用与事务回归，V3 接入后仍须逐项用目标包走实际界面。文件项目包验收见 F3，远端 CI 按实际交接提交核对。[U1 施工与交付](44-v3-u1-workbench-plan.md) · [既有 U0 基线](43-v3-u0-baseline.md)
