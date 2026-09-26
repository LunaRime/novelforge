# NovelForge 引入 Rust 原生内核的可行性分析

> 分析日期：2026-09-26 / 基线 v0.1.7-beta.1（非测试 TS/TSX 约 88,800 行；electron/ 18,263 + src/ 70,525）
> 结论先行：**只有一处值得换 Rust —— jieba 的 WASM 线性内存地板（加载即 +60 MB，分词后再抬 +97 MB 且永不归还）。**
> **真正的两个悬崖在向量回填路径上，但换 Rust 帮不上忙** —— 瓶颈是"调用次数与跨边界搬运量"而非"计算速度"，
> 把逻辑搬进原生反而**多一层边界**。这两条用既有引擎的批量 API 就能解，实测快两个数量级。
>
> 本文是 [`python-replacement-analysis.md`](python-replacement-analysis.md) 的姊妹篇：那篇问"要不要引入 Python"，
> 本篇问"要不要引入 Rust"。

---

## 0. 与姊妹篇的关系

| 项 | 现状 |
|----|------|
| 那篇的 Phase 1「本地向量化」 | **已落地** —— v0.1.7 以 Ollama 本地嵌入实现（`electron/ollama-embedding.ts`），不再是能力缺口 |
| 那篇的 C 档「不建议替换」清单 | 本次实测**全部复核为仍然成立**（SQLite 层 / LLM 薄封装 / 工作流与 Agent 编排 / UI 一律不动） |
| 那篇的 A3「docx/epub 导入导出」 | 仍开放，与本篇无交集（格式库是能力缺口，不是性能问题） |
| 方法论差异 | 那篇靠**判断**（生态成熟度、打包成本）；本篇靠**实测**（附脚本与原始读数，全部可复现） |

**重要前提**：本项目**已经在跑 Rust** —— `@lancedb/lancedb` 的核心就是 Rust（`lance` 0.27.2 系），
`jieba-wasm` 也是 Rust 编的 WASM。所以本篇讨论的不是"要不要引入 Rust 工具链"，
而是"**要不要把一个 JS↔原生边界替换成更划算的边界**"。

---

## 1. 测量方法与可复现性

- **环境**：node v24.21.0 / win32 x64 / 与生产同版本的 `@lancedb/lancedb@0.27.2`
- **脚本位置**：系统临时目录（仓库外），**未改动仓库任何文件**：
  `jieba-child.cjs`（分进程分词）、`u2.cjs`（逐行 update 代价）、`api.cjs`/`api2.cjs`（批量变更与批大小曲线）、
  `bench3.cjs`（JS 纯计算）
- **四路读数**：`rss` / `heapUsed` / `arrayBuffers` / `external`
- **两条方法论要点（否则结论会错）**：
  1. ⚠️ **`arrayBuffers` 不是 WASM 线性内存的探针** —— 实测恒为 0.1 MB。Node 把 WASM 内存计入 **`external`**。
     最初用 `arrayBuffers` 观察得出"没有增长"的错误结论，改用 `external` 才读到真相。
  2. **分进程 + 同规模跑两遍** —— 分进程排除跨测试污染；跑两遍用于区分
     「**一次性高水位**」（第二遍不再增长）与「**每次调用泄漏**」（逐次等量增长）。这个区分决定了整改方向完全不同。

---

## 2. 硬证据一：jieba-wasm 是内存地板（唯一该换 Rust 的项）

`electron/chinese-tokenizer.ts` 惰性加载 `jieba-wasm`（Rust → WASM）。**每个规模独立进程测量**：

| 分词规模 | 加载后 RSS | `external`（WASM 线性内存） | 分词耗时 |
|---|---|---|---|
| **0（只加载，不分词）** | 112.9 MB | **60.5 MB** | — |
| 1 千字 | 110.3 MB | 60.5 MB | 2 ms |
| 1 万字 | 110.4 MB | 60.5 MB | 9 ms |
| 10 万字 | 110.5 MB | 63.6 MB | 52 ms |
| 50 万字 | 110.6 MB | 107.4 MB | 212 ms |
| **100 万字** | 110.8 MB | **158.0 MB** | 404 ms |

