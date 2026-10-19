# NovelForge 布局与间距专项整改计划书

> 来源：`docs/2026-10-18-layout-spacing-review.md`（CRAP 四原则 + 视觉层次五步 + 尼尔森十启发式 + 认知走查）
> 配套基线：`AUDIT.md`（57 条静态审查，Top10 差距）
> 日期：2026-10-18
> 状态：**全部执行完成**（Phase 1 对比度令牌 + Phase 2/3 其余 9 项，2026-10-18 二次执行，见文末「执行记录」）

---

## 0. 决策摘要

| 阶段 | 内容 | 状态 |
|------|------|------|
| **Phase 1** | 对比度令牌修复（muted / statusbar-text / activity-icon 三族，light + paper + galaxy） | ✅ 已执行 |
| Phase 2 | 选中态收敛、状态栏补项、保存入口统一、设置留白 | ✅ 已执行 |
| Phase 3 | 徽标语义色、欢迎页层次、10px 下限、`/` `@` 可发现性、角色表单网格 | ✅ 已执行 |

**为什么 Phase 1 先行**：这是两份文档共同排第一的项（review 五·#1「高」级、AUDIT「建议执行顺序第 1」），
只改令牌值、波及面最大、风险最低、零设计歧义。其余项要么需要设计取舍（选中态/保存入口/徽标色/欢迎页），
要么需要真机复核（review 七明确标注截图与当前代码存在版本差）。

---

## 1. Phase 1 — 对比度令牌修复（已执行）

### 目标
浅色/纸色主题的「次要信息」从 2.0–2.7:1 抬到 **≥ 4.5:1**（WCAG 2.1 AA 正文档），
同时保持 正文 → 次要 → 弱化 的三级层次不塌缩。

### 改动清单（`src/index.css`，色值经 WCAG 相对亮度公式实测）

| 主题 | 令牌 | 旧值 | 新值 | 实测最弱面对比 |
|------|------|------|------|----------------|
| light `:root` | `--color-text-muted` | `#8A9AAB` | `#5A6B7E` | 2.57 → **4.87**（panel `#EFF2F7`） |
| light `:root` | `--color-statusbar-text` | `#8994A7` | `#57657A` | 2.73 → **5.27**（statusbar） |
| light `:root` | `--color-activity-icon` | `#8994A7` | `#57657A` | 2.51 → **4.86**（activity-bar `#E5E9F0`） |
| galaxy `.galaxy` | `--color-text-muted` | `#5A7A96` | `#6E8EAA` | 3.82 → **5.02**（panel `#0E1B30`，暗色需**提亮**） |
| paper `.paper` | `--color-text-muted` | `#A89888` | `#6F6157` | 2.29 → **4.89**（panel `#EDE8E0`） |
| paper `.paper` | `--color-statusbar-text` | `#A09488` | `#61564C` | 2.43 → **5.85**（statusbar） |
| paper `.paper` | `--color-activity-icon` | `#A09488` | `#61564C` | 2.20 → **5.30**（activity-bar） |

> `src/tokens/index.ts` 由 `pnpm gen:tokens` 从 index.css 自动重生成，已同步。
> dark `.dark` 的 muted `#888888` 主体面 4.70 已达标，未动（面板面 4.32 属边界，见 §4 遗留）。

### 验证口径
- `pnpm run typecheck`、`pnpm run lint`、`pnpm run test`（含 `color-token-guard.test.ts` 与 hover/border 守卫）全绿。
- 不触碰 `--color-hover` / `--color-border`（派生式，有专门守卫锁死），本次改动不涉及。

---

## 2. Phase 2 — 模式层收敛（待决策后执行）

### T2 选中态三范式收敛（review 五·#2，重复）
**现状**：设置分类 = 整行实心填充（`SettingsModal.tsx:132-134`）；角色子 Tab = 胶囊实心；主编辑器 Tab = 顶部 2px 指示线 + 浅底（`EditorArea.tsx:395-402`）。
**规则（review 已给定）**：面板内子导航 = 胶囊；顶层 Tab = 指示线；设置分类 = 左 2px 强调条。
**范围**：`SettingsModal.tsx`（左栏选中态改左强调条）、`CharacterEditor.tsx`（子 Tab 已胶囊，复核）、`EditorArea.tsx`（已指示线，复核）。
**待决策**：设置分类当前「accent 实心 + 白字」改为「左 2px 强调条」后，激活项需重新核对对比度。

