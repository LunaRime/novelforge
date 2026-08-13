# 角色库提取链路：缺点与不足检查报告

> 检查范围：初始提取（`extract_initial_characters`）→ 定稿动态更新（`update_character_cards`）→ 档案补全（`extract_from_finalized`）→ 关系检测（`relation_detect`）→ 名字修复（`character-name-repair`），以及底层匹配/归一化/解析工具。
> 依据：`architecture-workflow.ts` / `character-archive-workflow.ts` / `character-archive.ts` / `character-card-merge.ts` / `character-normalize.ts` / `character-repository.ts` / `finalize-chapter.command.ts` / `workflow-utils.ts` / `prompts/characters.ts`

---

## 一、提取链路全景

| 路径 | 触发 | 输入 | 输出写入 |
|------|------|------|----------|
| 初始提取 | 架构生成/角色图谱页按钮 | 角色图谱纯文本 | `mergeCharacterCards`（仅填空合并） |
| 定稿动态更新 | 每章定稿（后处理 DAG） | 章节正文分段注入 + 现有角色列表 | UPDATES→`updateState`（CASE WHEN 保旧）/ NEW→`upsert` |
| 档案补全 | 手动（角色卡页/角色列表按钮） | 每角色 8 段 ×800 字上下文 | `mergeFields`（仅填空） |
| 关系检测 | 定稿后处理 | 章节正文 | 邻近度启发式写 `relations` |
| 名字修复 | 一次性存量修复 | 全量角色 | 改名/合并 |

---

## 二、缺点与不足（按严重度排序）

### 🔴 P0 — 正确性 / 数据损失

**P0-1 初始提取的 `currentState` 整体丢失（prompt 契约违约）**
- `extract_initial_characters` 模板明确要求输出 `currentState`（初始位置/境界/道具/心理，`updatedAtChapter: 0`），但 `createCharacterExtractSteps` 组装卡片时只拷贝 `name / role / 10 个字符串字段 / tags`，**`currentState` 字段不在拷贝清单里，直接被丢弃**。
- 降级解析路径更糟：`extractKvFields` 会把 `currentState` 内层字段（location/powerLevel/…）拍平成顶层键——同样不在拷贝清单 → 依然丢弃。
- 后果：**新建项目的角色卡 `cs_*` 全空**，直到第一次定稿后处理才可能写入，与"初始状态"设计完全脱节。这也是测试没兜住的表现（`character-archive.test.ts` 无此用例）。

**P0-2 名称匹配没有模糊/变体归一化，别名形态全面失配**
- `matchCharacterName` 只有"精确 + 单层括号别名"两种形态。小说角色最常见的昵称/称号/错字形态（「晚儿」「阿晚」「苏仙子」「苏姑娘」「苏晚晴（苏夜）」→「苏夜」）全部匹配不到。
- 后果链：UPDATES 静默跳过（更新丢失）→ NEW 误判"新角色"重复创建（同角色多条记录，`name` 是唯一主键，分裂后互动检测/档案上下文/声音分析/反链全部失效）；已有 `character-name-repair.ts` 只修了"括号别名"这一种存量形态，昵称/称号无解。
- `stripNameAlias` 只剥一层括号：「苏晚（苏夜（少主）」剥完还剩「苏夜（少主）」；全括号名返回空串后依赖调用方兜底，边界易漏。

**P0-3 名字子串碰撞 → 语境污染 / 出场误登记**
- 全文 `indexOf(form)` 是**子串匹配**：短名或常见字（「一」「叶」「小」）会命中无关词语；「苏晚」会命中「苏晚晴」的段落（前缀碰撞）。
- 后果：档案上下文混入他人戏份（LLM 据此编造设定）、`appearChapters` 误登记、关系检测误判同场共现。

### 🟠 P1 — 效果 / 成本

**P1-1 档案上下文只取"前 8 个出现点"，后期章节完全不可见**
- `extractRoleContextSegments` 按章节顺序扫描，凑满 `maxSegments=8` 即返回——前 8 段可能全在第 1~3 章。
- 角色后期成长（arc、动机变化、能力提升）永远不会进入档案输入；且档案是"只填空、不覆盖"，**首次提取质量差 = 永久锁定**（后续章节揭示的新信息永不采纳，除非用户手改）。

**P1-2 代词/视角出现 → 零上下文，档案永久空白**
- 只要角色在正文中以「他/她/那人」或第一人称出现（高密度对话、主角视角场景），`indexOf` 扫不到名字 → `segments.length === 0` → `continue` 跳过，角色档案永远空白，且每次全量重跑都白扫一遍。

