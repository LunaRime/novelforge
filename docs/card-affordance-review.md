# 卡片可供性复核报告（侧栏 / AI 面板 / 收件箱 / 子会话卡）

> **日期**：2026-09-26
> **依据标准**：`.agents/skills/card-affordance-standard/SKILL.md`（同日沉淀，本报告是它的实测来源）
> **检查范围**：应用侧栏「项目结构」视图 8 张卡片、AI 面板（`src/components/panels/agent/**`，14 个非测试文件）、收件箱（`panels/automation/**`）、C 档第二轮新增的子会话卡与审批卡
> **方法**：全量读源码 + 一次只读交叉审计（逐文件通读，非 grep 抽样）+ 有/无标准两次独立判定的对照
> **未做**：本报告不含任何代码改动；所有结论附 `文件:行`，动手前请按行号复核一次

---

## 一、核心原则

**视觉暗示 = 点击热区 = 响应反馈。** 三者必须重合：有暗示就必须有热区与反馈；没有热区就不许有任何暗示。

## 二、判据速查

**四类卡片**（先回答"点这一行要发生什么"，答不出来就是纯状态卡）：

| 类型 | 主行为 | 热区 | 右侧 |
|---|---|---|---|
| 导航卡 | 进入 | **整行**（标题 + 中间空白 + 计数） | 主按钮内 `>`，纯装饰 |
| 折叠卡 | 展开/折叠 | **整行** | chevron 在主按钮内、**置左**；右端不得出现 `>` |
| 导航+折叠卡 | 行 = 进入 | 行 = 进入；左箭头 = 独立按钮 | 左 chevron 按钮 + 主按钮内 `>` |
| 纯状态卡 | 无 | **无**（不进 Tab、无 hover、光标默认） | 只有状态文字 |

**两条硬判据**：

- **纯展示内容进主按钮，有独立行为的控件出主按钮**（后者必须是主按钮的**兄弟节点**）——这是"点右边没反应"的唯一根因
- **hover 变色的元素边界必须 ≥ 可点热区边界**（多出来的部分是死带）

**实现形态只有一种**：外层 `div` 只留视觉类 / padding / `onContextMenu` / `title`；内容包进 `flex-1` 主按钮；操作按钮作兄弟。兄弟形态下外层无点击处理器 → **不需要 `stopPropagation`**。禁止：`div onClick`、`button` 嵌 `button`、用 `disabled` 表达"这里不可点"。

**命中区底线**：**20×20**（不是移动端的 44×44；本仓 `html{font-size:14px}` 使 1 个 spacing 单位 = **3.5px**，`w-5` 只有 17.5px）——一律用固定像素写。⚠️ 下面各处给的像素值都是**宽度**（由 padding + 固定图标宽决定，是确定值）；高度受行盒影响，估算会偏，**只要任一边不足 20 即不达标**。

## 三、侧栏「项目结构」8 张卡片（实测）

| 卡片 | 位置 | 标题行 | 右侧 | 判定 |
|---|---|---|---|---|
| 小说配置 | `ProjectTree.tsx:192` | 可点 → 打开编辑器 | 「已完成/待配置」在按钮外，**无 `>`** | ❌ 缺 `>` + 计数死区 |
| 故事架构 | `ProjectTree.tsx:283` | 可点 → 打开编辑器 | `4/4` 死区 + 右端 `>`（其实是折叠） | ❌ `>` 语义冲突 |
| 章节蓝图 | `ProjectTree.tsx:229` | 可点 → 打开编辑器 | `50/5 章` 死区，**无 `>`** | ❌ 缺 `>` + 计数死区 |
| 分卷 | `VolumeGroup.tsx:110` | **纯 span 死区** | 计数 + Layers + `+` + `>` | ❌ 主区不可点 |
| 连载监控 | `PublicationGroup.tsx:66` | **纯 span 死区** | 计数 + `+` + `>` | ❌ 主区不可点；列表行 hover 无点击（`:101`） |
| AI 记忆 | `MemoryGroup.tsx:64` | **纯 span 死区** | 计数 + 刷新 + `>` | ❌ 主区不可点 |
| 草稿箱 | `DraftBoxGroup.tsx:56` | `disabled` 按钮 | `N 章` 死区 + `>` | ❌ `disabled` 反模式 |
| 正文章节 | `ManuscriptGroup.tsx:162` | `disabled` 按钮 | `N 章` 死区 + 导出 + `>` | ❌ `disabled` 反模式 |

