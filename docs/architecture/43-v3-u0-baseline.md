# V3 U0 样板、基线与接口记录

2026-11-19。源码与 Windows Portable 包使用 `abb0aa8`，本地跟踪的已合并基线为 `812edd6`。窗口验证使用隔离的应用配置、SQLite 合成小说和候选项目副本。V3 原型从当前工作区加载，包含 `app.js`、`custom-scroll.js`、`v3-controls.js` 的本地改动。[V3 施工计划](42-v3-frontend-delivery-plan.md)、[原型入口](../ui-redesign-v3/index.html)

## 操作样板

在仓库运行 `corepack pnpm run storybook`，打开 **NovelForge Workbench → V3**。浏览器测试复用正式 CodeMirror、Button、SegmentedControl 和现有四主题，章节、保存结果、建议和运行状态使用合成数据。页面刷新会重置样板。[Story 源码](../../src/stories/V3Workbench.stories.tsx)

| 场景 | 操作和已验证结果 |
| --- | --- |
| Forge | 写入一句正文，切到写作态再切回。正文 DOM、输入、光标和撤销栈保持，项目导航和运行状态重新显示。另写一句并按 Ctrl+S，保存状态更新 |
| Compose | 在写作态打开搭档建议，再关闭和重新打开搭档。建议预览保持，项目章节和底部运行状态默认收起 |
| Read Only | 长章名在 1024×640 保持可读。实际键入无法改变定稿正文，保存按钮禁用。缩到 820 px 时样板按单列排列 |
| Save Failure | 模拟保存失败，重复点击仍保留相同正文和未保存状态。失败反馈有可读文字 |

## 实测基线

| 入口 | 运行结果 | 本地截图文件 |
| --- | --- | --- |
| V3 原型 | Chromium 中捕获 `.program-window`，分别记录构建态和写作态 | `v3-reference.png`、`v3-reference-compose.png` |
| Storybook | 1440×900、纸色主题下构建态稿纸 672 CSS px、写作态稿纸 832 CSS px。四套主题均加载，1024 与 820 CSS px 视口无横向溢出 | `forge.png`、`compose.png`、`narrow.png`、`save-failure.png` |
| Windows 普通 SQLite 项目 | 展开草稿箱并打开正文，在正式编辑器插入文字。按 F11 进入现有专注模式并退出，导航、Agent 和底部区域恢复，编辑区域从约 743 CSS px 到 720 CSS px 再回到约 743 CSS px。Ctrl+S 保存后通过正文读取通道核对数据库内容 | `desktop-sqlite.png`、`desktop-focus.png`、`desktop-settings.png` |
| Windows 文件候选项目 | 普通打开入口转到文件编辑器，首章正文实际加载。BrowserWindow 报告最小尺寸 1024×640，请求此尺寸时 Windows 实际返回 1026×643 | `desktop-candidate.png`、`desktop-candidate-narrow.png` |

截图和浏览器结果保存在本地 `.test-artifacts/v3-u0/`。Storybook 的 820 px 场景用于观察布局收缩。SQLite 基线实测的是既有 F11 专注模式，正式 V3 两种工作状态由 U1 实现。正式快捷键仍待确认，需查平台占用和用户自定义绑定。现有注册表中专注模式默认 F11，原型的 Ctrl+M 仅用于演示。[快捷键注册表](../../src/stores/shortcut-store.ts)、[窗口配置](../../electron/main.ts)

本批通过 TypeScript、ESLint、Storybook 构建、浏览器交互及 Vitest 全量检查，Vitest 共 367 个文件、3,931 条测试。

## 正式接口核对

此处记录当前入口和可验证语义。正式交接以第 42 号计划第 0 节的签收记录为准。

| 功能 / 存储路径 | 入口和回执 | 身份、失效与验证 |
| --- | --- | --- |
| 工作台布局 | `App.tsx` 组合左侧栏、编辑区、Agent 与底栏。layout store 持久化开关和当前视图，面板库管理尺寸，`focusMode` 为临时状态 | U1 使用单个编辑会话，验证持久化偏好恢复和原有快捷键。已有 [布局 store 测试](../../src/stores/layout-store.test.ts) |
| SQLite 打开与保存 | `openRendererEditorDocument` 发布打开的文档，草稿页标签使用 `doc:{draftId}`。编辑用例 `save(path, text)` 成功返回后通知刷新草稿投影 | 打开校验项目路径、项目 ID 和 `projectSession`。保存用例核验来源路径和会话。依据数值草稿 ID 读取正文，修稿、审稿分别使用对应记录的 locator。[打开适配器](../../src/services/editor/open-editor-document.ts)、[编辑器用例测试](../../src/core/application/draft-editor.test.ts) |
| SQLite 修稿与审稿 | 编辑用例提供 `revision`、`merge`、`review`。合并可带 `expectedContent`，返回成功、失败或成功后附 `refreshError` | 先绑定项目会话和草稿版本。正文、修稿状态及关联快照的提交由原子合并用例处理，刷新失败时保留合并回执。[合并适配器测试](../../src/services/editor/merge-revision.test.ts)、[原子提交](16-revision-merge-application-plan.md) |
| 文件候选项目打开与保存 | `project:open` 返回 `fileProjectPath` 分流。专用 `project:file-editor-open` 返回 `token`、文档标签、缺失项及可用操作。保存携带 `token`、`locator`、`revision` 和正文，回执为 `{ revision, indexed }` | token 按窗口发送方和会话校验，关闭、重开后旧 token 作废。当前稿 `doc://chapter/…` 按 ChapterId 寻址，历史稿为只读 locator。写入需匹配 revision，`indexed: false` 表示正文已保存且索引待更新。[IPC 契约](../../src/shared/ipc-channels.ts)、[候选编辑器测试](../../electron/controllers/file-project-editor-controller.test.ts) |
| 文件候选项目修稿与生命周期 | `project:file-editor-preview` 返回正文与 `contentHash`。合并、定稿、归档通过 `project:file-editor-commit` 返回 `{ status: 'committed', revision }`。合并可携带已预览的 `proposalHash` | 用 token、ChapterId 和预期 revision 校验。关闭编辑器使会话失效，已进入提交协议的操作按后端恢复回执核验。[提交恢复协议](41-file-commit-recovery.md)、[生命周期测试](../../electron/services/file-draft-lifecycle.test.ts) |
| 写作搭档与任务 | 工作台沿用 Agent/工作流运行时，文件编辑器另有候选项目提案入口，`project:file-editor-agent-resolve-edit` 返回 `discarded`、`staged` 或 `saved` | 候选提案绑定 token、proposalId 与内容版本。工作流按 runId 跟踪取消，进入提交区间的结果等待真实回执。U5 按项目和会话投影运行进度，复测超时待核验与切换后的审批归属。[Agent 适配器测试](../../src/services/agent-adapters/file-project-agent.test.ts)、[工作流运行时测试](../../src/services/workflows/workflow-runtime.test.ts) |

