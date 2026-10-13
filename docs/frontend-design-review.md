# NovelForge 前端设计全面审阅（2026-10-14）

> 审阅范围：颜色令牌 / 字体排版 / 布局 / UI 组件 / 视觉一致性（「AI 味」痕迹实证排查）。
> 基线：`src/index.css`（1514 行）、`src/components/ui/`（27 组件）、`src/components/{layout,panels,pages}/`、`.agents/skills/`（6 个前端规范）。
> 结论先行：**设计底盘极其成熟（四套主题 + 派生式令牌 + 组件收敛），但「装饰层」积累了大量「模仿 JetBrains/VS Code 工具默认」的 AI 味痕迹——全大写标签、`·` 中间点、装饰渐变。核心张力是「工具化语言」vs「小说写作的产品定位」。**

---

## 一、审阅结论

### 1.1 一句话判断

**这是一个「底盘有主张、装饰层随大流」的设计系统。** 底盘（颜色令牌 / 字体 / 布局 / 组件收敛）值得满分，装饰层（eyebrow 标签 / `·` 分隔 / 渐变）是典型 AI 味。

### 1.2 核心张力（本次审阅最重要的一个判断）

NovelForge 的默认浅色主题是「工具蓝」——`--color-accent: #5B9ED6`、`.panel-header` 全大写、`font-mono` 数据标签、等宽步骤序号。这是**代码 IDE（JetBrains/VS Code）的视觉语言**，被直接搬进了**一个小说写作工具**。

而项目自己已经握有「正确的语言」：`.paper` 纸质主题（温暖牛皮纸 `#F5F0E8` + 薰衣草紫 `#9B8EC8` + 霞鹜文楷写作字体）。它才是「写作」该有的样子。

**这不是说默认主题要变成纸色**——而是说：装饰层的默认项（大写标签、`·` 分隔、渐变光晕）是从「工具」借来的，不是从「写作」长出来的。写作工具的界面，应当比代码 IDE 更安静、更文学、更少「极客装饰」。

### 1.3 分项评级

| 维度 | 评级 | 一句话 |
|---|---|---|
| 颜色令牌系统 | ★★★★★ | 四套主题 + 派生式（color-mix）+ 语义令牌 + 决策注释，业界水准 |
| 字体系统 | ★★★★☆ | UI/写作/等宽三栈分离 + 按需注入 @font-face，正确 |
| 布局 | ★★★★☆ | react-resizable-panels 四区，清晰 |
| UI 组件收敛 | ★★★★★ | 27 组件，Spinner/ProgressBar/StateDot 等重复实现已收敛 |
| 装饰层（AI 味） | ★★☆☆☆ | 大写标签 / `·` 分隔 / 渐变光晕，系统级 AI 味 |

---

## 二、设计资产盘点（成熟部分 —— 别动）

以下是审阅确认「已达标、不要返工」的部分，防止改坏：

1. **颜色令牌**（`src/index.css:146-500`）：硬编码色只在 `--color-*` 源头（4 套主题块 `:root`/`.galaxy`/`.paper`/`.dark`），业务代码只用语义令牌。派生式 `--color-hover`/`--color-border` 用 `color-mix` 叠在「实际所在表面」上，方向自动正确（浅色加深、深色提亮）。**这是教科书级的令牌设计。**
2. **字体三栈**（`src/index.css:51-55`）：`--font-sans`（Inter，UI）/ `--font-mono`（JetBrains Mono，代码）/ `--font-writing`（LXGW WenKai，正文）。写作字体与工具字体分离，且按需注入 @font-face 避免同时加载 4 套中文字体（`theme-store.ts:317-341`）。
3. **组件收敛**：`Spinner`/`ProgressBar`/`StateDot`/`EmptyState`/`Table` 等把历史重复实现收敛成单一组件，`color-token-standard` 已沉淀全仓清扫。**这些收敛是「纪律」，不是 AI 味，保留。**
4. **交互规范**（`.agents/skills/ui-interaction-standard`）：浮层关闭口径、焦点可见、键盘可达、悬停置换（`HoverSwapIcon`）、破坏操作确认。**这些是实测踩坑的沉淀，不是理论清单。**

