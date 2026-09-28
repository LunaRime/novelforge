# UI 重构设计：行片化 + 卡片减重 + 悬停置换

> 2026-09-28 · 状态：待评审 · 依据：用户指令 + 四节设计逐节确认（本会话）

## 一、背景与目标

用户要求对程序 UI 进行**全应用重构**，两条特别说明经澄清后确定为：

1. **「项目结构」侧边栏菜单采取长方形圆角** → 菜单行做成**独立圆角矩形片**（行间留缝），分组卡片**去边框减重**、靠间距分组。
2. **悬停置换** → 默认显示**功能图标**，悬停时平滑换成**指示箭头**（跳转 `›`；原地展开 收起 `›`、展开后 `⌄`）。

用户明确：**这套风格成为长期基准**（"以后都采取这种风格"），后续如有补充另行提出。

**执行策略（已选）**：方案 A —— 样板先行（批 0 侧栏定型 + 提炼共享原语）→ 分批推广。**细粒度批次**（10 批）。

### 不变量（本次不动）

- 配色令牌、字号（13px 行 / `text-micro` 计数）、图标档位（ui-layout-standard 五档）
- 操作按钮**常驻**（不搞 hover 才显形——违反既有可达性标准）
- 信息架构、IPC、数据结构
- `typecheck` / `lint` / `test` 三门禁保持绿（样式断言随批次同步更新）

## 二、样板形态规格（批 0 · 侧边栏）

### 几何

| 项 | 规格 |
|---|---|
| 菜单行「片」 | 高 **32px**、圆角 **10px**（`--radius-lg`）、左右外边距 4px、片间距 2px、水平内边距 8px |
| 分组 | 去掉卡片边框与卡片底 → **纯间距分组**（组间距 ~10px）；组头同样是片 |
| 选中态 | `--color-active` 底 + 左 2px accent 竖线（沿用现有语言） |
| 悬停反馈 | 片底色 `--color-hover` + 图标置换；**去掉 `translateX(2px)` 位移**（片化后位移破坏"片"的整体感） |

**静止态**

```
  📖 小说配置             已完成
  📁 故事架构               4/4
  🗺 章节蓝图            50/5 章

  ▤ 分卷                  3 卷    ＋
  📝 草稿箱               11 章
  ✍ 正文章节              32 章    ⇪
```

**悬停态**（指到「故事架构」）

```
  📖 小说配置             已完成
▗▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▖
▐ ›  故事架构               4/4 ▌  ← 片底色亮起；📁 渐隐、› 渐现（≥100ms 交叉渐隐）
▝▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▘
  📝 草稿箱               11 章
```

### 悬停置换（关键交互）

> 2026-09-28 更新（用户拍板）：箭头语言**全侧栏统一 ›/⌄**——收起/折叠态 = `›`，展开态 = `⌄`；不再使用 `⌃`。下文中已按此更新。

- **默认态**：功能图标 + 标题 + 计数（界面干净）
- **悬停态**：功能图标**交叉渐隐**（≥100ms）为指示箭头
  - 跳转 / 滑出（纯导航卡）→ `›`
  - 原地展开（折叠卡）→ 收起态 `›`、已展开 `⌄`（与行语言同一套，方向随状态）
- **导航+折叠卡（双行为，如「故事架构」）**：左 chevron 独立按钮**常驻**（`›`/`⌄`，承担折叠 + 状态显示）；主按钮功能图标悬停置换为 `›`

  ```
  静止态：  │ ›  📖 故事架构        4/4 │
  悬停态：  │ ›  ›  故事架构        4/4 │
             ↑          ↑
            折叠按钮    主图标置换为「进入」（指示、不可单独点）
          （独立、常驻）
  ```

- **去掉导航卡右端常驻 `›`**（改由悬停置换承担，避免悬停时"左 `›` + 右 `›`"双箭头）
- **键盘等价**：`group-focus-within` 触发与 hover 完全相同的置换（既有可达性标准）
- **触摸端**（本仓当前无）：箭头必须常驻——记录为条件规则，不构成待办
- **`prefers-reduced-motion`**：降级为瞬时切换

### 32×32 命中区（并入批 0）

- 落实挂起迁移：单图标按钮热区 **≥32×32**（视觉图标不变，热区占满片高）
- 标准 §5.3 的差距登记从批 0 起**按批核销**

## 三、组件与接口

