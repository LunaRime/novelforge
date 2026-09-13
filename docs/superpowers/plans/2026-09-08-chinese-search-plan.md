# L3 中文检索升级 实施计划（SDD）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **执行状态：✅ 全部完成（2026-09-10 收口，提交 `f217e6d`→`746ae0b`）。**
> 本文档的 checkbox 已按实际执行回填；Task 1/3/4/5 的代码草案已替换为 **as-built** 形态（含与草案的有意偏差及原因）。
> 门禁实测与已知限制见文末「执行记录」。

**Goal:** 把知识库检索从「向量 ANN + LIKE 逐字容错（伪 FTS）双通道取 max」升级为「向量 + 中文分词 FTS 双通道 + RRF 融合」，并加查询改写（角色别名扩展）。

**Architecture:** 按设计 `docs/superpowers/specs/2026-09-08-chinese-search-design.md` 三步落地：① `electron/chinese-tokenizer.ts`（jieba 分词封装）+ chunks 加 `tokens` 字段 + 回填；② `searchWithScope` 的 FTS 通道改「query 分词 → tokens 词级检索」（替换逐字 LIKE）+ RRF 融合（替换 max）；③ 查询改写（characters v14 `aliases` 角色别名扩展）。

**Tech Stack:** TypeScript + Electron（主进程）+ LanceDB + jieba 分词器（`jieba-wasm` 优先，`@node-rs/jieba` 备选，实现时按运行环境选）。新增 1 个分词依赖。

**Spec:** `docs/superpowers/specs/2026-09-08-chinese-search-design.md`
**基线:** master @ `ebc983a`（L3 设计已提交）

## Global Constraints

- **v1 范围**（设计 §2）：① 分词 FTS 启用 + ② RRF 融合 + ③ 查询改写（角色别名）。**reranker 非 v1**（不做任务）。
- **行为兼容优先**：`tokens` 缺失 / 分词器不可用 → **退回现有 LIKE 逐字匹配**（兜底，行为不变）；向量通道 ANN、embedding 生成、`rag-context-provider` 注入/阈值豁免（FTS source 豁免 0.6）**零改动**；`kb:search`/`kb:search-with-scope` 返回结构（`{text,fileName,score,source}`）不变。
- **分词器选型（用户裁定「根据运行环境选择」）**：实现 T1 时先试 `jieba-wasm`（纯 wasm、Electron 免 native）；若 Electron 打包 wasm 复杂/加载失败，退 `@node-rs/jieba`（Rust native，需 `pnpm run rebuild` + asarUnpack）。**T1 报告必须记录选型结论与原因**。
- **索引重建幂等**：chunks 加 `tokens` 列（LanceDB `add_columns` 幂等）+ 回填（`backfillTokens` 只处理 tokens 缺失的 chunk）+ 新导入自动分词。不得破坏已有向量数据。
- **LanceDB 双通道一致性**：向量与 FTS 查同一 chunks 表；tokens 仅 FTS 通道用。
- **质量门禁**：`node node_modules/typescript/bin/tsc --noEmit`、`node node_modules/eslint/bin/eslint.js <files> --max-warnings 0`、全量 `node node_modules/vitest/vitest.mjs run` 全绿。
- **环境注意（DSH 实测）**：受限沙箱 vitest/vite config 加载 EPERM → 临时 `.vitest-min.config.mjs`（import-free）+ `--pool=threads`；全量门禁 danger-full-access 官方复跑。electron 侧测试用 `node:sqlite`/mock 模式（不加载 better-sqlite3）。
- **提交规范**：`feat:`/`fix:`/`refactor:` 前缀、一个提交一件事；不提交 `.claude/`、`.codex/`；版本号只在发版改。新增分词器依赖改动 `package.json`（只加依赖行，不动 version/scripts）。

---

### Task 1: 中文分词模块（选型 + tokenize 纯函数）

**Files:**
- Create: `electron/chinese-tokenizer.ts`（分词封装）
- Create: `electron/chinese-tokenizer.test.ts`
- Modify: `package.json`（新增 jieba 依赖——选型后）

