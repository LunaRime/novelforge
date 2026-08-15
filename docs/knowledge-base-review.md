# 知识库模块检查报告

> 检查范围：embedding（分块/API/缓存/重试）、vector-store（LanceDB：写入/检索/迁移/回填/索引）、knowledge-base（导入/降级链/幂等）、kb-controller、RAG 注入（rag-context-provider）、知识面板（KnowledgePanel）、Agent 工具（search-knowledge / index-content）。
> 规模基线：vector-store 802 行 / knowledge-base 505 行 / embedding 217 行 / embedding-service 633 行 / rag-context-provider 207 行 / kb-controller 224 行。

---

## 一、总体结论

**知识库是项目中防护链最完整、降级最周密的模块**：真混合检索（向量+FTS 并行取并集）、三级向量降级（API → LLM → FTS-only）、批次指数退避重试、维度守卫 + schema 自动重建 + 临时表替换防丢数据、注入过滤（LanceDB filter 转义 + LIKE 通配符消义）、查询向量 LRU 缓存、L2 统一度量——**没有 P0 级正确性问题**。

发现的问题集中在：**纯 FTS 模式检索排序无意义（P1-1）**、**知识库层 i18n 漏网（P1-2，8 处）**、**面板缺搜索/删除（P2-1）**、**RAG 截断切句子（P2-2）**。

---

## 二、检索质量

### 🔴 P1-1 纯 FTS 模式无相关性排序（无 Embedding 用户的检索质量短板）

- `vector-store.searchWithScope`：FTS 通道（DataFusion `LIKE`，逐字拆分 `%搜%索%`）**分数恒 0.5**（无真实打分，注释说明 Tantivy 不支持中文分词）；
- 无 Embedding 配置时（默认场景），全部候选同分 → 融合排序 `sort(score desc)` 退化为 Map 插入序（≈表扫描顺序）→ **"最相关"的块不保证排前面**。
- 修复思路（低风险、纯函数可测）：FTS 通道加启发式相关性打分——命中字符占比（`匹配片段长度 / 块长度`）、命中位置靠前加分、命中次数；混合模式下与向量分数取 max 的融合逻辑不变。

### 🟢 混合检索融合（正确且已考虑周全）

- 双通道并行取并集、分数取 max；FTS 来源豁免相似度阈值（`r.source === 'fts'` 豁免 0.6 阈值——无 Embedding 时 RAG 不会静默失效）；
- 章节范围检索把 `chapterNumber IS NULL` 纳入（设定集/角色卡/大纲文档可被章节写作 RAG 命中）。

---

## 三、i18n 规范

### 🟠 P1-2 知识库层硬编码中文（8 处，用户可见）

| 位置 | 文本 |
|------|------|
| knowledge-base.ts L139 | `不支持的文件类型: {ext}，仅支持 .txt / .md` |
| knowledge-base.ts L148 | `文件过大 ({size} MB)，最大支持 50 MB...` |
| knowledge-base.ts L72/84 | `正在通过 {method} 向量化 {n} 个块...`（进度消息） |
| knowledge-base.ts L100 | `FTS-only 降级`（progress） |
| knowledge-base.ts L119/142 | `✅ 已导入 {name}（{n} 个块）` / `正在读取 {name}...` |
| kb-controller.ts L175/180 | `LLM 向量写入失败`（2 处） |
| kb-controller.ts L197-202 | `无可用的向量化方式。请至少配置以下其一：...`（大段三行提示） |

> 注：上一轮框架检查的 electron 层扫描**漏掉了这批**（grep 结果被 250 条上限截断）——说明人工审计不可靠，建议补一个 i18n 审计脚本（P2 建议）。

---

## 四、体验与性能

### 🟡 P2-1 知识面板纯只读：无搜索、无删除
- `KnowledgePanel` 只有列表/排序/导出：**不能搜索**知识库内容（检索只发生在 Agent/写作内部链路）、**不能删除文档**（误入库的文档只能等重名覆盖）。
- 用户无法验证"知识库能不能查到 X"——RAG 质量的第一手反馈缺失。
- 修复：面板加搜索框（复用 `kb:search`）+ 每行删除按钮（confirm → `kb:remove-document`）。

