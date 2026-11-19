# V3 U4 功能页施工与验收计划

**目标**。从工作台打开需要编辑的资料，在窄窗的列表和详情之间往返时保留选择、列表位置和未保存输入。提交前可以核对作用范围，提交后能分辨写入结果与后续刷新状态。

**实施条件**。Storybook 可以提前使用合成数据。正式接入沿用 U1 的工作台、U2 的编辑会话和第 42 号计划第 0 节确认的项目类型及业务契约。[V3 总计划](42-v3-frontend-delivery-plan.md#0-后端交接与前端职责)、[U2 正文与版本反馈](46-v3-u2-editor-plan.md)

## Storybook 预验收

在 **NovelForge Workbench → V3 Blueprints → List Detail** 打开 18 章合成蓝图。通过 Chromium 验证 Storybook 构建产物在中、英、俄三语的 1440×900 和 684×428 两种视口。窄窗用键盘打开蓝图详情，返回恢复列表滚动、选中行和焦点。单项确认仅提交当前章，其他修改保留。批量确认列出全部修改。生成预览从内存读取示例，取消保留原文，应用后只更新目标章。保存后若原按钮禁用，焦点回到可编辑字段。[样板源码](../../src/stories/V3Blueprints.stories.tsx)

## 1. 用蓝图交付列表、详情和写入确认

- [ ] 在 `ChapterCardEditor.tsx` 保留当前项目 `id/path/session` 的容器和蓝图读写适配器。将列表、选中详情、状态和可执行动作交给展示组件。宽栏并排，窄栏一次展示一个区域。返回列表恢复选中行与滚动，焦点回到原行，回到详情可继续修改。
- [ ] 单项和批量保存沿用 `createRendererChapterBlueprintApplication`。以提交时的行版本对账，仅清理该次回执确认的输入。验证单项保存后另一行仍未保存、批量中途失败整批回滚，以及等待时新输入继续标记为未保存。
- [ ] 按操作保留现有生成、校检和补缺入口。目录生成的确认显示写入范围，调用现有连接和目录快照协议。补缺只提交缺失章节，既有蓝图及笔记保留。测试预览期间输入变化、项目同路径重开、部分资料外改和结果迟到。保存成功后的投影刷新错误按回执单独呈现。[蓝图加载与保存](23-blueprint-load-save-application-plan.md)、[生成与校检边界](27-blueprint-generation-verification-plan.md)、[补缺写入规则](28-blueprint-gap-insert-only-plan.md)、[目录写入协议](29-directory-blueprint-write-plan.md)

## 2. 推广到其余功能页

| 功能页 | 接线与展示职责 | 专项回归 |
| --- | --- | --- |
| 角色 | `CharacterEditor.tsx` 消费已选角色和角色编辑会话。列表、详情、模板和重复角色合并沿用各自的业务动作 | 角色改名后身份与引用一致，撞名时事务回滚。模板只处理可复用档案字段，模型填空保留手动输入。[角色编辑](31-character-edits-transaction-plan.md)、[模板与合并](32-character-templates-and-merge-plan.md) |
| 小说设置 | `NovelConfigEditor.tsx` 的容器绑定项目和字段版本。表单保管当前输入，使用现有保存、生成应用和撤销回执 | 修改字段期间收到生成结果时保留新输入。保存、回滚及自动回读按来源版本隔离。[小说设置应用层](21-novel-config-application-plan.md) |
| 世界观与架构 | `WorldBuildingEditor.tsx` 与现有架构文档容器消费文档及架构总览投影。视图显示每个来源的状态和可执行动作 | 单个来源读取失败时，其余已加载资料仍可编辑或打开。生成与提取具备取消及来源校验。[架构文档](20-architecture-document-application-plan.md)、[世界观与架构状态](22-architecture-overview-application-plan.md) |
| 知识库 | `KnowledgeOverview.tsx` 保留搜索、统计、维护与导出用例。视图显示索引状态、实际处理结果和后续统计刷新 | 检索空态、失败与取消分别显示。向量和分词维护冲突时保持互斥。维护成功而统计刷新失败时保留处理回执，导出在原项目会话内完成。[知识库总览](19-knowledge-overview-application.md) |

## 3. 布局、交互与打包验收

- [ ] 从工作台、命令面板和侧栏打开五类页面，核对三语动作名称、键盘路线、返回时的焦点和选中位置。窄窗长标题可查看全名，确认内容可滚动，取消和提交始终可达。
- [ ] 用 1440×900 和应用最小窗测试四主题及 100%/125%/150% 内容缩放。记录实际 CSS 视口，按长标题、修改中、错误回执和重复提交约束留存证据。
- [ ] 在已交接的项目类型中走完「开列表 → 选详情 → 编辑 → 暂时返回 → 回到原详情 → 核对确认范围 → 保存 → 重开回读」。保留已有三语手动保存提示和 `Save:{Module}` 日志。真实写入、角色冲突和维护回执逐页登记到正式验收。[每批检查](42-v3-frontend-delivery-plan.md#3-每批的检查与交付)

```powershell
corepack pnpm run test src/components/editor/ChapterCardEditor.test.tsx src/core/application/chapter-blueprints.test.ts src/core/application/directory-blueprint-write.test.ts src/core/application/insert-missing-blueprints.test.ts src/components/editor/CharacterEditor.test.tsx src/core/application/commit-character-edits.test.ts src/components/editor/NovelConfigEditor.test.tsx src/core/application/novel-config.test.ts src/components/editor/WorldBuildingEditor.test.tsx src/core/application/architecture-overview.test.ts src/components/pages/KnowledgeOverview.test.tsx src/core/application/knowledge-maintenance.test.ts src/core/application/prepare-knowledge-export.test.ts --maxWorkers 4
```
