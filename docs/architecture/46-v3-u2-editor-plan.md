# V3 U2 正文编辑与版本操作施工计划

**目标**。作者从项目导航打开章节后，可以在构建态与写作态继续编辑同一份正文。窗口收窄时，仍能保存、打开修稿和审稿、完成定稿，并看清这些动作作用于哪个版本。

**实施条件**。提前用合成稿准备样板和回归场景。正式接入依赖 U1 的稳定工作台挂载，以及第 42 号计划第 0 节对本批项目类型和接口的交接记录。文件项目的共用界面条目随该入口的交接范围执行。[V3 总计划](42-v3-frontend-delivery-plan.md#0-后端交接与前端职责)、[U1 工作台](44-v3-u1-workbench-plan.md)、[U0 实测基线](43-v3-u0-baseline.md)

## 编辑区呈现

| 区域 | 宽栏 | 窄栏 |
| --- | --- | --- |
| 文档标签 | 显示当前标签、未保存标记、固定与关闭入口。正文、修稿、审稿和历史可来回查看 | 当前标签始终可定位。移出可视区域的标签可从现有标签菜单切换，长标题可通过鼠标和键盘查看全名 |
| 章标题与操作 | 显示章节标题、正文状态、保存及当前文档可用的操作 | 保存和状态仍可见。放不下的操作进入「更多操作」，按编辑区实际可用宽度决定何时收纳 |
| 正文稿纸 | 稿纸居中，读取字号与行宽等现有编辑偏好。写作态可使用收起工具区后腾出的宽度 | 稿纸、标题和内边距随编辑区收缩，正文换行。长标题和菜单开关保持可达 |
| 修稿、审稿与历史 | 明示来自哪一章、哪个版本。修稿保留差异预览和确认路径 | 操作区可以换行或滚动，键盘能到达确认、取消和返回。长文本预览可独立纵向滚动 |

稿纸参照 V3 原型与 U0 样板，正式页面先保留 `editor-prefs-store.ts` 的正文行宽设置，再用容器宽度约束排版。四个主题使用现有稿纸、正文和焦点语义令牌。已定稿和归档状态在标题区可见，所显示的操作取决于当前文档的读写权限。[稿纸样板](../../src/stories/v3-workbench.story.css)、[正文偏好](../../src/stores/editor-prefs-store.ts)

## Storybook 预验收

在 **NovelForge Workbench → V3 → Version Actions** 打开带长章名和未保存正文的合成稿。菜单按编辑区宽度收纳，靠近视口边缘时翻转。已在 Chromium 用中、英、俄三语验证 1440×900 下直达及 684×428 下的 32×32 CSS px 入口、菜单项点击命中、键盘预览和 Esc 焦点归还。俄语场景另验取消定稿后返回入口、确认后焦点回到章标题，以及实际键入时正文保持只读。修稿、审稿和定稿均使用样板内存数据，打包版验收见下文。[样板源码](../../src/stories/V3Workbench.stories.tsx)

## 施工顺序

### 1. 整理标签与文档视图

- [x] 将标签栏和文档分派分别抽到 `EditorTabBar` 与 `EditorDocumentView`。保留元数据订阅、固定标签关闭保护和正文编辑器的挂载边界。关闭确认绑定发起时的项目会话及标签快照。
- [x] 在 Windows 打包应用中，从分卷和草稿箱打开同一 SQLite 草稿，复用 `doc:{draftId}` 标签与编辑实例。同章不同草稿、同名不同章各自显示正确正文。修稿、审稿和历史对比读取各自记录，返回正文保留未保存输入和测试夹具中的未决建议。
- [x] 复测取消关闭、确认丢弃、固定标签、批量关闭和项目切换。模拟同一路径关闭后重开，确认打开适配器的迟到读取及旧标签关闭确认无法作用到新会话。Windows 打包应用重启后，经草稿箱重开原草稿，回读已保存的正文与版本号。
- [x] 复跑 `EditorArea.test.tsx` 与 `open-editor-document.test.ts`，覆盖关闭确认、未决建议和不同入口打开同一草稿。[编辑区](../../src/components/panels/EditorArea.tsx)、[打开适配器](../../src/services/editor/open-editor-document.ts)
- [ ] 重开 SQLite 作品时自动恢复上次打开的正文标签及选中项。验证项目之间的恢复记录隔离，并从 SQLite 重新读取正文。

### 2. 接入稿纸与正文偏好

- [ ] 在 `DraftEditor.tsx`、`CodeMirrorEditor.tsx` 与 `novel-editor.css` 接入正文标题、稿纸留白和主题。按 `tabId` 和项目会话维持正文身份。工作状态、可用宽度、主题和字号变化通过样式或现有 CodeMirror 配置更新。
- [ ] 用同一章分别拖动侧栏、切换工作状态、改变字号和稿纸行宽。持续验证正文、选择区、滚动位置、撤销与重做，以及打字机模式、段落聚焦和 inline 建议的位置。窗口收窄时只改变即时排版，重新拉宽后读回作者原有行宽偏好。
- [ ] 真实中文输入法组合期间触发窄栏重排，并另测用鼠标切换工作状态。记录平台如何完成或取消组合，核对没有丢字或重复上屏，可继续输入并撤销。复用 U0 的长稿与空闲、Agent 流式两种输入条件对照延迟。[正文组件](../../src/components/editor/CodeMirrorEditor.tsx)、[输入延迟基线](43-v3-u0-baseline.md#输入延迟基线)

### 3. 让窄栏中的版本操作可达

- [ ] 在 `DraftEditor.tsx` 复用现有动作及确认路径，为 AI 修稿、AI 审稿和定稿提供溢出入口。直达按钮与菜单项使用同一可用条件和提交回调。文件编辑器按交接确认的能力提供对应操作。
- [ ] 复用仓库浮层组件承载菜单，支持 Tab 聚焦入口、键盘打开和执行、Esc 关闭以及点击外部关闭。关闭后将焦点交还触发器，动作打开对话框时将焦点交给对话框。图标入口提供三语可访问名称和至少 32×32 CSS px 桌面命中区。
- [ ] 用带长章名的稿件复测三语在最小窗和 150% 内容缩放下的保存、修稿、审稿、定稿。额外回归俄语在 1440×900、100% 的定稿裁切。记录编辑区实际 CSS 宽度、焦点顺序和点击命中，再完成一次真实预览、取消及确认。[正文操作裁切基线](43-v3-u0-baseline.md#windows-交互缩放与输入补测)

### 4. 对齐保存、冲突与版本回执

- [ ] SQLite 正文沿用 `src/services/editor/` 的编辑用例接线。保存开始时保留正文快照，回执只确认已提交的内容。等待时追加输入，回执返回后新输入仍显示未保存。验证保存失败、切项目、同路径重开及旧回执抵达后的界面。手动保存保留现有 toast 和 `Save:Draft` 日志。
- [ ] SQLite 修稿合并以所预览的原稿和对应修稿为来源，提交前保留现有内容比对。审稿和历史仍按对应记录打开，核对只读页显示该记录的正文或报告。合并成功但投影刷新失败时，显示已提交及刷新结果，保留成功回执。[修稿原子提交](16-revision-merge-application-plan.md)、[审稿视图](../../src/components/editor/ReviewReport.tsx)、[历史视图](../../src/components/editor/VersionHistory.tsx)
- [ ] 文件入口沿用 `FileProjectEditorDialog.tsx` 的会话和各自的能力回执。正文以 `token`、`locator`、`revision` 校验，`indexed: false` 显示正文已保存、索引待更新。修稿合并使用已预览的内容哈希和原稿 revision。发生外部改写或提交结果待核验时，保留当前输入或预览，通过原恢复流程核对后再继续。[文件编辑器](../../src/components/dialogs/FileProjectEditorDialog.tsx)、[文件提交恢复](41-file-commit-recovery.md)
- [ ] 双入口各跑一次「打开 → 编辑 → 保存 → 关闭 → 重开并回读」。对已交接的版本能力，另外验证预览作废、重复确认、定稿后只读、历史可读和晚到回执的隔离。

## 交付验收

| 证据 | 通过条件 |
| --- | --- |
| 组件与用例回归 | 标签去重、关闭确认、未决建议、编辑实例、保存快照、会话失效与版本冲突通过。文件入口提交回执由对应控制器与生命周期测试覆盖 |
| 样板和实际工作台 | 保存前后各截取宽窗与最小窗。覆盖三语、四主题、100%/125%/150% 内容缩放，优先留存最小窗 150% 和俄语宽窗 100% 的正文操作证据 |
| 打包版业务闭环 | 记录包版本、项目类型、窗口及 CSS 视口。保存回读、两态切换、真实输入法、修稿/审稿及定稿只读分别按交接能力验收，每个场景标明实测平台 |

```powershell
corepack pnpm run test src/components/panels/EditorArea.test.tsx src/components/editor/DraftEditor.test.tsx src/components/editor/CodeMirrorEditor.test.tsx src/components/editor/CodeMirrorEditor.inline.test.tsx src/stores/editor-prefs-store.test.ts src/services/editor/open-editor-document.test.ts src/services/editor/merge-revision.test.ts src/core/application/draft-editor.test.ts --maxWorkers 4
corepack pnpm run test src/components/dialogs/FileProjectEditorDialog.test.tsx electron/controllers/file-project-editor-controller.test.ts electron/services/file-draft-lifecycle.test.ts --maxWorkers 4
```

正式应用提交按总计划执行全量门禁，将截图、平台、读回结果和提交登记到本批验收记录。首个实际版本使用 U1 与 U2 正文路径的联合验收。[每批检查](42-v3-frontend-delivery-plan.md#3-每批的检查与交付)、[首个实际版本](42-v3-frontend-delivery-plan.md#4-第一批可交付版本)