**最要紧的一条**：卡片头最右端的 `>` **全是折叠**（`SidebarGroup.tsx:90-92`、`VolumeGroup.tsx:145-147`、`PublicationGroup.tsx:90`、`MemoryGroup.tsx:88`），而**真能进入的两张卡（小说配置 / 章节蓝图）右侧反而没有任何箭头**。这导致 2026-09-26 的一次独立评审把三张卡的 `>` 读成了"进入"——**该字形在卡片版式里已被证明歧义**，不能继续兼任两义。

**同款外观三种行为**（可导航 / 纯展示死区 / `disabled`），用户无法从外观预测，是同屏一致性的根本缺口。

**修法**：折叠箭头**移到标题左侧**（与既有行语言统一：`VolumeGroup.tsx:240-242`、`DraftBoxGroup.tsx:126-129`、`CharactersView.tsx:222-225`），右端留给"进入"的 `>`；计数进主按钮；`SidebarGroup` 的 `disabled` 标题改为纯 `<span>`。

**已达标，不要改**：行/卷/草稿/角色行 = 主按钮 + 兄弟操作按钮（`MemoryGroup.test.tsx:112` 有 `button button` = 0 的断言）；图标按钮自带 hover 底色；加载失败态与空态分开渲染（`MemoryGroup.tsx:92-109`）。

## 四、AI 面板 / 收件箱（实测站点）

| 站点 | 形态 | 判定 |
|---|---|---|
| `AgentMemoryView.tsx:140`（复用侧栏 `MemoryList`） | `MemoryGroup.tsx:208-215` 的死带**同源同现** | 修一处、两处同变，别当两个任务 |
| `ArtifactCard.tsx:81` + `:58-78` | `<div onClick>` + hover 变色（`agent-tools.css:183-186`），但只有 `path && type ∈ {file_created, file_modified, tab_opened}` 才有动作 | ❌ 其余产物类型点下去零响应；`div onClick` 键盘不可达。**「有内容可给」→ 接线，别删 hover**：`blueprint_generated` 带 `metadata.chapterNumber`（`output-post-processor.ts:103-108`）可跳章节、`workflow_started` 可跳任务面板 |
| `ToolCallBlock.tsx:87-89` | hover 变色挂**整块** `.tool-call-block`（`agent-tools.css:19-21`），点击只在 `.tool-call-header` | ❌ 展开后悬停参数/结果区，边框亮着点不动（hover ⊃ 热区）。头部 `div onClick` 亦键盘不可达 |
| `BottomPanel.tsx:182-203` | 历史行 `hover:bg` + 整棵子树无 `onClick` | ❌ 与 `PublicationGroup.tsx:101` 同类 |
| `BottomPanel.tsx:253-255`、`:419-420` | `cursor-pointer` + `div onClick` 做折叠，无键盘路径 | ❌ |
| 折叠箭头在右端 | `ToolCallBlock.tsx:124-127`（`.tool-call-arrow{margin-left:auto}`）、`ThinkingCollapse.tsx:29-30` | ❌ 同面板的工作区折叠却在**左端**（`AgentConversation.tsx:520-524`）→ 同屏两种位置 |
| `AgentConversation.tsx:661-670` | 手写 `role="button"` + `tabIndex`，`onKeyDown` **只判 Enter、缺 Space**；容器内含 5 个真 `<button>`（`:706-747`） | ❌ 注释（`:636-637`）以"内嵌 input 不能塞进 button"为由规避不成立——编辑态本是独立分支（`:641-658`），**不需要例外** |
| 命中区 <20px（值为宽度） | `AgentConversation.tsx:604` = 17.5px（**9 处**：`:534/545/552/565`、`:707/715/724/733/742`）、`AgentMemoryView.tsx:105` = 15.5px、`AgentMessage.tsx:56/73/81/100-119` = 19px、`AgentHeader.tsx:80/95/175` = 18px（这三处是显式 `width/height`，确定值） | ❌ |

⚠️ **`AgentConversation.tsx:603-604` 的注释写着「命中区 16×16 → 20×20」，代码写 `w-5 h-5`**——意图对、数值错，实渲染 17.5px，而注释让人以为已修好。**改完要用「原生 px 才算数」复核，别信注释。**

**已达标，不要改**：`AgentInputBox.tsx:672-688`（21px）、`:633`（发送按钮 21px）、`InboxItemCard.tsx:97/102`、`ConfirmCard.tsx:74/78/87`；`AgentConversation.tsx:530/701/694` 的 hover 显形按钮已补 `group-focus-within` 兜底（**这是合法的 hover 显形**，只做 hover 那一半才是隐形按钮）；`InboxItemCard.tsx:94-107` 用**不渲染**（`canRun &&`）+「仅提醒」标签表达"按策略不提供该操作"——**这是 §二「没有主行为」的正面范例**。

