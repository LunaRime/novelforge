# L3 中文检索升级 实施计划（SDD）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

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

- [ ] **Step 1: 选型验证（jieba-wasm vs @node-rs/jieba）**

在 worktree 尝试安装/加载 `jieba-wasm`（纯 wasm）；确认 Electron 主进程可加载（Node 侧 require/import 即可，无需 Electron 打包验证——打包留给 T6/发布）。若 jieba-wasm 安装/加载有障碍（网络/ABI），改 `@node-rs/jieba`。**记录选型结论**到报告（选哪个 + 为什么）。

- [ ] **Step 2: 写失败测试（chinese-tokenizer.test.ts）**

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

- [ ] **Step 3: 跑失败**

Run: `node node_modules/vitest/vitest.mjs run electron/chinese-tokenizer.test.ts`（受限临时 config）。Expected: FAIL（模块不存在）。

- [ ] **Step 4: 实现**

`electron/chinese-tokenizer.ts`：

```ts
// 选型后实现（jieba-wasm 或 @node-rs/jieba）
import { cut } from 'jieba-wasm'  // 或 @node-rs/jieba

export function tokenize(text: string): string[] {
  if (!text || !text.trim()) return []
  const words = cut(text, true)  // 返回词数组
  return words.filter(w => w && w.trim() !== '')
}

export function tokenizeToSpaceSeparated(text: string): string {
  return tokenize(text).join(' ')
}
```

（`cut` 签名以所选库为准；jieba-wasm 可能 `cut(text)` 返回数组，`@node-rs/jieba` 类似。以实际库 API 实现，导出签名锁定。）

- [ ] **Step 5: 跑测试确认通过**

- [ ] **Step 6: 门禁 + 提交**

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

- [ ] **Step 1: 写失败测试**（回填幂等：getChunksWithoutTokens 只返回 tokens 缺失的 chunk；backfill 后不再返回。以纯函数/模拟断言，或 mock getConnection 仿 getChunksWithoutVectors 现有测试模式）

- [ ] **Step 2: 跑失败**

- [ ] **Step 3: 实现**

vector-store.ts：
- chunks 写入（addChunks）schema 加 `tokens` 字段（Utf8）；导入时 `tokens: tokenizeToSpaceSeparated(chunk.text)`。
- 加 `getChunksWithoutTokens`（查 `tokens IS NULL OR tokens = ''` 的 chunk）+ `backfillTokens`（对无 tokens chunk 分词回填，幂等）。
- 存量表 ensureChunksSchema 里补 tokens 列（add_columns，参照既有 chapterNumber 列回填模式）。

knowledge-base.ts：importContent 分块后每 chunk 分词填 tokens；新增 `backfillTokens` 导出（仿 `backfillVectors`）。

kb-controller.ts + ipc-channels.ts：`kb:backfill-tokens`。

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: 门禁 + 提交**

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

- [ ] **Step 1: 写失败测试**（词级检索：query「搜索知识」分词「搜索 知识」→ tokens LIKE 命中含「搜索」的 chunk；构造 tokens 缺失的 chunk → 退回逐字 LIKE 仍命中。断言 source='fts' 保持）

- [ ] **Step 2: 跑失败**

- [ ] **Step 3: 实现**

`searchWithScope` FTS 通道（:576-600）改造：

