# UI 审计跟进项（2026-09-25）

> 本轮 UI 全面审计已落地批次 1 / 2 / 3 / 4（共 17 个提交）。
> 本文记录**剩余项**（批次 4 收尾 + 若干待决策）与**真机待测清单**。
> 本轮沉淀的两份规范：`.agents/skills/ui-interaction-standard/SKILL.md`（交互与可达性）、
> `.agents/skills/ui-layout-standard/SKILL.md`（刻度体系，本轮新增 §8–§11）。
> ⚠️ `.agents/` 被 gitignore，这两份**只在本地**；其中的关键结论已同步写进受版本控制的
> 代码注释（`index.css`、`color-token-guard.test.ts`、`useFloatingPosition.ts`）。

---

## 一、批次 4 剩余项（**待决策，下次进行**）

### 1. 浮层外壳收敛（10 处 → `ui/Popover`）

**现状**：10 处浮层外壳共享同一份内联样式块（`z-[var(--z-dropdown)] py-1 rounded-lg` +
`{ position: fixed, visibility: hidden, backgroundColor: var(--color-sidebar), border, boxShadow }`）。
批次 2b 已把它们的阴影统一到 `var(--shadow-popover)`，**视觉上已经一致**。

**为什么单独一批**：这 10 处用的是**两套定位机制**——
- `useFloatingPosition`（JS 计算 fixed 坐标）：`+` 菜单 / @提及 / 斜杠 / 文件选择 / AGENT「更多」/ 上下文明细 / 水温
- CSS 锚点 `.floating-menu`（`anchor()`）：主题菜单 / 深度档位 / 模型菜单（锚点都是按钮本身，符合可用形态）

抽组件时 API 必须同时容纳两者（一个传 ref，一个传 anchor-name），且 10 处都在**主交互路径**上。

**建议做法**：先固定 API 形态（如 `<PopoverSurface ref? anchorName? className? style?>` 只负责视觉外壳，
定位仍由调用方决定），再逐处迁移；**做完必须真机过一遍所有菜单**（见下方清单）。

**收益评估**：视觉收益≈0（2b 已完成统一），主要价值是**防止将来漂移**。故优先级低于其他项。

> ✅ **2026-09-25 已完成**：新增 `src/components/ui/PopoverSurface.tsx`（含 12 条测试），
> 10 处外壳全部迁移。两套定位机制由 **`ref` / `anchorName` 二选一**区分，组件只做一次分支：
> JS 模式补 `z-[var(--z-dropdown)]` + `position: fixed; visibility: hidden`；
> 锚点模式补 `floating-menu floating-menu--{placement}` + `positionAnchor`。
> 组件**只管外观**——不持有开关状态、不接管定位算法、不挂 Esc/点击外部（那些仍由各调用方负责）。
>
> 迁移中的两处事实更正：
> - **`RightToolWindowBar` 用的是 `--color-panel`**，其余 9 处用 `--color-sidebar`。
>   四主题下两者**取值完全相同**，故统一是**视觉零变化**（属命名漂移）。
> - 类名层面原本还有第三套写法差异：`RightToolWindowBar` 用 Tailwind 的 `border` 类 + 内联
>   `borderColor`，其余用内联 `border: 1px solid var(--color-border)`——等价，已统一为后者。
>
> 明确排除（非"同一外壳"）：`NovelConfigEditor` 的提示气泡是 **tooltip**
> （`--color-bg-elevated` 底 + `--z-tooltip` + `pointerEvents: none`）；
> `ui/ContextMenu` 是鼠标坐标定位的右键菜单（圆角 `radius-xl`、`minWidth 200`），
> 若要复用需给组件加圆角变体，本轮不做。
>
> ⚠️ **待真机验证**（这 10 条主交互路径此前零测试覆盖，自动化证据只到「类名与样式令牌正确」）：
> ① `+` 上下文菜单 ② @提及 ③ 斜杠命令 ④ 文件选择 ⑤ AGENT「更多」（含宽度 200↔260 过渡）
> ⑥ 上下文明细 ⑦ 水温 ⑧ 主题菜单 ⑨ 深度档位 ⑩ 模型菜单
> ——逐项确认：位置正确、不被裁切、底色/描边/阴影与其它菜单一致、点外部与 Esc 仍能关。


### 2. 共用组件抽取（需先设计 API + 审美定夺）

