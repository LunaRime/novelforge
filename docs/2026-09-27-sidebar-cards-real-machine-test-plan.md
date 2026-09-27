# 侧栏卡片点击响应 真机测试计划（2026-09-27）

> **授权单元声明**：本档是**一整份**测试文档。**批准本档 = 授权执行档内全部用例**，执行中不再逐条请示；档外控件一律不碰，要碰须重新申请。
> **路线**：CDP 驱动（`~/.claude/skills/computer-use/cdp.mjs`）——DOM 级定位、不移动真实鼠标、不截整屏。
> **背景**：`docs/card-affordance-review.md` + `card-affordance-standard` SKILL §8 已静态判定 8 张卡片全部存在「视觉暗示 ≠ 点击热区 ≠ 响应反馈」违规，**修复已推迟**；本档是修复前/后的**真机事实基线**——回答「点下去到底有没有反应」。

---

## 0. 一句话任务

侧栏 8 张卡片，**点标题 / 点计数 / 点右侧图标 / 键盘 Tab**，各自到底有没有反应；反应是否与视觉暗示一致。

## 1. 范围

**测**：`src/components/panels/sidebar/` 的 8 张卡片（挂载于 `ProjectTree.tsx:192-275`）：
小说配置 · 故事架构 · 章节蓝图 · 分卷 · 连载监控 · AI 记忆 · 草稿箱 · 正文章节

**不测**（档外，另立专项）：
- AI 面板 / 收件箱 / 编辑器内部的同族缺陷（`card-affordance-standard` §8.1 已静态登记，未在本档）
- 任何需要 LLM / embedding 的动作（见 §9 预算）
- 卡片内容的正确性（只验交互，不验数据对不对）

## 2. 环境与准备

### 2.1 临时开远程调试端口（**执行前**）

`electron/main.ts` 顶部 import 之后（第 14 行后）插入，**带标记，验完删除**：

```ts
app.commandLine.appendSwitch('remote-debugging-port', '9222') // RM-TEMP: 2026-09-27 真机测试，验完删除
```

### 2.2 启动与连通

```bash
cd E:/vela/11/vela-1 && pnpm run dev          # 沙箱外执行（Electron 子进程）
cd E:/vela/11/vela-1 && node ~/.claude/skills/computer-use/cdp.mjs ls    # 列出 target
node ~/.claude/skills/computer-use/cdp.mjs text                          # 能看到界面文本即通
```

### 2.3 夹具

打开**任一含 ≥1 章正文的项目**（草稿箱/正文章节/AI 记忆 仅在有内容的项目里才渲染完整）。
允许新建一次性项目 `RM-SIDEBAR-2026-09-27`；**不要在真实创作项目上执行**（本档只读，但隔离更稳）。

### 2.4 证据目录

`C:\Users\0\AppData\Local\Temp\nf-rm-2026-09-27\`（截图 + 文本快照；不进仓库）

---

## 3. 判定基准（每张卡的**应有**行为）

| 卡片 | 类型 | 主行为 | 热区 | 期望反应 | 右侧 `>` 含义 |
|---|---|---|---|---|---|
| 小说配置 | 导航卡 | 打开/切到配置编辑器 | 整行（含「已完成/待配置」） | 编辑区出现配置页 | 无（不得出现） |
| 故事架构 | 导航+折叠卡 | 行=打开架构编辑器 | 行=进入；chevron=独立按钮 | 编辑区出现架构页 | ⚠️ 现为折叠，**语义冲突** |
| 章节蓝图 | 导航卡 | 打开蓝图编辑器 | 整行（含 `N/M 章`） | 编辑区出现蓝图页 | 无（不得出现） |
| 分卷 | 折叠卡 | 展开/折叠 | **整行** | 卷列表显/隐 | 折叠（应在**左**） |
| 连载监控 | 折叠卡 | 展开/折叠 | **整行** | 导入列表显/隐 | 折叠（应在**左**） |
| AI 记忆 | 折叠卡 | 展开/折叠 | **整行** | 记忆列表显/隐 | 折叠（应在**左**） |
| 草稿箱 | 折叠卡 | 展开/折叠 | **整行**（含 `N 章`） | 草稿分组显/隐 | 折叠（应在**左**） |
| 正文章节 | 折叠卡 | 展开/折叠 | **整行**（含 `N 章`） | 章节列表显/隐 | 折叠（应在**左**） |

**三条判据**（对每张卡分别记）：
- **A 有反应吗**：点击后 `document.body.innerText` 是否变化（变化的**内容**也要记）
- **B 暗示与热区重合吗**：hover 变色元素的矩形 ⊇ 可点元素的矩形？差集 > 0 = **死带**
- **C 键盘够得到吗**：标题元素是否原生可聚焦（`<button>` 非 disabled / 无 `disabled` 的文本节点不可聚焦）

---

## 4. 标定脚本（**执行一次**，后续用例全靠它打的选择器）

```bash
cd E:/vela/11/vela-1
D=~/.claude/skills/computer-use/cdp.mjs