**Interfaces:**
- Consumes: 无
- Produces（Task 2/3 消费，签名锁定）:
  - `export function tokenize(text: string): string[]`（jieba 分词 → 词数组；去空白词/去重可选；空文本 → []）
  - `export function tokenizeToSpaceSeparated(text: string): string`（分词结果空格分隔，供 tokens 字段存储）

- [x] **Step 1: 选型验证（jieba-wasm vs @node-rs/jieba）**

在 worktree 尝试安装/加载 `jieba-wasm`（纯 wasm）；确认 Electron 主进程可加载（Node 侧 require/import 即可，无需 Electron 打包验证——打包留给 T6/发布）。若 jieba-wasm 安装/加载有障碍（网络/ABI），改 `@node-rs/jieba`。**记录选型结论**到报告（选哪个 + 为什么）。

- [x] **Step 2: 写失败测试（chinese-tokenizer.test.ts）**

```ts
import { describe, it, expect } from 'vitest'
import { tokenize, tokenizeToSpaceSeparated } from './chinese-tokenizer'

describe('chinese-tokenizer（L3 中文分词）', () => {
  it('中文分词：句子切为词', () => {
    const words = tokenize('主角的剑在月光下')
    expect(words.length).toBeGreaterThan(1)   // 不应整句一个 token
    expect(words).toContain('主角')           // jieba 应分出「主角」
  })
  it('tokenizeToSpaceSeparated：空格分隔，可存入 tokens 字段', () => {
    const s = tokenizeToSpaceSeparated('搜索知识库')
    expect(s).toContain(' ')
    expect(s.split(' ').filter(Boolean).length).toBeGreaterThan(0)
  })
  it('空文本/纯空白 → 空数组 / 空串', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenizeToSpaceSeparated('   ')).toBe('')
  })
  it('英文混排：英文词与中文词都保留', () => {
    const words = tokenize('hero 的剑')
    expect(words.some(w => w === 'hero')).toBe(true)
  })
})
```

（分词具体词形以 jieba 实际输出为准，断言放宽到「含关键子串/数量 >1」——分词器词典差异不破坏契约。若 jieba-wasm 输出的词形与断言不符，校准断言而非改实现。）

- [x] **Step 3: 跑失败**

Run: `node node_modules/vitest/vitest.mjs run electron/chinese-tokenizer.test.ts`（受限临时 config）。Expected: FAIL（模块不存在）。

- [x] **Step 4: 实现**

`electron/chinese-tokenizer.ts`：

**选型结论（as-built）：`jieba-wasm`**（计划允许二选一；理由：纯 wasm、Electron 免 native 重编译 + 免 asarUnpack 二进制 ABI 风险，代价是需在 vite `external` + electron-builder `asarUnpack`/`files` 白名单放行 `.wasm`）。

⚠️ **实现必须惰性加载（草案的静态 import 不可用）**：`jieba-wasm` 的 nodejs target 在**模块求值期**同步 `readFileSync` 读 `pkg/nodejs/jieba_rs_wasm_bg.wasm`。静态 `import { cut }` 会把读盘提前到本模块加载期 —— 只要 `.wasm` 未随包（白名单配错 / `__dirname` 位移），Electron 主进程**启动即崩**，而本模块内所有 `try/catch` 都在模块求值之后、捕不到加载期失败，设计 §3.1「分词器不可用 → 退回 LIKE」的降级根本不成立。故 as-built 形态为**首次调用时惰性 require + try/catch + 失败缓存 + 只告警一次**：

```ts
// as-built：electron/chinese-tokenizer.ts（导出签名与草案一致，加载方式不同）
let jiebaLoader: () => JiebaModule = defaultJiebaLoader   // 生产：require('jieba-wasm')
let jiebaModule: JiebaModule | null = null
let jiebaLoadFailed = false

export function loadJiebaModule(): JiebaModule | null {
  if (jiebaModule) return jiebaModule
  if (jiebaLoadFailed) return null            // 失败结果同样缓存，避免每次分词重试磁盘 IO
  try { return (jiebaModule = jiebaLoader()) }
  catch (e) { jiebaLoadFailed = true; /* warn 一次 */ return null }
}

export function tokenize(text: string): string[] {
  if (!text || !text.trim()) return []
  const jieba = loadJiebaModule()
  if (!jieba) return []                       // 降级为空词表 → 调用方退回逐字 LIKE
  try { return jieba.cut(text, true).filter(w => w && w.trim() !== '') }
  catch { /* warn 一次 */ return [] }
}

export function tokenizeToSpaceSeparated(text: string): string {
  return tokenize(text).join(' ')
}
```