| 重复项 | 处数 | 阻塞点 |
|---|---|---|
| `ui/MenuItem` | 5 套（`ui/MenuItem` 基准 / AgentInputBox 两套 / RightToolWindowBar / StatusBar 温度预设） | 需加 `selected` / `trailing` / `compact` 三个 prop；选中指示有三种流派（bg / accent 文字 / Check 图标） |
| `ui/SegmentedControl` | 5 套（LogFileDialog / ActivityView / LogsView / UsageStatsView / ChapterExportDialog） | **激活视觉两种流派**：accent 实底+白字 vs "浮起药丸"（后者用硬编码 boxShadow）——**属审美决定** |
| `ui/Confirm` 收敛 | 3 套（`Confirm.tsx` 两份壳 + `agent/ConfirmCard.tsx` 走 CSS 类） | 第三按钮需做成 `confirm()` 的 options；`ConfirmCard` 靠 `agent-tools.css` 三个类 |
| `ui/Table` | 2 处逐字符相同（`UsageStatsView` 的 StatsTable ↔ `ui/MarkdownContent` 内表格） | 只差 `my-2` 与行 hover |

附带死规则：`agent-tools.css:205-207` 的 `.confirm-card-btn.approve:hover` 与常态同色 → **hover 零反馈**，
属可删的死规则。

> ✅ **2026-09-25 已完成**。四个子项全部收敛，另**发现并修复一个存量系统性 bug**（见文末）。
>
> **审美拍板**（两项，均取多数派）：分段控件 = **描边分段条 + accent 实底白字**
> （4/5 处现状；被弃的「浮起白药丸」用的是硬编码 boxShadow）；菜单选中 = **Check 图标 + accent 文字**
> （不占底色，故与悬停态终生可分——模型菜单此前选中与悬停同色，无法分辨）。
>
> | 产物 | 收敛内容 |
> |---|---|
> | `ui/Table`（新） | 2 处逐字符相同的表格；差异做成 `hoverableRows` / `nowrapCells` 两个 prop，`my-2` 由调用方 className 传。**实为三处差异**（文档原写两处，漏了 `td` 的 `whiteSpace: nowrap`）。StatsTable 有 **3 个**调用点（非 1 个）。顺带修掉「以表头文本为 key」的重复 key 隐患 |
> | `ui/ModalShell`（新） | Confirm.tsx 两份模态的遮罩 + 卡片；另抽出 `useExitDelay`（退场 200ms 与动画对齐）与 `mountDialog`（命令式挂载生命周期，三个入口共用） |
> | `agent/ConfirmCard` | 按钮改用 `ui/Button`（success / outline），删掉 `.confirm-card-btn` 系列 5 条 CSS —— 其中 `.approve:hover` 与常态同色（零反馈死规则）。⚠️ `ConfirmCard` 是**消息流内联卡片**，不是模态，未并入 `ui/Confirm` |
> | `ui/SegmentedControl`（新） | 6 处（ActivityView / UsageStatsView / LogsView / LogFileDialog / ChapterExportDialog / StatusBar 温度预设）。**3 处观感按拍板改变**：UsageStatsView（药丸容器→描边条）、LogsView（无容器→描边条）、ChapterExportDialog（浮起白药丸→accent 实底）。尺寸收敛为 sm(11px/text-micro) / md(12px/text-xs) 两档 |
> | `ui/MenuItem`（扩展） | 3 处自绘菜单项（ContextMenuItem ×3 用法 / ModelMenuItem / 主题项）。新增 `selected` / `trailing` / `className`，`onClick` 放宽为可收 MouseEvent（主题切换要用点击坐标）。⚠️ **`compact` prop 最终没做**——「温度预设」经复核是「选一个值」而非「执行一个命令」，归了 SegmentedControl，API 因此少一档密度分叉。ContextMenuItem 的 `disabled`/`comingSoon` 分支经查无任何调用方使用（`agent.comingSoon` 成为零引用键，暂留字典） |
>
> ⚠️ **真机待看**（观感变化处）：① UsageStats / LogsView / ChapterExport 三处分段控件新形态
> ② 模型菜单选中项（现为 accent 文字 + Check）③ 主题菜单（文字色由 secondary 收敛为正文色、间距 px-2.5→px-3）
> ④ ConfirmCard 的两个按钮（换 ui/Button 后配色与按下/焦点反馈变化）⑤ 统计表与 Markdown 表格（应无变化）
>
> ### 🔴 附带发现并修复的存量 bug：`cn()` 吞掉自定义字号
>
> `cn()` 用**裸 `twMerge`，无自定义配置**。项目在 `@theme` 里自定义的字号档
> `--text-2xs` / `--text-micro` 不被 twMerge 认识，它按 `text-<任意值>` 兜底规则把
> `text-micro` 归进**文字颜色**组 → 与 `text-white` / `text-[var(--color-text-*)]` 判为同类冲突，
> **后者胜、字号被静默丢弃**（不报错、不警告，只是字比预期大一号）。
>
> 影响面：全仓 262 处使用这两档，其中 **4 处在 `cn()` 里与文字颜色同现**而丢字号——
> `ChapterCardEditor:419`（角色徽标）/ `KnowledgeOverview:414` / `CharactersView:176`（筛选 chip）/
> `ui/Select.tsx:115`（Select 标签）。修复：`extendTailwindMerge` 把两档登记进 `font-size` 组
> （`src/lib/utils.ts`，附 7 条测试）。**这 4 处字号会变小一号——是修复，非回归**，真机顺带确认。
> 新增自定义字号档时必须同步加进该列表。