三条硬结论：

1. **加载即 +60 MB**（`external` 1.6 → 60.5），**一个字都不分**就要付。
   因是惰性加载，用户感知为"**第一次检索/导入之后内存多了 60 MB，再也没下来**"。
2. **分一次 100 万字 → 峰值 158 MB，双次 GC 后纹丝不动**；同规模第二遍**不再增长**
   ⇒ 是**高水位，不是每次调用的泄漏**（这点没有冤枉它）。
3. **这块内存压缩不了。** 它位于 `.wasm` 实例的线性内存页内：V8 的 GC 碰不到它，
   操作系统也收不回。「压缩」对它无效 —— WASM 线性内存**只增不减**。

**换 `jieba-rs` 编成 napi 原生扩展的收益是精确的**：那 ~97 MB 一次性高峰可退回 OS；
**词典那 60 MB 退不掉**（本来就必须常驻）。额外收益：省掉每次调用的 JS↔WASM 字符串拷贝；
且 napi（Node-API）**ABI 稳定，不需要 electron-rebuild**（不像 better-sqlite3）。

---

## 3. 硬证据二：向量回填是真悬崖（但换 Rust 更糟）

### 3.1 方式 1（默认档：本地 Ollama / Embedding API）—— 整库搬运

`electron/knowledge-base.ts:791-802`：

```js
const fullTable = await db.openTable('chunks')
const allRows = await fullTable.query().toArray()        // ← 全表载入 JS 对象（所有块全文 + 所有已有向量）
const updatedRows = allRows.map(r => ({ ...r, vector })) // ← 再复制一份
// ...assertVectorDimCompatible...
await db.dropTable('chunks')
await db.createTable('chunks', updatedRows, { schema })  // ← 整表重写
```

- **峰值 ≈ 全库 ×3**（原始 JS 对象 + `.map` 浅拷贝 + Arrow 写入缓冲）
- 每行约 **10 KB**：500 字中文块（UTF-16 ≈1 KB）+ 1024 维 `number[]`（**8 KB**）
- 1 万块 → **约 300 MB 尖峰**；5 万块 → 1.5 GB
- 实测印证：5000 行 × 1024 维在 JS 侧持有即 `heap=108 MB`（与 ~10 KB/行 的推算一致）
- 附加代价：`dropTable` 期间库不可用，中途失败即数据丢失

### 3.2 方式 2（LLM 降级档）—— 逐行原生调用

`electron/vector-store.ts:1257-1271` 对**每一行**单独调一次 `table.update()`：

| 指标 | 实测值 |
|---|---|
| 单行耗时（预热后稳定态） | **11.88 ms/行** |
| 1 万行 | **119 秒** |
| 5 万行 | **9.9 分钟** |
| **渲染进程 IPC 超时上限 30 s** | **超过约 2,524 行必然报"失败"** —— 主进程还在写，UI 已放弃 |

最后一行是 **bug 形态**而非性能问题：大知识库的向量回填**稳定失败**。

### 3.3 修法实测：`mergeInsert` 批量变更（`@lancedb/lancedb@0.27.2` 已提供）

5000 行 × 1024 维，同一台机器：

| 批大小 | 单次耗时 | ms/行 | 全量 5000 行 |
|---|---|---|---|
| 100 | 16 ms | 0.16 | 0.8 s（50 批） |
| **500** | **29 ms** | **0.06** | **0.3 s（10 批）** |
| 1000 | 40 ms | 0.04 | 0.2 s（5 批） |
| 2500 | 85 ms | 0.03 | 0.2 s（2 批） |
| **逐行 `update()`（现状）** | — | **11.88** | **59 s** |

