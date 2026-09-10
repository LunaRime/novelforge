# L3 中文检索升级设计

> **For agentic workers:** 本设计供 subagent-driven-development / executing-plans 实现。每个 SDD 任务先设计后执行。
**Status:** 设计草案 v1（待用户审阅：分词器选型 + RRF + 索引重建策略）
**范围归属:** 档 3 L3（CC 计划 `docs/superpowers/plans/2026-08-29-cc-remaining-implementation.md` Task L3 §五.3）
**基线:** master @ `f648afd`（L2 + Agent 能力规划完成后）

## 1. 背景与现状

知识库检索（`electron/vector-store.ts` `searchWithScope`）当前是**向量 + FTS 双通道取并、分数取 max**：

| 通道 | 实现 | 打分 | 问题 |
|---|---|---|---|
| 向量 | LanceDB `table.search(normQuery)` ANN | 相似度 = 1 - d/2 | 语义检索好；人名/专有名词/原句召回弱 |
| FTS | `text LIKE '%搜%索%'`（**逐字拆 `%` 容错匹配**）+ `computeFTSRelevance` 启发式 | 启发式 [0.5,1] | **不是真全文检索**——Tantivy FTS 索引（`Index.fts()`）建了但**不支持中文分词**（整段一个 token 检索无效），故退回 DataFusion LIKE 逐字匹配；无 BM25 打分 |

**缺口**（L3 目标）：
1. 中文分词 FTS 未启用——LIKE 逐字容错对中文词边界不敏感（「搜索知识」与「检索知识」字面不同但语义相关，LIKE 只命中字面）。
2. 无 RRF 融合——双通道 max 取并会偏向分数高的单通道，忽略「两通道都排前」的信号。
3. 无查询改写——同义/角色别名不扩展。
4. 无 reranker。

## 2. 目标 / 非目标

### 2.1 目标（三步渐进，见 §3）
- **① 中文分词 FTS 启用**：jieba 分词 → `tokens` 字段 → 真 FTS/词级匹配，替换逐字 LIKE。
- **② RRF 融合**：替换「max 取并」为 Reciprocal Rank Fusion。
- **③ 查询改写**：角色名/别名扩展（复用 characters 表 v14 `aliases`）。
- **reranker**（可选，成本敏感）：后置。

### 2.2 非目标
- 不改向量侧 ANN（IVF_PQ）与 embedding 生成。
- 不做语义重排（reranker）在 v1（成本敏感，设计 §3.4 标注，不实现）。
- 不改 `rag-context-provider` 的注入/格式化/阈值豁免逻辑（只改底层检索返回）。

## 3. 设计（三步）

### 3.1 中文分词 FTS 启用

- **分词器**：`jieba-wasm`（推荐）——纯 wasm、Electron 兼容好、免 native rebuild；备选 `@node-rs/jieba`（Rust native，快，需 rebuild + asarUnpack）。**待用户/评审定**（§4）。
- **chunk 加 `tokens` 字段**：`tokens TEXT`（jieba 分词结果，空格分隔，如「搜索 知识 库」）。写入时（import/回填）对 `text` 分词填入。
- **FTS 索引**：在 `tokens` 上建 Tantivy FTS 索引（`Index.fts()`，whitespace 分词 tokens 字段即可检索）；检索时 query 先 jieba 分词 → 用词查 `tokens`。
- **与现有阈值豁免衔接**：FTS 命中仍标 `source='fts'`，调用方（rag-context-provider :126）继续豁免 0.6 阈值——不变。
- **降级**：tokens 缺失（回填前旧数据）/ 分词器不可用 → 退回现有 LIKE 逐字匹配（兜底，行为不变）。

### 3.2 RRF 融合（替换 max 取并）

- 现状：`candidates Map` 双通道取并、分数取 max（`if score > cur.score` 覆盖）。
- RRF：`score(d) = Σ_channel 1/(k + rank_channel(d))`，k=60。
  - 每个通道先各自按分数排序得 rank（1-based）；候选 doc 的 RRF 分 = 两通道 rank 倒数之和。
  - 融合后按 RRF 分数降序 slice topK。
