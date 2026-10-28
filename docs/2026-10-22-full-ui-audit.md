# NovelForge 全 UI 只读审查报告

> 日期：2026-10-22  
> 基线：2026-10-22 13:02 的工作区快照（当时 master 含未提交改动），版本 0.1.7-beta.3。审查完成后仓库切换到 `feat/dev-console`；`diff -rq` 确认 `src/` 与审查副本逐字节一致，仅新增非 UI 的 `electron/dev/`，故 UI 结论仍对应当前 src。  
> 范围：`src/components` 140 个非测试 TSX + 5 份 CSS（含 `src/index.css`、`src/styles/agent-tools.css`），约 3.8 万行；覆盖交互式与非交互式表面（页面、侧栏、编辑器、面板、对话框、设置、Agent 流、空/错/加载态、排版、颜色、主题、i18n）。  
> 方法：6 个只读分组审查（逐文件阅读）+ 8 份项目 UI 标准 + 以 `MCPSettings` 为参照样本 + 隔离实例真机冒烟（Playwright 驱动 Electron，CDP/DOM 量测与截图）。  
> 隔离实例：`/tmp/nf-ui-audit`（源码副本）、`/tmp/nf-ui-audit-home`（HOME）、`/tmp/nf-ui-audit-userdata`（Electron userData）、`/tmp/nf-audit-project`（测试项目）。审查过程未修改仓库内任何文件；本报告是唯一新增文件。  
> **文档状态：只读审查记录，未实施任何修复。** 所有 `文件:行号` 以审查时快照为准；后续代码变动后行号可能漂移。
>
> **2026-10-28 更新**：§6 批次 1 的 P0-2「审稿假通过」已修复——新增 `src/services/text-quality-guard.ts`（字数区间 + 循环重复确定性判定），接入 `book-pipeline-workflow` 写稿/自审/定稿三步与 `FinalizeChapterCommand` 定稿入口；其余批次仍未实施。

---

## 目录