---

## 三、问题清单（按优先级）

### P0 — 技术债（圆角令牌漂移，一致性断裂）

**现状**：`--radius-*` 声明在 `:root`（`src/index.css:272-277`），**不在 `@theme`**（`index.css:51` 只有 `--font-*`）。

**后果**：同一「卡片」概念落在 5 档圆角——className `rounded-2xl` 走 Tailwind 默认 16px（`Dialog.tsx:44`），内联 `var(--radius-2xl)` 是 20px（`ModalShell.tsx:58`）；`rounded-xl` 是 12px（WelcomePage 卡片），`--radius-xl` 是 14px（`ContextMenu.tsx:84`）。

| 文件:行号 | 圆角 | 实际值 | 令牌名义值 |
|---|---|---|---|
| `ui/Dialog.tsx:44` | `rounded-2xl` | 16px | `--radius-2xl` = 20px |
| `ui/ModalShell.tsx:58` | `var(--radius-2xl)` | 20px | 20px ✅ |
| `ui/ContextMenu.tsx:84` | `var(--radius-xl)` | 14px | 14px ✅ |
| `ui/PopoverSurface.tsx:65` | `rounded-lg` | 8px | `--radius-lg` = 10px |
| `pages/WelcomePage.tsx:78` | `rounded-xl` | 12px | `--radius-xl` = 14px |
| `layout/LeftToolWindowBar.tsx:57` | 硬编码 `6` | 6px | 无令牌 |

**问题**：弹窗是 16px、右键菜单 14px、下拉 8px、卡片 12px、图标栏 6px——同一「浮起物」圆角无规则。这是「AI 味」的隐性形态（模板化系统里圆角到处统一，这里反过来是到处不一致）。

**改法**：把 `--radius-*` 从 `:root` 移进 `@theme`（Tailwind v4 的 `@theme` 里的 `--radius-*` 会生成对应的 `rounded-*` 工具类刻度），然后全仓把内联 `var(--radius-*)` 与 className `rounded-*` 对齐到同一刻度。

**验收**：grep 全仓，`rounded-2xl` 与 `var(--radius-2xl)` 解析出的像素值一致；弹窗/右键/下拉/卡片各归其位（建议：浮层用 `--radius-xl`=14px 统一，卡片用 `--radius-lg`=10px，图标栏角收进令牌）。

---

### P1 — AI 味清理（高价值，三处）

#### P1-1 全大写 eyebrow 标签（系统级，至少 8 处）

**现状**：`.panel-header` 全局强制大写（`src/index.css:718-731`）：
```css
.panel-header {
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;  /* ← AI 味 */
}
```
另有 8 处内联 `uppercase tracking-*`：`AIOutputPanel.tsx:72,568`、`BottomPanel.tsx:178`、`KnowledgePanel.tsx:304,400`、`GenerateConfigDialog.tsx:161-168,244-251`、`CodeMirrorEditor.tsx:1062`。

注释自述「JetBrains 风格：紧凑、全大写、弱化」——这正是「模仿工具默认」而非「NovelForge 自己的选择」。

**问题**：全大写 + 字距拉开是 frontend-design 方法论点名的「AI 生成页最常见破绽」之首。一个中文写作工具的界面，标题全大写英文，违和感最强。

**改法**：`.panel-header` 去掉 `text-transform: uppercase` + `letter-spacing`，改句子大小写（中文标题天然无需处理）；8 处内联 `uppercase` 收敛为普通句子大小写。**保留** 11px/600/muted 的「弱化层级」——弱化是对的，大写是错的。

**验收**：grep `text-transform: uppercase` + `uppercase tracking`，业务面板（除品牌 Logo 专用处）清零；`.panel-header` 视觉层级（弱化）不变。

#### P1-2 `·` 中间点连接 meta（Agent 子系统密集，20+ 处）