## 五、C 档第二轮两张新卡（已落地，复核结论）

### `SubAgentSessionCard.tsx` —— 折叠卡，四处不合规

| 检查项 | 结果 |
|---|---|
| 头部整行可点 | ❌ `:36-68` 只有最右 15.5px 的按钮能点，描述/状态/工具数都是死区 |
| 折叠箭头位置 | ❌ 在**右端**（`:67`）——正是 §三 证明会被读成"进入"的位置 |
| 命中区 | ❌ 取消 `:50-58` 宽 = 11 + 3.5 = **14.5px**；折叠 `:60-68` 宽 = 12 + 3.5 = **15.5px**（高度按行盒估算约 19px；只要任一边 <20 即不达标） |
| 纯展示内容 | ❌ 状态（`:43-45`）与工具数（`:46-48`）在主按钮外 |
| 取消按钮形态 | ✅ 兄弟节点、无嵌套、无需 `stopPropagation`；只在 `running` 出现（非 hover 显形）、有 hover 底色与解释性 title（"取消这个子 agent（不中断当前对话）"） |
| 状态不只靠颜色 | ✅ 文字 + 颜色 + 图标（spinner/Bot）三通道 |
| 展开体 | ✅ 在头部按钮之外（`:73-79`），不与点击冲突 |
| 与 spec §3.10 的差异 | spec 写"步数/工具数/tokens"，实现只显示工具数（`session.toolCalls.length`），tokens 改在结果页脚出现 |

**修法**：头部内容（图标 + 描述 + 状态 + 工具数）包进 `flex-1` 主按钮并把 chevron 移到**左端**，取消按钮作兄弟；两个图标按钮改固定像素 ≥20×20。展开体保持现状。

### `SubAgentConfirmCard.tsx` —— 基本合规

| 检查项 | 结果 |
|---|---|
| 假可供性 | ✅ 容器无 hover/手型，无主体点击（纯操作卡） |
| 静默失败 | ✅ 120 秒自动拒绝**已在卡上披露**（`subagent.confirmHint` 明写"120 秒未回应将自动拒绝"） |
| 授权放大 | ✅ 刻意不给「始终允许」（spec §3.5），且 hint 说明了原因 |
| 按钮命中区 | ⚠️ `px-2 py-0.5` + `text-xs`：`text-xs` 自带行高 1rem = 14px，故高 = 14 + 3.5 = **17.5px**（拒绝按钮另有 1px 边框 ≈ **19.5px**），低于 20px 底线；宽度足够 |
| 主次按钮 | ⚠️ **判断项，非缺陷**：允许 = accent 实底白字、拒绝 = 描边。若按"破坏性方向应让安全项显眼"的口径二者应对调；若按"让用户快速放行子 agent"的意图则现状正确。**待拍板** |

## 六、`docs/project-tree-ui-review.md` 已过期之处

那份报告同样针对本视图，但有三处与当前代码不符，**不要拿它当现状**：

1. 写「故事架构：**5 个**架构子文件」→ 实际 `ARCH_FILES` 只有 **4** 个（`SidebarShared.tsx:141-146`）
2. 分组清单里**没有「AI 记忆」**（`MemoryGroup` 是后加的）
3. 它的 P1-1（`--color-danger` 不存在）与 P1-2（硬编码「第{n}章」前缀）**当前都已修**：`PublicationGroup.tsx:50` 已是 `--color-error`，`DraftBoxGroup.tsx:107` 已用 `t('chapter.label')`

## 七、修复顺序建议

1. **先修三个"坏模板"**——它们是后续卡片会被照抄的范式：
   `CompressedBatchCard.tsx:65-124`（标题行补成可点，正文可划选区保持不可点）、`ToolCallBlock.tsx:87-89` + `:124-127`（头部改按钮形态 + 箭头移左）、`ThinkingCollapse.tsx:22-31`（已是原生 button 整行可点，只差箭头移左 + 补 hover 反馈）
2. **再统一侧栏 8 张卡**（一轮做完：`SidebarGroup` 与三处自绘头部归并）
3. **再清 AI 面板/收件箱零散站点**（`ArtifactCard` 接线、`BottomPanel` 两处行、命中区批量）
4. **`SubAgentSessionCard` 随第 2/3 批一起改**（它是第 2 批的同类形态）
5. 每批改完跑标准 §7 的自检 grep + `MemoryGroup.test.tsx:100-133` 同款断言（`button button` = 0、主按钮可 `focus()`、点外层 `div` 不触发主行为）+ 真机 Tab 走查一遍