- [0. 结论摘要](#0-结论摘要)
- [1. 审查方法与真机隔离](#1-审查方法与真机隔离)
- [2. 发现清单](#2-发现清单)
- [3. 真机冒烟记录（隔离实例）](#3-真机冒烟记录隔离实例)
- [4. 逐文件覆盖矩阵](#4-逐文件覆盖矩阵)
- [5. 标准与参照样本校正（重要）](#5-标准与参照样本校正重要)
- [6. 建议修复批次（未实施）](#6-建议修复批次未实施)
- [7. 未验证 / 挂起项](#7-未验证--挂起项)
- [8. 附：改动范围声明](#8-附改动范围声明)

---

## 0. 结论摘要

### 0.1 总体判断

- **底盘成熟**：四主题语义令牌、`color-mix` 派生 `--color-hover/--color-border`、组件收敛（Button/Input/Select/Toast/Confirm/EmptyState/MenuRow/HoverSwapIcon/StateDot/DisclosureRow）、i18n 三语 3941 key 零缺失、生产代码 `button button` 为 0、侧栏行片 32px 几何正确。
- **真正的风险不在“好不好看”**，而在四类：
  1. **功能性回归**：架构编辑器的 AI 生成入口失效、审稿解析失败显示“全部通过”、版本 diff 的“完成”是空操作、导出清空后反而导出全部。
  2. **模态/焦点/脏数据**：设置页 Esc 级联关闭、Tab 逃到背景、遮罩点击丢草稿；9 个表单弹窗可点遮罩关闭。
  3. **失败态不诚实**：大量列表把 `catch` 后的空数组渲染成“暂无数据”，用户不知道加载失败、也无法重试。
  4. **键盘与热区**：裸 `div/span onClick`、自定义 checkbox/radio、SVG 节点键盘不可达；图标按钮普遍 <32×32。
- **参照样本 MCP 本身有严重缺陷**：已连接/未连接状态文案反了；删除成功提示“服务器已添加”。它适合做“结构/错误态分层”的参照，不适合做交互质量基线。

### 0.2 数量（去重后）

| 级别 | 数量 | 说明 |
|---|---:|---|
| P0（功能失效/数据丢失/假成功） | 8 | 见 §2.1 |
| P1（明确违反标准且用户可感知） | 约 70 | 见 §2.2（部分为同一根因的跨区域影响面） |
| P2/P3（一致性、细节、潜在风险） | 150+ | 按主题归并见 §2.3，逐文件见 §4 |

> 计数为六组结果去重后的口径；同一问题在多个区域出现时只计一次，并在“影响面”中列出多个位置。

### 0.3 最需要先处理的 10 件事

1. 架构编辑器 AI 生成/角色提取入口完全消失（`detectStepKey` 不识别 `vela://core/*`）。
2. 审稿报告解析失败时显示绿色“全部通过”。
3. 版本 diff 点“完成”不写库，Tab 却关闭。
4. 导出弹窗“清空”后点导出 = 导出全部章节。
5. 设置页按 Esc 关闭 Select 时，把整个设置页一起关掉；且无脏数据守卫。
6. 设置页/命令面板/表单弹窗的焦点与背景管理缺口。
7. 裸 `div/span onClick`：编辑器标签页、状态栏费用/AI 胶囊、AI 输出步骤头、导出章节行等键盘不可达。
8. 失败被渲染成空态：角色/分卷/连载监控/知识库/日志/记忆/MCP/自动化/开发者模式等。
9. 图标按钮热区普遍不足 32×32；Tooltip 全局代理摘掉 `title` 却不补 `aria-label`。
10. MCP 参照样本的状态文案反转、删除提示错误。

---

## 1. 审查方法与真机隔离

### 1.1 静态审查

- 6 个分组：应用外壳/侧栏、设置页、编辑器/文档、Agent/AI 面板、其他面板/对话框/UI 原语、样式令牌/跨切面。
- 每个文件完整阅读；对关键结论做了源码复核（`detectStepKey`、`parseReport`、`applyMergedRevision`、导出分支、排序订阅、只读 AI 路径等）。
- 机械扫描：硬编码色、Tailwind 调色板类、`outline-none`、hover-only、`title` vs `aria-label`、图标尺寸、字号、`button button`、i18n key 完整性、`var()` 兜底、未定义令牌。

### 1.2 真机冒烟（隔离）

- 在 `/tmp/nf-ui-audit` 复制当前源码，`node_modules` 软链，生产模式 `vite build`。
- Electron 以独立 `HOME=/tmp/nf-ui-audit-home`、`XDG_CONFIG_HOME`、`--user-data-dir=/tmp/nf-ui-audit-userdata` 启动；项目创建在 `/tmp/nf-audit-project`。
- 用 Playwright `_electron` 驱动；DOM 量测 + `Page.captureScreenshot` 截图。
- 截图：`/tmp/nf-audit-scripts/01-welcome.png` … `18-arch-viewer.png`；原始量测日志：`/tmp/nf-audit-scripts/*.log`。

---

## 2. 发现清单

### 2.1 P0 — 功能失效 / 数据丢失 / 假成功

| ID | 位置 | 问题与证据 | 真机/复核 | 建议 |
|---|---|---|---|---|
| P0-1 | `editor/ArchFileViewer.tsx:41-47`；`panels/sidebar/ProjectTree.tsx:355` | `detectStepKey()` 只匹配 `*.md` 结尾；侧栏传入的是 `vela://core/${f.key}`，因此 `stepKey` 恒为 `null`。后果：`stepKey &&` 的 AI 生成按钮（`:328-343`）、角色提取（`:312-326`）、AI 确认弹窗全部不渲染；页面头退化为“架构文档”。 | **已复现**：打开“故事前提”，工具栏只有“架构文档”+刷新，无 AI 生成入口。 | 按 `vela://core/{key}` 的末段识别；补入口回归测试。 |
| P0-2 | `editor/ReviewReport.tsx:72-93`；`:346-350` | `parseReport()` 在 JSON 解析失败后回退文本解析；两者都失败时 `issues=[]`。渲染层把 `issues.length===0` 当作“全部通过”，显示绿色 `CheckCircle` + `review.allPassed`。 | 源码复核成立；未构造坏数据真机验证。 | 增加 `parseFailed` 状态，显示错误 + 原始文本 + 重试；不得把解析失败当通过。 |
| P0-3 | `editor/VersionHistory.tsx:99-106`；`panels/EditorArea.tsx:990-1006` | 版本 diff Tab 只传 `filePath`，没有 `chapterDir`/`revisionPath`；`applyMergedRevision` 的调用条件是 `chapterDir && filePath && revPath`，不满足时直接走 `finally` 关闭 Tab。 | 源码复核成立；用户看到“完成”动作但无写入。 | diff Tab 补齐章节上下文；缺失时禁用“完成”并说明原因。 |
| P0-4 | `dialogs/ChapterExportDialog.tsx:93`；`:180-188` | `chapterNumbers: selected.size > 0 ? [...selected] : undefined`；“清空”把 `selected` 置空。0 选时传 `undefined`，主进程语义是“全部章节”。 | 源码复核成立。 | 0 选时禁用导出，或显式传 `[]` 并提示“未选择章节”。 |
| P0-5 | `settings/SettingsModal.tsx:108`；`hooks/useEscapeKey.ts:19-25`；`SettingsModal.tsx:118-122` | `useEscapeKey` 挂在 window 冒泡阶段；设置页内打开 Radix Select 后按 Esc，Select 关闭但不阻断冒泡，设置页也执行 `onClose()`。同时遮罩点击直接关闭，设置页含供应商密钥/代理/并发/自动化等未保存草稿，无 dirty 守卫。 | **已复现**：设置 → 编辑器 → 打开 Select → Esc：`listbox=0, dialog=0`；新建项目表单输入后点遮罩，弹窗关闭且输入丢失。 | 建立 Esc 栈（子层优先消费）；设置页统一 dirty 守卫；表单类禁遮罩关闭。 |
| P0-6 | `panels/EditorArea.tsx:449-485`；`:490-503` | 编辑器标签页是裸 `div onClick` + `cursor-pointer`，无 `role`/`tabIndex`/键处理；dirty 标签的关闭入口是 `<span onClick>`，键盘完全不可达。 | 源码复核成立；侧栏/文档分组与外壳分组独立确认。 | 标签页改原生主按钮或形态 B 三件套；dirty 关闭统一 `<button>`。 |
| P0-7 | `editor/CodeMirrorEditor.tsx:626-631`；`:955-981` | 选区更新时无条件 `setBubbleOpen(true)`，未检查 `editable`；`handleAcceptAI` 也不检查 `editable`。`readOnly` 只阻止键盘输入，阻止不了程序化 `dispatch`。已定稿/归档稿件仍可出现 AI 动作并被改写。 | 源码复核成立；`DraftEditor.tsx:390` 确实传 `editable={!isReadonly && !isChapterBusy}`，但气泡层没有守卫。 | 打开气泡、执行 AI、`beginInlineSession`、保存四处都加 `editable` 守卫；只读态隐藏 AI 动作。 |
| P0-8 | `settings/MCPSettings.tsx:135-141`；`:109` | 状态文案反转：`connected` 返回 `t('mcp.connect')`（“连接/Connect”），`disconnected` 返回 `t('mcp.disconnect')`（“断开/Disconnect”）。删除成功后 `toast.success(t('mcp.added'))`（“服务器已添加”）。 | **已复现**：未连接 server 行显示“断开”，旁边动作按钮却是“连接”；删除确认后 toast 为“服务器已添加”。 | 新增 `mcp.statusConnected/statusDisconnected` 与 `mcp.removed` 三语 key；不能复活动作文案做状态文案。 |

### 2.2 P1 — 明确违反标准且用户可感知

#### A. 模态、焦点、背景与脏数据

| ID | 位置 | 问题 |
|---|---|---|
| P1-A1 | `settings/SettingsModal.tsx:116-130` | 自绘全屏模态只有 Esc + `role=dialog`/`aria-modal`；无焦点陷阱、无背景锁、关闭后焦点不归还。**真机**：打开设置后连续 Tab 25 次，焦点全在背景（`inDialog=false`）；Esc 关闭后 `activeElement` 为 BODY。 |
| P1-A2 | 9 个表单/配置弹窗 | 均未禁用遮罩关闭：`NewProjectDialog:56`、`ImportNovelDialog:120`、`ArchitectureConfirmDialog:157`、`AutoSplitDialog:74`、`VolumeDialog:113`、`ChapterCreationDialog:209`、`DirectoryConfigDialog:108`、`ChapterExportDialog:123`、`GenerateConfigDialog:140-144`。**真机**：新建项目输入后点遮罩，输入丢失。 |
| P1-A3 | `command-palette/CommandPalette.tsx:411-421` | 自绘模态无显式关闭出口（0 个关闭按钮）；Esc + 遮罩可关。Tab 在输入框内循环、背景滚动未观察到变化，但模态语义不完整。 |
| P1-A4 | `ui/ModalShell.tsx:52-69`；`ui/Confirm.tsx:90-104` | 无 `aria-labelledby`；无焦点陷阱/背景锁（已登记缺口）；确认框初始焦点落在危险确认按钮，误按 Enter 即执行；退场 200ms 内重复 Esc 可二次 resolve。 |
| P1-A5 | `settings/ModelPickerDialog.tsx:164`；`ModelRoutingTierDialog.tsx:83-84`；`editor/AIActionDialog.tsx:90`；`editor/DraftEditor.tsx:417-423`；`panels/EditorArea.tsx:953-971` | 多选/搜索/改稿表单可点遮罩关闭；两处合并弹窗同时 `preventDefault` 了 Esc 与遮罩，Esc 不可关（虽有 X/取消）。 |

#### B. 失败态诚实性（失败不得伪装成空/加载中/成功）

| ID | 位置 | 问题 |
|---|---|---|
| P1-B1 | `panels/sidebar/CharactersView.tsx:204-205` + `stores/character-store.ts:103-107` | 加载失败只 `renderLog` 并把 `characters=[]`，视图显示“暂无角色”。 |
| P1-B2 | `panels/sidebar/VolumeGroup.tsx:147-149` + `stores/volume-store.ts:73-76` | 同上，显示“暂无分卷”。 |
| P1-B3 | `panels/sidebar/PublicationGroup.tsx:36-40` | `catch {}` 空，失败显示“暂无平台章节”。 |
| P1-B4 | `pages/KnowledgeOverview.tsx:152-161`；`panels/KnowledgePanel.tsx:147-165,319-340` | 检索/列表失败只 `console.warn`，无错误态；首屏加载期直接渲染“还没有已入库章节”。 |
| P1-B5 | `panels/LogsView.tsx`；`dialogs/LogFileDialog.tsx:97-104` | 日志文件加载失败 `setEnvFiles([])`，显示“无日志文件”；筛选无结果与“从未有日志”共用空态。 |
| P1-B6 | `panels/agent/AgentMemoryView.tsx:32-34,149-152` | store 已有 `loadFailed`，视图不订阅；失败显示“暂无记忆”。 |
| P1-B7 | `panels/agent/AgentHeader.tsx:218-262`；`mcp-store.ts:44-46` | MCP 子视图忽略 `loading/error`，失败/加载中都显示“未配置 MCP”，与 MCPSettings 的错误+重试形成反差。 |
| P1-B8 | `settings/AutomationSection.tsx:72-74,109` | 加载失败只 `renderLog`，组件直接渲染“还没有自动化任务”。 |
| P1-B9 | `settings/DeveloperModeSection.tsx:44-65` | `config:get().catch(()=>{})` 完全静默；失败后显示默认值，保存会把真实配置覆盖为默认。 |
| P1-B10 | `ui/PostProcessStatusPanel.tsx:47-68` | 失败后 `loading` 仍为 true，组件 `return null`，加载失败表现为“没有后处理”。另 `new Date(...).toLocaleTimeString` 无 Invalid Date 保护，坏时间戳可抛 RangeError。 |
| P1-B11 | `settings/UsageStatsView.tsx:76,92,117,252` | `load` 与 `loadGlobal` 共用模块级 `loadSeq`；切页竞态可让 `loading` 永久为 true。 |
| P1-B12 | `settings/VectorConfigSection.tsx:255-280` | 候选模型加载失败无 error 分支，永久渲染 disabled“正在加载”。 |
| P1-B13 | `editor/ChapterCardEditor.tsx:114-118`；`WorldBuildingEditor.tsx:64-73`；`WorldTimelineView.tsx:51-65`；`ManuscriptBoard.tsx:57-67`；`DraftEditor.tsx:57-74`；`VersionHistory.tsx:64-77` | 蓝图/架构/时间线/看板/草稿元信息/版本列表加载失败均保持空数组或永真 loading，显示为空态。 |
| P1-B14 | `panels/automation/InboxPanel.tsx:17-31` | 无 loading/error；空态是裸文本而非 `EmptyState`。 |
| P1-B15 | `settings/ProviderRowList.tsx` + `llm-store.ts:198-226` | 模型/供应商加载失败只写日志、保持空数组，界面渲染“首次运行”虚线卡。 |
| P1-B16 | `settings/ProxySection`（`SettingsModal.tsx:517-531`） | `catch` 里 toast.error 后仍无条件 `setSaved(true)`，失败时按钮显示 ✓“已保存”。 |
| P1-B17 | `settings/PromptSettings.tsx:213-233` | 两个删除函数返回 `false` 仍显示“已恢复默认”，内存条目已删、文件可能残留。 |
| P1-B18 | `src/stores/agent-store.ts:326-331,1172-1179`；`electron/llm/openai-provider.ts`（流式 usage） | **真实模型补充冒烟**：Agent 3 次调用在 `llm_calls` 中 `prompt/completion/total` 全为 0，用量页显示“3 次调用 / 12.3s / 0 tokens / $0.00”。同一模型直连 `llm:generate` 返回 `usage.totalTokens=89`，说明不是模型不报 usage，而是流式路径未把 usage 写入记账。 |

#### C. 键盘可达性与语义

| ID | 位置 | 问题 |
|---|---|---|
| P1-C1 | `dialogs/ArchitectureConfirmDialog.tsx:225-266`；`DirectoryConfigDialog.tsx:336-352`；`editor/AIActionDialog.tsx:119-144` | 步骤勾选/范围单选/审稿维度用 `<label onClick>` + 自绘方块，无原生 input/role/tabIndex/键处理，Tab 完全够不到。 |
| P1-C2 | `dialogs/ChapterExportDialog.tsx:201-206` | 章节多选行是裸 `div onClick`，无 role/tabIndex/键处理。 |
| P1-C3 | `layout/StatusBar.tsx:326-335,376-450` | 会话费用重置、AI 任务胶囊共 4 处裸 `div onClick`，无键盘路径。 |
| P1-C4 | `panels/AIOutputPanel.tsx:377-389` | 步骤头是裸 `div onClick`，键盘无法展开历史步骤输出。 |
| P1-C5 | `editor/RelationshipGraph.tsx:325-335` | SVG 节点 `<circle>` 只有鼠标事件，无 `role`/`tabIndex`/键处理/可访问名。 |
| P1-C6 | `editor/WorldBuildingEditor.tsx:255-266`；`ChapterCardEditor.tsx:523-532`；`VersionHistory.tsx:286-295` | 架构卡/蓝图列表行/版本章节列表行均是裸 `div onClick`，键盘不可选。 |
| P1-C7 | `editor/ManuscriptBoard.tsx:395-406` | `role=button + tabIndex` 只处理 Enter，不处理 Space；双击打开无键盘等价。 |
| P1-C8 | `panels/agent/MentionMenu.tsx:37-63`；`SlashCommandMenu.tsx:41-69`；`AgentInputBox.tsx:189-201` | @ 提及与 `/` 菜单只注册 Esc，点外部不关闭；浮层可继续盖住窗口。 |
| P1-C9 | `ui/GlobalTitleTooltip.tsx:31-38,109-166` | 全局摘除 `title` 但不补 `aria-label`，且只监听 mouseover/mouseout；键盘聚焦不显示 Tooltip。全仓约 342 处 `title` vs 100 处 `aria-label`，大量图标按钮读屏无名。 |
| P1-C10 | `ui/Switch.tsx` 调用点：`VectorConfigSection:166,194,241,815`、`AutomationSection:120`、`SettingsModal:758,766`、`ContextCompactionSection:196` | 10 个 Switch 中 8 个无 `aria-label`/`aria-labelledby`；读屏只播报“开关，开/关”。 |
| P1-C11 | `settings/SettingsModal.tsx:688,712,723` | 语言/界面字体/写作字体三个 Select 触发器无 `aria-label`/`aria-labelledby`；**真机**实测 3/3 `aria=null`。 |
| P1-C12 | 设置页 34 处 `<Label>` 仅 4 处有 `htmlFor` | 自动化、代理、并发、ModelForm、MCP 添加表单等大量控件没有程序化标签。 |
| P1-C13 | `ui/Toast.tsx:79-88,179-191` | 容器无 `role=status`/`aria-live`；成功/失败不会被读屏播报；关闭钮约 20px 且无 aria-label。 |
| P1-C14 | `ui/ContextMenu.tsx:44-123` | 无 `role=menu/menuitem`、无方向键/Home/End、打开后不聚焦首项；`left/top` 只夹上限，贴左/上可能为负。 |
| P1-C15 | `ui/Spinner.tsx:22`；`ui/ProgressBar.tsx:27-42`；`ui/StateDot.tsx:45,89,113` | Spinner 无 role/aria-hidden；ProgressBar 有 progressbar 但无 label；StateDot 恒 `aria-hidden`，若为唯一状态指示则读屏无信息。 |
| P1-C16 | `ui/SegmentedControl.tsx:69-80`；`ui/Button.tsx:11` | 禁用项仍保留 `hover:` 类；禁用透明度 50%（标准约 30%）；Button 的 `disabled:pointer-events-none` 使 `cursor:not-allowed` 与解释性 tooltip 都不生效。 |

#### D. 破坏性操作与保存反馈

| ID | 位置 | 问题 |
|---|---|---|
| P1-D1 | `editor/WorldTimelineView.tsx:211-220,298-306` | 实体/事件删除点击即执行，无 confirm、无失败反馈。 |
| P1-D2 | `editor/VersionHistory.tsx:110-123,215-218,220-228` | 回退、快照恢复、分支归档均无确认；`revertToVersion` 返回 false 不提示；归档成功无 toast。 |
| P1-D3 | `settings/AutomationSection.tsx:133` | 删除任务直接 `void deleteTask()`，无 confirm、无 danger 样式。 |
| P1-D4 | `panels/AIOutputPanel.tsx:283-304` | “中止生成”直接 `cancelWorkflow()`，无确认，误点即中断整条工作流。 |
| P1-D5 | `settings/AutomationSection.tsx:84-88` | 保存只 `await saveTask` 后关卡；无 toast、无 renderLog、无 try/catch。 |
| P1-D6 | `editor/ChapterCardEditor.tsx:246-254,287` | 新建章节自动保存成功仍 `setDirty(true)`；删除成功只写英文日志、无 toast。 |
| P1-D7 | `panels/sidebar/VolumeGroup.tsx:81-108`；`PublicationGroup.tsx:56-61` | 删除卷/平台行无成功 toast/log；返回 false 不提示；自动划分部分失败仍弹 success。 |
| P1-D8 | `settings/SkillsSettings.tsx:68-76` | 删除失败分支不存在，IPC reject 也未捕获，用户看不到“没删掉”。 |
| P1-D9 | `editor/ArchFileViewer.tsx:150-167` | 手动刷新/工作流完成自动刷新直接覆盖内容并清 dirty；未保存修改无确认即丢失。 |
| P1-D10 | `settings/ProviderEditorCard.tsx:250-252,387` | 保存成功仅 sr-only 播报，无可见 toast；取消按钮有未保存密钥/地址草稿时直接关闭，无确认。 |
| P1-D11 | `panels/EditorArea.tsx:819-849` | 终稿/物理章节保存成功无 toast、无 renderLog；失败才有反馈。 |

#### E. 热区、可供性与布局

| ID | 位置 | 真实量测/问题 |
|---|---|---|
| P1-E1 | 全仓图标按钮 | 大量 <32×32：`Sidebar` 关闭 18×18；`ProjectTree` 刷新 28×28；`CharactersView` 工具条 24×24；`EditorArea` 标签关闭约 15×15、左右/更多 22×22、刷新/保存 24×22；`StatusBar` 缩放 16×24；`ProjectSquareList` 删除约 10×10、方块 30×30；`WelcomePage` 关闭约 18×18；`MCP/Skills` 删除 25×25；`AIOutputPanel` 关闭 20×20；`Dialog` 关闭 24×24；`PostProcessStatusPanel` 重试约 15×15；`Input` 数字步进 18px 宽（上下两枚小按钮）。 |
| P1-E2 | `panels/agent/AgentConversation.tsx:827,833-837,863-946` | 会话行容器有 `hover:bg`（含上下 padding 与右侧留白），但主按钮只覆盖标题区；悬停亮起、点击空白无响应。 |
| P1-E3 | `pages/KnowledgeOverview.tsx:406-430`；`panels/KnowledgePanel.tsx:309,449-493` | 搜索结果行/文档行有 hover 底色但无 onClick；“亮起却点不动”。 |
| P1-E4 | `editor/VersionHistory.tsx:406-410`；`WorldTimelineView.tsx:188-221` | 版本行/时间线行容器 hover，真正可点只有内部按钮，上下 padding 是死带。 |
| P1-E5 | `panels/sidebar/ProjectSquareList.tsx:158-163` | `EmptyState` 渲染在约 39px 宽的活动栏列中，“没有其他历史项目”逐字换行成竖排。**真机截图确认**。 |
| P1-E6 | `pages/WelcomePage.tsx:128-216` | 1440×900 首屏：内容滚动区 `scrollHeight 802 / clientHeight 622`，三张主入口卡只露出顶部；主行动被 Quick Start 卡重复且落到折叠线以下。 |
| P1-E7 | `editor/CodeMirrorEditor.tsx:1060-1068,675-684`；`InlineAcceptPopover.tsx:97-102` | AI 气泡/行内接受浮层 `position: fixed` 但无 flip/shift 夹取；靠右/靠底时出视口，接受按钮可能点不到。 |
| P1-E8 | `layout/StatusBarSegment.tsx:26-44` | 无 `onClick` 时仍渲染 `<button>`，纯展示段进入 Tab 顺序但无动作（假焦点停靠点）。 |
| P1-E9 | `panels/agent/ConfirmCard.tsx:96-112` | 窗口级 Enter 批准；焦点在 body/空白区时按 Enter 会直接批准；卡片出现时未把焦点移入。 |
| P1-E10 | `panels/agent/SubAgentConfirmCard.tsx:42-57` | 允许/拒绝约 19px 高，`text-white`，无键盘路径/初始聚焦。 |
| P1-E11 | `panels/agent/CompressedBatchCard.tsx:75-86,143-150` | 读原文无 catch，点击“展开”可能无反应；“移除该压缩”无确认。 |
| P1-E12 | `panels/agent/ArtifactCard.tsx:76-92` | 文件读取失败静默吞掉，仍打开空白 Tab。 |

#### F. i18n、文案与视觉一致性

| ID | 位置 | 问题 |
|---|---|---|
| P1-F1 | `dialogs/ChapterCreationDialog.tsx:262` | `placeholder="DEFAULT_WORDS_PER_CHAPTER"` 是字面量，用户会看到英文标识符。 |
| P1-F2 | `editor/CodeMirrorEditor.tsx:783-804` | CodeMirror 搜索/替换 phrases 全部映射英文（Find/Replace/Next…），zh/ru 界面仍是英文。 |
| P1-F3 | `editor/CodeMirrorEditor.tsx:915,921,923,939,941`；`DraftEditor.tsx:309,311,320`；`CharacterEditor.tsx:164,187`；`VersionHistory.tsx:146` | 用户可见错误串硬编码英文（`empty response`/`save failed`/`template data not found`/`snapshot-create failed`…），会透传到 toast。 |
| P1-F4 | `panels/agent/AgentHeader.tsx:73,251`；`SlashCommandMenu.tsx:112` | 面板标题硬编码 `Agent`；`{toolCount} tools` 硬编码英文；`Skill` 徽章硬编码。 |
| P1-F5 | `settings/MCPSettings.tsx:157,232`；`SkillsSettings.tsx:92`；`ProjectSquareList.tsx:203,246`；`ChapterExportDialog.tsx:211` | 主按钮/图标硬编码 `#fff`；属已登记的 on-fill 令牌缺口，但应按统一 `Button` 收口。 |
| P1-F6 | `editor/CodeMirrorEditor.tsx:189`；`VersionHistory.tsx:237`；`shared/draft-status.ts:31` | `text-purple-400`/`bg-purple-500/20`/`#a78bfa`：无紫色令牌，已登记为“不能顺手修”的产品决策。 |
| P1-F7 | `settings/VectorConfigSection.tsx:134-139` | `${modeInfo.color}10`（`var(--color-success)10`）不是合法颜色，工作模式横幅底色/边框实际不生效；`${modeInfo.color}40` 同理。 |
| P1-F8 | `editor/three-way-merge.css:77,93,133,169,177` | 硬编码 `rgba(100,116,139,.04)`、`rgba(128,128,128,.04)`、`color: white`；字体栈写死 Noto Serif/SimSun 而非 `var(--font-writing)`。 |
| P1-F9 | `ui/Dialog.tsx:20,25-27,46,54-56` | 内联 `boxShadow` 覆盖 `shadow-[var(--shadow-popover)]` 类；内联 `backdropFilter: blur(12px)` 覆盖遮罩类，令牌类成为死代码。 |
| P1-F10 | `editor/WorldBuildingEditor.tsx:310`；`ArchFileViewer.tsx:317`；`styles/agent-tools.css:143-149` | error→warning 渐变 + `text-white` + 位移动效；确认卡渐变底——违反“渐变只用于品牌与主按钮/禁模糊光晕”的装饰约束。 |

### 2.3 P2/P3 — 按主题归并

> 逐文件结论见 §4；以下是复现价值较高的主题项。

1. **字号/图标刻度漂移**：内联 `fontSize: 9/10.5/11/12/13` 与 CSS `0.65rem`(10.4px)/`0.75rem`(12px)/`0.85rem`(13.6px)/`0.9rem`(14.4px) 并存；图标 `size` 出现 6/7/8/15/28/32 等离群档，空态图标 28/32 未统一到 36。
2. **菜单行高**：`ui/MenuItem` 实际约 28px（`px-3 py-1.5` + 12px 行高），低于行片 32px 口径；`ContextMenu` 仍按 28px 估算，尚算准确，但圆角 14px 与其它菜单 10px 不一致。
3. **Settings 分区一致性**：MCP/Skills 在设置页头下重复渲染同名标题+操作栏；MCP 与开发者选项都用 `Plug` 图标；关于页用文本 `?` 占位。
4. **MCP 细节**：无 loading；推荐芯片覆盖已输入草稿；添加表单 placeholder-only；禁用添加钮 `opacity-40` 仍 `cursor-pointer`；`load()` 与初始 `useEffect` 两套加载逻辑。
5. **MCP/Skills 计数**：`opacity-50` + muted 双重淡化。
6. **Settings 主题卡**：四张预览条都用“当前主题”令牌渲染，四张完全相同；卡片内联底色覆盖 `hover:bg`。
7. **Settings 快捷键**：“全部恢复默认”无确认；录制按钮内联底色覆盖 hover。
8. **ModelRoutingTierDialog**：已选行固定 28px，内部 32px 按钮纵向溢出，相邻行热区约 2px 重叠。
9. **ModelCatalogEditor/ModelCatalogRow**：`key={index}`；ID/显示名仅 placeholder；`disabled:opacity-50`。
10. **ModelForm/ProviderEditorCard**：密钥眼睛按钮 18–20px；300K/600K/1M 快捷挡位约 17px 高；测试/保存禁用无原因 title。
11. **UsageStatsView**：图表无 `role=img`/摘要；热力格只有 title；`toLocaleString()` 跟随系统而非应用语言；`Promise.all` 让归档失败拖垮整个仪表盘；StatCard 标签缺 `min-w-0`。
12. **PromptSettings**：折叠头无 `aria-expanded`；保存结果条无 `aria-live`。
13. **VectorConfigSection**：range 无 `aria-label`/`aria-valuetext`/`accent-color`；下载/测试禁用无原因 title。
14. **DeveloperModeSection**：两个启用项用 16px 原生 checkbox + 兄弟 span，无 aria-label，与全设置页 Switch 语言不一致；测试无 try/finally，reject 后永久禁用。
15. **BottomPanel**：关闭钮 18px；渲染期 `console.log`；Continue 用 `var(--color-text)` 铺 accent 底；StateDot `aria-hidden` 且步骤行无文本状态。
16. **LogsView**：清空日志无确认；6 个 28px 图标钮仅 title；筛选空态与无日志混同。
17. **KnowledgePanel/KnowledgeOverview**：加载期直接渲染空列表；搜索中无 loading；summarize disabled 无禁用视觉。
18. **ActivityView**：刷新 20px；🌐 emoji 与 lucide 体系混用；热力图无 `role=img`/汇总文本。
19. **InboxPanel**：无 loading/error；空态裸文本。
20. **PostProcessStatusPanel**：失败隐藏；坏时间戳 RangeError；重试约 15px。
21. **Toast**：无 aria-live；关闭钮约 20px 无名称。
22. **ErrorBoundary**：`⚠️` emoji 32px；原始 `error.message + componentStack` 直出给用户；“重试”仅清 state，持久错误立即再次崩溃。
23. **EmptyState**：默认 `opacity: 0.3` 作用于图标+文字，空态文案对比度不足。
24. **MarkdownContent**：h1–h3/blockquote 渲染成 `div`，丢失语义；复制按钮约 18px 高、无成功反馈； ThinkingBlock 无 `aria-expanded`。
25. **Spinner/ProgressBar/StateDot**：ARIA 缺口（见 P1-C15）。
26. **Select**：Viewport 用 `h-[var(--radix-select-trigger-height)]`，需真机确认下拉是否只有一行高；`/NN` 透明度在 Tailwind 4.2.2 实测可用（标准旧说法已过时）。
27. **Input**：数字步进 18px 宽，上下两枚小按钮，`tabIndex=-1`，纯鼠标小目标；输入框本体 `h-7` = 28px。
28. **Switch**：实测 40×20（滑块 16，右缘距轨道 2px，无溢出）；高度低于 24px WCAG 2.5.8；滑块硬编码 `bg-white`。
29. **ContextMenu**：无 menu 角色/方向键/首项聚焦；圆角 14px。
30. **Dialog/Confirm**：关闭钮 24px；遮罩硬编码 `bg-black/30`；阴影内联覆盖令牌。
31. **StatusBarThinking/StatusBarUpdate/NotificationCenter**：基本达标；NotificationCenter 未读角标 9px；铃铛 32×24 为状态栏特例。
32. **ProjectSquareList**：30×30 方块、删除约 10px、硬编码白/金；空态竖排（P1-E5）。
33. **WelcomePage**：Logo `drop-shadow(0 0 40px …)` 模糊光晕；卡片 hover 由 `onMouseEnter/Leave` 内联 JS 驱动，无 `focus-visible` 等价；`grid-cols-3` 固定。
34. **CommandPalette**：内联字号 10.5/11/12/13 与 34px 行高；快捷键模式输入框 `aria-label` 与实际占位不一致。
35. **EditorToolbar**：右操作区 `flex-shrink-0`，320px 编辑区 + 8 控件必溢出；ru-RU 更甚。
36. **NovelConfigEditor**：无 dirty 指示/保存按钮常亮；字段说明仅 hover，键盘不可见；未配置模型只写日志。
37. **WorldBuildingEditor**：加载失败显示“待生成”；角色提取失败只 `console.error`；卡片裸 div。
38. **WorldTimelineView**：删除无确认；加载失败空态；行内死带。
39. **CharacterEditor/CharacterBacklinks**：保存 28px；关系删除 10px；模板加载失败空 catch；提示文字 `opacity-30`；📍/⚡ emoji。
40. **RelationshipGraph**：缩放/重置约 21px；图例 `slice(0,6)` 漏 neutral/other。
41. **ThreeWayMerge**：采用钮宽 26px 仅字形+title；contentEditable 无角色；完成无防重入；CSS 9.1px 字号/硬编码色。
42. **InlineAcceptBar**：`role=status` 内放按钮；accent 底用正文色。
43. **DraftEditor**：待合并/审稿读取失败静默；英文错误串；合并 Dialog 禁 Esc。
44. **ArchFileViewer**：保存按钮硬编码“保存”；刷新丢未保存；`placeholder/hideStatusBar` 死 prop。
45. **AIActionDialog**：审稿维度键盘不可选；表单可点遮罩关闭。
46. **ManuscriptBoard**：Space 未处理；打开按钮 `accent + var(--color-bg)` 深色主题对比度风险；空态图标 28/32。
47. **ReviewReport**：帮助钮 22px；修稿失败静默；解析失败假通过（P0-2）。
48. **DIFF/版本历史**：`window.prompt` 与全站 Dialog 不一致；版本行 hover 假可供性；无 loading。
49. **AgentHeader**：3 个 22×22 图标钮仅 title；MCP 状态只靠圆点颜色；`aria-haspopup/aria-expanded` 缺失。
50. **AgentMessage**：复制/赞/踩/分支/回退 title-only；22×22 尺寸为用户已裁决豁免（只补 aria-label）；末条 rewind 禁用 tooltip 待真机。
51. **AgentInputBox**：发送/停止 24×24，硬编码 `rgba(128,128,128,0.3)`；工具栏 21px `rounded-full` 与发送钮 4px 圆角语言不一致。
52. **AgentConversation**：流式自动滚动逐帧 smooth；会话行死带（P1-E2）；历史面板头无 `min-w-0`。
53. **AIOutputPanel**：历史列表把 paused/cancelled/running 都画红色 ×；`new Date(...).toLocaleTimeString` 无保护；`z-10` 硬编码；空态图标 20px。
54. **RunningStatus/TurnErrorRow/ToolCallBlock/WorkflowProgressEntry/PlanSteps/ProcessGroup**：内联 10.5–13px 字号；计时无 aria-live；失败态可能只靠红字。
55. **ThinkingCollapse/DisclosureRow/StateDot/TextShimmer**：DSH 形态已裁决；DisclosureRow 非整行点击分支热区仅 16px；TextShimmer 注释称 reduced-motion 降级但未实现（另一分组认为已实现，需真机确认）。
56. **CompressedBatchCard**：折叠态已显示摘要，点“展开”只显示原文，文案与行为不符；移除无确认。
57. **MCP 工具展示**：ToolCallBlock 只显示 `toolName`，无 server 徽章；用户无法判断是哪个 MCP server。
58. **模型清单可发现性（真实模型补充）**：设置页显示“已配置 7 个”，但 7 个模型名只能通过“点供应商行 → 编辑卡 → 自定义设置”才能看到；供应商行本身是编辑触发器，没有展开模型列表的直接入口。`ProviderEditorCard.tsx:319,357` 的注释确认模型目录被挂进“自定义设置”。
59. **模型菜单与 Tooltip 重叠（真实模型补充）**：点击模型选择器后，按钮的 `title` Tooltip 仍停留在新打开的菜单上，遮住菜单底部“管理模型…”项（截图 `24-model-menu-real.png`）。Tooltip 应在 click/菜单打开时隐藏。
60. **Agent 推理标记未折叠（真实模型补充）**：`qwen3.8-max` 实际输出以裸 `thinking` / `response` 文本分隔推理与回答；`AgentMessage.splitThinking` 只识别 ` thinking` 标签，因此推理内容以内联正文呈现，没有进入 `ThinkingCollapse`，也没有本地化标签。若换模型/提示词可复现，建议在系统提示中约束标签格式，或在 UI 兼容裸标记。
61. **CSS 死代码**：`index.css` 的 `.sash/.config-input/.bottom-tool-btn/.hover-lift/.hover-scale/.glow-border/.glass/.text-gradient/.smooth-scroll/.no-pointer` 与 `@theme` 的 `slide-in-*` 零消费；`novel-editor.css:1-62` 的 `.vela-editor-content/.ProseMirror` 零消费且 `outline:none !important` 无替代焦点。
62. **three-way-merge.css**：0.65rem=10.4px、0.75rem=12px、0.85rem=13.6px、0.9rem=14.4px；与 11/12 两档不一致。
63. **inline-accept.css**：`font-size: 12px`、`border-radius: 12px` 未走令牌（12px 不在圆角刻度）。
64. **`novel-editor.css`**：分隔条方向判定用 `aria-orientation` 正确；卡片贴边/圆角规则达标；编辑器内容区压掉焦点样式（仅靠光标）。
65. **i18n 正面结果**：3941 key，三语零缺失、零重复、零空值；3221 个字面量 `t()` 全部命中；主要残留是硬编码错误串/英文工具文案（见 P1-F1..F4）。
66. **颜色正面结果**：未定义 token 引用为 0；`--color-hover/--color-border` 四主题逐一同值且为 `color-mix` 派生；硬编码 UI 色仅 6 处组件内 hex（MCPSettings ×2、ProjectSquareList ×2、SkillsSettings、ChapterExportDialog）。
67. **结构正面结果**：生产代码 `button button` 为 0；侧栏 `menu-chip/tree-item` 32px；`MenuRow/HoverSwapIcon` 契约测试齐备；`InboxItemCard` 的“不渲染而非 disabled”保持良好。
68. **文档/标准过时项**：见 §5。
69. **通知中心弹层无显式关闭按钮**：`layout/NotificationCenter.tsx:139-156` 的 `NoticePanel` 声明 `role="dialog"`，头部只有标题与“全部已读”（未读时），没有 X/取消；空态时整个弹层 0 个按钮。关闭只靠 `useOutsideClick`（`:57`）与 `useEscapeKey`（`:58`）。按通用浮层“Esc + 外部点击”两项已达标，但作为 `role="dialog"` 且无可见出口，可发现性/可访问性偏弱。真机：点击状态栏铃铛后 `[role="dialog"]` 内 `buttons=[]`、`closeLike=0`。建议在头部补 32×32 X（`t('action.close')`），保留 Esc/外部点击。

---

## 3. 真机冒烟记录（隔离实例）

### 3.1 环境

| 项 | 值 |
|---|---|
| 源码副本 | `/tmp/nf-ui-audit` |
| HOME | `/tmp/nf-ui-audit-home` |
| Electron userData | `/tmp/nf-ui-audit-userdata` |
| 测试项目 | `/tmp/nf-audit-project/审计测试项目` |
| 版本 | 0.1.7-beta.3 |
| 窗口 | 1440×900，light 主题，zh-CN |

### 3.2 量测

| 对象 | 实测值 |
|---|---|
| 根字号 | **16px**（不是源码声明的 14px） |
| `text-2xs` / `text-micro` / `text-xs` | 11px / 11px / 12px |
| 设置弹窗 | 960×720；关闭钮 28×28；Select 触发器高 32 |
| Switch | 40×20；滑块 16×16；右缘距轨道 2px（无溢出） |
| 侧栏行片 | 32px；ProjectTree 刷新 28×28；面板头关闭 18×18 |
| MCP 删除钮 | 25×25 |
| 项目方块 | 30×30；删除钮约 10×10 |
| 状态栏缩放 | 16×23 |
| 欢迎页滚动区 | `scrollHeight 802 / clientHeight 622` |
| 命令面板 | 640×612；输入框 aria-label 存在；0 个关闭按钮；Tab 始终停在输入框；背景 scrollTop 不变 |

### 3.3 已复现的问题

| 问题 | 复现步骤 | 结果 |
|---|---|---|
| 设置页焦点逃逸 | 打开设置 → 连续 Tab 25 次 | 焦点全在背景，`inDialog=false` |
| 设置页 Esc 级联 | 设置 → 编辑器 → 打开 Select → Esc | `listbox=0` 且 `dialog=0`（整个设置被关） |
| 设置页关闭后焦点 | Esc 关闭设置 | `activeElement=BODY`，未回到设置按钮 |
| 设置页遮罩关闭 | 打开设置 → 点击遮罩 | 关闭，无脏数据确认 |
| 新建项目遮罩丢输入 | 输入名称/路径 → 点遮罩 | 弹窗关闭，输入丢失 |
| MCP 状态反转 | 添加一个未连接 server | 行内状态显示“断开”，旁边按钮“连接” |
| MCP 删除提示错误 | 删除 server → 确认 | toast 显示“服务器已添加” |
| 架构编辑器 AI 入口消失 | 打开“故事前提” | 工具栏只有“架构文档”+刷新，无 AI 生成/角色提取 |
| 欢迎页主行动折叠 | 1440×900 首次打开 | 三张主入口卡只露出顶部，需滚动 |
| 活动栏空态竖排 | 无历史项目 | 39px 列内“没有其他历史项目”逐字换行 |
| 通知弹层无关闭按钮 | 点击状态栏铃铛 | `[role="dialog"]` 内 `buttons=[]`、`closeLike=0`；只能 Esc/点外部关闭 |

### 3.4 真实模型补充冒烟（用户提供测试端点）

- 端点：用户提供的 OpenAI 兼容测试端点（地址从略），测试 key 仅写入隔离 HOME。
- 配置方式：官方 `llm:save-provider` 写入路径（凭据加密 + 派生模型），未手写明文配置文件。
- 已配置 7 个文本模型：`qwen3.8-max`、`qwen3.8-flash`、`qwen3.6-plus`、`deepseek-v4.1-flash`、`deepseek-v4-pro`、`kimi-k3`、`glm-5.3`。
- 连通性：`llm:test-connection` 成功；直连 `llm:generate` 成功（89 tokens）。
- Agent 真实对话：流式正常，Markdown 正常，工具 `read_project_state` 调用成功并显示 `7ms` 耗时。
- 模型选择菜单：7 个模型 + “管理模型…”正常展开，当前模型有勾选。
- 设置页模型卡：provider 行 592×32，编辑/删除按钮 32×32 且有 `aria-label`（正面）；“已配置 7 个”但不直接显示模型名（见 P2 58）。
- 用量页：3 次调用、活跃 12.3s，但 0 tokens / $0.00；`llm_calls` 三行 token 全 0（见 P1-B18）。
- 截图：`20-settings-models-real.png`、`21-agent-input-real.png`、`22-agent-streaming-real.png`、`23-agent-done-real.png`、`24-model-menu-real.png`、`27-toolcall-done.png`、`28-usage-real.png`、`29-models-expanded.png`。

### 3.5 截图索引（本地临时目录，未随仓库提交）

- `/tmp/nf-audit-scripts/01-welcome.png`
- `02-settings-llm.png`、`03-settings-mcp.png`
- `04-command-palette.png`
- `06-new-project-dialog.png`、`07-project-opened.png`
- `10-knowledge.png`、`11-characters.png`、`12-usage.png`
- `17-arch-expanded.png`、`18-arch-viewer.png`
- `38-notification-center.png`

---

## 4. 逐文件覆盖矩阵

> 状态：✅ 未发现需上报问题；⚠️ 有问题；⏸ 需真机/产品裁决。所有文件均已读取。

### 4.1 应用外壳、侧栏、布局、页面、命令面板

| 文件 | 状态 | 关键问题 |
|---|---|---|
| `App.tsx` | ⚠️ | 编辑区 `minSize="25%"` 百分比下限；跳过链接 `text-white`；命令面板入口 10.5px |
| `ErrorBoundary.tsx` | ⚠️ | emoji、原始堆栈直出、重试仅清 state |
| `panels/Sidebar.tsx` | ⚠️ | 关闭钮 18×18 |
| `panels/sidebar/ProjectTree.tsx` | ⚠️ | 刷新 28×28、仅 title；`refreshAll` 无 catch；卡片视图按钮仅 title |
| `sidebar/SidebarGroup.tsx` | ⚠️ | 折叠按钮仅 title |
| `sidebar/SidebarShared.tsx` | ⚠️ | `.tree-item` 右侧 8px 死带（已登记）；中文 fallback |
| `sidebar/HomeSidebarPanel.tsx` | ⚠️ | 删除按钮仅 title；IPC reject 未兜 |
| `sidebar/CharactersView.tsx` | ⚠️ | 工具条 24×24；加载失败伪装空态；`stopPropagation` 残骸；`·` meta |
| `sidebar/DraftBoxGroup.tsx` | ⚠️ | 打开/归档失败无反馈 |
| `sidebar/ManuscriptGroup.tsx` | ⚠️ | 标题读取失败静默；导出按钮仅 title |
| `sidebar/MemoryGroup.tsx` | ⚠️ | 读文件失败开空 Tab；图标按钮仅 title |
| `sidebar/VolumeGroup.tsx` | ⚠️ | 加载失败伪装空态；删除/自动划分反馈缺口；空态文案错位 |
| `sidebar/PublicationGroup.tsx` | ⚠️ | 加载失败静默；删除静默；表单遮罩可关 |
| `layout/LeftToolWindowBar.tsx` | ✅ | `.tool-btn` 高度 30 为已登记债 |
| `layout/RightToolWindowBar.tsx` | ⚠️ | 4 个图标按钮仅 title、高度 30 |
| `layout/StatusBar.tsx` | ⚠️ | 费用/AI 胶囊裸 div onClick；缩放 16×24 |
| `layout/StatusBarSegment.tsx` | ⚠️ | 纯展示段仍渲染 button |
| `layout/StatusBarThinking.tsx` | ✅ | Esc/外部点击/aria 完整 |
| `layout/StatusBarUpdate.tsx` | ✅ | 浮层关闭/错误/重试完整 |
| `layout/NotificationCenter.tsx` | ⚠️ | 未读角标 9px；铃铛 32×24（状态栏特例）；弹层无显式关闭按钮（仅 Esc + 外部点击） |
| `layout/ProjectSquareList.tsx` | ⚠️ | 删除约 10px；方块 30×30；硬编码白/金；空态竖排 |
| `pages/WelcomePage.tsx` | ⚠️ | 引导关闭 18px；品牌光晕；三列固定；主卡折叠 |
| `pages/KnowledgeOverview.tsx` | ⚠️ | 检索失败静默；结果行 hover 无点击；输入缺 label |
| `command-palette/CommandPalette.tsx` | ⚠️ | 无显式关闭；字号离群；返回项热区约 16px |
| `panels/EditorArea.tsx`（标签页） | ❌ | 标签页/dirty 关闭键盘不可达 |

### 4.2 设置页

| 文件 | 状态 | 关键问题 |
|---|---|---|
| `SettingsModal.tsx` | ❌ | 模态焦点/背景/脏数据/Esc 级联；关闭 28px 无 aria |
| `MCPSettings.tsx` | ❌ | 状态反转；删除提示错误；无 loading；删除 25px；表单无 label |
| `SkillsSettings.tsx` | ❌ | 删除失败静默；删除 25px；`#fff` |
| `ModelListSection.tsx` | ⚠️ | 加载失败无错误态；i18n 双空格 |
| `ProviderRowList.tsx` | ⚠️ | 加载失败=首次运行；焦点环被裁；删除无反馈 |
| `OrphanRows.tsx` | ⚠️ | 同上 |
| `ProviderEditorCard.tsx` | ⚠️ | 眼睛 20px；保存仅 sr-only；取消丢草稿 |
| `AddProviderCard.tsx` | ✅ | 两模式草稿保持、忙时锁切换 |
| `ModelCatalogEditor.tsx` | ⚠️ | `key={index}`；禁用 50% |
| `ModelCatalogRow.tsx` | ⚠️ | ID/显示名仅 placeholder |
| `ModelForm.tsx` | ⚠️ | fetch/test 无 catch；眼睛小；快捷挡位 17px |
| `ModelInputTypes.tsx` | ⚠️ | 复选框 16px；行高不足 20 |
| `ModelPickerDialog.tsx` | ⚠️ | 遮罩可关；错误+空态同屏；无重试 |
| `ModelRoutingTierDialog.tsx` | ⚠️ | 28px 行塞 32px 按钮，热区重叠；遮罩丢草稿 |
| `AutomationSection.tsx` | ❌ | 删除无确认；保存无反馈；加载失败=空；切换丢草稿 |
| `ContextCompactionSection.tsx` | ⚠️ | 保存反馈完整；加载失败无重试 |
| `DeveloperModeSection.tsx` | ❌ | 失败显示默认值可覆盖；测试卡死；checkbox 无标签 |
| `UsageStatsView.tsx` | ⚠️ | `loadSeq` 竞态；图表无 ARIA；数字语言 |
| `PromptSettings.tsx` | ⚠️ | 恢复默认忽略失败；折叠头无 aria-expanded |
| `VectorConfigSection.tsx` | ❌ | 状态横幅 CSS 无效；3 个 Switch 无标签；候选失败永久 Loading |
| `ShortcutsSection.tsx` | ⚠️ | 全部重置无确认；录制按钮 hover 失效 |
| `ThemeSection.tsx` | ⚠️ | 四张预览相同；hover 被内联底覆盖 |
| `CredentialDot.tsx` | ✅ | 三态语义清晰 |

### 4.3 编辑器与文档

| 文件 | 状态 | 关键问题 |
|---|---|---|
| `EditorArea.tsx` | ⚠️ | 标签页/关闭键盘不可达；diff 完成 no-op；只读页可被 AI 改写；保存成功无反馈 |
| `CodeMirrorEditor.tsx` | ⚠️ | 只读 AI 绕过；搜索面板英文；气泡越界；错误串英文；字数口径不一致 |
| `DraftEditor.tsx` | ⚠️ | 英文错误；合并弹窗禁 Esc；待合并/审稿失败静默 |
| `EditorToolbar.tsx` | ⚠️ | 窄区溢出；`#a78bfa` 状态色 |
| `ChapterCardEditor.tsx` | ⚠️ | 排序不生效；列表行键盘不可达；加载失败=空；新章仍 dirty |
| `NovelConfigEditor.tsx` | ⚠️ | 无脏状态；字段说明仅 hover；无模型只写日志 |
| `WorldBuildingEditor.tsx` | ⚠️ | 卡片裸 div；加载失败无错误态；提取失败静默 |
| `WorldTimelineView.tsx` | ⚠️ | 删除无确认；加载失败=空；行内死带 |
| `CharacterEditor.tsx` | ⚠️ | 保存 28px；关系删除 10px；模板失败静默 |
| `CharacterBacklinks.tsx` | ⚠️ | 低对比度；emoji 图标 |
| `RelationshipGraph.tsx` | ⚠️ | SVG 节点键盘不可达；缩放 21px；图例漏项 |
| `BlueprintSortBar.tsx` | ⚠️ | 方向钮 15.5px；模块级 `t` |
| `VersionHistory.tsx` | ⚠️ | 回退/恢复/归档无确认；版本行假可供性；`window.prompt` |
| `ThreeWayMerge.tsx` | ⚠️ | 采用 26px；contentEditable 无 role；无防重入 |
| `ReviewReport.tsx` | ❌ | 解析失败显示“全部通过”；帮助 22px；修稿失败静默 |
| `ManuscriptBoard.tsx` | ⚠️ | 加载失败=空；OutlineRow 缺 Space；对比度 |
| `ArchFileViewer.tsx` | ❌ | `stepKey` 恒 null（P0-1）；刷新丢未保存；硬编码“保存” |
| `AIActionDialog.tsx` | ⚠️ | 审稿维度键盘不可选；遮罩可关 |
| `InlineAcceptBar.tsx` | ⚠️ | `role=status` 内放按钮；accent 底用正文色 |
| `InlineAcceptPopover.tsx` | ⚠️ | fixed 无边界夹取；恢复钮过小 |
| `novel-editor.css` | ✅/⚠️ | 卡片/分隔条达标；前 62 行死样式 |
| `inline-accept.css` | ⚠️ | 固定 380px；12px 字面值 |
| `three-way-merge.css` | ⚠️ | 硬编码色/字体；9.1px 字号 |

### 4.4 Agent / AI 面板

| 文件 | 状态 | 关键问题 |
|---|---|---|
| `AIPanel.tsx` | ✅ | 容器职责清晰 |
| `AgentHeader.tsx` | ⚠️ | 22px 图标钮仅 title；MCP 子视图无 loading/error；状态仅圆点 |
| `AgentConversation.tsx` | ⚠️ | 会话行死带；流式 smooth 滚动；历史面板头溢出 |
| `AgentInputBox.tsx` | ⚠️ | @/斜杠菜单无外部关闭；发送 24px 硬编码灰；工具栏 21px |
| `AgentMessage.tsx` | ⚠️ | 操作钮 title-only；22px 尺寸已裁决豁免 |
| `AgentMemoryView.tsx` | ⚠️ | 忽略 `loadFailed`；刷新 22px |
| `ArtifactCard.tsx` | ⚠️ | 读失败开空 Tab；模块级 `t` |
| `CompressedBatchCard.tsx` | ⚠️ | 移除无确认；读原文无 catch；文案不符 |
| `ConfirmCard.tsx` | ⚠️ | 全局 Enter 批准风险；无初始聚焦 |
| `ContextBudgetBar.tsx` | ⚠️ | 触发 <20px；warning/success 当分类色；模块级 `t` |
| `FilePickerMenu.tsx` | ⚠️ | 搜索框 outline-none 无 focus-within |
| `MentionMenu.tsx` | ⚠️ | 仅 Esc，无外部关闭 |
| `PendingToolConfirmation.tsx` | ✅ | 薄包装 |
| `PlanSteps.tsx` | ⚠️ | 内联字号 |
| `ProcessGroup.tsx` | ⚠️ | DSH 24px 行；内联字号 |
| `ProgressLabel.tsx` | ✅ | 工具日志 `·` 允许 |
| `RunningStatus.tsx` | ⚠️ | 内联 11px；计时无 aria-live |
| `SlashCommandMenu.tsx` | ⚠️ | 仅 Esc；`Skill` 硬编码 |
| `SubAgentConfirmCard.tsx` | ⚠️ | 19px 按钮；`text-white`；无键盘/初始聚焦 |
| `SubAgentSessionCard.tsx` | ⚠️ | 取消 22px；error 文案 warning 色 |
| `ThinkingCollapse.tsx` | ✅ | DSH 形态、可划选、maxHeight |
| `ToolCallBlock.tsx` | ⚠️ | 10.5px；失败仅红摘要 |
| `TurnErrorRow.tsx` | ⚠️ | 内联字号 |
| `WorkflowProgressEntry.tsx` | ⚠️ | 展开行 24px；内联字号 |
| `AIOutputPanel.tsx` | ⚠️ | 步骤头裸 div；取消无确认；历史状态红 ×；关闭 20px |
| `agent-tools.css` | ⚠️ | 渐变确认卡；死规则 `!important` |

### 4.5 其他面板、对话框、UI 原语

| 文件 | 状态 | 关键问题 |
|---|---|---|
| 11 个 `dialogs/*` | ⚠️ | 9 个遮罩可关；ChapterExport 0 选导出全部；ChapterCreation placeholder 字面量；ArchitectureConfirm/DirectoryConfig 键盘不可选；LogFileDialog 失败=空 |
| `BottomPanel.tsx` | ⚠️ | 关闭 18px；渲染日志；Continue 对比度；状态 aria-hidden |
| `LogsView.tsx` | ⚠️ | 清空无确认；6 个 28px 图标钮；空态混同 |
| `KnowledgePanel.tsx` | ⚠️ | 加载/空混同；hover 假可供性；summarize disabled 无视觉 |
| `activity/ActivityView.tsx` | ⚠️ | 刷新 20px；emoji；热力图无 ARIA |
| `automation/InboxPanel.tsx` | ⚠️ | 无 loading/error；裸文本空态 |
| `automation/InboxItemCard.tsx` | ✅ | “不渲染而非 disabled”保持 |
| `ui/Badge.tsx` | ✅（白色 on-fill 债） | — |
| `ui/Button.tsx` | ⚠️ | icon 28×28（<32）；禁用 50% + pointer-events-none；尺寸注释在 16px 根字号下是准确的（旧标准按 14px 读法会误判） |
| `ui/Confirm.tsx` | ⚠️ | 初始焦点危险；无焦点陷阱（已登记）；二次 resolve |
| `ui/ContextMenu.tsx` | ⚠️ | 无 menu 角色/键盘；圆角 14px |
| `ui/CountBadge.tsx` | ✅ | — |
| `ui/Dialog.tsx` | ⚠️ | 内联阴影覆盖令牌；关闭 24px；遮罩 `bg-black/30` |
| `ui/DisclosureRow.tsx` | ⚠️ | 16px 前导（DSH 例外）；非整行分支热区小 |
| `ui/Disclosure.tsx` | ✅ | — |
| `ui/EditorPageHeader.tsx` | ✅ | — |
| `ui/EmptyState.tsx` | ⚠️ | opacity 0.3 压暗文字 |
| `ui/GlobalTitleTooltip.tsx` | ❌ | 摘 title 不补 aria-label；仅鼠标 |
| `ui/HoverSwapIcon.tsx` | ✅ | 双层交叉渐隐、键盘等价 |
| `ui/Input.tsx` | ⚠️ | 数字步进 18px 宽；输入框本体 `h-7` = 28px |
| `ui/Label.tsx` | ✅ | 调用方普遍未关联 for/id |
| `ui/MarkdownContent.tsx` | ⚠️ | 标题语义丢失；复制钮小无反馈 |
| `ui/MenuItem.tsx` | ⚠️ | 行高约 28px |
| `ui/MenuRow.tsx` | ✅ | 行片唯一实现 |
| `ui/MetricChip.tsx` | ✅ | — |
| `ui/ModalShell.tsx` | ⚠️ | 无 aria-labelledby；焦点陷阱/背景锁缺口 |
| `ui/PopoverSurface.tsx` | ✅ | 两种定位契约正确 |
| `ui/PostProcessStatusPanel.tsx` | ❌ | 失败隐藏；坏时间戳；重试小 |
| `ui/ProgressBar.tsx` | ⚠️ | 无 aria-label |
| `ui/SegmentedControl.tsx` | ⚠️ | 禁用仍 hover；50% |
| `ui/Select.tsx` | ⚠️ | Viewport 高度待真机；触发器高度 32 |
| `ui/Spinner.tsx` | ⚠️ | 无 role/aria-hidden |
| `ui/StateDot.tsx` | ⚠️ | 恒 aria-hidden |
| `ui/Switch.tsx` | ⚠️ | 40×20；8/10 无 aria-label；滑块 bg-white |
| `ui/Table.tsx` | ✅ | — |
| `ui/Textarea.tsx` | ⚠️ | 焦点环 1px 与 Input 2px 不一致 |
| `ui/TextShimmer.tsx` | ⚠️ | reduced-motion 注释与实现不一致（待真机） |
| `ui/ThinkingLevelSlider.tsx` | ⚠️ | 硬编码阴影；轨道 18px |
| `ui/Toast.tsx` | ❌ | 无 aria-live；关闭 20px 无名称 |

### 4.6 样式与跨切面

| 文件 | 状态 | 关键问题 |
|---|---|---|
| `src/index.css` | ⚠️ | `html 14px` 被 `html,body,#root{font-size:inherit}` 覆盖为 16px；禁用态 50%；死类 |
| `src/styles/agent-tools.css` | ⚠️ | 渐变确认卡；死 `.tool-call-*` 规则含 `!important` |
| `layout/StatusBar*.tsx` | ⚠️/✅ | 见 4.1 |
| i18n 字典 | ✅ | 3941 key，三语零缺失；残留硬编码错误串 |
| 颜色令牌 | ✅ | 未定义 token 0；硬编码 UI 色 6 处 |
| 图标/字号刻度 | ⚠️ | 15/28/32/8/7/6 离群；9/10.5/13px 内联 |

---

## 5. 标准与参照样本校正（重要）

> 本轮真机量测发现：**多份标准/注释的“14px 根字号”前提在当前运行时是错的**。不改代码，但后续修复必须按真实值判断。

### 5.1 根字号 16px，不是 14px

- `src/index.css:582-585` 声明 `html { font-size: 14px }`。
- `src/index.css:587-594` 随后声明 `html, body, #root { font-size: inherit }`。对 `html` 元素，`inherit` 回到初始值 **16px**，且该规则在后、同特异性胜出。
- CDP `CSS.getMatchedStylesForNode` 同时命中两条规则；`getComputedStyle(document.documentElement).fontSize === '16px'`。
- 实测：`text-2xs=11px`、`text-micro=11px`、`text-xs=12px`；`h-7/w-7=28px`、`h-6=24px`、`w-5/h-5=20px`、`w-10/h-5=40×20px`、Select 触发条 32px。
- 因此以下旧数字在当前运行时**不成立**：`Button size="icon"` 24.5px、`h-6` 21px、`w-5 h-5` 17.5px、Switch 35×17.5px、菜单行 21px。
- **不要**简单删除 `font-size: inherit` 或把 14px 修成生效：那会把 `--text-2xs/micro` 变成 9.625px，低于可读下限。应先拍板“根字号 16px”，再清理无效的 14px 声明与文档/注释。

### 5.2 `var()` + Tailwind `/NN` 可用

- `color-token-standard` 说“Tailwind `/NN` 不能套在 `var()` 上”。本项目 Tailwind 4.2.2 实测会生成 `color-mix(in oklab, var(--color-accent) 25%, transparent)`；`Select`/`CharactersView` 的 `/25`、`/20` 不是缺陷。
- 真正无效的是字符串拼接：`VectorConfigSection.tsx:134-139` 的 `${modeInfo.color}10` / `${modeInfo.color}40`。

### 5.3 `--color-bg-elevated` 已定义

- 旧文档说它“未定义、实际透明”。当前 `src/index.css` 四套主题均定义 `--color-bg-elevated: var(--color-panel)`（167/317/407/495 行）。相关引用不是缺陷。

### 5.4 `--text-2xs` 与 `--text-micro` 同为 11px 是刻意别名

- 注释明确：2026-10-18 把 10px 档抬到 11px，token 名保留作语义别名，避免改 113 处引用。
- 因此“两档没有层级差”是设计取舍，不是遗漏；若要分层需产品拍板。

### 5.5 MCPSettings 的定位

- **可参照**：分区头 + 计数 + 主按钮；推荐芯片填充表单；加载失败与空态分离；危险操作 `confirm(..., { danger: true })`；行是纯展示卡不伪装可点。
- **不可参照**：状态文案（P0-8）、删除提示（P0-8）、删除热区 25px、添加表单 placeholder-only、禁用添加钮仍 `cursor-pointer`、主按钮 `#fff`、无 loading、无 `renderLog`。
- 当前更接近标准的样板：`ProviderRowList`（32×32、aria、引用检查、先凭据后配置）、`ContextCompactionSection`（toast+renderLog）、`MenuRow`/`HoverSwapIcon`（行片与悬停置换）。

---

## 6. 建议修复批次（未实施）

1. **假成功/数据完整性**：P0-1..P0-8。先修架构编辑器入口、审稿假通过、版本 diff no-op、导出 0 选、MCP 文案、只读 AI、标签页键盘。
2. **模态与脏数据**：设置页 Esc 栈/焦点陷阱/焦点归还/dirty 守卫；9 个表单弹窗禁遮罩；命令面板与通知中心补显式关闭出口；ModalShell/Confirm 语义。
3. **失败态诚实性**：角色/分卷/连载/知识库/日志/记忆/MCP/自动化/开发者/后处理/版本/蓝图/时间线/看板/收件箱统一 loading/empty/error 三态，错误带重试。
4. **键盘可达**：裸 `div/span onClick`、自定义 checkbox/radio、SVG 节点、`role=button` 缺 Space、@/斜杠菜单外部关闭。
5. **可访问名与反馈**：`aria-label` 批处理（342 title vs 100 aria-label）、Switch/Select/Label 关联、Toast aria-live、GlobalTitleTooltip focus 触发。
6. **热区批处理**：单图标按钮 32×32（视觉图标不动，透明 padding/伪元素）；文字型 20×20；相邻中心距 40 或竖线分隔。
7. **视觉/令牌/i18n 清理**：硬编码 `#fff`/hex/渐变/模糊光晕、字号与图标离群档、死 CSS、英文错误串、10.5/9px 内联字号。
8. **文档/标准更新**：根字号 16px、真实控件尺寸、`/NN` 可用、`--color-bg-elevated` 已定义；避免后续按旧数字改错。

---

## 7. 未验证 / 挂起项

- `AgentMessage.tsx` 末条消息 rewind 的 `disabled` + 解释性 tooltip：需真机 hover 一次确认原生 title 是否在禁用控件上弹出（`Button` 的 `pointer-events-none` 已使同类解释不可达）。
- `TextShimmer` reduced-motion：两个分组结论不一致，需 DevTools 模拟 `prefers-reduced-motion: reduce` 真机确认。
- `Select` 的 `h-[var(--radix-select-trigger-height)]` 是否导致下拉只有一行高：需逐一打开 Select 量 `[role=listbox]` 高度。
- 四主题（light/galaxy/paper/dark）对比度：本轮只做 light 真机；`#fff` on accent 在 paper/galaxy 下需 WCAG 实算。
- ru-RU 窄宽溢出：需切俄语 + 320px 编辑区/264px AI 面板逐一量 `scrollWidth > clientWidth`。
- 表单遮罩关闭的 9 个弹窗只真机验证了 `NewProjectDialog`；其余为源码判定。
- `VersionHistory` 的 diff “完成” no-op 与 `ReviewReport` 假通过为源码复核，未构造真实数据端到端验证。
- `ArchFileViewer` 的 AI 入口消失已真机复现；工作流生成链路本身未跑（真实模型补充冒烟中，Agent 两次把“生成架构”误判成“写第几章”，未调用 `start_workflow`；这是模型工具遵循/意图问题，不是 UI 渲染问题，故未据此判定 UI 缺陷）。
- 真实模型补充：`qwen3.8-max` 的流式输出把推理写成裸 `thinking` / `response` 文本，未进入 `ThinkingCollapse`；是否为该模型特有仍需换模型复核。
- 架构确认弹窗（`ArchitectureConfirmDialog`）的键盘不可达为源码判定；本轮真机入口未找到（“世界观与时间线”打开的是时间线视图，非 WorldBuildingEditor），未做运行时复现。

---

## 8. 附：改动范围声明

- 除本报告文件外，未修改 `/home/yue/NovelForge` 内任何源码、配置、样式或测试。
- 所有真机操作只写入 `/tmp/nf-ui-audit-home`、`/tmp/nf-ui-audit-userdata`、`/tmp/nf-audit-project`。
- 如需按批次修复，请指定批次；我会先给出最小改动计划，再实施并跑 `typecheck` + `lint` + `test`。