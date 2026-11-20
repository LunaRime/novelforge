# V3 U3 项目导航与章节定位施工计划

**目标**。作者能从构建态找到作品、分卷、草稿和正文章节，从写作态回到导航时继续定位原稿。键盘打开、拖拽重排和搜索后的定位使用同一份项目投影。

**实施条件**。Storybook 可提前用合成稿验证交互。正式接入以 U1 工作台、U2 文档身份和第 42 号计划第 0 节确认的项目类型及接口为前提。[V3 总计划](42-v3-frontend-delivery-plan.md#0-后端交接与前端职责)、[U2 正文](46-v3-u2-editor-plan.md)

## 入口与身份

| V3 导航入口 | 现有正式接线 | 验收要点 |
| --- | --- | --- |
| 项目结构 | `Sidebar.tsx` 组合 `ProjectTree` 和已有项目操作 | 切项目后重置来源。侧栏召回、窄栏和键盘切换时能看见当前项目与已打开文档 |
| 活页夹与卷 | `BinderVolumeGroup` 读取现有卷投影，`VolumeGroup` 提供展开、打开、拖放和键盘重排 | 以蓝图的实际卷归属与 `sortOrder` 展示。无蓝图旧草稿继续用卷范围回退，打开动作沿用当前章节入口 |
| 草稿箱 | `DraftBoxGroup` 按来源会话消费草稿列表，已有打开和归档用例按真实 `draftId` 执行 | 同章同版本的不同分支各有独立身份。读取失败、归档失败和空列表各自反馈，回执仅在原会话有效时应用 |
| 正文章节 | `ManuscriptGroup` 保留已定稿入口、标题和导出 | 打开实际稿件并验证只读状态。当前项跟随编辑区活动身份，返回草稿箱时保持该草稿已有的编辑状态 |
| 文件项目导航 | 通过第 42 号计划的交接确认可读列表、`ChapterId`、历史定位符及可写能力 | 以文件项目会话和稳定定位符识别当前稿及历史稿。排序、归档和其他写入按已交接能力开放 |

[活页夹顺序与事务](24-binder-application-plan.md)、[草稿箱用例](30-draft-box-application-plan.md)、[文件编辑器契约参照](43-v3-u0-baseline.md#正式接口核对)

## Storybook 预验收

在 **NovelForge Workbench → V3 → Volume Navigation** 打开两卷合成稿。卷头公布展开状态及受控区域，章节行公布当前页。在 Chromium 以中、英、俄三语各验证了 1440×900 和 684×428 两种视口。用 Space 展开卷、Tab 到章节、Enter 开稿，再折叠当前卷及往返切换工作状态，正文仍指向同一章。返回原稿时核对未保存输入仍在。真实项目的搜索、顺序写入和重开回读按下文验收。[样板源码](../../src/stories/V3Workbench.stories.tsx)、[行语义回归](../../src/components/ui/MenuRow.test.tsx)

## 施工顺序

### 1. 统一行的行为与当前项

- [x] 卷、草稿箱与正文行复用 `MenuRow`。卷和草稿分组公布展开状态与受控区域，文档行按实际草稿 ID 或正文定位符标记当前项。草稿与正文的 32×32 CSS px 操作按钮独立于打开按钮，菜单关闭时归还焦点。
- [ ] 打开同一文档时复用现有编辑器打开适配器。从不同入口打开同章不同草稿或同名历史稿，核对标题、标签和导航当前项跟随实际文档身份。折叠当前卷、打开另一卷、在两种工作状态间往返，确认正文和未保存状态保持。
- [x] 将卷和草稿箱的展开状态及导航滚动保存到工作台持有的当前项目会话。测试覆盖面板卸载并召回后的展开状态与新会话重置。[行片组件](../../src/components/ui/MenuRow.tsx)、[打开适配器](../../src/services/editor/open-editor-document.ts)

### 2. 对齐真实卷顺序与重排

- [ ] 先用有隐藏蓝图、无蓝图旧稿、未分卷章节和同名草稿的副本记录现状。核对有蓝图章节按实际归属和 `sortOrder` 排列，回退稿在原卷可见。没有草稿的蓝图不得生成空正文标签。
- [ ] 卷内的 `Alt+↑`、`Alt+↓` 及拖放沿用 `BinderVolumeGroup` 把可见行位置转换为完整卷索引的路径。用含隐藏蓝图的同卷前移、同卷后移、跨卷拖放和尾部插入逐项核对。每次校验事务后的成员、排序和章号，重开后再读一遍。
- [ ] 搜索或未来筛选引入的可见顺序，应从同一完整投影推导。向可见目标移动时以稳定目标行映射位置。过滤状态下无法确定目标时收起该重排入口，恢复完整列表后核对可达动作。空搜索结果、清除条件和定位当前章均保留编辑器已打开的文档。
- [ ] 覆盖重复提交、重排失败、写入成功但刷新失败，以及等待期间切项目。反馈分别对应实际回执与投影状态，恢复刷新只作用于当前项目会话。[卷投影与重排入口](../../src/components/panels/sidebar/BinderVolumeGroup.tsx)、[卷交互组件](../../src/components/panels/sidebar/VolumeGroup.tsx)

### 3. 复核真实导航矩阵

- [ ] 从当前侧栏列出小说配置、章节蓝图、卷、草稿箱、正文和导出入口，逐项回归构建态、写作态召回和命令面板。通过长章名、混合已定稿和未定稿作品核对三语的截断、全名提示和键盘焦点。使用 1440×900 和最小窗，记录实际内容视口和缩放。
- [ ] 用多卷大目录记录冷加载、展开、滚动、开稿及重排后的可见延迟。定位热点后再调整订阅或列表渲染。优化后复测键盘开稿、拖放、卷间滚动定位和焦点恢复。
- [ ] Windows 打包版完成「打开项目 → 展开卷 → 编辑一章 → 切换布局 → 从导航回到该章 → 保存并重开」。对已交接的项目类型附上入口、实际文档身份、顺序回读和包版本。本批定向测试见下，正式交付沿用总计划全量门禁。[每批检查](42-v3-frontend-delivery-plan.md#3-每批的检查与交付)

```powershell
corepack pnpm run test src/components/ui/MenuRow.test.tsx src/components/panels/sidebar/SidebarGroup.test.tsx src/components/panels/sidebar/BinderVolumeGroup.test.tsx src/components/panels/sidebar/DraftBoxGroup.test.tsx src/components/panels/sidebar/ManuscriptGroup.test.tsx src/services/chapters/binder-adapter.test.ts src/core/application/binder.test.ts electron/services/binder-service.test.ts src/services/editor/open-editor-document.test.ts --maxWorkers 4
```