（另导出 `loadJiebaModule` / `setJiebaLoaderForTest` 供测试注入「.wasm 读盘失败」与「首次调用才加载」。CJS 产物下 `import.meta` 会被 rolldown 降级为 `{}`，故 `createRequire` 分支只服务 ESM/vitest，两条路都不可用时由 try/catch 兜住 → 空词表而非崩溃。）

- [x] **Step 5: 跑测试确认通过**

- [x] **Step 6: 门禁 + 提交**

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js electron/chinese-tokenizer.ts electron/chinese-tokenizer.test.ts --max-warnings 0
node node_modules/vitest/vitest.mjs run electron/chinese-tokenizer.test.ts
git add electron/chinese-tokenizer.ts electron/chinese-tokenizer.test.ts package.json pnpm-lock.yaml
git commit -m "feat: 中文分词模块 chinese-tokenizer（jieba 分词，L3 任务1）"
```

---

### Task 2: chunks 加 tokens 字段 + 导入时分词 + 回填

**Files:**
- Modify: `electron/vector-store.ts`（chunks schema 加 `tokens`；新增 `getChunksWithoutTokens`/`backfillTokens`；导入 addChunks 时带 tokens）
- Modify: `electron/knowledge-base.ts`（importContent 分块后分词填 tokens；`backfillTokens` IPC 逻辑）
- Modify: `electron/controllers/kb-controller.ts`（+`kb:backfill-tokens` handle）
- Modify: `src/shared/ipc-channels.ts`（+`kb:backfill-tokens` 签名）
- Create: `electron/vector-store.test.ts`（回填幂等 + tokens 写入；沿用现有 node:sqlite/mock 或纯函数断言）

**Interfaces:**
- Consumes: Task 1 `tokenizeToSpaceSeparated`
- Produces:
  - chunks 表新增 `tokens TEXT`（LanceDB add_columns 幂等）
  - `getChunksWithoutTokens(projectPath): Promise<Array<{ text: string; fileName: string; chapterNumber?: number }>>`
  - `backfillTokens(projectPath, onProgress?): Promise<{ success: boolean; processed: number; failed: number }>`
  - IPC `'kb:backfill-tokens': { args: []; return: { success: boolean; processed: number; failed: number; error?: string } }`

- [x] **Step 1: 写失败测试**（回填幂等：getChunksWithoutTokens 只返回 tokens 缺失的 chunk；backfill 后不再返回。以纯函数/模拟断言，或 mock getConnection 仿 getChunksWithoutVectors 现有测试模式）

- [x] **Step 2: 跑失败**

- [x] **Step 3: 实现**

vector-store.ts：
- chunks 写入（addChunks）schema 加 `tokens` 字段（Utf8）；导入时 `tokens: tokenizeToSpaceSeparated(chunk.text)`。
- 加 `getChunksWithoutTokens`（查 `tokens IS NULL OR tokens = ''` 的 chunk）+ `backfillTokens`（对无 tokens chunk 分词回填，幂等）。
- 存量表 ensureChunksSchema 里补 tokens 列（add_columns，参照既有 chapterNumber 列回填模式）。

knowledge-base.ts：importContent 分块后每 chunk 分词填 tokens；新增 `backfillTokens` 导出（仿 `backfillVectors`）。

kb-controller.ts + ipc-channels.ts：`kb:backfill-tokens`。

- [x] **Step 4: 跑测试确认通过**

- [x] **Step 5: 门禁 + 提交**

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js electron/vector-store.ts electron/knowledge-base.ts electron/controllers/kb-controller.ts src/shared/ipc-channels.ts electron/vector-store.test.ts --max-warnings 0
node node_modules/vitest/vitest.mjs run electron/vector-store.test.ts
git add electron/vector-store.ts electron/knowledge-base.ts electron/controllers/kb-controller.ts src/shared/ipc-channels.ts electron/vector-store.test.ts
git commit -m "feat: chunks 加 tokens 字段 + 导入分词 + backfillTokens 回填（L3 任务2）"
```

