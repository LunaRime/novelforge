# V3 U6 设置、欢迎页与公共交互施工计划

**目标**。作者打开应用时看得见加载进度或恢复入口，能从欢迎页进入作品，并能预览、调整和恢复写作外观。设置关闭时保留已经生效的偏好，对未保存表单给出明确选择。

**实施条件**。独立启动页和 Storybook 可提前验证。正式接入沿用 U1 工作台与第 42 号计划第 0 节的项目类型和入口。[V3 总计划](42-v3-frontend-delivery-plan.md#0-后端交接与前端职责)、[启动画面设计](45-v3-startup-design.md)

## 样板预验收

在 **NovelForge Workbench → V3 Appearance → Preview And Apply** 用临时偏好预览四主题及正文排版，应用后更新样板稿纸。Chromium 对中、英、俄三语分别验证了 1440×900 和 684×428。键盘切主题、字号和栏宽，关闭按钮和 Esc 均可进入未保存确认。取消确认后原设置控件恢复焦点，放弃后外层稿纸保持原值。恢复默认先更新预览，应用后更新外层稿纸。另用独立启动样板核对三语、暖白和深色的等待、失败与键盘重试。[外观样板源码](../../src/stories/V3Appearance.stories.tsx)、[启动样板](../ui-redesign-v3/startup.html)

## 1. 首帧、欢迎页和项目入口

- [ ] 延续第 45 号计划，在根 `index.html` 和 `public/theme-init.js` 接入实际首帧。核对主题和语言在 React 挂载前的读取时机，以及 `window.__VELA_HTML_READY` 和渲染就绪日志。以实际加载事件驱动慢启动、失败和重试，复用 Electron 原有窗口恢复与 CSP。[应用入口](../../index.html)、[预渲染主题](../../public/theme-init.js)
- [ ] `WelcomePage.tsx` 保留新建、打开、导入、最近项目和首启指引的现有回调。普通 SQLite 与文件项目的打开由各自入口给出成功、取消和失败结果。最近项目路径失效或选取被取消时，返回可操作的欢迎页。优先在隔离配置中验证首启、重启和空历史。[欢迎页](../../src/components/pages/WelcomePage.tsx)
- [ ] 在 Windows 打包应用验证实际首帧、加载等待、失败重试、无明显白闪及应用关闭。核对系统缩放、语言和减少动态效果，记录包版本与启动日志。

## 2. 外观偏好与未保存表单

| 入口 | 现有作用范围 | 正式验收 |
| --- | --- | --- |
| 主题 | `ThemeSection` 和右侧工具栏共用 `theme-store` 与主题元数据，选中即时生效 | 四主题在设置、欢迎页、正文和浮层一致，切换或重开后读取同一偏好 |
| 正文排版 | `editor-prefs-store` 的字号、行宽和专注阅读设置只用于正文编辑器，按已有键保存 | 正文字号 17/18 px，行宽 720–800 px，默认 760 px。窄窗约束可用宽度，恢复宽窗后使用保存的值 |
| 纸面与密度 | 纸色主题复用现有令牌。原型里独立的纸面和密度选项在正式接入时明确它们各自的控件和作用域 | 对照正文、侧栏、表单及缩放验证互不误改。恢复默认只作用到本组设置 |
| 未保存表单 | `SettingsModal` 复用 `settings-dirty` 和关闭确认 | 关闭按钮与 Esc 走同一路径。取消保留输入，明确放弃后关闭。切换分区时仍可找回待保存输入 |

[主题选项](../../src/components/settings/ThemeSection.tsx)、[正文偏好](../../src/stores/editor-prefs-store.ts)、[设置关闭入口](../../src/components/settings/SettingsModal.tsx)

## 3. 公共控件与打包回归

V3 稿纸首帧使用现有标识和启动前读取的主题及语言。入口加载失败提供重试，主文档加载失败提供原路重试或关闭。编辑器设置预览字号、栏宽、稿纸和列表密度，应用后持久化。主题切换延续即时生效，欢迎页延续常规项目和文件项目入口。启动、欢迎页和外观设置组件已通过定向回归。

- [ ] 先在设置、欢迎页和 `CommandPalette` 复用 `Dialog`、按钮、Tooltip 和分段控件。核对打开即有可见焦点、Tab 循环、遮罩策略、Esc 和关闭后的焦点归还。二次确认取消后回到原设置控件。
- [ ] 用三语、四主题、长文案和 100%/125%/150% 应用缩放验证。最小窗的正文预览允许随容器收缩，设置区可以滚动，底部确认与取消可达。切主题时核对文字、控件和底色同步，鼠标和键盘均能恢复默认与保存。
- [ ] 在打包版完成「启动 → 欢迎页打开或导入 → 调整外观 → 编辑设置并取消关闭 → 保存 → 重启读取偏好」。记录实际窗口、语言、主题及设置作用范围。[每批检查](42-v3-frontend-delivery-plan.md#3-每批的检查与交付)

```powershell
corepack pnpm run test src/components/settings/SettingsModal.test.tsx src/components/settings/settings-dirty.test.ts src/components/settings/ThemeSection.test.tsx src/stores/editor-prefs-store.test.ts src/components/pages/WelcomePage.test.tsx src/components/command-palette/CommandPalette.test.tsx src/components/ui/SegmentedControl.test.tsx src/components/ui/GlobalTitleTooltip.test.tsx --maxWorkers 4
```