**批量相对逐行快两个数量级（约 200×）。** 且逐行那 11.88 ms 几乎全是**每次调用的固定开销**
（表打开、过滤扫描、提交事务），与向量维度无关 —— 这正是"瓶颈是调用次数，不是计算"的直接证据。

**结论**：这两条**换 Rust 无效** —— 瓶颈在 JS↔原生边界的**搬运量与调用次数**，
把逻辑搬进原生会**再增加一层边界**。正确修法是压扁调用次数（§7）。

---

## 4. 被实测否掉的候选（含本次分析自身的 5 处误判）

开工时按复杂度分析点名的 5 处"JS 热点"，实测后**全部撤回**：

| 我最初的预判 | 实测结果 |
|---|---|
| `truncateToTokenBudget` 是 O(n²) 秒级 | **19–31 ms**；实际是 O(预算²)，与文档长度无关 |
| `computeTextStats` 有 GB 级瞬时分配 | 9.8 万字 **4.9 ms** |
| `textSimilarity`（3-gram 集合）泄漏几十 MB | 10 万字 **12.7 ms**，堆增长 ≈ 0（GC 收得干净） |
| 文风审计（`audits.ts`）是秒级悬崖 | 180 万字 **0.18 s**；50 术语 × 2 次全文扫描 **0.06 s** |
| `table.update` 传 `number[]` 有 dtype bug | 三个最小复现（u3/u4）全部通过、项目自身真实-LanceDB 测试也覆盖该路径 → **判定为探针伪影，撤回** |

**这五行本身就是结论**：这个项目在 JS 侧的纯计算**没有瓶颈**，也没有可测的内存泄漏。
V8 的字符串搜索与外推比预期快两个数量级。**换语言在这些点上只能买到"更快"，但基数只有 3–31 ms ——
收益到手也感知不到，却要付出跨语言边界的成本。**

---

## 5. 逐模块评估矩阵

### 🟢 A 档：唯一推荐引入 Rust

**A1. jieba 分词器（WASM → napi 原生）** —— 见 §6

唯一"只有原生分配器能解"的问题：回收 ~97 MB 高水位。理由不是"更快"（404 ms 已经够快），
而是 **WASM 线性内存是单调地板，压缩与 GC 都碰不到它**。

### 🟡 B 档：必须做，但**不是**语言问题

**B1. 方式 1 回填：消除整表重写**（建表恒带 null 向量列 + 存量一次性迁移）/ **B2. 方式 2 回填：逐行 → 批量** —— 见 §7

纯 TS + 既有原生引擎 API 的改动，不动依赖树，却拿掉分钟级悬崖与那个 30 s 超时 bug。
**优先级高于 A**：B 是确定性故障，A 是内存占用。

### 🔴 C 档：不建议（实测支持）

| 模块 | 为什么不换 |
|---|---|
| `token-budget.ts` 截断 / `text-stats.ts` 统计 | 19–31 ms / 4.9 ms，已足够快 |
| `llm-embedding-optimizer.ts`（相似度/n-gram） | 12.7 ms，堆增长 ≈ 0 |
| `audit/audits.ts` 全文扫描 | 180 万字 0.18 s |
| `DiffViewer.tsx` 的 LCS（`m>1000` 已降级） | 上限被钉死；且在渲染进程（sandbox 只能 WASM，而 WASM 正是内存地板来源 —— 自相矛盾） |
| `utils/read-text-window.ts` | 已是流式 + RSS 有界，实现正确，**别碰** |
| LLM provider / SQLite 层 / 工作流与 Agent 编排 / store / UI | 与姊妹篇 C 档结论一致 |
| IPC / 日志 / MCP 管理器 | 无计算量，换语言零收益 |
| **Go / 独立 sidecar** | 否决：进程模型 + IPC 序列化 + 多份二进制，收益抵不过复杂度（与姊妹篇对 Python 的取舍同理） |
| **C++ / Zig** | 否决：相对 Rust 无优势，且 Rust 已在依赖树内（lance），不值得引第二套工具链 |