---

### Task 3: FTS 词级检索（替换逐字 LIKE）+ 降级

**Files:**
- Modify: `electron/vector-store.ts`（`searchWithScope` 的 FTS 通道：query `tokenize` → 查 tokens；tokens 缺失 → 退回现有 LIKE）
- Modify: `electron/vector-store.test.ts`（词级检索命中 + 降级回归）

**Interfaces:**
- Consumes: Task 1 `tokenize`、Task 2 `tokens` 字段
- Produces: FTS 通道从「逐字 LIKE」改为「query 分词 → tokens 词级匹配」；tokens 缺失/分词器不可用 → 退回 LIKE（行为不变）

- [x] **Step 1: 写失败测试**（词级检索：query「搜索知识」分词「搜索 知识」→ tokens LIKE 命中含「搜索」的 chunk；构造 tokens 缺失的 chunk → 退回逐字 LIKE 仍命中。断言 source='fts' 保持）

- [x] **Step 2: 跑失败**

- [x] **Step 3: 实现**

**检索方式结论（as-built）：tokens 词级 `LIKE`，未采用 Tantivy BM25**（LanceDB 侧未建真 FTS 索引）。表达式抽成导出的纯函数 `buildChunkFTSFilter(queryText, words, scopeFilter?)` 以便直测，as-built 形态：

```ts
// as-built：electron/vector-store.ts
export function buildChunkFTSFilter(queryText: string, words: string[], scopeFilter?: string): string {
  // ⚠️ 转义必须在**逐字符拆分之后**：先转义整串再 split('') 会把 `''` 拆成 `'%'`，单引号转义随之失效
  const charPattern = `%${queryText.split('').map(escapeLikeLiteral).join('%')}%`
  const fallbackClause = `text LIKE '${charPattern}'`
  const missingTokens = `(tokens IS NULL OR tokens = '')`
  const wordClause = words.length === 0
    ? fallbackClause
    : `((${words.map(w => `tokens LIKE '%${escapeLikeLiteral(w)}%'`).join(' AND ')}) OR (${missingTokens} AND ${fallbackClause}))`
  return scopeFilter ? `(${wordClause}) AND (${scopeFilter})` : wordClause
}
```

与草案的**三处有意偏差**（均由 review 证伪草案后修正，见提交 `e6d1521` / `746ae0b`）：

1. **`OR` → `AND`**：草案每词 OR 拼接，实测「含高频词的 query」会让无关行撑满候选池、把真命中挤出 topK（reviewer 复现场景）；且 OR 下 `tokens` 词级匹配不构成「同时含多个查询词」的语义，召回精度反而低于预期。
2. **噪声词过滤**：query 分词结果先过 `selectQueryTerms`（滤掉「的/了」这类高频虚词），**实义单字词必须保留**（否则 100 条含「主角」的行会挤出同时含「剑」的真命中）。
3. **scope 并入过滤表达式**（原设计走 `q.where(scopeFilter)` —— LanceDB 的 `filter()` 是 `where()` 别名且 `where()` 为**赋值**语义，二次调用会**覆盖**词级条件，带 `chapterScope` 时 FTS 通道退化为「章节窗内任意行」，窗内无关块被标 `source='fts'` 后由 rag 层豁免 0.6 阈值注入上下文。这是**既有缺陷被本档放大**，属 review IMP-1）。

另两条兜底：词级表达式抛错（`tokens` 列缺失/类型不符 → 补列失败）时**退回纯逐字 LIKE 重试一次**，避免 FTS 通道静默归零（Important-2）；候选**先取足量再打分**（`candidateLimit = max(topK*10, 50)`），原 `limit(topK*3)` 会在打分前按表扫描顺序截断、多词命中面大时真命中被挤出候选池。`source='fts'` 判定与 `computeFTSRelevance` 启发式打分保持不变。

- [x] **Step 4: 跑测试确认通过**