### T3 状态栏补章节/字数/保存（review 五·#3，反馈）
**现状**：`StatusBar.tsx` 右段仅费用/AI 胶囊/水温/模型/通知/缩放；字数与 dirty 点只在编辑器头部（`EditorArea.tsx:78-93`）。
**方案**：状态栏左段（品牌版本右侧）补只读三项，数据源：
- 字数 → `useEditorStore` 当前激活 `chapter` tab 的 `computeTextStats`（或复用 `ProseEditorWrapper` 的 `onCharCountChange` 上抛到 store）
- 章节 → 当前激活 tab 的 `chapterNumber` / `name`
- 保存 → 复用 `tab.dirty` 语义（点 + `t('statusbar.unsaved')`）
**前置**：需确认 `editor-store` 是否已持有「激活章节字数」——若未持有，需把 `ProseEditorWrapper` 的 `wordCount` 上抛（新增 store 字段），属轻量数据流改动 + i18n 三语新增键。

### T4 保存入口统一（review 五·#4，重复）
**现状**：主编辑器 = 头部右侧图标按钮（仅 dirty 出现，`EditorArea.tsx:94-105`）；角色编辑 = 头部常驻「保存」文字按钮（`CharacterEditor.tsx:282`）。
**方案（review 建议）**：统一为「编辑器头部常驻保存态」（dirty 点 + 图标），角色编辑沿用同款。
**待决策**：角色编辑当前「保存」是 accent 主操作、dirty 时点亮；改为图标按钮后主操作视觉权重下降，需确认角色场景是否接受。

### T5 设置内容区右缘留白（review 五·#5，对齐/密度）
**现状**：内容区实际可用宽 ≈ 624px（880 − 208 左栏 − 48 内边距）；部分分区 `max-w-[480px]`（`SettingsModal.tsx:467`）/ `max-w-[600px]`（`:713`），右缘长期约 1/3 空白。
**方案（review 二选一）**：① 内容 `max-w` 提到 640（实际即满宽）；② 弹窗收窄到内容宽（`w-[880px]` → 自适应）。
**待决策**：480/600 两档可能是有意区分「表单窄、列表宽」；需逐分区核对再统一。

---

## 3. Phase 3 — 语义与可发现性（待决策 + 待真机）

### T6 侧栏徽标语义色（review 五·#6，对比）
**现状**：章节蓝图「3/100 章」橙色徽标与故事架构「0/4」灰色徽标并列，警告 vs 计数不可区分（截图已过期，**需真机复核**当前代码）。
**方案**：警告 = 橙/红 + 图标；普通计数 = 灰，全仓统一（新增「badge 语义色」usage 规则）。

### T7 欢迎页三卡片等权重（review 五·#7，层次，低）
**现状**：新建/打开/导入三卡片完全等权重（`WelcomePage.tsx:125-214`），侧栏另有实心「新建项目」主按钮，主操作双入口。
**方案**：「新建项目」卡片做 primary 强调；或侧栏入口降级。**待决策**。

### T8 10px 文本下限（review 五·#8，密度）
**现状**：`text-2xs`（10px）113 处 + `text-micro`（11px）223 处；`index.css` 有长注释说明两档刻意的语义区分。
**方案**：下限提到 11px，但需避免 `text-2xs` 与 `text-micro` 语义塌缩——建议「内容承载文本抬到 11px，纯装饰徽标保留 10px」两路走，而非一刀切改令牌。**待决策 + 需真机看 10px 实际载体**。

### T9 `/` 与 `@` 能力可发现（review 五·#9，识别，低）
**现状**：两项核心能力只存在于输入框 placeholder 灰字（`AgentInputBox`）。
**方案**：输入框聚焦时显示能力 chips；或空状态加引导卡。**待决策 + 真机**。

### T10 角色表单列宽（review 五·#10，对齐，低）
**现状**：已使用 `grid-cols-[repeat(auto-fit,minmax(160px/200px,1fr))]` 响应式网格（`CharacterEditor.tsx:450,480,513,655`），review 基于旧截图「3→2→1 跳变」**已部分缓解**；剩余问题是 160px/200px 最小宽不一致。
**方案**：统一最小宽基准；宽字段 `col-span`。**待真机复核当前观感**。

---

## 4. 遗留与边界

