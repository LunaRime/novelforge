# NovelForge 六项 UI/交互改进 — 实施口径与决定记录（2026-10-16）

> 用户 6 项诉求 → 落地口径、拍板决定与验收。实现提交：`40bd7b1`（29 文件 / +3114 −309）。
> 本地门禁：`typecheck` 零错误 · `eslint --max-warnings 0` · 全量 vitest **237 文件 / 2823 测试全过**
> （改动前基线 233 / 2766，+4 文件 / +57 测试）。
>
> ⚠️ 本文件是**决定记录**，不是规范。仓库规范仍以 `.agents/skills/**` 为准。

## 0. 六项 → 归属与落点

| # | 用户诉求 | 落点（文件） |
|---|---|---|
| 1 | 主界面下边栏右下角「消息收纳」弹窗（应用更新 / 任务状态；运行中置顶） | `src/stores/notice-store.ts`（新）、`src/components/layout/NotificationCenter.tsx`（新）、`StatusBar.tsx`（挂载一行） |
| 2 | AGENT 对话悬停 UI 热区太窄 / 不含功能按钮 | `src/components/panels/agent/AgentMessage.tsx`、`AgentConversation.tsx` |
| 3 | 模型路由（分层调度）排版 + 优先级弹窗（勾选 + 数字序号） | `SettingsModal.tsx` 的 `ModelRoutingSection`、`ModelRoutingTierDialog.tsx`（新） |
| 4 | 指标行（`压缩 0 · 跳过 0 · …`）按功能个性化 | `src/components/ui/MetricChip.tsx`（新）+ 三处同族指标 |
| 5 | 设置 → 编辑器加入主题界面修改 | `src/components/settings/ThemeSection.tsx`（新）、`lib/theme-transition.ts`、`lib/theme-meta.ts`（新） |
| 6 | 自学习压缩说明过长 / 未按项目约定 | `src/components/settings/ContextCompactionSection.tsx`（learning 文案区） |

## 1. 逐项实施口径

### 1.1 消息收纳（通知中心）

- **入口**：状态栏最右段、**缩放控件左侧**（用户选定）。铃铛 + 未读角标（无未读不显「0」）。
- **弹层**：向上展开（`placement: above` / `align: end`，与水温/模型面板同款），宽 320、最大高 360、列表内部滚动。
- **分区顺序即优先级**：① 正在执行（`activeRuns` 派生，置顶、不可移除、不计未读）→ ② 应用更新 → ③ 任务结果。
- **派生式而非 push**：`notice-store.sync()` 从 `workflow-store` / `update-store` 当前状态派生条目，
  稳定 id（`run:<id>:running|completed|failed`、`update:available|downloaded|error`）去重；
  已读/移除集合持久化 `localStorage['vela-notice']`，`sync()` 时按候选 id 剪枝。
  下载中**沿用 available 同一 id**（否则一点「下载」条目就消失、进度无处可看）。
- **首次运行 seed**：`vela-notice` 键**不存在**时，把当时已存在的候选 id 一次性写入已读集合
  （装完本轮不会凭空出现历史未读角标；之后新产生的条目照常未读）。键存在（含用户点过「全部已读」）→ 不 seed。
  候选为空也写键（键的存在 = 首次运行已处理）；`seeded` 进程内一次性标记防 localStorage 不可用时反复 seed。
- **动作**：单条「标记已读 / 移除」、「全部已读」；更新行「下载 / 重启安装 / 查看版本说明」；
  结果行「查看输出」→ 右侧 AI 输出面板；运行中行「任务面板」→ 底部任务页；跳转后自动关弹层。

### 1.2 AGENT 对话悬停热区

根因（实测）：

1. `AgentMessage` 助手消息底部操作按钮 `22×22`，低于图标按钮 **32×32** 口径；
2. `AgentConversation` 会话行右侧操作组 5 个 `ACT_BTN`（20×20）+ `gap-0.5` 塞在**写死 `width: 88`** 的容器里
   —— 5×20 + 4×1.75 = **107px 已溢出**，「hover 亮起的范围」里有点不动的按钮。

修法：操作按钮统一 **32×32**（图标视觉仍 12px）、`gap-2.5`（相邻中心距 **40.75px**）；
会话行右侧容器删掉固定宽度改 **grid 内容自适应**（时间与操作组同格交叉渐隐，零布局跳动）；
分叉 / 归档 / 删除收进「更多」菜单（`PopoverSurface` + `useOutsideClick` + `useEscapeKey`，
菜单开关提升到列表容器做**行间互斥**）。用户消息那一行：容器**不点亮**、时间仍是纯文本、
复制按钮自亮（hover 边界 ⊆ 可点边界，死带禁令）。工作区表头 3 个按钮同批 20→32。

契约不破：外层行仍是纯视觉 `div`（形态 A，无需 `stopPropagation`）、`button button` 恒为 0、
hover 显形一律配 `group-focus-within` 键盘等价。

### 1.3 模型路由（分层调度）

- **排版**：标题独占一行在上；动态路由开关同排右侧；三层说明收进 `Disclosure`（`settings.cardHint`）。
  每层一块**层卡** = 层名 + 摘要（`N 个模型 · 首选 xxx` / 空层「未指定（回退默认模型）」）+
  「编辑优先级」按钮；层内 ①②③ 展示前 3 个，其余折叠 `+N`。旧「ArrowUp 挪一格 + Select 添加」整段移除。