1. **`HoverSwapIcon`**（新，`src/components/ui/HoverSwapIcon.tsx`）
   - 职责：功能图标 ↔ 指示箭头的交叉渐隐置换
   - Props：`icon: ReactNode`、`swap: 'nav' | 'expand'`、`expanded?: boolean`（展开方向用）、`size?: number`（默认 12）
   - 实现：固定尺寸 `relative` 容器 + 两图层 `opacity` 交叉渐隐；`transition ≥100ms`；**纯 CSS 触发**（父级 `group-hover` + `group-focus-within`），不用 JS hover state（无闪烁、键盘等价天然成立）；`prefers-reduced-motion` 降级为瞬时
2. **`MenuRow`**（新，`src/components/ui/MenuRow.tsx`）
   - 职责：**行片的唯一实现** —— 外层片（挂 `menu-chip`）+ `flex-1` 主按钮（HoverSwapIcon + 标题 + 计数）+ 兄弟 `actions`
   - 变体（props 表达）：导航 / 折叠 / 导航+折叠（`leadingButton` 槽）/ 纯展示
   - 沿用现有 `SidebarGroup` 的公开语义：`onPrimary`、`onToggle`、`leadingButton`、`actions`、`count`、`active`、`titleHint`、`onContextMenu`
   - **DOM 契约**：`button button` 恒为 0；主按钮可聚焦；点击外层不触发主行为
3. **`menu-chip`**（`index.css` 样式类）
   - 只负责几何与悬停底色；**热区 = 片本身**；其他区域将来可脱离 MenuRow 单独复用

## 四、迁移（批 0 范围）

- **`SidebarGroup`**：公开 props 不变（全部调用点零改动），内部改为渲染 `MenuRow`
- **`.tree-item`**（`index.css`）：改片形态（26→32 高、4→10 圆角、去位移）——波及面已核实：仅 `panels/sidebar/**` 5 个文件使用
- **测试同步**：`SidebarGroup.test.tsx` 的 22px 断言 → 32px；结构断言（按钮数 / 可聚焦 / 零嵌套）全部保留；**新增置换断言**（`group-hover` + `group-focus-within` 双类都在、箭头方向随折叠状态）

## 五、标准与记忆同步

- **`card-affordance-standard`**：§1 契约表（右端 `>` → 悬停置换 `›`；导航+折叠卡细则）；新增「行片形态」小节（`menu-chip` 几何 + `MenuRow` 为唯一实现）；§5.2/§5.3（32×32 从批 0 起核销）；§7.1、§8/§8.1 现状重写
- **`ui-interaction-standard`**：§3.1 悬停置换（"本仓尚无实现" → 已实现，范式 = `HoverSwapIcon`）；§3.2/§5 热区现状更新
- **`ui-layout-standard`**：行片圆角 = `--radius-lg`(10px)、行高 32 密度档位（与既有 §10 冲突处一并修订）
- **`color-token-guard` 守卫**（2026-09-28 走查修复）：新增「悬停底色守卫」describe —— `--color-hover` 派生式形态 + 四主题逐一同值 + 实算可见性阈值（单层/嵌套 ≥ ΔL\* 3.0）
- **`color-token-standard` / `ui-interaction-standard` / `card-affordance-standard`**（同上）：`--color-hover` 相对叠加语义入库；嵌套层自动分档（片内按钮勿再单独定义嵌套令牌/固定色）
- **记忆**：「以后都采取这种风格」记为长期偏好 + 样板规格摘要
- 技能在 `.agents/`（gitignore）不进仓库；标准随各代码批次同步更新

## 六、批次计划（细粒度，共 10 批）

| 批 | 范围 |
|---|---|
| **0** | 样板：`panels/sidebar/**`（行片化 + 卡片减重 + 悬停置换 + 32×32 + 三个共享件） |
| 1 | AI 面板 · 会话列表族（`AgentConversation` 会话行与工具条、`AgentHeader`） |
| 2 | AI 面板 · 消息卡族（`AgentMessage`、`ThinkingCollapse`、`CompressedBatchCard`、`ToolCallBlock`） |
| 3 | AI 面板 · 产物与任务族（`ArtifactCard`、`SubAgentSessionCard`、`SubAgentConfirmCard`、任务面板行）+ 收件箱（`automation`） |
| 4 | 底部面板（历史行 / 运行条 / 步骤行） |
| 5 | 编辑器区（标签页条、编辑器内的列表/行） |
| 6 | 布局框架（`ActivityBar` / `ToolWindowBar` / `StatusBar` / `TitleBar` 的按钮与列表） |
| 7 | 设置页（模型 / 供应商等列表） |
| 8 | 知识库面板 + 欢迎页 |
| 9 | 弹窗族（`dialogs/**`、`ui/Dialog`、`ui/ModalShell`、`ui/Confirm` 内部的行/列表） |

