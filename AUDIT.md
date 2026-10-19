# UI 审查基线 — NovelForge

> 审查日期：2026-10-18
> 基线来源：用户提供的《A. 项目定位 / B. 设计约束 / C. 区域审查》规范（C2 模板）
> 方法：静态代码审查（文件:行号 为证据），**未做真机截图走查**；标注「未验证」的条目需真机确认。
> 结论口径：✅ 达标 / ⚠️ 部分达标或与规范存在设计取舍 / ❌ 缺失

## 结论摘要

- 底盘（令牌体系、组件收敛、五区布局、编辑器排版、版本 diff）**成熟度高于本规范假设**，不是「从零搭 UI」的项目。
- 真正的差距集中在四处：**浅色主题对比度不达 AA**、**无命令面板/快捷键体系**、**状态栏信息缺项**、**面板尺寸不记忆**。
- 规范中「单暗色 #0e0e10」与「≥44px 点击区」与本项目「四主题 + 桌面级信息密度」直接冲突，属于**规范与产品定位的冲突**，不应机械执行（按 E3 决策框架处理）。
- 达标率（按 C2 共 57 条逐条判定）：✅ 12 条、⚠️ 32 条、❌ 13 条。⚠️ 占比高，多数是「能力有、但不满足规范的字面细节」，不是功能缺失。

---

## 整体布局

- ✅ **五区完整** — `src/App.tsx:314-425`：左图标栏(44px) / 侧栏 / 编辑区 / 底栏 / 状态栏(28px)，另有右图标栏 + 右侧 AI 面板。
- ✅ **面板可折叠** — `src/App.tsx:134-143` `closeIfAtFloor` + `src/stores/layout-store.ts` `closeRegion`；拖到下限定格即关闭，可从图标栏重开。
- ✅ **面板可调宽** — `src/App.tsx:358-420` `react-resizable-panels`，含像素级内容下限（侧栏 176 / AI 232 / 底栏 88 / 编辑区 320）。
- ❌ **记忆偏好** — 尺寸归 `react-resizable-panels` 管（`layout-store.ts:29-32` 明确说明），但 `App.tsx:358` 的 `PanelGroup` **未设 `autoSaveId`**，store 也无 persist；每次启动回到 20/60/20，折叠态也不保留。**这是每日 4 小时工具最容易被感知的摩擦**。
- ⚠️ **状态栏常显五项** — 实际为：品牌版本 / 会话费用 / AI 任务胶囊 / 温度 / 模型 / 通知 / 缩放（`src/components/layout/StatusBar.tsx:29-73`）。
  - Agent ✅：`StatusBar.tsx:382-395`
  - 保存 ⚠️：只在编辑器头部 dirty 点（`src/components/panels/EditorArea.tsx:86-94`），状态栏无
  - 章节 ❌ / 字数 ❌：字数在编辑器头部（`EditorArea.tsx:78`），状态栏无
  - 分支 ❌：无分支概念
- ⚠️ **折叠后无空白** — 代码层为条件渲染，无占位残留；但 `padding: 3` 画布缝在极端组合下是否出现 3px 亮边，**未验证（需真机）**。

## Agent 交互