**现状**：`panels/agent/*` 把 `·` 当设计语言（注释多处自述「线② · dsh 照搬」）：`ToolCallBlock.tsx:5`（「[icon] 标题 · 摘要」）、`ContextBudgetBar.tsx:106`、`CompressedBatchCard.tsx:81,83`、`AgentInputBox.tsx:440`、`InboxItemCard.tsx:70` 等；扩散到 `CharacterEditor.tsx:681,828`、`ActivityView.tsx:480,517`、`ArchitectureConfirmDialog.tsx:181`、`AutomationSection.tsx:124`。

**问题**：`A · B · C` 的 `·` 分隔是 frontend-design 点名的「meta strings joined with middle dots」AI 味。它是「照搬参考设计」的结果，与 WelcomePage/KnowledgeOverview（用徽章或分行）风格不一致。

**改法**：`·` 分隔改成分行 / 图标 / 独立徽章，取决于语义——「标题 · 摘要」改为「标题 + 摘要换行」；「来源 · 标题」改为「来源徽章 + 标题」。**保留**确为「同一属性的并列」场景（如 `第N章 · 草稿` 可用空格或顿号）。

**验收**：grep `' · '` / `.join(' · ')`，Agent 子系统清零；确需并列的场景改用图标或换行，肉眼无中间点。

#### P1-3 装饰性渐变（6 个可复用类，部分过度）

**现状**：`src/index.css:975-1514` 沉淀了 `.brand-gradient`/`.btn-primary`/`.ai-glow`/`.glow-border`/`.text-gradient`/`.shimmer` 六个装饰类。其中 `.ai-glow`（`index.css:1014-1042`）是「渐变底 + `filter: blur(8px)` 模糊光晕」的极光按钮，用于新建项目（`WelcomePage.tsx:143`）。

**问题**：`.ai-glow` 的模糊光晕是「AI 味」高发区（近黑底 + 荧光渐变是模板化默认的经典形态）。品牌渐变 `.brand-gradient`（`index.css:976`）用于品牌名 + 版本号 + 关于页标题，这个**合理**（品牌一致性）。

**改法**：`.ai-glow` 去掉 `::before` 的 `blur(8px)` 光晕，只保留实底渐变 + 过渡（按钮的「AI」感由语义色承担，不由光晕承担）。`.glow-border`/`.text-gradient` 若只有装饰性用途（无品牌/状态语义）则收敛。**保留** `.brand-gradient`（品牌名）与 `.btn-primary`（主按钮，渐变是品牌蓝的延伸）。

**验收**：`.ai-glow` 无 `filter: blur`；「新建项目」按钮仍有清晰的 AI 语义（渐变底 + accent 色），但无模糊光晕。

---

### P2 — 局部不一致（可选，低风险）

#### P2-1 编号徽章

`WelcomePage.tsx:100-119` 三步引导用强调色圆形编号徽章（`w-6 h-6 rounded-full`）。**这个保留**——它是真「步骤序列」，编号合理（frontend-design 明确「编号仅当内容真是序列时用」，欢迎页引导就是序列）。但 `BottomPanel.tsx:422` 的 `{index+1}. {step.name}` 与 `AIOutputPanel.tsx:426` 的 `{index+1}/{total}` 是工作流步骤序号，也合理。**无需改**——仅记录「编号标记在本项目是合理的，不算 AI 味」。

#### P2-2 单字高亮

`StatusBar.tsx:45`、`SettingsModal.tsx:727` 的品牌名用 `.brand-gradient` 渐变文字强调；`KnowledgeOverview.tsx:472` 统计卡大数字 `text-2xl font-bold`。**保留**——品牌名渐变是品牌一致性（不是单字高亮破绽），统计大数字是「大数字 + 小标签」的合理数据呈现。唯一建议：`GenerateConfigDialog.tsx:174` 里「总字数」数字的 `<strong>` 加重，若只是把数字变粗则保留（数据强调），若变粗+变色则去掉色。