## 八、待定项（需拍板 / 需实测）

| 项 | 需要什么 |
|---|---|
| `AgentMessage.tsx:109-119` 的 `disabled` + 解释性 tooltip | **真机 hover 一次**：Chromium 对禁用控件是否弹原生 title。能弹出 → 保留并登记为"临时不可用"的合法用法；不能 → 改"不渲染 + 原因写在别处"。**未定案前不要照抄，也不要盲目改掉** |
| `SubAgentConfirmCard` 主次按钮 | 产品拍板（见 §五） |
| `PublicationGroup.tsx:101` / `ArtifactCard.tsx:81` 的"接线" | 打开什么：平台正文已随 `db:publication-list` 返回（`publication-repository.ts:26`，**数据现成、无需新 IPC**）；产物卡则按类型跳章节 / 任务面板 |
| `SubAgentSessionCard` 是否补"步数 / tokens" | spec §3.10 与实现的差异，需确认是刻意简化还是漏做 |

## 九、标准本身的修正记录

本报告同时产出了一条**标准自我修正**：`<`（`ChevronRight` + `rotate(180deg)`）在 AI 面板里是**返回上一层**（`AgentHeader.tsx:208/307`、`AgentMemoryView.tsx:96`），占的正是"折叠箭头该在的左端"。故标准 §1 已加边界：**本标准只管卡片/列表行；视图头部的返回键与下拉选择器不在其中**，判据是"**同一容器内必须唯一**，跨容器允许有别"。**不要把返回键改成折叠开关。**

---

## 十、修复记录（2026-09-27 执行）

三批修复全部完成（每批：`tsc` 零错 + `eslint --max-warnings 0` + 全量 vitest 绿）：

| 批次 | 提交 | 内容 |
|---|---|---|
| 1/3 | `ddbbc25` | **三个坏模板**：ToolCallBlock 头部 div→button + 箭头移左 + 整块 hover 收窄到头部（`:has`）；ThinkingCollapse 箭头移左 + 补 hover 反馈；CompressedBatchCard 通知文案（含计数）进主按钮 + 文字按钮热区 21px（`py-1 -my-1`） |
| 2/3 | `2722320` | **侧栏 8 卡**：SidebarGroup 按四类契约重写（计数进主按钮 / 折叠卡 chevron 置左 / 导航卡 `>` 装饰 / 纯状态卡不渲染 disabled 按钮）；Volume / Publication / Memory 三处自绘头部归并同一形态；DraftItem / MemoryRow 死带（hover 收窄进主按钮）；**RM-SB-01**（ChapterExportDialog 移出折叠门 + 回归测试）；连载行接线（点行打开平台正文，新增 `publication` 只读标签页）；命中区批量固定 22×22 |
| 3/3 | `e71ebd9` | **AI 面板 / 收件箱**：SubAgentSessionCard 头部主按钮化（chevron 置左、取消按钮兄弟）；RecentConversationItem 由 `role="button"` div → 主按钮 + 工具条兄弟（清掉 5 处 stopPropagation 残骸）；ACT_BTN `w-5 h-5`(17.5px) → 20px（9 处调用点）；ArtifactCard 接线（file→编辑器 / blueprint_generated→跳章节草稿 / workflow_started→底部「任务」面板；**无可达目标的类型改静态卡，不再假装可点**）；BottomPanel 历史行可展开步骤详情、运行条与步骤行按钮化；AgentMessage / AgentHeader / AgentMemoryView 命中区 22px；LeafItem（未使用，但会被照抄的坏模板）disabled 表达修复 |

**验证**：全量 **2168/2168**（187 文件，新增 19 个契约测试）；标准 §7 自检四项 grep 归零（`p-0.5` / `disabled={!on` / `role="button"` / `tabIndex={0}` / `w-5 h-5`）。真机复验另有文档（本轮按 computer-use 约束未动真机）。

**仍未做（挂起项）**：

- §八 待定三件：`AgentMessage` rewind `disabled` + tooltip 的 Chromium 真机 hover（未定案前按标准不动）；`SubAgentConfirmCard` 主次按钮（产品拍板）；`SubAgentSessionCard` 步数 / tokens（spec 确认）
- 本轮未审：`CharactersView`（角色视图，不属「项目结构」8 卡范围）；`.tree-item` 右 8px 刻意留白（标准 §3 已注明"按注释刻意不可点"，涉全仓行样式，需单独拍板）
- 真机验证发现但本批未动的观察：导出弹窗章节标题列「第1章 第1章」重复（titleMap 未就绪时 fallback，样本一例未深查）