---

## 6. 设计 A：jieba 原生化（`jieba-rs` + napi-rs）

### 目标 / 非目标

- **目标**：消除 WASM 线性内存地板（实测 ~97 MB 高水位可回收）；省掉跨边界字符串拷贝
- **非目标**：**不追分词速度**（404 ms/百万字已足够）；**不追那 60 MB 词典**（必须常驻，退不掉）

### 接口契约：必须逐条保持（这是硬约束，不是风格）

`electron/chinese-tokenizer.ts:3-14` 的注释记录了为什么不能静态导入：
`jieba-wasm` 的 nodejs target 在**模块求值期**同步读盘，一旦 `.wasm` 未随包（asar/files 白名单配错），
**主进程启动即崩**，而模块内所有 try/catch 都在求值之后、捕不到加载期失败 —— 设计 §3.1「分词器不可用 → 退回 LIKE」的降级就不成立。

原生版**必须保持同一契约**：

1. **惰性加载 + 失败缓存**：`loadJiebaModule()` 首次调用才加载；失败返回 `null` 并**只告警一次**
2. **降级而非崩溃**：`tokenize()` 失败返回 `[]`、`tokenizeToSpaceSeparated()` 返回 `''`
   → 调用方（`knowledge-base.ts` / `vector-store.ts`）据此退回逐字符 LIKE
3. **导出签名不变**：`tokenize(text): string[]` / `tokenizeToSpaceSeparated(text): string`
4. **可注入替身**：`setJiebaLoaderForTest` 保留，现有 `chinese-tokenizer.test.ts` 必须继续通过

> 原生模块的加载失败面比 WASM **更大**（.node 缺失/ABI/杀软隔离），所以第 1、2 条在原生版里**更重要**，不是负担。

### 工程落地

| 项 | 做法 |
|---|---|
| 包结构 | 新增本地 crate（如 `native/tokenizer/`），napi-rs 3.x，暴露 `cut(text, hmm)` 与 `cutToSpaceSeparated(text)` |
| ABI | **Node-API（napi）ABI 稳定 ⇒ 不需要 `electron-rebuild`**（区别于 better-sqlite3） |
| 打包 | 加入 `electron-builder.json5` 的 `asarUnpack` 与 `files` 回加区 |
| **校验（已存在，无需新建）** | `scripts/detect-native-deps.cjs` 会自动扫 `.node` 并核对 asarUnpack / files 覆盖 —— 加完会被自动验证 |
| 构建产物体积 | release profile 用 `lto = true` / `opt-level = "z"` / `strip = true`。体积不是反对理由：同族的 lance `.node` 已大一个量级，走同一套工具链 |

### 备选方案与取舍（都考虑过，均不选为主路）

| 备选 | 为什么不选 |
|---|---|
| **保留 WASM，只做分块上限**（把长文切 64 KB 再喂 `cut`） | 能压住单次峰值，但**词典那 60 MB 地板退不掉**；且分块会切断词边界、**影响分词质量**。可作为**零新增依赖的过渡方案** |
| `nodejieba`（C++ napi） | 功能等价，但要引**第二套原生工具链**（node-gyp/C++），且与现有 jieba 上游不同、**无法对拍** |
| 更小的分词器 / 按需词表 | 方向可行但属**算法替换**，会改变分词结果 → 影响检索召回，需单独评估，不在本设计范围 |

**选 `jieba-rs` 的决定性理由**：与现有 `jieba-wasm` **同上游**，分词结果可逐字对拍 → 迁移风险最低。

### 主要成本（诚实说）

**CI 需要 Rust 工具链（三平台）**。这是本设计真正的成本项，不是代码量。
落地前需确认 CI 配置（见 `ci-parity-standard`：本地绿 ≠ CI 绿），并明确 napi 产物是按平台构建还是交叉编译。

### 验收标准