**P1-3 逐角色串行调 LLM，成本高且不可恢复**
- 档案补全对每个 pending 角色单独一次 LLM 调用（8 段 ≈ 13k 输入 token），50 个角色 = 50 次串行调用；无并发、无批量（多角色共享章节上下文一次调用）。
- 无结果缓存/checkpoint：任何字段为空就全量重跑 pending 角色；`appearance` 的"绝对不要留空"是 prompt 软约束，LLM 仍可能给空 → 无限重跑。
- **未接入后处理持久化体系**：`runCharacterArchive` 直接 `startWorkflow` 单步执行，不像 `runArchCharacterExtract` 走 `runPostProcessPipeline`（有 `post_process_runs` 落库 + `onlyFailed` 修复模式）——崩溃后无断点续跑。

**P1-4 800 字窗口硬切 + 重叠段不合并**
- `slice(idx-800, idx+800)` 可能把句子腰斩，给 LLM 半句垃圾；相邻多次出现的窗口大面积重叠 → 重复内容重复计费。

**P1-5 关系检测是"500 字内共现"启发式，垃圾关系多**
- `relation_detect`：任意两个角色名在 500 字窗口内出现即建 `relations`，`type` 恒为 `'other'`、`label` 恒为「第N章互动」——同场景多角色共现（开会、群像戏）会生成大量无意义关系；不区分"对话互动"与"同场共现"。
- `endedChapter` 字段定义了但从无任何代码设置它：**角色死亡/关系破裂无自动检测**，关系表只增不修。

**P1-6 角色库只增不减，长期膨胀**
- NEW 创建只做精确/括号匹配去重，昵称变体直接重复建卡（P0-2 后果）；无角色删除/归档/合并的用户入口（`character-card-merge.ts` 是 LLM 写库合并，不是用户合并两个角色）；死角色继续留在关系检测 O(C²) 候选里，每章定稿性能随角色数平方恶化。

### 🟡 P2 — 维护 / 体验

**P2-1 缺出场统计与角色生命周期数据**
- 无"出场次数 / 首次出场章 / 最近出场章 / 缺席区间"字段 → 角色淡出检测、跨章一致性检查、AI 上下文裁剪（smart-context-pruner）都缺数据基础；`appearChapters` 只在 `relation_detect` 顺带维护，且是"名字出现过"的粗口径。

**P2-2 哨兵集合只覆盖中英，无俄语**
- `NO_CHANGE_VARIANTS` 覆盖中文/英文变体，但项目支持 ru-RU；俄语模型的「нет изменений」等哨兵输出不会被识别 → 污染 tags/motivation/cs_* 字段（P0-2 同类事故的未爆弹）。

**P2-3 解析层剩余盲区**
- `extractKvFields` 只匹配 `"key": "value"` 字符串 + 数字/布尔：嵌套对象/数组值全丢（P0-1 同源）；降级路径下数组型 tags 丢。
- `parseMarkdownTable` 已处理单元格内换行（缓冲合并），但单元格内竖线 `|`（「阵营A|阵营B」）无法转义，会错裂列。
- Markdown 表单元格内的 tags 用顿号/逗号分隔，LLM 常混用全角半角、多空格 → `normalizeTagsValue` 拆分后元素被截碎（部分已防）。

**P2-4 硬编码魔法数字与缺失约束**
- `windowChars=800`、`maxSegments=8`、`500 字邻近度`、`tags 上限 8` 全部硬编码不可配置；`callLLMForArchive` 未设置 temperature/输出长度约束。

**P2-5 测试覆盖盲区**
- 纯函数单测充分，但缺：初始提取 currentState 端到端用例（若有此用例 P0-1 不可能存活）；「LLM 输出 → 写库 → 不覆盖已有字段」的集成测试；长文本/多章节场景下窗口切句边界用例。

---

## 三、修复建议（不引入新语言的纯 TS 方案，按优先级）

1. **P0-1 修复（一行级改动）**：`createCharacterExtractSteps` 拷贝清单加入 `currentState`（`stringifyField` 序列化后走 `mergeCardRows` 的 `currentState` 分支），并补端到端测试。
2. **建立"别名/称呼注册表"**（最高价值，一石多鸟）：角色卡增加 `aliases` JSON 字段；匹配层升级为"规范名 + 别名"双扫描 + 边界感知（命中位置前后非 CJK/字母字符才有效，解决 P0-3）；别名来源：LLM 提取时要求输出称呼变体 + 从正文「X说：」归属/「"……"X」统计高频候选 + 用户手填。一次改动同时修 P0-2/P0-3/P1-6 的上游。
3. **上下文抽取升级**（P1-1/P1-2/P1-4）：按句号切句后取整句（窗口对齐句边界）；均匀跨章节采样 8 段（保证后期可见）；相邻段去重合并；对"角色未出现但该章有代词"的场景可选注入章节首尾段兜底。
4. **批量档案提取**（P1-3）：多角色共享章节上下文一次调用批量 JSON 输出（成本降 5-10 倍）；并发 2-3 个请求（受 llm-store 并发控制约束）；接入 `runPostProcessPipeline` 获得 `onlyFailed` 断点续跑。
5. **角色生命周期字段**（P1-6/P2-1）：`appearCount/firstChapter/lastChapter/status`（active/departed/dead）；定稿时更新；提供"疑似重复角色"（编辑距离 ≤1 或共享别名）检测列表供用户合并；死角色从关系检测候选剔除。
6. **关系检测分级**（P1-5）：共现 → 仅标记"疑似"；「X说：」归属/对话互动 → 确认关系；按缺席区间 + 正文判定设置 `endedChapter`。
7. **哨兵补俄语**（P2-2）：`NO_CHANGE_VARIANTS` 增加常见俄语变体（нет/без изменений/нет данных/не изменился 等）。