- ⚠️ **操作日志式非气泡** — 助手侧已是「正文段 + 工具批」交错时间线（`src/components/panels/agent/AgentMessage.tsx:282-310`）；但用户消息仍是右对齐气泡（`AgentMessage.tsx:245-259`，`rounded-lg` + accent 12% 底）。
- ⚠️ **工具调用显式** — 名称 + 参数 JSON + 结果/错误均有（`src/components/panels/agent/ToolCallBlock.tsx:76-101`）；**耗时不渲染**，而数据其实已存在（`src/stores/agent-store.ts:332,1173` `duration_ms`）。
- ❌ **计划步骤有序有状态** — Agent 侧无 plan/step 结构（`grep planStep|plannedSteps` 在 `agent/*` 与 `agent-store` 均为空）。`ProcessGroup` 只是工具批分组（`ProcessGroup.tsx:52-67`），工作流的步骤只存在于 `WorkflowProgressEntry`（另一条链路）。
- ⚠️ **引用可点击** — 输入侧 `@` 菜单存在（`AgentInputBox.tsx:102,303`；`MentionMenu.tsx`）；**消息流内的引用 chip 是否可跳转未验证**。
- ⚠️ **内联 diff 逐条确认** — 子 hunk 计数 + 全部接受/全部拒绝/完成/关闭（`src/components/editor/InlineAcceptBar.tsx:53-66`）；无「重写」，逐条能力依赖编辑器内单 hunk 交互（未验证）。
- ⚠️ **流式规则** — 无逐字打字机（`MarkdownContent` 分段流式）；但**思考展开后无高度上限**（`ThinkingCollapse.tsx:94-108`，无 `max-h` / `overflow`），长思考会把事件流顶开，直接违反「容器固定高 3 行滚动」。
- ⚠️ **状态编码三重** — 图标 + 颜色存在（`data-state` + `StateDot`/`DisclosureRow`）；文字标签是否每态齐全未逐一验证。
- ✅ **长任务滚动 + 跳到最新** — `AgentConversation.tsx:223,241-258,414-416`（`isAtBottom` + 浮动按钮）。

## 正文编辑器

- ✅ **宽度 720–800px** — 正文 `maxWidth: 800px`（`CodeMirrorEditor.tsx:612`）；专注模式容器 `max-w-[720px]`（`App.tsx:385`）。
- ⚠️ **字号 ≥17 / 行高 ≥1.7** — 行高 1.8 ✅（`CodeMirrorEditor.tsx:615`）；正文字号 **16px**（`:601`），差 1px。
- ✅ **专注模式** — `F11` 切换（`App.tsx:279-283`），隐藏两侧栏与图标栏（`App.tsx:350,361,407,424`）。
- ❌ **打字机滚动 / 段落焦点** — 全仓无 `typewriter` / 段落高亮实现（grep 为空）。
- ✅ **无行号/语法高亮/波浪线** — `lineNumbers: false`（`CodeMirrorEditor.tsx:852`）、`highlightActiveLine: false`（`:857`）。

## 章节/大纲

- ⚠️ **活页夹 卷→章→场景** — 结构存在（`sidebar/VolumeGroup.tsx`、`ManuscriptGroup.tsx`、`DraftBoxGroup.tsx`）；**无可拖拽排序**（`sidebar/*` 无 `draggable`/`onDragStart`）。
- ⚠️ **节点显字数状态** — 章节卡片有字数（`ArchFileViewer.tsx:268-274`）；侧栏树节点是否显字数未验证。
- ❌ **三视图（列表/卡片/大纲）** — 无视图切换（`grep viewMode|outline` 为空）。
- ❌ **多选** — 无多选实现。
- ⚠️ **双链 + 反向链接** — 仅角色维度有反向链接面板（`src/components/editor/CharacterBacklinks.tsx:17-104`）；章节/设定无。

## 世界观/时间线

- ⚠️ **实体唯一 ID** — 角色以**名字**为图节点键（`RelationshipGraph.tsx:167-175`），靠 `renameMap` 级联改名（`src/stores/character-store.test.ts:68-98`）；无跨实体统一 ID。
- ✅ **关系图可筛选/缩放/跳转** — 层级筛选 `RelationshipGraph.tsx:240-243`、缩放 `:179,252-264`、点击跳转 `:334`。
- ❌ **时间线多线并行** — 无 Timeline 组件（`grep -li timeline` 仅命中 Agent 消息与审计服务，无世界观时间线）。
- ✅ **反向链接面板** — `CharacterBacklinks.tsx`。
- ❌ **事件关联角色/地点/章节** — 无事件实体模型。

## 视觉与快捷键