node "$D" eval "
const T = {'小说配置':'cfg','故事架构':'arch','章节蓝图':'bp','分卷':'vol','连载监控':'pub','AI 记忆':'mem','草稿箱':'draft','正文章节':'ms'};
const out = {};
for (const c of document.querySelectorAll('section.rounded-xl')) {
  const head = c.children[0];
  const txt = (head?.textContent || '').trim();
  const [label, slug] = Object.entries(T).find(([k]) => txt.startsWith(k)) || [];
  if (!slug) continue;
  const spans = [...head.querySelectorAll('span')].filter(s => !s.closest('button') && s.textContent.trim());
  const btns  = [...head.querySelectorAll('button')];
  const titleEl = [...head.querySelectorAll('span,button')].find(e => e.textContent.trim() === label);
  head.setAttribute('data-rm-probe', slug + '.row');
  titleEl?.setAttribute('data-rm-probe', slug + '.title');
  spans.at(-1)?.setAttribute('data-rm-probe', slug + '.count');
  btns.filter(b => b !== titleEl).at(-1)?.setAttribute('data-rm-probe', slug + '.chev');
  if (c.children[1]) c.children[1].setAttribute('data-rm-probe', slug + '.body');
  out[slug] = {
    titleTag: titleEl?.tagName + (titleEl?.disabled ? ':disabled' : ''),
    countText: spans.at(-1)?.textContent.trim() ?? null,
    btns: btns.length,
    chevTitle: btns.at(-1)?.getAttribute('title') ?? null,
    bodyPresent: !!c.children[1],
    titleFocusable: (() => { titleEl?.focus(); return document.activeElement === titleEl; })(),
  };
}
return out;"
```

**记录这张输出**——它就是 S 组的静态底账（`titleTag` = `SPAN` 或 `BUTTON:disabled` 即键盘不可达）。

**通用「有没有反应」探针**（每个 S 用例前后各跑一次）：

```bash
node "$D" eval "window.__rm = document.body.innerText; return window.__rm.length"     # ① 基线
node "$D" click '[data-rm-probe="draft.title"]'                                        # ② 点它
node "$D" eval "const b = window.__rm.split('\n'), a = document.body.innerText.split('\n');
  const d = a.filter(x => !b.includes(x)).slice(0,4), m = b.filter(x => !a.includes(x)).slice(0,4);
  return (d.length || m.length) ? 'CHANGED  新增=' + JSON.stringify(d) + ' 消失=' + JSON.stringify(m) : 'NO_CHANGE';"