### 3. 空态文案 key 合并（5 → 1）

同一句"请先打开项目"占了 5 个 key：`empty.pleaseOpenProject` / `knowledge.openProjectFirst` /
`blueprint.openProjectFirst` / `project.noProject` / `editor.noProject`（前三个 zh 完全相同、en 三种写法），
另有 3 个零引用键（`error.noProject` / `export.noProject` / `guard.noProject`）。

**为什么不在本轮做**：要删 i18n key + 改 8 个调用点，删错 key 的后果（其他语言缺失 / 运行时取不到 key）
比收益大。建议单独一批，**改完必须三语各切一遍**看空态。

> ⚠️ **2026-09-25 已完成——但上文有三处失实，勿再沿用该判断**：
> ① `error.noProject` **不是零引用**（41 处：agent 工具 17 + workflow 命令与守卫 20 + kb-controller 4）；
> ② `guard.noProject` **不是零引用**（5 处，`workflow-guards.ts`）；
> ③ `editor.noProject` **不属"同一句"**——其文案是「在左侧项目树中单击文件开始编辑」，
> 场景是**「有项目但没有打开的 Tab」**（`EditorArea.tsx:466` 注释），与外三键语义无关。
> 照上文删除会打断 46 处调用，用户与 **LLM 上下文**将直接看到 key 字面量。
>
> **实际完成范围**：`knowledge.openProjectFirst` + `blueprint.openProjectFirst` + `project.noProject`
> 三键并入 `empty.pleaseOpenProject`（含 ProjectTree 文案由「未打开项目」改为「请先打开项目」），
> 共 **7 个调用点**统一；真死键 `export.noProject` 删除；`error.` / `guard.` / `editor.noProject` 三键保留。
> `empty.pleaseOpenProject` 的 ru 文案由「Откройте проект」改为多数派的「Сначала откройте проект」。
>
> **同时新增守卫** `src/shared/i18n-key-guard.test.ts`：扫描 `t()` 字面量引用，断言 key 均在字典中
> （只做「用了但没有」单向检测；反向的零引用检测因动态 key 误报过多而刻意不做）。
> 该守卫在本次合并中实测有效：删键后立即失败并精确列出 5 个悬空调用点。
>
> ✅ **三语空态已真机确认（2026-09-25，用户实测无问题）**。

### 4. 其他已知但未动的项

- **`ui/` 组件复用**：手写 `<button>` 169 处（仅 35 文件 import `ui/Button`）、手写 `<input>` 17 处
  （`CharactersView:193` 与 `KnowledgePanel:231` 是两份几乎相同的搜索框）、手写 `<label>` 19 处、
  手写 `<textarea>` 5 处、手写 checkbox 3 处 → 属长期收敛，非一次性
- **图标尺寸 10/11/12/13/14 五档**（475 处）：见 §三 决策点
- **`.tree-item` 的 `cursor-pointer`**：批次 3 已把 4 处 `.tree-item` 行的左缩进移到主按钮上，
  但**类本身仍带 `cursor-pointer`**；若将来新增行仍用 `<div onClick>`，会重新引入假可供性

