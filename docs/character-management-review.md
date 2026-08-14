# 角色管理模块：第二轮优化检查报告

> 检查范围：角色管理的完整用户链路——store 状态管理（character-store）、侧栏列表（CharactersView）、编辑器（CharacterEditor/RelationshipGraph/CharacterBacklinks）、数据层（character-repository）、声音分析（character-voice-analyzer）、Agent 工具注入（read_characters / roleplay / audit-context）。
> 第一轮（提取链路 P0~P2-5）已修复完毕，本报告聚焦**管理体验与注入质量**，与提取链路不重叠。

---

## 一、按优先级排序的优化点

### 🔴 P0 — 快赢（低风险，立刻可做）

**P0-1 别名注册表没有手动编辑入口（功能半残）**
- 上一轮加了 `aliases` 列 + 匹配层（昵称/称号命中），但**用户无法手动登记别名**——只有 LLM 合并写入时碰巧给了 aliases 才会登记。
- 后果：用户知道"阿晚 = 苏晚"，但没有入口告诉系统 → 匹配层能力闲置，定稿更新依旧漏。
- 方案：CharacterEditor 加"别名"输入框（逗号/顿号分隔，存 JSON 数组），保存走现有 saveAll。

**P0-2 RelationshipGraph 硬编码颜色（违反核心约束）**
- `RELATION_COLORS` 8 个 hex（#22c55e/#ef4444/#f59e0b...）直接写死，违反 AGENTS.md「颜色：CSS 变量，禁止硬编码」。
- 方案：映射到主题变量（--color-success/-danger/-warning/-info/-accent 等），暗色主题自适应。

**P0-3 deleteCharacter 级联清理逐个 IPC**
- 删除角色后，对其他角色 relations 的清理是 `for` 循环逐个 `db:character-upsert`（N 次 IPC + N 次 SQL）。
- 方案：合并为一次 `db:character-save-all`（repository 已有事务）。

### 🟠 P1 — 高价值

**P1-1 角色列表无搜索**
- CharactersView 只有 tier 筛选；50+ 角色时靠滚动定位。
- 方案：顶部加名字即时过滤输入框（含别名匹配），改动约 20 行。

**P1-2 角色试演未注入声音档案（OOC 风险）**
- `buildRoleplaySystemPrompt` 注入了性格/背景/动机/位置/最近经历/关系，**唯独没有 voice profile**（语气/常用词/句式）——而 voice analyzer 的存在目的就是保持角色说话一致，试演是最需要它的场景。
- 方案：试演时加载该角色 [VOICE:] 档案注入 prompt（profile 里已有 analyzedChapters/样本句）。

**P1-3 roleplay prompt 硬编码中文（违反 i18n 标准）**
- `buildRoleplaySystemPrompt` 全部中文硬编码，en-US/ru-RU 用户拿到中文扮演指令。
- 方案：prompt 走三语变体（沿用 prompt 模板 locale 机制或按 locale 分支）。

**P1-4 read_characters 列表模式 token 浪费**
- Agent 问"有哪些角色"时全量平铺 `名字 (role)`；50+ 角色全量返回。
- 方案：按 tier 压缩——主角/反派全量，配角/龙套只给前 N 个 + 总数；加 status 标注（dead/departed 挂 [退场]）。

### 🟡 P2 — 中等价值

**P2-1 存量项目无出场统计**（上一轮生命周期字段落地后仍缺触发源）
- appearCount/firstChapter/lastChapter 只在**定稿时**维护；存量项目/导入小说的角色这些字段全是 0，生命周期面板无数据。
- 方案：复用 `buildNamePositions`（含别名/碰撞过滤）做一个"扫描全书统计出场"工具（角色列表按钮），顺带输出"连续 N 章未出场"疑似退场清单（status 自动建议，用户确认）。

**P2-2 voice analyzer 提取局限**
- 对话提取只认 `名+说/道+引号` 与 `引号+名+说/道` 两种形态：纯对话流（无说话人标注）、`名说`无引号、跨段对话全部漏提。
- tonePatterns 中文关键词硬编码：英/俄文对话提取不到语气（三语产品短板）。
- 方案：① 引号段归属增强（统计相邻引号段 + 上下文说话人）；② 语气词表补英/俄；③ 高频词停用词表已有，可补英文停用词。

**P2-3 StructuredRelations 无 sinceChapter 输入**
- 手动添加关系时 sinceChapter 恒 0，图谱/反链无法展示"关系始于第几章"。
- 方案：添加行加章节号输入（默认 0 = 未知）。

**P2-4 新角色无焦点引导**
- addCharacter 后名字输入框未自动聚焦，用户需手动点击改名。
- 方案：编辑器挂载时若名字是默认名则聚焦名字框。