- [x] **Step 5: 门禁 + 提交**

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js electron/vector-store.ts electron/vector-store.test.ts --max-warnings 0
node node_modules/vitest/vitest.mjs run electron/vector-store.test.ts
git add electron/vector-store.ts electron/vector-store.test.ts
git commit -m "feat: FTS 通道改中文词级检索（query 分词 → tokens），tokens 缺失退回 LIKE 兜底（L3 任务3）"
```

---

### Task 4: RRF 融合（替换 max 取并）

**Files:**
- Modify: `electron/vector-store.ts`（`searchWithScope` 融合：candidates 改为双通道各记 rank，RRF 融合）
- Modify: `electron/vector-store.test.ts`（RRF 排序正确性）

**Interfaces:**
- Consumes: Task 3 双通道结果
- Produces: RRF 融合（`score(d) = Σ_channel 1/(60 + rank_channel(d))`），替换「分数取 max」

- [x] **Step 1: 写失败测试**（RRF 排序：⚠️ 原拟数据 `[A(0.9), B(0.85)] + FTS [B(1.0), A(0.5)]` **经 T4 review 实证不可用**——A/B 在该数据下 RRF 分**完全相等**（各 `1/61+1/62`），且 max 语义下同样是 B 排 A 前（B 取 FTS 1.0 > A 的 0.9）→ 既不能满足「B 排 A 前」，也无法证明「与 max 不同」。改用**共识用例**：C 原始分最低但两通道共识排前 → RRF `[C,B,A]` vs max `[B,A,C]`（这才是「RRF ≠ max」的正证据）；另补单通道退化 / 全空 / **完全打平**（key 升序兜底）用例。`rrfFuse` 纯函数导出测。T4 破平契约见 SDD ledger：融合分降序 → 完全打平时最佳原始分降序 → 再打平 key 升序）

- [x] **Step 2: 跑失败**

- [x] **Step 3: 实现**

抽纯函数 + 改造 searchWithScope 融合。**as-built 签名改为变参通道**（草案的双参 `(vectorCandidates, ftsCandidates, k)` 在加通道时需改签名，变参形态与破平需要的最佳原始分一并落地）：

```ts
// as-built：electron/vector-store.ts
export function rrfFuse(
  channels: Array<Array<{ key: string; score: number }>>,
  k = 60,
): Array<{ key: string; score: number }> {
  const fused = new Map<string, number>()
  const bestRaw = new Map<string, number>()
  for (const list of channels) {
    list.forEach((c, i) => {
      fused.set(c.key, (fused.get(c.key) ?? 0) + 1 / (k + (i + 1)))
      const prev = bestRaw.get(c.key)
      if (prev === undefined || c.score > prev) bestRaw.set(c.key, c.score)
    })
  }
  return [...fused.entries()]
    .map(([key, score]) => ({ key, score, raw: bestRaw.get(key) ?? 0 }))
    .sort((a, b) =>
      b.score - a.score                     // ① 融合分降序
      || b.raw - a.raw                      // ② 完全打平 → 最佳原始分降序（与改造前 max 序一致）
      || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))  // ③ 再打平 → key 升序（不依赖 Map 插入序）
    .map(({ key, score }) => ({ key, score }))
}
```

**破平契约（SDD ledger 记录）**：融合分降序 → 完全打平时按各 key 的**最佳原始分**降序 → 再打平按 key 升序。②保证「RRF 打平时不劣于旧行为」，③保证结果确定可复现。

`searchWithScope` 融合 as-built：通道 1/2 各自按本通道分数降序、**通道内先按 key 去重**（重复导入/同 text 多行 → 保留最高分，否则同一 rank 会被重复累加虚增融合分）→ `rrfFuse([vectorChannel, ftsChannel])` → **融合排序之后**才 `slice(0, topK)`（草案把截断留在通道内，T3 handoff 已指出真命中被挤出候选池）→ 映射回 4 键 `SearchResult`。

**score 归属（草案留待实现定的那处）**：`SearchResult.score` **仍是通道 max 分**（`bestByKey` 取两通道较高者），RRF 分**只用于排序**、不外泄。依据：`rag-context-provider` 的 0.6 硬阈值与 `search-knowledge.tool` 的 `min_score` 按原始分标定，换 RRF 分会改变既有阈值语义；FTS 通道的阈值豁免本来就靠 `source` 而非 score，故安全。

- [x] **Step 4: 跑测试确认通过**

- [x] **Step 5: 门禁 + 提交**

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js electron/vector-store.ts electron/vector-store.test.ts --max-warnings 0
node node_modules/vitest/vitest.mjs run electron/vector-store.test.ts
git add electron/vector-store.ts electron/vector-store.test.ts
git commit -m "feat: RRF 融合替换双通道 max 取并（k=60，L3 任务4）"
```