1. **对拍**：同一语料，原生版与 `jieba-wasm` 的 `cut()` 输出**逐字一致**（diff = 0）
2. **内存**：加载后 `external` 增量与"100 万字分词后 `external` 峰值"对比本文件 §2 基线
   （目标：高水位可回落；**不要求**降低加载地板的 60 MB）
3. **降级**：删除/改名 `.node` 后，主进程**正常启动**，`tokenize()` 返回 `[]`、只告警一次、检索退回 LIKE
4. **门禁**：`typecheck` / `lint --max-warnings 0` / `test` 全绿；`pnpm run build` 后
   `verify-packed-app` 与 `detect-native-deps` 通过
5. **CI 三平台**打包产物均含正确平台的 `.node`

---

## 7. 设计 B：向量回填写入路径（**优先级高于 A**）

### B2. 方式 2：逐行 `update()` → `mergeInsert`（先做，改动最小、收益最大）

`electron/vector-store.ts:1254-1285`：

```js
// 现状：N 次原生调用，11.88 ms/行
for (const update of updates) {
  const updated = await table.update({ where: `id = '${sanitizeFilterValue(update.id)}'`, values: {...} })
  written += typeof (updated)?.rowsUpdated === 'number' ? updated.rowsUpdated : 1
}
```

改为**分批 `mergeInsert`**（实测批 500 时 0.06 ms/行，约 200×）：

```js
const BATCH = 500
for (const batch of chunk(updates, BATCH)) {
  const res = await table
    .mergeInsert('id')
    .whenMatchedUpdateAll()
    // ⚠️ 刻意【不】调用 .whenNotMatchedInsertAll() —— 未匹配行即视为失败，见下方约束 1
    .execute(batch.map(u => ({ id: u.id, vector: normalizeVector(u.vector) })))
  written += res.numUpdatedRows                    // 引擎返回精确计数
}
```

**必须守住的语义约束**（现状代码的注释明确依赖它们）：

1. **不得插入未匹配行** —— 现状把"id 未匹配"计入 `failed`；
   若调用 `.whenNotMatchedInsertAll()` 会凭空插入新行，破坏"未匹配 = 失败"的诚实计数。
   **实测确认**（`api3.cjs`）：只调 `.whenMatchedUpdateAll()` 时返回
   `{numInsertedRows: 0, numUpdatedRows: 1}` 且表行数不变 —— **默认即"不插入"，这正是要的语义**
2. **维度守卫（`checkUpdateVectorsDim`）仍在**任何写动作**之前**（`vector-store.ts:1250-1252` 的既有约定：拒绝时一行都不写）
3. **零成功不得报 success**（`vector-store.ts:1275-1283` 的既有约定）—— `mergeInsert` 返回的
   `numUpdatedRows` 天然给出精确计数，**比现状的 `rowsUpdated ?? 1` 估算更可靠**
4. **`ensureVectorIndex` 在全部批次之后**调用一次（而不是现状的循环内/循环后各一次）
5. **分批 + 进度事件**：若要支持超大库，批次间上报进度，避免单次 IPC 请求超过 30 s

### B1. 方式 1：去掉整库搬运

`electron/knowledge-base.ts:791-802` 的 `query().toArray()` → `.map({...r})` → `dropTable` + `createTable`
是**整表重写**，峰值 O(全库)。正解不是"把这次重写写快点"，而是**让这条重写路径从热路径上消失**：

**正解：一次性 schema 迁移，把 `vector` 列补齐**

让 `addChunks` 在**建表时恒带 `vector` 列**（FTS-only 导入也带，值为 NULL）。
此后回填退化为**纯 `mergeInsert`**：不再读全表、不再 dropTable、峰值 O(批大小)。
存量项目（表里没有 vector 列）走**一次性迁移**（按 `db-migration-standard` 做幂等 + 哨兵），
迁完即永久消除该分支。

**已实测的可行性**（`api6.cjs`）：