- ⚠️ **暗色克制** — 实际暗色为 `#1E1E1E`/`#252526`（`index.css:490-492`），规范要求 `#0e0e10`/`#141416`；且项目是四主题（light/galaxy/paper/dark），不是单暗色。
- ❌ **AA 对比度 ≥4.5:1** — 浅色主题多项实测不达标：muted `#8A9AAB` on `#F7F9FC` **2.73**、on panel **2.57**、statusbar `#8994A7` **2.73**、accent `#5B9ED6` **2.73**、success `#10b981` **2.41**、warning `#f59e0b` **2.04**；暗色 accent `#0E639C` **2.61**、accent 上的正文 **4.31**（详情见附录）。
- ⚠️ **字号层级 11/12/13/14/17/22/28** — 实际主力是 10/11/12/14（`text-2xs` 113 处、`text-micro` 223、`text-xs` 371、`text-sm` 71），缺 13/17/22/28 档（`index.css:68-69`）。
- ⚠️ **动效 120–200ms** — `--transition-fast: 0.12s` ✅（`index.css:290`）；`normal 0.25s`、`spring 0.4s`（`:291-292`）与多处 `0.2s/0.3s` 超出区间。
- ❌ **Cmd+K 命令面板** — 无任何命令面板实现（`grep -i commandPalette` 为空）。
- ⚠️ **所有操作有快捷键** — 快捷键散落在 10 处 `addEventListener('keydown')`（`App.tsx:310`、`EditorArea.tsx:295`、`CodeMirrorEditor.tsx:530` 等），无注册表、无冲突检测、无 `?` 速查。
- ⚠️ **点击区 ≥44px** — Button 高 24/28/32，icon 28×28（`src/components/ui/Button.tsx:28-32`）。桌面 IDE 的合理密度，但与规范字面冲突（见冲突处理）。
- ⚠️ **Emoji 作图标** — Toast 内用 `✅`/`❌`（`App.tsx:252,255`）；语言切换用国旗 emoji（`SettingsModal.tsx:616`）。
- ⚠️ **颜色只用于强调** — 业务代码硬编码色 21 处，绝大多数在导出 HTML（`services/share-card.ts`、`yearly-report.ts`）属合理离屏渲染；界面层仅零星。
- ⚠️ **尺寸令牌单一来源** — `@theme` 里的 `--spacing-activity-bar: 48px` / `--spacing-statusbar: 24px` / `--spacing-sidebar: 260px`（`index.css:72-76`）**零引用**；实际值走 `--width-left-bar: 44px` / `--height-statusbar: 28px`（`:275-279`）。两套数值并存，注释还写着「22px/30px」。

## 版本与分支

- ⚠️ **自动快照 / 可命名** — 章节版本历史存在（`src/components/editor/VersionHistory.tsx`、`src/services/version-service.ts:32-86`），支持对比与回滚；**自动触发时机与「命名快照」未验证**。
- ✅ **diff 行级高亮** — `editor/DiffViewer.tsx`、`MonacoDiffViewer.tsx`、`ThreeWayMerge.tsx`。
- ✅ **可回滚 / 可对比任意版本** — `revertToVersion`（`version-service.ts:86`）+ `VersionHistory.tsx:88-109`。
- ❌ **分支实验** — 无章节分支模型；Agent 侧 `RewoundBranch` 只是对话回退（`services/agent/archive-codec.ts:166`），不是改写分支。
- ⚠️ **变更可追溯（谁/何时/改了什么）** — 有版本记录与时间；「谁」在单机写作场景无意义，未建模。

## 设置弹窗（D1 抽查）

- ⚠️ **尺寸** — 固定 `w-[880px] h-[600px]`（`SettingsModal.tsx:104`），规范要求 `min(90vw,960) × min(85vh,720)`；小窗口下不可自适应。
- ⚠️ **圆角** — `rounded-2xl` = 20px（`SettingsModal.tsx:104`），超出规范 6–10px 克制区间。
- ❌ **一级分类 ≤8** — 实际 10 个：llm / usage / embedding / proxy / editor / prompts / skills / mcp / dev / about（`SettingsModal.tsx:56-65`）。
- ⚠️ **左栏 200px 固定** — `w-52` = 208px（`:112`），差 8px；选中态为整行浅底而非「左 2px 强调条」。
- ⚠️ **内容区内边距/最大宽** — `px-6` = 24px（`:168`，规范 32）；各分区最大宽 480/600（`:467,595,709`），规范 640。
- ❌ **搜索** — 设置内无搜索框、无 Cmd+F（grep 为空）。
- ⚠️ **二级页不新开弹窗** — 分区本身在内容区切换 ✅；但模型候选走嵌套 Modal（`ModelCatalogEditor.tsx:450` → `ModelPickerDialog`），开发者指南同理（`DeveloperModeSection.tsx:317`）。
- ⚠️ **每项恢复默认** — 仅少数分区有（`ContextCompactionSection.tsx:120`、`ModelCatalogEditor`），非全局。
- ⚠️ **即时生效 vs 保存统一** — 未逐项验证。