node "$D" eval "const e = document.querySelector('[data-rm-probe=\"draft.body\"]'); return e ? e.offsetHeight > 0 : 'NO_BODY'"  # ③ 折叠类专用
```

---

## 5. 用例矩阵

> 结果列：`通过` / `失败` / `阻塞`。每条失败必须附 §8 缺陷单。
> **`NO_CHANGE` 不必然是失败**——按 §3 判定基准对照才算（纯状态卡本来就该零反应，但它也不该有 hover/手型）。

### S 组 — 鼠标响应（每卡 4 个探针：标题 / 计数 / chevron / 行空白）

| # | 卡片 | 探针 | 预期 | 结果 |
|---|---|---|---|---|
| S1 | 小说配置 | 点标题 → 点计数「已完成」→ 点行空白 | 标题：开配置页 ✅；计数与空白：**同一反应**（否则死带） | |
| S2 | 故事架构 | 点标题 → 点 `4/4` 计数 → 点右端 `>` | 标题：开架构页；计数同反应；`>` 应为**折叠**且与「进入」不冲突 | |
| S3 | 章节蓝图 | 点标题 → 点 `N/M 章` 计数 | 两者同一反应（开蓝图页） | |
| S4 | **分卷** | 点标题「分卷」 | 展开/折叠（现状预期 **NO_CHANGE** = 失败） | |
| S5 | **连载监控** | 点标题 → 展开后点一条列表行 | 标题折叠；列表行若 hover 变色则**必须有反应**（打开正文/详情） | |
| S6 | **AI 记忆** | 点标题 → 展开后点「章节摘要」行标题 | 标题折叠；行标题打开编辑器（现状：行内 `py-1.5` 死带） | |
| S7 | **草稿箱** | 点标题 → 点 `N 章` 计数 | 折叠；计数同反应（现状：`disabled` 按钮 = 外观可点、行为不可点） | |
| S8 | **正文章节** | 点标题 → 点 `N 章` 计数 → 点导出图标 | 折叠；计数同反应；导出图标**独立**触发（不得顺带折叠） | |

> S1–S8 每张卡**另记**：hover 变色矩形 vs 可点矩形（判据 B，几何断言）：

```bash
node "$D" eval "
const q = s => document.querySelector('[data-rm-probe=\"' + s + '\"]');
const r = e => e ? {x:e.getBoundingClientRect().x, y:e.getBoundingClientRect().y, w:e.getBoundingClientRect().width, h:e.getBoundingClientRect().height, hover:getComputedStyle(e).transitionProperty} : null;
return { row: r(q('draft.row')), title: r(q('draft.title')), count: r(q('draft.count')) };"
```

### K 组 — 键盘与焦点

| # | 用例 | 步骤 | 预期 | 结果 |
|---|---|---|---|---|
| K1 | 标题可聚焦性 | §4 标定输出的 `titleFocusable` 字段 | 8 张卡标题全部 `true`（`<button disabled>` 与纯 `<span>` 为 `false`） | |
| K2 | Tab 落点 | 聚焦第一张卡标题 → `key Tab` ×8，每次记 `document.activeElement` | 焦点只落在**能点的东西**上，不落在纯文本/禁用按钮上 | |

### G 组 — 复选框（不改数据）

| # | 用例 | 步骤 | 预期 | 结果 |
|---|---|---|---|---|
| G1 | 点击不落库 | 全程结束后查项目 `drafts`/`contents` 行数 | 与执行前一致（本档只读） | |
| G2 | 无 console 报错 | 全程 `Runtime.consoleAPICalled` / 日志 `~/.novelforge/logs/vela-2026-09-27.log` | 无新增 Error | |

---

## 6. 通过标准

| 级别 | 定义 | 处置 |
|---|---|---|
| **P1** | 主行为**零响应**（点标题什么都不发生）、点击触发**错误**行为（点导出顺带折叠）、键盘完全不可达 | 修复前排期 |
| **P2** | 死带（hover ⊃ 热区）、计数/状态文本在热区外、右端 `>` 语义冲突、命中区 <20×20 | 记录，随卡片可供性批次修 |
| **P3** | 观感（对齐、间距） | 记录 |

**判定**：8 张卡 × (A 有反应 + B 无死带 + C 可聚焦) 全绿 = 本批可供性缺陷清零；否则按 §8 逐条登记，直接喂给修复排期。

---

## 7. 结果记录表（2026-09-27 实测回填）

```
执行人：Claude Code · computer-use 技能（CDP 驱动：cdp.mjs + Temp 坐标扩展 rm-clickat.mjs）   日期：2026-09-27
构建：dev 未打包（master 72ece95；electron/main.ts 临时 CDP 端口行验后已还原，git diff 干净）
CDP target：page · NovelForge — AI 深度驱动的小说创作 IDE · http://localhost:5173/（remote-debugging-port 9222）
项目夹具：E:\vale\小说\斗罗大陆虚界之痕（只读；user_version=19 无迁移触发；automations / workflow_checkpoints 均空）
```

| # | 卡片 | A 有反应 | B 无死带 | C 可聚焦 | 结果 | 备注/证据 |
|---|---|---|---|---|---|---|
| S1 | 小说配置 | 标题 ✅（开配置页）/ 计数 ❌ / 行空白 = 标题按钮 ✅ | ❌ 计数在热区外 | ✅ | **失败（计数死区）** | 计数「已完成」点击 NO_CHANGE；flex-1 标题按钮铺满中段，无独立空白区 |
| S2 | 故事架构 | 标题 ✅（开架构页）/ 计数 ❌ / chevron ✅（仅折叠，不抢编辑器） | ❌ 整行暗示 ⊃ 热区 | ✅ | **失败（计数死区 + 暗示超热区）** | 悬停整行（含计数、空白）浮出工具提示「打开故事架构编辑器（可生成架构文档）」，但只有标题按钮/chevron 可点 → RM-SB-02 |
| S3 | 章节蓝图 | 标题 ✅（开蓝图页）/ 计数 ❌ / 行空白 = 标题按钮 ✅ | ❌ 计数在热区外 | ✅ | **失败（计数死区）** | 计数原文「50/5 章」系忠实渲染 `project_core.total_chapters=5`（数据如此，非渲染 bug） |
| S4 | 分卷 | 标题 ❌ / 计数 ❌ / 行空白 ❌ / chevron ✅（展开出「第1卷『虚界觉醒』1-50 章 10/50 章」） | ❌ 整行 132px 空白区零暗示零热区 | ❌ SPAN | **失败（主区不可点 + 键盘不可达）** | hover 采样：head 背景 hover 前后均 rgba(0,0,0,0)、cursor=auto |
| S5 | 连载监控 | 标题 ❌ / 计数 ❌ / 行空白 ❌ / chevron ✅（空态）/ 列表行 ⛔ | ❌ 同上（127px 空白） | ❌ SPAN | **失败 + 1 阻塞** | 列表行用例**阻塞（夹具 publication_tracker=0）**；展开显示「尚未导入任何平台章节」 |
| S6 | AI 记忆 | 标题 ❌ / 计数 ❌ / chevron ✅（收/展）/ 行主按钮 ✅（打开记忆文件） | ❌ 行内 6px 死带 | ❌ SPAN | **失败（主区不可点 + 行内死带）** | RM-SB-05：行 243×30 hover 高亮，主按钮仅 191×18；同点点击 NO_CHANGE；「重建」「删除」未触碰（红线） |
| S7 | 草稿箱 | 标题 ❌（disabled）/ 计数 ❌ / 行空白 ❌ / chevron ✅（展开出「第1章 雪夜入谷 2 稿…」） | ❌ disabled 反模式 + 计数死区 | ❌ BUTTON:disabled | **失败（主区不可点）** | 标题按钮 cursor=default（无虚假手型，但也零可点暗示） |
| S8 | 正文章节 | 标题 ❌ / 计数 ❌ / 行空白 ❌ / chevron ✅ / 导出图标 ⚠️ | ❌ disabled 反模式 | ❌ BUTTON:disabled | **失败 + 新缺陷 RM-SB-01（P1）** | 收起态点导出 = 零响应 + 状态泄漏（展开后弹窗自行出现）；展开态路径正常、Esc 可取消、不落盘、不顺带折叠 |
| K1 | 标题可聚焦 | — | — | **3/8 ✅** | **失败（5/8 键盘不可达）** | 可达仅 cfg/arch/bp；vol/pub/mem=SPAN、draft/ms=BUTTON:disabled |
| K2 | Tab 落点 | — | — | ✅ | **通过（附注）** | 焦点只落按钮、不落文本/禁用按钮；5 个死标题完全不在焦点链上（完整序列见 04-s-probes.log） |

**实测缺陷单**（编号 / 级别 / 卡片 / 现象 / 复现 / 证据 / 现状代码）

```
编号：RM-SB-01      级别：P1      卡片：正文章节
现象：卡片收起状态下点击头部「批量导出」图标零响应（弹窗不出现）；exportOpen 状态被静默置位，
      之后任意一次展开卡片，导出弹窗都会"突然自行出现"（状态泄漏）。