```
✅ vector: null  → 建表带 FixedSizeList[8]<Float32> 列
                   回填 mergeInsert → numUpdatedRows=2，未匹配行保持 NULL，行数不变
❌ vector: undefined / 省略该字段 → vector 列【根本没被创建】
```

> ⚠️ **实现约束（实测，反直觉）**：FTS-only 行必须**显式传 `vector: null`**。
> 省略字段或传 `undefined` 时，`createTable(data, {schema})` **不会**建出 `vector` 列 ——
> 此时 schema 并非完全权威，数据形状会覆盖它。

**❌ 已排除的错误方案**：用 `addColumns` 补 `vector` 列**不可行**（`api4.cjs` / `api5.cjs` 实测）：

```
Error: Unsupported data type: Custom(ObjectName([Identifier(Ident { value: "FixedSizeList" ...)]))
```

DataFusion 的 SQL 层**不认 `FixedSizeList` 这个类型名**，`cast(... as FixedSizeList(8,Float32))`
与 `arrow_cast(...)` 两种写法均失败（`array_fill` 在该构建中亦不存在）。
注意项目既有注释（`vector-store.ts:181-190`）已说明 `addColumns` 走 napi 侧、不做 `sanitizeSchema`，
而 `createTable({schema})` 有 —— 本次实测补充了另一半事实：**即便绕过多副本问题，SQL 类型名也表达不了 FixedSizeList**。

### B1-补：`createTable` 的 schema 保真度陷阱（实测，务必防御）

`createTable(data, {schema})` 在入参是 **JS 对象数组**时，schema **不是**完全权威：

- 数据里不存在的列 → 该列**可能不出现**在结果表里（同上，`api6.cjs`）
- 早期探针还遇到过一次无法复现的类型漂移（`FixedSizeList<Float32>` 的列在后续 `update` 时被当作 `Int64`，`memprobe.cjs`）——
  三个最小复现（`u3.cjs`/`u4.cjs`）均未复现，**故未计入结论**，但它指向同一个方向：**别假设 schema 一定生效**

**防御措施**：建表后**断言** `detectVectorDimFromSchema` 读出的维度/类型符合预期，
不符即视为建表失败（现有 `detectVectorDimFromSchema` 已是现成的读数工具）。

### 验收标准

1. **性能**：1 万块回填从 119 s 降到 **< 5 s**（实测批 500 外推约 0.6 s）
2. **不再撞 IPC 超时**：实测 3 万块级（现状上限 2,524 行）通过
3. **计数诚实**：未匹配 id 仍计入 `failed`、零成功仍返回 `success:false` ——
   现有 `vector-store.test.ts:839-1000` 的 T4 用例必须**全部不变地通过**
4. **无半写入**：分批中任一批失败时的行为需明确（建议：已成功批次保留、如实上报部分成功，与现状"部分成功"语义一致）
5. **维度守卫**：混维仍被拒绝且**一行都不写**（现有 T3 端到端用例）
6. **内存**：回填 1 万块的峰值 `heap` 增量显著低于现状（现状 ~10 KB/行 × 全量）
7. **B1 迁移正确性**：FTS-only 新库建表后 `vector` 列**存在且类型正确**；
   存量库迁移**幂等**（重复执行不改变结果）、有哨兵、可在中断后重跑（对照 `db-migration-standard`）
8. **schema 保真断言**：建表后按 §7 B1-补 断言列类型，防止 `vector` 列静默缺失

---

## 8. 风险清单

