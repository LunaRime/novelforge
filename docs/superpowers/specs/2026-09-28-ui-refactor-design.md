# UI 重构设计：行片化 + 卡片减重 + 悬停置换

> 2026-09-28 · 状态：待评审 · 依据：用户指令 + 四节设计逐节确认（本会话）

## 一、背景与目标

用户要求对程序 UI 进行**全应用重构**，两条特别说明经澄清后确定为：

1. **「项目结构」侧边栏菜单采取长方形圆角** → 菜单行做成**独立圆角矩形片**（行间留缝），分组卡片**去边框减重**、靠间距分组。
2. **悬停置换** → 默认显示**功能图标**，悬停时平滑换成**指示箭头**（跳转 `›`；原地展开 `⌄`，展开后 `⌃`）。

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

- **默认态**：功能图标 + 标题 + 计数（界面干净）
- **悬停态**：功能图标**交叉渐隐**（≥100ms）为指示箭头
  - 跳转 / 滑出（纯导航卡）→ `›`
  - 原地展开（折叠卡）→ `⌄`；**已展开 → `⌃`**（方向随状态）
- **导航+折叠卡（双行为，如「故事架构」）**：左 chevron 独立按钮**常驻**（`⌄`/`⌃`，承担折叠 + 状态显示）；主按钮功能图标悬停置换为 `›`

  ```
  静止态：  │ ⌄  📖 故事架构        4/4 │
  悬停态：  │ ⌄  ›  故事架构        4/4 │
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
   - Props：`icon: ReactNode`、`swap: 'nav' | 'expand'`、`state?: 'collapsed' | 'expanded'`（展开方向用）、`size?: number`（默认 12）
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

## 九、非目标

- 不改信息架构、配色令牌、字号与图标档位
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