复现：收起 → 点导出 → 3s 内 6 次轮询 hasDialog=false（innerText 长度恒定 760）；
      随后仅点 chevron 展开（不再碰导出）→ 首次轮询 hasDialog=true、roleDialog=1。
证据：04-s-probes.log（S8-repro-2 / S8-repro-3）；08-export-dialog-deferred-open.png；
      点击命中确认 hits=1（收起态点击确实到达按钮，capture 阶段监听）
现状代码：ManuscriptGroup.tsx:249-254（ChapterExportDialog 挂在 SidebarGroup children 内）
          + SidebarGroup.tsx:96（收起态 `open ? children : null` → 弹窗组件不挂载，点击置位的状态无处渲染）
```

```
编号：RM-SB-02      级别：P2      卡片：故事架构
现象：悬停整行（含计数 4/4 与中段空白）浮出工具提示「打开故事架构编辑器（可生成架构文档）」，
      暗示"点哪都能进"，但点击仅标题按钮/chevron 有效；计数点击 NO_CHANGE = 暗示 ⊃ 热区。
证据：04-s-probes.log（S2b 干净版）；05-arch-tooltip-hover.png；工具提示 DOM 取证
      （自定义层 pointer-events-none fixed z-[var(--z-tooltip)]）
现状代码：ProjectTree.tsx:314 titleHint（经 SidebarGroup.tsx:63 挂在整行 head div）
```

```
编号：RM-SB-03      级别：P2      卡片：小说配置 / 故事架构 / 章节蓝图
现象：三张导航卡的计数文本（已完成 / 4/4 / 50/5 章）不在任何热区内，点击零反应（死区）。
证据：04-s-probes.log（S1b / S2b / S3b 均 NO_CHANGE）
现状代码：SidebarGroup.tsx:76-80（count 是标题按钮的兄弟节点，不随主按钮响应）
```

```
编号：RM-SB-04      级别：P2      卡片：分卷 / 连载监控 / AI 记忆 / 草稿箱 / 正文章节
现象：5 张折叠卡主区不可点——标题点击零反应且不可聚焦（3×SPAN + 2×BUTTON:disabled）；
      分卷/连载/记忆整行 127–139px 空白区无热区、无 hover 反馈；正确入口只剩 16×16 的 chevron。