| 风险 | 说明 | 缓解 |
|---|---|---|
| **CI 无 Rust 工具链** | A 档真正的成本项 | 落地前确认 CI；`ci-parity-standard`：提交后必查 run |
| 原生模块加载失败面更大 | `.node` 缺失 / ABI / 杀软隔离 | 契约第 1、2 条（惰性加载 + 失败降级）**必须**保留，并加一条"删掉 .node 仍能启动"的用例 |
| **`createTable` 的 schema 不保真**（实测） | 数据中不存在的列可能**不被创建**；早期探针还见过一次无法复现的类型漂移 | FTS-only 行**显式传 `vector: null`**；建表后**断言列类型**（§7 B1-补） |
| **`addColumns` 无法补向量列**（实测） | DataFusion SQL 不认 `FixedSizeList` 类型名 | 不要走这条路；改用"建表恒带 null 列 + 一次性迁移"（§7 B1） |
| 存量库迁移 | 一次性重写，需幂等与中断可重跑 | 对照 `db-migration-standard`（幂等/哨兵/分阶段）；迁移期间不做其他写操作 |
| 现有测试可能只覆盖"无 vector 列"分支 | 逐行 update 分支的覆盖度需自查 | 实施时先确认覆盖，必要时补测 |
| 分批写入的失败语义 | 与现状"部分成功"口径必须一致 | 明确定义：已成功批次保留 + 如实计数 + 错误回执 |
| 版本升级 | lancedb 升级可能改 `mergeInsert` 行为 | 计数与维度用例做回归网 |
| 体积（用户关切） | — | **不构成反对理由**：napi ABI 稳定免 electron-rebuild；lance `.node` 已大一个量级；`detect-native-deps.cjs` 自动校验打包 |

---

## 9. 建议路线

| 阶段 | 内容 | 验收 |
|---|---|---|
| **Phase 0** | 本文件定稿、排期 | — |
| **Phase 1（先做）** | **B2** 逐行 → `mergeInsert` 分批 | 1 万块回填 < 5 s；T4/T3 用例全绿；不再撞 30 s |
| **Phase 2** | **B1** 建表恒带 `vector` 列（null）+ 存量一次性迁移 → 消除整表重写分支 | 回填峰值内存降到 O(批大小)；无 `dropTable` 窗口；迁移幂等 |
| **Phase 3（唯一 Rust 项）** | **A1** jieba 原生化（含 CI 工具链） | §6 五条验收全过，尤其**逐字对拍**与**删 .node 仍能启动** |
| **不做** | §5 的 🔴 C 档全部 | — |

> 一句话总结：**"用 Rust 优化内存"这件事在本项目只成立一处（jieba WASM 地板）；
> 而用户真正会撞到的两个悬崖（回填慢/失败、回填爆内存）是调用次数与搬运量问题，`mergeInsert` 就够了 ——
> 两个数量级的提速，零新增依赖。**

---

## 附：本次实测的原始读数与脚本

| 脚本 | 用途 | 关键读数 |
|---|---|---|
| `jieba-child.cjs` | 分进程测 WASM 内存地板 | 加载 +60 MB；100 万字后 `external` 158 MB 不回落 |
| `u2.cjs` | 逐行 `table.update()` | 预热 8.73 / 稳定 11.88 ms/行 |
| `api.cjs` | `mergeInsert` 存在性与向量列兼容 | 50 行 92.3 ms，`numUpdatedRows:50` |
| `api2.cjs` | 批大小规模曲线 | 批 500 = 0.06 ms/行；全量 5000 行 0.3 s |
| `api3.cjs` | `mergeInsert` 未匹配行的默认语义 | 不调 `whenNotMatchedInsertAll` → `numInsertedRows:0`，行数不变 ✅ |
| `api4.cjs` / `api5.cjs` | `addColumns` 能否补向量列 | ❌ 两种 SQL 写法均失败：DataFusion 不认 `FixedSizeList` 类型名 |
| `api6.cjs` | "建表恒带空向量列" 是否可行 | `vector:null` ✅（回填后未匹配行保持 NULL）；`undefined`/省略字段 ❌ 列不建 |
| `bench3.cjs` | JS 纯计算（n-gram / 全文扫描） | 180 万字 0.18 s |
| `u3.cjs` / `u4.cjs` | 证伪 dtype 误报 | 三例全通过 → 撤回 |

脚本位于系统临时目录（仓库外），未纳入版本控制；需要复跑时按上表重建即可。