> ✅ **2026-09-25 已完成前两项**（第三项仍待你拍板）。
>
> **① `.tree-item` 的 `cursor-pointer` 已移除**：批次 3 号称已消除假可供性，实际只是把它从
> **左缩进区**挪到了**右侧 8px 留白**（该处 `paddingRight: 8` 且不可点，却因类自带手型光标而
> 显示为可点）。4 处使用点（DraftBoxGroup / ManuscriptGroup / ProjectTree / SidebarShared）
> 均已确认内层主按钮自带光标，移除后手型只出现在真实可点区。
>
> **② 表单控件收敛 —— 但清单里的「28 处」经逐处复核后只有 7 处成立**（本次第四次遇到
> 「清单不能照单全改」）：
>
> | 清单说法 | 实况 |
> |---|---|
> | 手写 input 17 处 / textarea 5 处 / checkbox 3 处 | 其中 **3 处是 `input[range]` 滑块**（水温/深度/向量参数）、**3 处是 `input[radio]`**（向量配置，被记成了 checkbox）、**4 处是无外观内联编辑器**（重命名框/聊天输入/菜单内搜索，`bg-transparent outline-none` 属有意为之）、**3 处是原生/custom checkbox**（`accent-[var(--color-accent)]` 是刻意的原生风格，且 `ui/` 下并无 Checkbox） |
> | 「`CharactersView` 与 `KnowledgePanel` 是两份几乎相同的搜索框」 | ✅ 属实 —— 但它们**就是 `ui/Input` 的紧凑版**（同一套 10 个外观类，只是 h-6/text-micro） |
>
> **已收敛 7 处**：2 搜索框 → `ui/Input`（`className="h-6 text-micro"`）；3 文本域
> （DeveloperModeSection / AIActionDialog / ReviewReport）→ `ui/Textarea`；MCPSettings 添加表单
> 3 输入框 → `ui/Input`（保留 `--color-hover` 底色，因嵌在 panel 底色卡片里）；
> PromptSettings 提示词编辑器 → `ui/Textarea`（顺带删掉手工 onFocus/onBlur 改 borderColor）。
>
> ⚠️ **没有新建 `ui/SearchInput`** —— 那等于为一个 className 覆盖造一层 API。
>
> **③ 图标尺寸 10/11/12/13/14 五档（475 处）仍待你拍板**（§三 决策点 1）：
> 保持现状 / 收敛到 12/14。我的建议仍是**保持**——收敛需动约 268 处，而图标变化会挤压
> 固定高度的按钮与行，回归面大于收益。
>
> **仍未动的长尾**：手写 `<button>` 189 处、`<label>` 21 处。属长期收敛，建议按模块分多批。

---

## 二、真机待测清单（**本轮改动全部是视觉与行为改动，以下必须人工过**）

> ✅ **2026-09-25：用户已完成 UI 真机测试，暂无问题**（含后续跟进项 1/2 引入的观感变化：
> 10 处浮层、3 处分段控件新形态、模型菜单选中项、主题菜单、ConfirmCard 按钮、
> `cn` 修复的 4 处字号、搜索框焦点环、`.tree-item` 留白光标）。
> 下方清单保留作为**改动记录与回归参照** —— 将来再动这些区域时按此逐项复查。

> 自动化证据止于「结构正确 + 类真的生成」；**好不好看、点得对不对只能真机判断**。

### A. 批次 1（静默失效修复）

1. **有框无底的盒子**：打开「导出章节」对话框 / 评审报告 / 角色编辑器的出场章节标签 / 三方合并工具条
   → 期望都能看到**底色**（此前只有边框没填充）
2. **主题切换（4 套）**：切换主题后确认上述底色随主题变化（不是写死的白）
3. **上下文占用条**：AGENT 面板点圆环 → 明细里 `基础` 与 `记忆` 两段**颜色必须可区分**
   （此前默认主题下同色，会连成一整块）
4. **键盘 Tab 走左右图标栏**：应能看到**焦点环**（此前被 `.tool-btn{outline:none}` 压掉，完全没指示）
5. **斜杠菜单**：输入 `/xyz`（无匹配）后按回车 → 应能**正常发送消息**（此前回车被吞、既不发也不换行）
6. **@提及菜单**：输入 `@zzz` 再退格回 `@世` → 菜单**必须可见且位置正确**
   （此前会永久隐形却仍响应键盘，回车会选走看不见的第一条）

### B. 批次 2（视觉体系）

7. **小字观感**：任意页面扫一遍，10px / 11px 两档是否仍显参差（此前 10 档挤在 3px 区间）
8. **深色主题下的浮层**：菜单 / 对话框 / Tooltip 的阴影现在跟随主题
   （此前 `shadow-lg` 是 Tailwind 内置纯黑、不通主题，深色下分层感明显偏弱）
9. **Input 与 Select 并排**：设置页里两者圆角应一致（此前 Select 触发器 10px vs 输入控件 6px）
10. **图标观感**：空态/错误态图标（空态 36px）与工具栏图标（14px）是否协调
11. **按钮悬停**：危险/成功按钮悬停应有**品牌色光晕**（本轮改动中曾一度会被破坏，已修复）