- **弹窗**（`ModelRoutingTierDialog`，走 `ui/Dialog` 拿 Radix 的 Esc / 焦点陷阱 / 背景锁）：
  上半候选**勾选列表**（整行 `<label>` 可点，已勾行行首显示**序号 = 优先级**，取消后自动重排）；
  下半已选列表（序号 + 上移/下移/移除，32×32）；底部取消 / 保存。
  **草稿只在本地 state，只有点保存才 `updateModelRoutes({ [tier]: ids })`**；取消 / Esc / 点遮罩都不写库。
  空层合法并在弹窗内说明回退口径。

### 1.4 指标行按功能个性化

「怪」的技术根因：一条 `·` 串把 6 个语义完全不同的计数**拍平成同等权重的纯文本** ——
分不清哪个是好事、哪个是告警，也看不出学习是否在起效。

新原语 `ui/MetricChip`：`{ icon, label, value, tone: neutral|good|warn|bad, title }` ——
图标 + 标签 + **等宽数字**，`tone` 只给数值与图标着色，`title` 是解释型 tooltip（这个数是什么、来自哪）。
另导出 `MetricRow` 做横向分组。三处落地：

| 位置 | 形态 |
|---|---|
| 自学习压缩统计 | 6 个 chip：压缩/跳过=neutral，**截断/保真告警/移除=warn**，重生成=neutral；全 0 照常渲染 |
| 工作流进度 | 「步骤 3/7」+「运行中 N」两个 chip；**删掉与 chip 重复的行尾裸数字** |
| 上下文明细 | 逐段满宽 chip（标签左 / 值右，`title` 给来源 + 告警原因）；数值口径、圆环、`data-budget-segments` 未动 |

字典层：`settings.learningStats` / `workflow.progressSummary` / `settings.learningDesc` 三个
**零消费方** key 已删除，原位留注「不要再把 `·` 串加回字典」。

### 1.5 设置 → 编辑器：主题界面

- 新建 `settings/ThemeSection`：2×2 主题卡（图标 + 名称 + 三色预览条 + accent 描边/勾），点选**立即生效**。
- 圆形扩散过渡抽到 `lib/theme-transition.ts`，主题元数据（顺序/图标/名称）抽到 `lib/theme-meta.ts`，
  与右侧图标栏底部菜单**共用同一份**（改一处两处同步；图标栏行为外观零变化）。

### 1.6 自学习压缩文案

开关下由 **129 字整段** → **21 字一行**（`learning.summaryShort`，默认可见量 −84%）；
全量口径（学习信号 / 调整范围 ±50% / 不训练模型不额外调 LLM / 重置范围）进「说明」折叠的 4 条短行
（2px 中性圆点做项目符号），与同卡片其它旋钮的版式约定一致。

## 2. 本轮拍板（含刻意偏离）

| 决定 | 理由 |
|---|---|
| **不做「逐主题真预览」**，预览条改为「当前主题配色预览」+ 说明性 `title` | `index.css` **没有 `.light` 类**（浅色 = `:root`）。要真预览就得把 `:root` 整块 token 复制成 `.light`，浅色配色出现两份定义必然漂移（color-token-standard 禁忌），代价远大于收益 |
| 通知中心**入口**用 22px 段高（`h-full` × `minWidth: 32`），**不塞 32×32 方块** | 状态栏是 22px 固定条；塞 32px 会撑破条高。弹层内图标按钮仍 32×32。属对 `card-affordance-standard` §5.2 的**刻意偏离** |
| `AgentMessage` rewind 禁用态 opacity **保持 0.4**（v2 目标 ~30%） | `card-affordance-standard` §8 明确「未定案前不要盲目改掉」；与 `.icon-btn:disabled` 的 0.5 同批不动，避免同轮既改形态又改令牌而无法归因 |
| 上下文明细的 `2.6k · 2584` 保留 `·` | 标准明确「工具日志 / 数据」的 `·` **属保留场景**；加 legend 反而增噪 |
| 会话行时间与操作组做交叉渐隐（而非去掉时间） | 保持零布局跳动，且 `group-focus-within` 保证键盘等价 |

## 3. 并行执行与写作用域

5 个执行者并行（通知中心 / 悬停热区 / 模型路由 / 指标行 / 主题+文案）。共享文件靠**约定分区**避免覆盖：

- 新开 i18n 分片 `src/shared/locale-data/notice.ts`，按前缀分区（`notice.*` / `route.*` / `metric.*` /
  `theme.*` / `learning.*`），各执行者只写自己那段 —— 避开既有分片（`ui.ts` / `workflow.ts` 等）的同文件并发写。
- `SettingsModal.tsx`（`ModelRoutingSection` / `EditorSection`）与 `ContextCompactionSection.tsx`
  （learning 文案区 / 统计 chip 行）各有两个执行者触碰 → **只用小范围 edit，改自己那一节**。

## 4. 已知残留（登记，本轮未处理）

1. **更新入口重复**：顶部 `UpdateNotification` 横幅与通知中心会同时提示更新可用 / 已下载。
   横幅是启动即可见，通知中心是收纳入口，语义不同；是否收敛成一处属跨模块决策，未动。
2. **未做真机人工验收**：本轮验证 = 渲染层单测（jsdom）+ 静态合规（颜色/热区/i18n 守卫）+ 全量门禁；
   悬停手感、弹窗遮罩层级、主题过渡动画属真机项。
3. 「更多」菜单在列表滚动时**不跟随锚点重算**（与 `AgentHeader` / `ContextBudgetBar` 既有菜单同行为，非本轮回归）。
4. `card-affordance-standard` §5.3 的差距项（`.icon-btn` 12 处、`Button size="icon"` 24 处等）本轮未动。