---

### Task 5: 查询改写（角色别名扩展）

**Files:**
- Modify: `electron/vector-store.ts` 或 `electron/knowledge-base.ts`（检索前查询改写：读 characters 别名 → query 扩展）
- Modify: 相关测试

**Interfaces:**
- Consumes: characters v14 `aliases`（JSON 数组）
- Produces: `rewriteQuery(query, charactersAliases): string`（query 分词 + 角色别名扩展 → 扩展后 query 供 FTS/向量检索）

- [x] **Step 1: 写失败测试**（query 含角色名 → 扩展加入别名；别名缺失 → 原样；纯函数断言）

- [x] **Step 2: 跑失败**

- [x] **Step 3: 实现**

**扩建入口 as-built（与草案的有意偏差）**：改写发生在 `knowledge-base.ts` 的 `searchKnowledge`（`kb:search` / `kb:search-with-scope` 的上游），产物是 `rewriteQuery(query, aliasMap)` 纯函数 + `buildCharacterAliasMap(rows)` 纯函数 + `readCharacterAliasMap(projectPath)`（IO）。

- 命中判定取并集：**分词 token 精确相等**（大小写不敏感）+ **原文子串包含**（长度 ≥ 2）——jieba 把 OOV 人名切碎时 token 判定会漏，子串判定补上（与 T3「跨 token 边界漏命中」是查询侧的同类镜像）。
- ⚠️ **扩展只喂语义通道**：`storeSearchWithScope` 的 `queryText` 只被 FTS 通道消费，而 T3 词级检索是 **AND** —— 把变体并进 `queryText` 等于**追加 AND 约束**，候选集只会收紧（query「阿晚」并入 苏晚/晚儿 后要求 chunk 同时含三种形态），反向丢失既有召回。故**词法通道沿用原 query**，只有送去 embedding 的文本用扩展后 query。
- ⚠️ **收益边界（review Important-1 收窄，勿再表述为「纯增益」）**：上述保证只到「词法通道不变、候选池不减」；扩展后的 query 向量会改变语义通道的候选与品秩，而 T4 的融合是在**融合排序之后**才 slice(topK)，因此**结果集排序与 top-K 成员可能被替换**（同 query、topK=1 时 top1 就可能换块）。带硬阈值的消费者（rag 0.6 / `min_score` 0.5）**可能丢弃改造前会注入的 chunk** —— 该风险只能在**有 API Key 的真实 embedding 环境**复测确认（已登记为发布前置项，见 T6 Step 2）。
- 项目边界：`readCharacterAliasMap` 校验 `getCurrentProjectPath() === projectPath`，避免检索 B 项目时并入 A 项目别名（跨项目污染）；无 characters 表/解析失败/未开项目 → 空 map → 原样 query（行为与改造前一致）。

角色名不稀释已由 `buildChapterRAGQuery` 保证（本章范围），此改写针对**跨章/知识库**检索的同义扩展。

- [x] **Step 4: 跑测试确认通过**

- [x] **Step 5: 门禁 + 提交**

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js <改动文件> --max-warnings 0
node node_modules/vitest/vitest.mjs run <测试文件>
git add <改动文件>
git commit -m "feat: 查询改写——角色别名扩展（复用 characters v14 aliases，L3 任务5）"
```

---

### Task 6: 全量门禁 + 回归 + 已知限制登记

**Files:**
- Verify: 全量测试 / typecheck / lint
- Verify: 现有检索回归（kb:search / search-with-scope / rag-context-provider 阈值豁免 / FTS 兜底）

- [x] **Step 1: 全量门禁（官方复跑）**

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js . --ext ts,tsx --max-warnings 0   # 受限环境改逐文件
node node_modules/vitest/vitest.mjs run
```
Expected: 全绿（基线 104 files/1178 + 本档新增）。断言附真实输出。