```ts
// 通道 2：FTS（tokens 词级匹配；tokens 缺失/分词器不可用 → 退回 LIKE 逐字兜底）
try {
  const words = tokenize(queryText)
  const escapedQuery = queryText.replace(/'/g, "''").replace(/%/g, '％').replace(/_/g, '＿')
  let likePattern: string
  if (words.length > 0) {
    // 词级：每个词作为一个容错片段，OR 匹配（比逐字更精准）
    likePattern = words.map(w => `%${w.replace(/'/g, "''").replace(/%/g, '％').replace(/_/g, '＿')}%`).join(' OR tokens LIKE ')
    likePattern = `(tokens LIKE ${likePattern})`
  } else {
    likePattern = `%${escapedQuery.split('').join('%')}%`  // 逐字兜底
  }
  // 词级匹配优先查 tokens；tokens 为空的行用 text LIKE 兜底
  // （LanceDB filter 表达式：优先 tokens 命中，tokens 缺失则 text LIKE）
  ...
}
```

> 实现细节：LanceDB 的 FTS 索引在 tokens 上（Task 2 建），但**检索走 `tokens LIKE '%词%'`**（词级容错）还是**真 Tantivy FTS**（`table.search('词1 词2')`）——实现时验证 LanceDB FTS 查询 API 与 tokens 分词检索效果；**若 Tantivy FTS 在 tokens 上能按空格分词检索，优先真 FTS（BM25 打分）；否则退 tokens LIKE 词级**（比逐字 LIKE 已是大改进）。两种都保留 source='fts' + computeFTSRelevance 或 BM25 分数。**报告记录最终检索方式**。

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: 门禁 + 提交**

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

- [ ] **Step 1: 写失败测试**（RRF 排序：⚠️ 原拟数据 `[A(0.9), B(0.85)] + FTS [B(1.0), A(0.5)]` **经 T4 review 实证不可用**——A/B 在该数据下 RRF 分**完全相等**（各 `1/61+1/62`），且 max 语义下同样是 B 排 A 前（B 取 FTS 1.0 > A 的 0.9）→ 既不能满足「B 排 A 前」，也无法证明「与 max 不同」。改用**共识用例**：C 原始分最低但两通道共识排前 → RRF `[C,B,A]` vs max `[B,A,C]`（这才是「RRF ≠ max」的正证据）；另补单通道退化 / 全空 / **完全打平**（key 升序兜底）用例。`rrfFuse` 纯函数导出测。T4 破平契约见 SDD ledger：融合分降序 → 完全打平时最佳原始分降序 → 再打平 key 升序）

- [ ] **Step 2: 跑失败**

- [ ] **Step 3: 实现**

抽纯函数 + 改造 searchWithScope 融合：

```ts
/** RRF 融合（k=60）：输入各通道候选（已按各自分数降序），返回融合排序后的候选 */
export function rrfFuse(
  vectorCandidates: Array<{ key: string; score: number }>,
  ftsCandidates: Array<{ key: string; score: number }>,
  k = 60,
): Array<{ key: string; score: number }> {
  const rrf = new Map<string, number>()
  const add = (list: Array<{ key: string; score: number }>) => {
    list.forEach((c, i) => { rrf.set(c.key, (rrf.get(c.key) ?? 0) + 1 / (k + (i + 1))) })
  }
  add(vectorCandidates); add(ftsCandidates)
  return [...rrf.entries()].map(([key, score]) => ({ key, score })).sort((a, b) => b.score - a.score)
}
```

searchWithScope：通道 1/2 各自收集**有序候选列表**（按各自分数降序）→ `rrfFuse` 融合 → slice topK。返回的 SearchResult.score 用 RRF 分（或保留原通道分，RRF 只用于排序——实现时定，倾向 score 存 RRF 分供排序/阈值，但 FTS 豁免逻辑靠 source 不靠 score，故安全）。

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: 门禁 + 提交**

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

- [ ] **Step 1: 写失败测试**（query 含角色名 → 扩展加入别名；别名缺失 → 原样；纯函数断言）

- [ ] **Step 2: 跑失败**

- [ ] **Step 3: 实现**

读 characters 别名（`db:character-list` 或 repository 取 name+aliases）→ query 分词 → 命中角色名时把别名并入 query（空格/词拼接）。检索入口（searchWithScope 或 kb-controller）先 rewriteQuery 再检索。角色名不稀释已由 `buildChapterRAGQuery` 保证（本章范围），此改写针对**跨章/知识库**检索的同义扩展。

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: 门禁 + 提交**

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

- [ ] **Step 1: 全量门禁（官方复跑）**

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js . --ext ts,tsx --max-warnings 0   # 受限环境改逐文件
node node_modules/vitest/vitest.mjs run
```
Expected: 全绿（基线 104 files/1178 + 本档新增）。断言附真实输出。

- [ ] **Step 2: 已知限制登记**

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