- 好处：精确关键词（FTS 排前）+ 语义相关（向量排前）即使各自分数不同量纲也能公平融合。

### 3.3 查询改写

- 角色名不稀释已做（`buildChapterRAGQuery`）。扩展：query 分词后，对命中角色名/别名做**同义扩展**——复用 `characters` 表 v14 `aliases`（角色名匹配的变体形态），把 query 中的角色名替换/扩展为「正名 + 别名」并集，提升召回。
- 成本：低-中（读 characters 别名 + query 分词替换）；可后置（RRF 是核心，查询改写次之）。

### 3.4 reranker（可选，非 v1）

- 重排：cross-encoder 或 LLM 打分。成本敏感（每次检索多一次 LLM 调用）。**v1 不实现**，登记为后续项。

## 4. 分词器选型（待定）

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| `jieba-wasm` | 纯 wasm，Electron 免 native rebuild，体积小 | 首次加载 wasm 略慢；需 files 白名单打包 wasm | **推荐** |
| `@node-rs/jieba` | Rust 原生，快 | 需 native rebuild + asarUnpack + ABI 与 Electron 匹配 | 备选 |
| 纯 JS jieba | 无 native/wasm | 慢、字典大 | 不推荐 |

**推荐 `jieba-wasm`**：NovelForge 已有 native 模块（better-sqlite3/lancedb）但检索是低吞吐路径，wasm 免 native 复杂度、Electron 兼容好。实现时验证 wasm 打包（`files` 白名单 + `asarUnpack`）。

## 5. 索引重建策略

- **加列**：`tokens TEXT`（LanceDB `add_columns`，幂等）。
- **回填**：对现有 chunks 重新 jieba 分词填入 `tokens`（类似 `kb:backfill-vectors` 的 `getChunksWithoutVectors` 模式 → 新增 `getChunksWithoutTokens` + `backfillTokens`）。
- **新导入**：`importContent` 分块后即分词，写入时带 `tokens`。
- **索引**：tokens 字段 FTS 索引，回填后建（若 LanceDB FTS 需重建，参考 `ftsRebuildFailed` :824 的既有重建模式）。
- **与 LanceDB 双通道一致性**：向量与 FTS 都查同一 chunks 表；tokens 仅 FTS 通道用，向量通道不变。

## 6. 测试策略

- **中文分词检索命中**：query「主角的剑」→ 分词「主角 的 剑」→ tokens 命中含「主角」的 chunk；LIKE 逐字不命中的语义相关词（如「检索」vs「搜索」）经分词后命中同词。
- **RRF 排序正确性**：构造向量通道与 FTS 通道各排前的候选，验证 RRF 融合排序与「max 取并」差异（RRF 把「两通道都排前」的提上来）。
- **与现有混合检索回归**：既有向量/LIKE 检索用例不改语义（tokens 缺失时兜底 LIKE）；阈值豁免、scope 过滤不变。
- **回填幂等**：backfillTokens 重复执行不重复分词、不改已有 tokens。
- **分词器降级**：tokens 缺失/分词器不可用 → 退回 LIKE，行为不变。

## 7. 风险 / 已知限制

- **分词器打包**（jieba-wasm 的 wasm 文件 asar 打包）——实现时验证，若打包复杂可退 @node-rs/jieba（native 已有流程）。
- **回填成本**：现有项目知识库需回填 tokens（一次 O(chunks) 分词），大库略慢——后台/进度。
- **RRF k 值**：k=60 为标准值，实现时可调参。
- **查询改写依赖 characters.aliases**：别名缺失时改写退化为原 query（无损失）。
- **reranker 未做**（v1 非目标）。

---
*设计草案 v1。待用户审阅：分词器选型（jieba-wasm 推荐）、RRF 方案、索引重建策略。*