## 元规则

- ✅ **优先信息密度** — 面板结构、工具批折叠、状态胶囊均服务密度。
- ⚠️ **优先快捷键** — 有零散快捷键，无体系、无发现入口。
- ⚠️ **优先长时舒适** — 行高 1.8、写作字体分离、专注模式到位；但 10px 文本 113 处 + 浅色低对比拖后腿。
- ❌ **状态常显** — 章节/字数/保存/分支未进状态栏，写作时需移开视线看编辑器头部。

## B1 质量基线逐项

- ⚠️ **8pt 间距网格** — 令牌为 4 基数（4/8/12/16/20/24/32/40/48/64，`src/tokens/spacing.ts:9-21`），非严格 8pt；但刻度自洽，不建议为字面合规重排间距。
- ⚠️ **字号层级 11/12/13/14/17/22/28** — 见「视觉与快捷键」。
- ⚠️ **字重 400/500/600** — 主体为 normal/medium/semibold（11/145/41 处），但仍有 15 处 `font-bold`(700) 用于标题与数字（`CharacterEditor.tsx:402`、`KnowledgeOverview.tsx:224,473`、`ActivityView.tsx:302`、`MarkdownContent.tsx:132` 等），破坏三级字重。
- ⚠️ **颜色只用于强调** — 语义色用于状态 ✅；但 accent 也承担品牌字（`StatusBar.tsx:46-47` `brand-gradient`），属品牌例外。
- ⚠️ **组件状态完整** — `Button/Input/Select/Switch` 具备 hover/focus/disabled（`ui/` 下统一）；`loading` 由 `Spinner` 单独承担，未内建到 Button；`error` 态依赖调用方传 `aria-invalid`（未逐一验证）。
- ⚠️ **动效 120–200ms** — 见「视觉与快捷键」。
- ❌ **可访问性 AA** — 见附录，浅色主题系统性不达标。
- ✅ **层次来自字重/字号/灰度** — 面板标题 11/600 muted、正文 14/400，符合。

## 规范冲突（按 E3 决策框架）

| 规范条目 | 项目现状 | 判定 | 处理 |
|---|---|---|---|
| B3「不引入 Zustand/Redux/MobX」 | 全仓 Zustand（`App.tsx:3` 起） | 历史遗留、改造成本极高 | **放宽约束**：视为既成事实，新代码沿用现有 store 范式，不新增状态库 |
| B2「单暗色 #0e0e10」 | 四主题（light/galaxy/paper/dark），暗色 #1E1E1E | 产品定位冲突：写作工具需要纸质浅色 | **选 B**：保留四主题；仅把「暗色要克制」作为原则，不追色值 |
| B1「点击区 ≥44px」 | 按钮 24–32px | 与桌面 IDE 信息密度直接冲突（Linear/Cursor 亦为 28px 级） | **显式放宽**：图标按钮保留 28px，但需保证 `hover` 命中区扩展与键盘可达 |
| B2「状态栏 24px / 活动栏 48px」 | 28px / 44px | 令牌里同时存在 48/24（死值）与 44/28（实值） | **选 B**：以实值为准，删除死令牌，不追规范数字 |

---

## Top 10 差距（按严重度）