- [x] **Step 2: 已知限制登记**

- reranker 非 v1（设计 §3.4）。
- 分词器选型结论（T1 报告）+ wasm/native 打包注意（发布时验证）。
- 回填成本（大库一次分词）。
- RRF k=60 为标准值，可调参。

---

## Self-Review 记录

**① 设计三步覆盖**：① 分词 FTS → T1/T2/T3；② RRF → T4；③ 查询改写 → T5；reranker 非 v1（无任务）。

**② 占位符扫描**：无 TBD；各 Task 给关键接口/测试契约；T3 的「真 FTS vs tokens LIKE」留实现验证（报告记录最终方式）。

**③ 跨任务签名一致性**：`tokenize`/`tokenizeToSpaceSeparated`（T1）被 T2/T3 引用；`tokens` 字段（T2）被 T3 检索；`rrfFuse`（T4）独立纯函数；`rewriteQuery`（T5）在检索入口。IPC `kb:backfill-tokens`（T2）签名统一。

**④ 非目标无任务**：reranker、向量侧 ANN/embedding 改动、rag-context-provider 注入/阈值逻辑、多项目/多语言分词（英文按空格天然可分，中文 jieba）。

---

## 执行记录（2026-09-10 收口）

**状态：✅ T1–T6 全部完成**，提交区间 `f217e6d`（T1）→ `746ae0b`（final 修复轮），含 `6dee5d2`/`e6d1521`（T3 及其 review 收口）、`94c26a5`（T4）、`d80ae28`/`8891e97`（T5 及措辞收窄）、`1758c54`（T2）、`8891e97`（T6 门禁硬化）、`54cc712`（本文档 RRF 测试数据更正）。

**任务 → 提交对照**

| Task | 提交 | 说明 |
|---|---|---|
| T1 分词模块 | `f217e6d` | jieba-wasm 选型；as-built 为惰性加载 + 降级 |
| T2 tokens + 回填 | `1758c54` | `tokens` 列 / `backfillTokens` / `kb:backfill-tokens` / 打包白名单 |
| T3 词级 FTS | `6dee5d2` + `e6d1521` | OR→AND、噪声词过滤、打分前置 |
| T4 RRF 融合 | `94c26a5` | 变参 `rrfFuse` + 三级破平 + 截断后置 |
| T5 查询改写 | `d80ae28` + `8891e97` | `rewriteQuery` 只喂语义通道 + 收益边界收窄 |
| T6 门禁 + 限制登记 | `8891e97` + `746ae0b` | scope 并入表达式（IMP-1）/ 回填接线（IMP-2）/ 惰性加载（IMP-3） |

**门禁实测（2026-09-13 复跑，非引用历史）**

| 门禁 | 结果 |
|---|---|
| `tsc --noEmit` | exit 0 |
| `eslint <L3 改动文件> --max-warnings 0` | exit 0 |
| `vitest run`（官方 `vitest.config.ts`） | **107 files / 1254 tests 全过** |
| CI（`gh run list`） | L3 主线提交当时 failure，根因是 CI 无 electron 二进制导致的打桩缺失（`c540fd2` 修复）；当前 master 最近两次 run success |

> 受限沙箱下官方 config 会 `spawn EPERM`（vite 打包 config），需放宽权限复跑；最小 config 路线会因 logger 写 `~/.novelforge/logs` 报 EPERM（测试本身全过但 exit 1）。这与 §Global Constraints「环境注意」一致。

**已知限制 / 发布前置项**（详版在 `.codex/memory/project-state.md` L3 节）

- reranker 非 v1（设计 §3.4）。
- **真实 embedding 环境未复测**：别名扩展对语义通道 top-K 与阈值命中率的实际影响（无 API Key 无法本地验证）—— 发布前置项。
- **jieba-wasm 打包后真机加载未验证**：`.wasm` 是否随包可读、asar 路径是否位移 —— 发布时验证。
- FTS-only（无 Embedding）模式下别名扩展无增益（词法通道刻意不变）。
- 词级 AND 为**子串**语义，跨 jieba token 边界的 OOV 词仍会漏；无有效词的 chunk 永远计入 `failed`。
- 候选上限仍取在通道内排序之前（根治需服务端排序）。