每批 = 独立提交 + 三门禁全绿 + 标准与记忆同步。

## 七、验证策略

- 每批跑 `pnpm run typecheck` / `pnpm run lint` / `pnpm run test`；样式断言在批次内同步更新
- **契约断言保持**：`button button = 0`、主按钮可聚焦、点击外层不触发主行为
- **新增置换断言**：`group-hover` 与 `group-focus-within` 两个类都在；箭头方向随折叠状态
- 标准 §5.3 的 32×32 差距**按批次逐步核销**（批 0 关闭侧栏站点）
- **真机走查**：按既有 computer-use 约束走（用户另立测试文档；未被要求不做）

## 八、风险与开放项

- 过渡期各区域形态不一致（可接受，按批收敛；批 9 前弹窗内仍是旧形态）
- `.tree-item` 的语义迁移需在批 0 一并更新其注释与相关文档引用
- 若 32px 行高在真机观感上过挤（待用户后续真机确认），备选回退：伪元素扩热区 + 视觉 22px —— 仅在观感不可接受时再讨论
- `MenuRow` 是"行片唯一实现"：后续批次若发现无法覆盖的形态，应先扩展 MenuRow，而不是就地另写一套（同场景一致性）

### 批 0 走查反馈（2026-09-28 用户提出 · **同日已修复**）

> ⚠️ 修复放开了 §九「不改**配色令牌**」非目标——限 `--color-hover` 一处，§九 已按例外记档。编号 FB-x 可持续追加。

| # | 现象 | 根因（已定位到令牌，非猜测） | 影响面 |
|---|---|---|---|
| **FB-1** | **浅色主题下，部分 UI 菜单的悬停底色变化不明显** | `src/index.css:163` 浅色 `--color-hover: #EBF0F7` 与它常驻的表面 `--color-sidebar`/`--color-panel` `#EFF2F7`（`index.css:151-152`）几乎同色：**对比度 ≈ 1.02:1**（RGB 差仅 −4/−2/0），肉眼近乎不可察。对照：同一令牌在 `.dark` 下是 `#2A2D2E` on `#252526` ≈ **1.10:1**——深色底上同样的相对差更易辨识，这解释了"为什么只有浅色难看出来"。`.paper` 同病（`#E8E3DB` on `#EDE8E0` ≈ 1.05:1） | 全仓 **182 处** `--color-hover` 引用：`.menu-chip`/`.tree-item`（`index.css:727-730`）、`.icon-btn`（`:763`）、`Button` ghost/outline（`Button.tsx:22,24`）+ 58 处组件内联 `hover:bg-[var(--color-hover)]`（侧栏 5 个分组文件全中） |
| **FB-2** | **行片内嵌套的图标按钮，悬停与「上面（所在行）」一样**——悬停时图标自身底色与所在行底色**完全相同**，看不出这一层被单独悬停 | **同一个令牌被复用在嵌套的两层**：行片 `.menu-chip:where(button,:has(button)):hover`（`index.css:727-730`）与行内图标按钮的 `hover:bg-[var(--color-hover)]`（`SidebarGroup.tsx:66`、`VolumeGroup.tsx:123/133/255/264`、`MemoryGroup.tsx:74/91/233/242`、`PublicationGroup.tsx:94`、`ManuscriptGroup.tsx:173/236`）取的是**同一个 `--color-hover`**；悬停图标时行（`:has(button)` 命中）与图标同时变色且同色 → 净视觉变化为零，仅剩 `color` 变深与 `.icon-btn` 的 `scale(1.1)` 兜底 | 批 0 侧栏全部 32×32 图标按钮；后续批次凡是"行内有按钮"的场景都会照抄此形态（批 1-9 前需定案） |

**修法候选（三选一或组合；拍板前的备选清单，保留备查）**：

| 候选 | 做法 | 代价 |
|---|---|---|
| A · 只调浅色令牌值 | 改 `index.css` 浅色/纸色 `--color-hover`，使其对 `--color-sidebar`/`--color-panel` 有可辨差异（如向 `--color-active` `#DDE3ED` 一档靠） | 改动最小、一处生效 182 点；但**解决不了 FB-2**（两层仍同色） |
| B · 补一层级令牌 | 外层仍用 `--color-hover`，**新增「嵌套/次级 hover」令牌**（更深或带回退，如 `rgba()` 叠加）专供行内图标按钮 | 根治 FB-2、语义清晰；需新增令牌并改 12+ 处图标按钮与本文件 §五「标准与记忆同步」 |
| C · 不动令牌 | 让嵌套层改用**非底色**反馈（描边/加深文字/加图标权重） | 零令牌风险；但破坏了「状态面必须有 hover 底色」的既有口径（`ui-interaction-standard` §3.2），需同步改标准 |