## Windows 交互、缩放与输入补测

复用 `abb0aa8` Windows Portable，在隔离的 SQLite 项目中加入 100,258 字符的合成稿和带长章名的蓝图。取同一台 Windows 11、同一块 125% 缩放的屏幕，窗口为 1440×900 和请求的最小尺寸 1024×640。通过应用快捷键切换 100%、125%、150% 的内容缩放，并核对实际视口和状态栏读数。结果保存在本地 `.test-artifacts/v3-u0-desktop/`。

| 验证 | 实测结果 | 截图 / 数据 |
| --- | --- | --- |
| 三语与缩放 | 浅色主题下实测中文、英文、俄语各 6 组窗口与缩放组合。最小窗口在 150% 应用缩放时，视口约 684×428 CSS px，正文区域宽约 244 CSS px | `matrix-results.json`、`windows-ru-RU-min-100.png`、`windows-ru-RU-min-125.png`、`windows-ru-RU-min-150.png` |
| 四主题 | 中文在 1440×900、100% 下核对浅色、星空、纸色、深色。长章名和中文正文均可见，编辑区操作中心点可点击 | `windows-theme-galaxy.png`、`windows-theme-paper.png`、`windows-theme-dark.png` |
| 正文操作裁切 | 三语在最小窗口、150% 缩放时，AI 修稿、AI 审稿和定稿按钮的中心点无法命中。俄语在 1440×900、100% 时已经裁切定稿。已纳入 U2 回归，U1 同时复用这组窄窗场景核对面板布局 | `matrix-results.json`、对应语言最小窗截图 |
| 缩放控件裁切 | 最小窗、150% 缩放时，三语的状态栏缩小、重置和放大控件中心均无法命中。俄语在最小窗、125% 即出现。缩放快捷键可用，U1 补验鼠标可操作的缩放入口 | `matrix-results.json`、`windows-ru-RU-min-125.png` |
| 设置键盘操作 | 最小窗口、125% 应用缩放下，从左侧设置按钮打开，连续 14 次 Tab 焦点均在弹窗内，Esc 关闭后回到原按钮 | `windows-settings-min-125.png` |
| 拖拽与恢复 | 三次将侧栏拖到约 220 CSS px。按住时侧栏保留，松手后收起。Ctrl+B 重新打开均约 220 CSS px，未保存正文保留 | `desktop-results.json` |
| 蓝图与 Agent 状态 | 打开已有蓝图并核对表单内容。采集 Agent 空会话、流式生成、完成和 HTTP 400 失败，正文未保存提示及输入在任务状态变化后仍可读 | `windows-blueprint.png`、`windows-agent-empty.png`、`windows-agent-streaming.png`、`windows-agent-stream-completed.png`、`windows-agent-error.png` |

### 输入延迟基线

使用同一份长稿、1440×900 和 100% 应用缩放。每轮空闲与流式期间各输入 8 次，共 3 轮、每种条件 24 次。回环模型服务每 150 ms 返回一段内容。浏览器从 `beforeinput` 到下一帧回调计时，每次核对新文本已进入正文，最后按 Ctrl+S 后回读数据库。指标作为本机帧延迟基线，端到端按键呈现、真实服务波动和 IME 组合另行验收。

| 条件 | 中位数 | P95 | 最大值 |
| --- | ---: | ---: | ---: |
| Agent 空闲 | 4.7 ms | 6.3 ms | 6.5 ms |
| Agent 流式输出中 | 4.4 ms | 5.6 ms | 6.0 ms |

本机样本未显示稳定的延迟增量。U1/U2 应复用相同窗口、稿件和分段节奏核对正文实例和撤销状态。U5 在较长会话中重跑并检查无关区域的更新次数。

## 仍待验证

- Windows 系统级 DPI 100%/150%、原生窗口控件画面、macOS 交通灯及真实输入法组合，在 U1/U7 的相应设备验收。
- U1 正式接入等待适用范围的后端交接确认。[U1 施工与交互验收](44-v3-u1-workbench-plan.md)