### C. 批次 3（交互与可达性）

12. **Esc 关闭 9 处浮层**：`+` 菜单 / 深度档位 / 模型菜单 / AGENT「更多」/ 上下文明细 / 水温 / 主题 / 接受浮层 / **设置模态**
13. **上下文明细浮层**：点外部应能关闭（此前唯一一处 Esc 和点击外部都没有，只能再点一次圆环）
14. **hover 才显形的按钮**：用 Tab 走到它们 → 应**显形**（此前 Tab 到的是隐形按钮）
15. **删除会话 / 删除模型配置**：应弹**二次确认**（此前一点即删，删除会话会清空整段历史）
16. **AI 主输入框**：点进去时容器边框应**点亮**（此前无任何焦点指示）
17. **加载失败态**：断网/制造失败后，知识面板 / 知识概览 / MCP 设置 / 技能 / 活动 / 版本历史 / 记忆
    → 应显示**「加载失败」+ 重试**，而不是伪装成「暂无数据」
18. **侧栏行的键盘可达**：Tab 到章节行 / 草稿行 / 卷行 → 应能聚焦并**回车打开**；
    行内操作按钮（导出/重建/删除）应能**独立 Tab 到**
19. **侧栏点击热区**：点章节行的**缩进空白**应仍能打开（左缩进已移到主按钮上）
20. **ProjectSquareList**：Tab 到项目方块 → 应能聚焦；删除入口应能**独立 Tab 到**（此前是嵌套的 `span[role=button]`，键盘完全够不到）

### D. 批次 4（收敛）

21. **加载指示**：找任意**刷新按钮** → 空闲态应是**刷新图标**（不是转圈的加载图标），加载时才旋转
22. **徽标**：工具调用的来源徽标（内置/MCP/技能）、章节创建对话框的标签 → 观感应与其它徽标一致
23. **空态**：各面板的空态（无数据时）观感应一致（opacity / 内边距此前有 3–4 档差异，本轮已统一）
24. **侧栏卡片**：「标题到内容」的间距在所有分组应一致（`SidebarGroup` 此前少 6px）
25. **进度条**：模型下载 / 向量回填 / 底部任务 → 高度与配色应一致

---

## 三、需要你拍板的决策点（**已全部结案**，2026-09-25）

| # | 决策 | 结论 | 落地 |
|---|---|---|---|
| 1 | **图标尺寸是否继续收敛** | ✅ **保持现状**（10/11/12/13/14 五档不收敛，用户 2026-09-25 拍板） | 不动代码。理由：收敛需改约 268 处，且图标变化会挤压固定高度的按钮/行 —— 收益（少三档）不足以抵这个风险面。**新增禁止**：`ui-layout-standard` §9 已写明「10/11/13 三个密集档属可接受范围，不要再新增」 |
| 2 | **激活视觉定哪一派** | ✅ accent 实底 + 白字（多数派） | `ui/SegmentedControl` 按此形态落地（描边容器 + 激活块贴边） |
| 3 | **菜单选中指示定哪一派** | ✅ accent 文字 + 尾部 Check（**刻意不设底色**） | `ui/MenuItem` 的 `selected` 按此落地 —— 底色留给 hover，两者都用底色会分不清「正悬停」与「当前选中」 |
| 4 | 浮层外壳是否现在就抽 | ✅ 抽（防漂移） | `ui/PopoverSurface` 收敛 10 处；两种定位模式（JS ref / CSS anchor）的契约差异写在组件头注释 |

---

## 四、方法论沉淀（本轮有效、建议沿用）

1. **并行只读审计员 + 逐条复核**：5 个维度并行审，但**审计员的清单不能照单全改**——
   本轮拦下 4 处误报（`UsageStatsView` 早有错误态、`SidebarShared:89` 非组件、
   `MemoryGroup:150` 指错行、`KnowledgeOverview:322` 实际是 Button）。
2. **区分「静默失效」与「观感不一致」**：前者改完就是对的（批次 1），后者需要设计定夺（批次 2/4）。
3. **批量替换前先确认旧写法的语义边界**：字号替换必须做**中性替换**（`text-[10px]` 只设字号，
   档位若带 `--line-height` 会连带改行高）。
4. **机械替换后必须复审 diff**：本轮两次拦下自己造成的回归
   （把"刷新按钮"换成"加载图标"、`shadow-[任意值]` 破坏颜色工具类）。
5. **验证到「构建产物」这一层**：CSS 转义陷阱（`.` 与括号会被转义）让人误判"类没生效"，
   教训已写入 `ui-layout-standard` §6。