**验证方式**：改完取 `getComputedStyle` 实算对比度（本表两个数就是算出来的），阈值建议 ≥1.2:1 才算"看得见"；真机走查按既有 computer-use 约束另立文档。

### 终选方案 —— 「相对叠加」（2026-09-28 拍板并实施）

`--color-hover` 从固定 hex 改为**派生式**（四套主题逐一同值，`src/index.css`）：

```css
--color-hover: color-mix(in srgb, var(--color-text) 5%, transparent);
```

**语义**：悬停底色不再是"某个固定浅色"，而是"**相对当前表面**加深/提亮的一层"——浅色/纸色主题 `--color-text` 深 → 加深；星空/深色浅 → 提亮，方向自动正确（`var` 按当前主题惰性求值）。契合本仓既有颜色纪律（`inline-accept.css` / `three-way-merge.css` 的 `color-mix(变量, transparent)` 约定）。

**为什么优于 A/B/C（实测数据，非纸面论证）**：

| 维度 | 旧值（固定 hex） | 相对叠加（5%） |
|---|---|---|
| 浅色 hover 对 sidebar/panel | **ΔL\* 0.79**（不可辨，FB-1） | **3.57**（达 VS Code 官方 `list.hover` 基线 ≈ 3.5） |
| 纸色 | ΔL\* 1.76 | 3.52 |
| 星空 / 深色 | 4.87 / 3.50（本就达标） | 4.87 / 4.26（保持） |
| 活动条面（A 候选的坑） | — | 四主题 3.2~5.2 全达标（A 的 hex 候选实测对活动条面只差 0.08~0.43） |
| 嵌套按钮（FB-2） | 与行同色（净变化 0） | **自动叠出第二层**：净变化 ΔL\* 3.2~4.6，**13 处按钮零代码改动** |
| 与 `--color-active` 的分离（浅色） | 4.55 | 1.77（与 VS Code 深色梯度 1.56 同构） |

**关键机制**：FB-2 由同一条令牌自动覆盖两级 —— 行片底色 = 面 + 5%；片内按钮（同一令牌）叠在已点亮的行片上 ≈ 面 + 9.75%，天然分档。A/B/C 三个候选都需要"第二处改动"（第二令牌 / 13 处类名 / 改标准），相对叠加不需要。

**代价（已记录）**：12+ 处把 `--color-hover` 当**静态底色**借用的地方（`ErrorBoundary`、`DiffViewer`、`CharacterEditor`、`MCPSettings` 等）从"固定浅色"变为"相对色"——多数观感近似；编辑区白底上的块会略变淡（ΔL\* 5.39 → 3.8，仍高于基线），待真机确认。

**验证（已执行）**：
- **守卫测试**（`src/shared/color-token-guard.test.ts`「悬停底色守卫」）：① 四主题逐一同值 + 派生式形态；② 实算——单层 ≥ ΔL\* 3.0、嵌套第二层 ≥ ΔL\* 3.0（四主题全过）
- **实算标尺**：CIELAB ΔL\*（感知均匀亮度差），基线取 VS Code 官方 `list.hover`（深色 `#2A2D2E` on `#252526` ≈ ΔL\* 3.5）
- **产物同步**：`pnpm run gen:tokens`（`src/tokens/index.ts` 无消费者；本次一并归位了滞留多日的其它令牌漂移）
- **待办**：修复后真机复走查（按既有 computer-use 约束另立文档）

### 后续走查：边界线整体加强（2026-09-28 当日实施）

用户走查："项目内有些边界线不够明显"（含方块区改造新做的两条横线）。实算定位**四个死点**：
浅色/纸色的活动栏面 ΔL\* 2.1/1.9、深色/星空的画布面 0.90/2.90（深色固定值 `#3C3C3C` 与画布 `#3A3A3A` 几乎同色）。
按与 `--color-hover` 同族的**相对叠加**修复：

```css
--color-border: color-mix(in srgb, var(--color-text) 10%, transparent);  /* 四主题逐一同值，用户拍板 10% 档 */
```