| # | 现状 | 目标 | 影响 |
|---|------|------|------|
| 1 | 浅色主题 muted/statusbar/accent/success/warning 2.0–2.7:1（附录） | 全部 ≥4.5:1 | 每天 4 小时阅读疲劳、误读状态色 |
| 2 | 无 Cmd+K、无快捷键注册表（10 处零散 keydown） | 命令面板 + 单一注册表 + `?` 速查 | 高频操作全靠鼠标，效率上限被锁死 |
| 3 | 面板尺寸不持久（无 persist/autoSaveId） | 记住宽度/折叠态 | 每次启动重拖，最烦人的小摩擦 |
| 4 | 状态栏无章节/字数/保存/分支 | 五项常显 | 写作中视线反复离开正文 |
| 5 | 设置 10 分类、无搜索 | ≤8 分类 + 搜索覆盖二级页 | 找设置靠翻，且不可键盘直达 |
| 6 | 正文 16px、无打字机/段落焦点 | 17px + 打字机滚动 | 长文写作舒适度与定位感 |
| 7 | 思考展开无高度上限、工具无耗时、Agent 无计划步骤 | 固定高滚动 + 耗时 + plan | Agent 可读性/可信度打折（核心差异化） |
| 8 | 无三视图、侧栏不可拖拽、无时间线 | 三视图 + 拖拽 + 多线时间线 | 长篇结构管理能力缺口 |
| 9 | 尺寸令牌双源（48/24/260 死令牌 vs 44/28 实值） | 单一来源 | 后续改布局必踩坑 |
| 10 | 10px 文本 113 处 | 最小 11px | 可读性下限 |

## 不建议动的部分

- **四主题令牌架构**（`index.css:146-500` + `tokens/index.ts`）：派生式 `color-mix` 与语义令牌是资产，不要为对齐「单暗色」而推倒。
- **正文排版参数**（800px / 1.8 / 写作字体 / 无行号）：已符合规范，唯一待调是 16→17px。
- **版本 diff 三件套**（DiffViewer / MonacoDiffViewer / ThreeWayMerge）+ 回滚链路：达标，不要重写。
- **关系图的筛选/缩放/跳转**：达标。
- **五区布局与像素下限逻辑**（`App.tsx:44-143`）：注释里是踩坑换来的，改动风险高收益低。

## 建议执行顺序（对应规范 F）

1. 对比度修复（只改令牌值，波及面最大、风险最低）
2. 面板尺寸持久化（一个 `autoSaveId` 或 layout-store persist）
3. 命令面板 + 快捷键注册表（新增叶子组件，不动既有接口）
4. 状态栏补齐四项（只读 store，不改数据）
5. D1 设置弹窗（搜索 → 分类合并 → 尺寸自适应）
6. D2 Agent 输出（耗时、思考定高、计划步骤）
7. 真机走查（C3）验证 1–6

---

## 附录：对比度实测（WCAG 2.1）

| 主题 | 前景 / 背景 | 比值 | 判定 |
|------|-------------|------|------|
| light | `#1A2233` / `#F7F9FC` 正文 | 15.08 | ✅ |
| light | `#4A5568` / `#F7F9FC` 次要 | 7.14 | ✅ |
| light | `#8A9AAB` / `#F7F9FC` muted | 2.73 | ❌ |
| light | `#8A9AAB` / `#EFF2F7` muted on panel | 2.57 | ❌ |
| light | `#8994A7` / `#EFF2F7` 状态栏 | 2.73 | ❌ |
| light | `#5B9ED6` / `#F7F9FC` accent 文字 | 2.73 | ❌ |
| light | `#10b981` / `#F7F9FC` success | 2.41 | ❌ |
| light | `#f59e0b` / `#F7F9FC` warning | 2.04 | ❌ |
| dark | `#D4D4D4` / `#1E1E1E` 正文 | 11.25 | ✅ |
| dark | `#A0A0A0` / `#1E1E1E` 次要 | 6.38 | ✅ |
| dark | `#888888` / `#1E1E1E` muted | 4.70 | ✅ |
| dark | `#909090` / `#181818` 状态栏 | 5.56 | ✅ |
| dark | `#0E639C` / `#1E1E1E` accent 文字 | 2.61 | ❌ |
| dark | `#D4D4D4` / `#0E639C` accent 按钮文字 | 4.31 | ⚠️ 差 0.19 |
| galaxy | `#5A7A96` / `#0A1628` muted | 4.02 | ⚠️ 仅大字号 |
| paper | `#A89888` / `#F5F0E8` muted | 2.46 | ❌ |

> 复现方式：按 WCAG 相对亮度公式计算，脚本可复跑；浅色三档 muted 需整体压深约 12–18% 才能进 4.5。