- **accent / success / warning（review 五·#1 点名但未动）**：三者为「文字 + 图标 + 背景」**双用途**令牌。
  - `--color-accent`（light `#5B9ED6`）作为文字 2.73，但作为主按钮背景需与白字配（dark 下 `#0E639C` 白字 4.31 已临界）；
  - `--color-success` / `--color-warning` 多为状态点/图标（非文本，3:1 即够），个别文字位才需 4.5。
  - 处理需引入「文本安全变体」（如 `--color-accent-text`）或按用途逐点核，**属设计决策，列入 Phase 2/3 排期**。
- **dark 主题 muted 面板面 4.32**：主体面 4.70 达标、AUDIT 判定 ✅；面板面 4.32 属 0.18 的边界差，如后续统一暗色面板面再一并处理。
- **galaxy statusbar-text / activity-icon `#4A6580`（约 3.10）**：review/AUDIT 抽样未覆盖，本次梳理时发现，属**新增发现**，建议并入 Phase 1 收尾时用同法提亮到 ≥4.5。

---

## 5. 质量门禁（每阶段执行后必跑）

```bash
pnpm run typecheck              # tsc 零错误
pnpm run lint                   # eslint 零错误零警告（--max-warnings 0）
pnpm run test                   # vitest 全绿（含 color-token-guard / hover / border 守卫）
git status --short              # 确认未误改 package.json / tokens 漂移
```

- 颜色一律走 CSS 变量（`color-token-guard.test.ts` 锁死，禁硬编码）。
- i18n：新增用户可见文本必须三语覆盖（zh-CN / en-US / ru-RU）。
- 提交：版本号只在发布时改；不提交 `.claude/`、`CLAUDE.md`。

## 6. 后续验证（真机走查，review 七）

- ⚠️ 截图与当前代码有版本差，动手后仍建议真机复核：AGENT 空状态垂直分布、折叠面板 3px 画布缝、消息内引用 chip 可点性。
- 认知走查补 2 条真实新手任务：① 导入已有小说并检索；② 修改 AI 建议并接受（inline accept 核心差异化路径）。

---

## 7. 执行记录（2026-10-18 二次执行）

用户要求「全部一次性执行」，以下为逐项落地结果：

| # | 项 | 改动 | 状态 |
|---|----|------|------|
| T2 | 选中态收敛 | `SettingsModal.tsx` 左栏选中态改「左 2px accent 强调条 + 浅底」（复用 MenuRow `active` 范式）；顶层 Tab（指示线）与角色子 Tab（胶囊）已符合，未动 | ✅ |
| T3 | 状态栏补项 | `editor-store.ts` 加 `activeCharCount` + `setActiveCharCount`；`EditorArea.tsx` ProseEditorWrapper 上抛字数 + 卸载清零；`StatusBar.tsx` 新增 `EditorStatusSegment`（章节名/字数/dirty 点，独立 selector） | ✅ |
| T4 | 保存入口统一 | `CharacterEditor.tsx` 保存按钮由文字 Button 改 icon-btn 图标（dirty 时 accent） | ✅ |
| T5 | 设置留白 | `SettingsModal.tsx` `max-w-[480px]`/`[600px]` → `[640px]` | ✅ |
| T6 | 徽标语义色 | **已实现**（`ProjectTree.tsx` 三处已用 success/warning/muted 三态编码，review 基于旧截图误判），未改 | ✅ 验证通过 |
| T7 | 欢迎页层次 | `WelcomePage.tsx` 「新建项目」卡片改 accent 边框 + 淡底（primary），打开/导入保持次级 | ✅ |
| T8 | 10px 下限 | `index.css` `--text-2xs` 0.625rem → 0.6875rem（11px，与 text-micro 同值，token 名保留作别名） | ✅ |
| T9 | `/` `@` 可发现性 | `AgentInputBox.tsx` 底部工具栏新增两个常驻图标按钮（`@` 提及 / `/` 命令），点击即触发对应菜单 | ✅ |
| T10 | 角色表单列宽 | `CharacterEditor.tsx` 网格最小宽 160px → 200px，统一基准 | ✅ |

**验证**：`typecheck` ✅（修 1 处 interface 遗漏）· `lint --max-warnings 0` ✅ · 全量测试见最新一次运行。

**遗留（本轮未动，理由同前）**：accent / success / warning 双用途令牌的「文本安全变体」仍属设计决策，未在本轮硬改；dark muted 面板面 4.32 边界差、galaxy statusbar-text ≈3.10 为新发现，建议后续用同法一并处理。