---

## 四、可执行改进行动（分 3 批）

> 每批独立可提交、独立验收。批序按「价值/风险」排序，P0 先做。

### 批 1 — 圆角令牌归位（P0，纯技术债，零视觉争议）

1. `src/index.css`：把 `--radius-sm/md/lg/xl/2xl` 从 `:root`（272-277）移进 `@theme`（51 之后）。
2. 全仓 grep `rounded-{sm,md,lg,xl,2xl}` 与 `var(--radius-{...})`，建立映射表，统一到同一刻度。
3. 硬编码 `borderTopLeftRadius: 6`（`LeftToolWindowBar.tsx:57`、`RightToolWindowBar.tsx:104`）改为令牌。

**验收**：`rounded-2xl` 与 `var(--radius-2xl)` 像素一致；弹窗/右键/下拉/卡片各归其位（建议：浮层 14px、卡片 10px）。门禁：typecheck / eslint / 现有 UI 测试全绿。

### 批 2 — 装饰层去 AI 味（P1，视觉改动，需逐屏走查）

1. `.panel-header`（`index.css:718`）去 `uppercase` + `letter-spacing`。
2. 8 处内联 `uppercase tracking-*` 收敛（AIOutputPanel/BottomPanel/KnowledgePanel/GenerateConfigDialog/CodeMirrorEditor）。
3. `·` 分隔改为分行/图标（Agent 子系统 20+ 处）。
4. `.ai-glow` 去 `blur(8px)` 光晕。

**验收**：grep `uppercase` / `' · '` 清零（品牌 Logo 专用处除外）；`.ai-glow` 无 blur；四套主题下逐屏走查无大写标签、无中间点、无模糊光晕。**注意**：此批动了 Agent 子系统的「dsh 照搬」语言，需确认 AI 面板族的线② 规范同步（`ui-interaction-standard` §3.1 的箭头语言已收窄到侧栏，`·` 分隔也应一并收窄）。

### 批 3 — 产品语言校准（P1-3 深化 + 长期）

1. 明确「工具化语言」与「写作语言」的边界：默认浅色主题的装饰层，向「安静」收敛；`.paper` 主题作为「沉浸写作」的主推方向之一。
2. 补充一条设计原则进 `.agents/skills/`（见下节），固化「写作工具 ≠ 代码 IDE」的判断，防止后续迭代重新引入大写标签/`·` 分隔/渐变光晕。

**验收**：新增一条 `writing-tool-aesthetic` 规范 skill；后续新 UI 不再出现大写 eyebrow / `·` 分隔 / 模糊光晕。

---

## 五、设计原则补充（固化到规范）

建议新增 `.agents/skills/writing-tool-aesthetic/SKILL.md`，核心三条（写入即可执行，不必重写）：

1. **NovelForge 是写作工具，不是代码 IDE。** 装饰层默认项（标签大小写、meta 分隔、动效）从「写作」的语境取，不从 JetBrains/VS Code 借。已有「正确语言」参照：`.paper` 主题。
2. **标签用句子大小写，禁全大写 + 字距。** 弱化层级用「字号 + 颜色 + 字重」，不用 `uppercase` + `tracking`。品牌 Logo 是唯一例外。
3. **meta 并列用图标/分行/徽章，禁 `·` 中间点。** 渐变只用于品牌与主按钮，禁用模糊光晕作装饰。

---

## 六、已知债（本次不处理，仅登记）

- `--color-gold: #C9A76C` 在 4 套主题逐一同值，缺 `--color-gold-rgb` 三元组 → 半透明金色场景只能硬编码（`color-token-standard` 已登记）。
- `rehype-raw` 依赖已装但未启用（MarkdownContent 不渲染原始 HTML，XSS 安全，保留现状）。

---

*审阅方法：frontend-design（两遍法 + AI 味破绽清单）+ dev-expert（引用点实码 trace + 分批验收）。行号基于 2026-10-14 的 master（HEAD 6e66e75）。*