修复后四主题 × 五常驻表面（活动栏/侧栏/面板/画布/编辑区）收敛到 **ΔL\* 6.4~10.5**（现状跨度 0.90~14.05）；
`--color-border` 262 处引用已核实全部是画线用途。守卫 = `color-token-guard.test.ts`「边框可见性守卫」。
`--color-card-edge`（编辑区专用、深一档）维持原值未动。

## 九、非目标

- 不改信息架构、字号与图标档位
- 配色令牌**原则上不动**；**走查例外已用两次**（均 2026-09-28 当日）—— `--color-hover`（FB-1/FB-2）与 `--color-border`（边界线加强），都改为「相对叠加」派生式（见 §八）
- 不做功能变更；不引入新依赖
- 不在本设计范围内安排真机测试（另立文档）

## 附录 A：共享底座与形态分裂点（2026-09-28 只读盘点）

**共享底座**
- 样式源头：`src/index.css` 的 `@layer components`（`.tree-item` / `.icon-btn` / `.tool-btn` / `.bottom-tool-btn` / `.panel-header` / `.floating-menu`）；`src/styles/agent-tools.css`；`src/components/editor/novel-editor.css`；`three-way-merge.css` / `inline-accept.css`
- 共享组件（`src/components/ui/`）：`Button`（cva；`size="icon"` 实为 `h-7 w-7`=24.5px）、`MenuItem`、`ContextMenu`、`PopoverSurface`、`Dialog` / `ModalShell` / `Confirm`、`Badge`、`SegmentedControl`、`Disclosure`、`Table`、`EmptyState`、`Switch`、`Input/Select/ProgressBar/Toast` 等

**形态分裂点（批次 1–9 的收敛目标——各批次顺手收敛其范围内的分裂）**

1. 卡片外壳三种写法：`SidebarGroup` / 各组件自建 `rounded-xl border p-2.5` / `ui/Dialog`
2. 行 hover 三套实现：Tailwind `hover:bg-` 类 / `onMouseEnter` 手改 style（WelcomePage 最近项目行、EditorArea 标签、AIOutputPanel HistoryList、StatusBar 缩放钮）/ 容器 `group` 高亮
3. 选中态三种：`.tree-item.active` 左竖线 / `bg-[var(--color-active)]` / `bg-[var(--color-accent)] text-white`（SettingsModal 导航）
4. 折叠箭头 6 处不同尺寸（10/11/12/13/14px）且左右位置不一
5. 行分隔手段混用：`border-t` / `space-y` / `mb-0.5` / 无缝贴排

## 附录 B：样式断言测试总表（重构时必须同步更新）

| 文件 | 断言要点 |
|---|---|
| `panels/sidebar/SidebarGroup.test.tsx` | 头部按钮 **22×22 像素**、chevron 位置、按钮数契约（1/1/2/0） |
| `panels/sidebar/MemoryGroup.test.tsx` | 主按钮含 `hover:bg-`、行容器**不含**、`button button`=0、每行 3 按钮 |
| `panels/sidebar/PublicationGroup.test.tsx` | 行容器不含 hover、`button button`=0、主按钮可 focus |
| `panels/sidebar/ManuscriptGroup.test.tsx` | 收敛态导出弹窗挂载位置 |
| `panels/agent/AgentConversation.test.tsx` | 右侧固定宽度容器、`group-hover:opacity-0/100` 类名、`.group` 计数 |
| `panels/agent/ThinkingCollapse.test.tsx` | `hover:bg-` 类、箭头最前、无嵌套 button |
| `panels/agent/ToolCallBlock.test.tsx` | `.tool-call-header` 为 BUTTON、箭头位置、无嵌套 |
| `panels/agent/ArtifactCard / CompressedBatchCard / ConfirmCard / ContextBudgetBar / AgentMemoryView / AgentMessage .test.tsx` | button/title 选择器、气泡 `items-end` + 底色 |
| `layout/ProjectSquareList.test.tsx` | 方块按钮数、`data-project-square`、删除按钮非嵌套 |
| `ui/ModalShell / Confirm / MenuItem / Disclosure / SegmentedControl / Table / PopoverSurface .test.tsx` | 令牌化圆角/边框、动画名、选中态不占底色、`visibility:hidden` 禁则、`aria-pressed` |
| 其余（`EditorArea`、`settings/*`、`editor/*`） | 行为/DOM 定位（`details`/`summary`、`role="switch"`、`aria-label`、`data-field`）——改类名安全，改**标签语义或按钮文案**会破 |