### 🟡 P2-2 RAG 截断会切句子
- `rag-context-provider` 超 token 预算时 `text.slice(0, cutPoint) + '…'` —— 从句子中间切断，LLM 拿到半句。
- 修复：截断点前移到最近的句子边界（`。！？!?\n`），一行改动。

### 🟡 P2-3 文件夹导入串行
- `importFolder` 逐个文件 await（分块+向量化+写库），大文件夹慢；顺序执行防并发压 API，可接受——可选并发 2-3 条。

### 🟡 P2-4 向量回填全表扫描到 JS
- `getChunksWithoutVectors` / `backfillVectors` 把全表 select 进 JS 内存过滤（万级 chunk 时开销大）；`updateChunkVectors` 有向量列时逐条 `table.update`（N 次 SQL）。中低优先级（回填是低频操作）。

---

## 五、做得扎实、不需要动的部分

| 项 | 说明 |
|----|------|
| 三级降级链 | Embedding API → LLM 向量化 → FTS-only，每级失败自动降级且有日志 |
| 批次重试 | 批次级指数退避（429/5xx），前批成功不因后批失败作废 |
| 维度守卫 | 模型切换后维度不一致给明确错误（不吞） |
| schema 自愈 | 旧表缺字段自动重建；回填走临时表替换 + 失败恢复 |
| 注入防护 | LanceDB filter `sanitizeFilterValue`（单引号转义/反斜杠清除）+ LIKE `%/_` 转全角 |
| 幂等导入 | 同名文档先删后写 |
| 查询缓存 | 单文本查询向量 LRU（500 条 / 30min TTL） |
| 度量一致 | 写入端与查询端统一 L2 归一化 |
| RAG 预算 | maxTokens 800 + 章节 ±10 范围 + FTS 豁免阈值 |

---

## 六、结论与建议

**知识库无需架构改动，本轮价值点集中在"检索质量补强 + 面板闭环 + 规范清理"：**
1. **P1-1 FTS 相关性打分**（无 Embedding 用户的检索体验，纯函数可测）；
2. **P1-2 i18n 8 处**（knowledge-base + kb-controller）；
3. **P2-1 面板搜索 + 删除**（RAG 质量反馈闭环）；
4. **P2-2 RAG 句边界截断**（一行）；
5. 可选 P2-3/P2-4 与 i18n 审计脚本（防第 4 次同类漏网）。

---

## 七、修复状态（分点修复记录）

| 编号 | 问题 | 状态 | 落地位置 |
|------|------|------|----------|
| P1-1 | 纯 FTS 模式无相关性排序 | ✅ 已修 | `vector-store.computeFTSRelevance`（逐字命中率 0.5 + 最长连续 n-gram 0.3 + 位置 0.2，范围 [0.5,1]）；FTS 通道分数由恒 0.5 → 启发式分；+6 测试 |
| P1-2 | 知识库层 i18n 漏网 | ✅ 已修 | knowledge-base 6 处（文件类型/大小/进度消息/导入完成）+ kb-controller 2 处（LLM 写入失败/无可用向量化方式）；新增 `kb.*` 9 键三语 |
| P2-1 | 面板无搜索/删除 | ✅ 已修 | KnowledgePanel 搜索框（Enter 触发，结果视图含来源/相关度）+ 每行删除（confirm → `kb:remove-document` → 刷新）；列表视图提取为 `DocListView` 子组件（规避深层条件表达式+fragment 的 TSX 解析问题，顺带简化括号层级） |
| P2-2 | RAG 截断切句子 | ✅ 已修 | `rag-context-provider` 截断点前移到最近句边界（。！？!?/换行，边界 <30% 不移动） |
| 附带 | 默认按章节号排序 | ✅ 已修 | KnowledgePanel 默认 sortMode `time` → `chapter`（章节是主索引），排序选项顺序同步调整 |

> 门禁：typecheck 零错误、lint 零警告（--max-warnings 0）、测试 525 → 531 全过。
> 备注：`knowledge.searchPlaceholder/searchResults` 键已存在（旧搜索入口复用），未重复添加。
> 遗留：P2-3 文件夹导入并发 / P2-4 回填全表扫描 / i18n 审计脚本——低频或需工具化，未纳入本轮。