证据：02-calibration.json（titleTag / titleFocusable 底账）；S4a-c / S5a-c / S6b-c / S7a-c / S8a-c 各 NO_CHANGE；
      分卷 head hover 采样（rgba(0,0,0,0) 前后不变）；K2 焦点链
现状代码：VolumeGroup.tsx:110-117、PublicationGroup.tsx:66-73、MemoryGroup.tsx:64-71（纯 span 无主按钮）；
          SidebarGroup.tsx:68（disabled={!onTitleClick}）
```

```
编号：RM-SB-05      级别：P2      卡片：AI 记忆（行内死带）
现象：记忆行 hover 整行高亮（243×30），但可点的主按钮只有 191×18；
      上下各 6px padding 带 + 左 6px：悬停有反馈、点击零反应。
证据：04-s-probes.log（S6d：hover @(180,569) 后行背景 rgba(0,0,0,0) → rgb(235,240,247)，同点点击 NO_CHANGE）
现状代码：MemoryGroup.tsx:208-215（hover:bg 在行容器上、点击在子按钮上）
```

```
编号：RM-SB-06      级别：P2（命中区）   卡片：6 张可折叠卡（arch/vol/pub/mem/draft/ms）
现象：chevron 折叠按钮命中区 16×16，低于 20×20 底线标准。
证据：03-geometry.json（chev w=16 h=16，6 处一致）
现状代码：SidebarGroup.tsx:86 / VolumeGroup.tsx:140 / PublicationGroup.tsx:85 / MemoryGroup.tsx:83（p-0.5 + 12px 图标）
```

**实测方法补充与档外观察**

1. 工具补充：`rm-clickat.mjs`（坐标级真实点击 / hover，仅存 Temp 证据目录，不进仓库）——「行空白」探针与 hover 实测依赖它；`cdp.mjs` 只能点元素中心。
2. 方法学备忘：应用会为 `title` 属性渲染**自定义工具提示**（非原生）——① 悬停产生的 tooltip 文本会混入 `innerText` diff（S2b 首测出现假 CHANGED，已用「移开鼠标」法消除并重测）；② 工具提示挂在整行 head div 的 `titleHint` 上，悬停计数/空白同样触发；③ 该机制会把 title 属性「消费」掉（hover 后 `getAttribute('title')` 变 null），事后拿 title 定位元素不可靠。**后续复用：diff 前先把鼠标移开。**
3. 档外观察（不属本档缺陷）：
   - 「50/5 章」：`project_core.total_chapters=5`、blueprints=50——渲染忠实于数据（用户配置如此）。
   - 导出弹窗章节列表的标题列显示「第1章 第1章」重复（titleMap 未就绪时的 fallback；仅观察到一次，未深查）。
   - disabled 标题按钮 cursor 为 `default`（`enabled:cursor-pointer` 限定），因此**没有**虚假手型——5 张卡的缺陷是「零暗示」而非「假暗示」。
4. 证据目录：`C:\Users\0\AppData\Local\Temp\nf-rm-2026-09-27\`（01/05/08/09 截图 + 06/07 反证截图；02/02b/03 JSON；04-s-probes.log 全程日志；before/after-rows.json）。G1 行数前后一致（drafts 14 / contents 14 / blueprints 50 / archives 4 / volumes 1 / memory 1 / pub 0）；G2 零 console 错误、dev 日志零新增 Error。
5. 全程未触碰：记忆「重建」/「删除」、分卷增删、连载导入保存、导出执行、任何对话框的保存/确定键；对话框仅经 Esc 关闭。

---

## 8. 预算与副作用

| 项 | 说明 |
|---|---|
| API 花费 | **零**。本档全部动作是本地 DOM 交互 + 编辑器页打开 |
| ⛔ 禁点 | AI 记忆行的「重建」按钮（`MemoryGroup.tsx:240` `onRebuild` → 可能触发 LLM 摘要重建）。卡片头的「刷新」是本地读文件，允许 |
| 数据 | 只读：不点删除、不点导入保存、不点「自动划分卷」确认 |
| 桌面 | `pnpm run dev` 会弹真实 Electron 窗口（占前台，不接管鼠标）；CDP 点击是合成事件，**不动用户鼠标** |

## 9. 执行后撤销清单

- [ ] 删除 `electron/main.ts` 的 `RM-TEMP` 那一行（`git diff` 必须干净）
- [ ] 关闭 dev（Ctrl+C / 关窗口）
- [ ] 证据目录保留在 Temp（不进仓库）

---

## 10. 本次执行已知的外部阻塞

| 阻塞 | 影响 | 解除方式 |
|---|---|---|
| Windows-MCP 桌面工具本会话不可用（`aio` 服务 `CONNECTION_CLOSED`） | **坐标点击兜底不可用**；CDP 主路线不受影响 | 重启 Claude Code 让 MCP server 重连 |
| 本档未获批准 | 无授权 → 不得启动应用/改 main.ts/点击 | 批准本档 |

**变更记录**

| 日期 | 变更 |
|---|---|
| 2026-09-27 | 首版：基于 `card-affordance-standard` §8（2026-09-26 静态判定）+ 当日源码复核编写 |