### 🟢 P3 — 低优先级

**P3-1 saveAll 全量保存**：每次保存全量 upsert 所有角色。可做逐行 diff（store 需要行级 dirty 标记），但并发写保护复杂，收益一般——维持全量事务一致性更稳。
**P3-2 load 每次跑 applyCharacterNameRepair**：幂等但每次刷新全量扫描；可加"已修复"标记跳过。
**P3-3 批量操作**：批量删除/批量标记退场（清理龙套群），需产品确认交互。

---

## 二、已确认无问题的部分（防过度优化）

| 模块 | 结论 |
|------|------|
| renameMap 改名级联 + 链式压缩 | 正确，保存时级联重写 relations，含循环防护 |
| dirty 保护（load 跳过/刷新确认/保存中保留） | 正确，竞态处理完善 |
| 删除级联（store 同步 + 改名映射清理） | 正确（仅 IPC 粒度可优化，见 P0-3） |
| merge 与 delete 的 relations 一致性 | 双向都覆盖（merge 走 DB 事务，delete 走 store 级联） |
| 图谱边去重/非法 tier 归一化/JSON 容错 | 正确 |

---

## 三、修复状态（分点修复记录）

| 编号 | 问题 | 状态 | 落地位置 |
|------|------|------|----------|
| P0-1 | 别名注册表无手动编辑入口 | ✅ 已修 | `CharacterEditor` 别名输入框（逗号/顿号分隔，存 JSON 数组）；`character.aliases/aliasesHint` 三语 |
| P0-2 | 图谱硬编码颜色 | ✅ 已修 | `RELATION_COLORS` 全部映射主题 CSS 变量（success/error/warning/info/accent/gold/text-*），四主题自适应 |
| P0-3 | 删除级联逐个 IPC | ✅ 已修 | `character-store.deleteCharacter` 合并为一次 `db:character-save-all`（事务） |
| P1-1 | 角色列表无搜索 | ✅ 已修 | `CharactersView` 名字/别名即时过滤框（大小写不敏感） |
| P1-2 | 试演未注入声音档案 | ✅ 已修 | `extractVoiceProfileFromNotes` 单角色同步解析 + `buildRoleplaySystemPrompt` 注入语气/高频词/典型对话 |
| P1-3 | roleplay prompt 硬编码中文 | ✅ 已修 | `roleplay-prompt.ts` 三语常量（zh/en/ru，随 locale 输出，可选 locale 参数） |
| P1-4 | read_characters 列表 token 浪费 | ✅ 已修 | 主角/反派全量 + 配角/龙套前 10 个 + 总数；退场/死亡状态标注 |
| P2-1 | 存量项目无出场统计 | ✅ 已修 | `character-appearance-scan.ts`（含别名+碰撞过滤扫描）+ `updateAppearanceStats`（仅统计三列）+ 列表页 Radar 按钮 + 疑似退场提示（≥20 章未出场，不自动改状态） |
| P2-2 | voice analyzer 提取局限 | ✅ 已修 | 模式3（引号段与说话人间允许标点/空格）+ 中文左引号补全（原实现漏 `“`）+ 英文说话动词（said/says/asked...）+ 英/俄语气词表 + 英文停用词 + 对话行去重 |
| P2-3 | 关系无 sinceChapter 输入 | ✅ 已修 | `StructuredRelations` 添加行数字输入（0=未知） |
| P2-4 | 新角色无焦点引导 | ✅ 已修 | 默认名角色自动聚焦名字框（useEffect + ref） |

> 测试 504 → 525（voice 提取/解析 13 条、scan 6 条、roleplay 三语与声音注入 5 条等）；typecheck/lint 零错误零警告。
> P3 三项（saveAll 增量 diff / repair 标记跳过 / 批量操作）按报告结论维持不动——收益低或需产品确认。

---

## 四、结论

**角色管理骨架（store 语义/改名级联/删除一致性/合并）已经非常扎实，本轮优化重点是"能力补全"而非"架构修正"：**
1. 最高价值：**aliases 手动编辑**（P0-1）——让上一轮的别名匹配真正可用；
2. 规范与性能快修：**图谱颜色变量化**（P0-2）+ **删除级联批量化**（P0-3）；
3. 注入质量：**试演注入声音档案**（P1-2）+ **roleplay i18n**（P1-3）直接影响 AI 输出一致性；
4. 体验补全：**列表搜索**（P1-1）+ **出场统计扫描工具**（P2-1）完善生命周期闭环。

全部可在现有 TS 栈内完成，预计 P0+P1 约 300 行改动。