---

## 五、修复状态（分点修复记录）

| 编号 | 问题 | 状态 | 落地位置 |
|------|------|------|----------|
| P0-1 | 初始提取 currentState 丢失 | ✅ 已修 | `architecture-workflow.ts`：`assembleCharacterCards` 透传 currentState（对象形态校验）+ `extractKvFields` 嵌套对象重建；`character-card-merge.ts` 合并写入 |
| P0-2 | 名称匹配无变体归一化 | ✅ 已修（含 DB 迁移） | `characters.aliases` 列（Schema v13→v14）+ `parseAliases` + `matchCharacterName` 别名注册表/存量双形态 + `stripNameAlias` 嵌套括号迭代剥离 |
| P0-3 | 子串碰撞污染 | ✅ 已修 | `buildNamePositions`/`collectOccurrences` 前缀碰撞过滤（命中位置被更长注册名覆盖即跳过） |
| P1-1 | 上下文只取前 8 段 | ✅ 已修 | `extractRoleContextSegments` 等距选章（首章+末章必含）+ 预算补充轮询 |
| P1-2 | 代词出场零上下文 | 🟡 部分 | 别名形态扫描已覆盖大部分失配；`includeFallback` 兜底段能力已实现（默认关闭——低置信度内容可能诱导 LLM 编造且"只填空"语义会永久锁错，建议后续配合"低置信度标记"再启用） |
| P1-3 | 串行调用/无断点 | ✅ 已修 | 批量提取（新模板 `extract_from_finalized_batch`，每批 4 角色一次 LLM 调用，调用次数降为 1/4）+ 接入 `runPostProcessPipeline`（`archive_characters` scope：run/steps 落库、批次级 withRetry、失败标记）；mergeFields 只填空语义保证天然幂等断点——失败角色下次运行自动重试 |
| P1-4 | 窗口硬切/重叠重复计费 | ✅ 已修 | 句边界对齐（整句优先，短句扩窗）+ 同章重叠段合并 |
| P1-5 | 关系检测纯共现噪音 | ✅ 已修 | `relation_detect` 互动门槛：最小间距 <100 或区间内有对话标记（引号/说/道/喊/叫/问/答）；新增 `closestNamePair`/`hasDialogueMarker` |
| P1-6 | 角色库只增不减 | ✅ 已修 | 生命周期列（v15：appear_count/first_chapter/last_chapter/status）+ 定稿自动维护出场统计 + 非 active 角色退出关系检测 + 用户合并（`mergeCharacters` 事务：空白字段/tags并集/出场合并/relations 并入与全库重定向/删源）+ 疑似重复检测（`character-duplicates`：别名相等/共享别名/一字之差）+ CharacterEditor 生命周期面板与合并 UI + 侧栏状态徽标 |
| P2-1 | 无出场统计/生命周期 | ✅ 已修 | 随 P1-6 一并落地（appearCount/firstChapter/lastChapter 定稿时维护，status 手动管理） |
| P2-2 | 哨兵缺俄语 | ✅ 已修 | `isNoChangeValue` 增加俄语变体 + `нет `/`без изменений` 前缀规则 |
| P2-3 | 解析层盲区 | 🟡 部分 | currentState 嵌套重建已修；Markdown 单元格竖线转义留待后续 |
| P2-4 | 魔法数字 | ✅ 已修 | `extractRoleContextSegments` 改为 `ContextExtractOptions` 可配置（默认值不变） |
| P2-5 | 测试盲区 | ✅ 已修 | 新增 currentState/别名/碰撞/采样/句对齐/兜底/俄语哨兵等用例（479 全过，typecheck/lint 零错误零警告） |

> 检查报告中的全部缺陷项（P0-1/P0-2/P0-3/P1-1/P1-3/P1-4/P1-5/P1-6/P2-1/P2-2/P2-4/P2-5）已修复；仅剩 P1-2 兜底段启用（建议配合低置信度标记后开启）为设计决策未落地。

---

## 六、结论

**当前角色库提取"能跑、防覆盖语义正确、解析层已高度加固"，但正确性上有一个实锤 bug（P0-1 currentState 丢失），匹配层是全链路最大短板（P0-2/P0-3），成本与效果受上下文采样策略（P1-1/P1-3）和启发式关系检测（P1-5）拖累。** 其中 P0-1 是几分钟能修完的确定缺陷；其余建议按"别名注册表 → 上下文采样 → 批量提取 → 生命周期"的顺序推进，全部可以在现有 TS 栈内完成。
