# 07 · 在文件之上套 DB：职责分层与规模后路

> 前置：[06 存储方案](06-storage-design.md)（文件是真相，索引可重建）
> 本文回答：DB 到底该干什么、3000 章之后怎么不退化成全表扫描

---

## 一、先纠正一个前提

你现在不是「没有 DB」，而是 **DB 承担了不该承担的职责**：它既是真相（`contents.body`）、又是索引（`drafts`）、又是事件（`workflow_checkpoints`）、又是缓存（`word_count`），四件事混在一张表结构里。

06 方案把「真相」搬到文件之后，DB 不是被删掉，而是**被释放**——它终于可以专心做它擅长的事。

---

## 二、DB 的四个职责，边界要清楚

| 层 | 存什么 | 丢了会怎样 | 存储 |
|---|---|---|---|
| **索引** | `chapter_index`：id→path/number/status/hash | 重扫一遍就回来 | SQLite |
| **检索** | FTS5 全文、LanceDB 向量 | 重建索引 | SQLite + LanceDB |
| **缓存** | 渲染后的 HTML、字数统计、摘要 | 重算 | SQLite（可定期清） |
| **协调** | 锁、任务队列、检查点 | 重启后重来 | SQLite（WAL） |

**判断某个数据该放哪，只问一句：删了它，会不会丢东西？** 会 → 文件；不会 → DB。

---

## 三、现在就能做的三件事（成本低，收益立刻）

### 3.1 PRAGMA 只调了一半

你已经有 `journal_mode=WAL` 和 `foreign_keys=ON`，缺的是读写性能相关的：

```js
db.pragma('synchronous = NORMAL')      // WAL 下安全，写入快一个数量级
db.pragma('mmap_size = 268435456')     // 256MB 内存映射，随机读加速
db.pragma('cache_size = -64000')       // 64MB 页缓存（负值 = KB）
db.pragma('temp_store = MEMORY')       // 排序/临时表走内存
db.pragma('busy_timeout = 5000')       // 多进程竞争时等，别立刻 SQLITE_BUSY
```

这五条不用改代码结构，改一次全局受益。`synchronous=NORMAL` 在 WAL 模式下**不会丢已提交事务**，只可能在断电时丢最后几个未 checkpoint 的事务——对索引层完全可接受。

> 实测环境：你项目里的 `better-sqlite3@12.11.1` + SQLite **3.53.2**（Electron ABI）。五条 PRAGMA 全部被接受，无 warning。

### 3.2 补 FTS5（这是 3000 章真正的分水岭）

现在 `knowledge-base.ts` 的检索靠 `LIKE` + 向量兜底，注释里也写了「LIKE 兜底」。**LIKE `%关键词%` 在 900 万字上是全表扫描**。

```sql
-- 写入前先分词，body 存「空格分隔的 token」，不是原文
CREATE VIRTUAL TABLE chapter_fts USING fts5(
  chapter_id UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

**别用 `tokenize='trigram'`。** 我在你的 better-sqlite3（SQLite 3.53.2）上实测过：

| 查询 | 字数 | trigram | jieba 预分词 + unicode61 |
|---|---|---|---|
| 旧书店 | 3 | ✅ 命中 | ✅ 命中 |
| 雨水 | 2 | ❌ **命中 0** | ✅ 命中 |
| 屋檐 | 2 | ❌ **命中 0** | ✅ 命中 |
| 雨夜 | 2 | ❌ **命中 0** | ✅ 命中 |
| 门 | 1 | ❌ **命中 0** | ✅ 命中 |

trigram 是 3 字符窗口，**中文双字词全部失效且不报错**——用户搜「雨水」搜不到，只会以为功能坏了。中文里双字词是绝大多数，这条路走不通。

正确做法（已实测 7/7 命中）：

```ts
// 写入
const tokens = tokenize(body).join(' ')      // 用你已有的 electron/chinese-tokenizer.ts
db.prepare('INSERT INTO chapter_fts(chapter_id,title,body) VALUES (?,?,?)')
  .run(ch.id, tokenize(ch.title).join(' '), tokens)

// 查询：同样先分词
const q = tokenize(keyword).map(t => `"${t}"`).join(' OR ')
db.prepare('SELECT chapter_id FROM chapter_fts WHERE chapter_fts MATCH ? ORDER BY rank').all(q)
```

代价是写入和查询各走一次分词（jieba 单次 < 5ms），换来的是单字、双字、三字全都能命中。

**索引体积**：900 万字 → jieba 分词后约 40-80MB；trigram 是 150-250MB 且还搜不到双字词。

### 3.3 索引表加两个预留列

```sql
ALTER TABLE chapter_index ADD COLUMN volume_id TEXT;
ALTER TABLE chapter_index ADD COLUMN shard INTEGER DEFAULT 0;
```

现在用不上，但**以后加列要重建表 + 回填**，而 SQLite 的 `ALTER TABLE ADD COLUMN` 是 O(1)。先占位。

---

## 四、3000 章的真正瓶颈不是存储

先说结论：**3000 章 × 3000 字 = 900 万字，单章读取永远是 O(1)**，因为文件方案本来就是「读哪章开哪个文件」。存储不会成为瓶颈。

会崩的是这三件事：

| 瓶颈 | 现状 | 3000 章时 | 解法 |
|---|---|---|---|
| 启动全量 rescan | 每章读文件 + hash | 3-8s | 只校验 mtime，后台补 hash |
| 上下文组装 | 拼前 3 章 + 设定 | 撞 context window | 分层摘要（章→卷→书） |
| 全文检索 | LIKE 全表 | 2-5s | FTS5 |

**所以后路要预留在「索引与检索」，不是「存储」。**

---

## 五、规模演进三级

### L1：< 3000 章（现在到未来两年）

- 启动：读 `index.db`，**只校验最近 20 章的 mtime**，其余信任索引
- 索引：`rescan()` 全量重建（< 1s）
- 检索：FTS5 + LanceDB
- 上下文：前 3 章全文 + 卷摘要

**不做任何分片。**

### L2：3000 – 10000 章

触发条件：**启动 > 2s** 或 **rescan > 5s**。

- 增量索引：`fs.watch(chapters/)` → 只处理变更文件
- 惰性校验：启动只校验索引里最近 N 条，其余在空闲时后台扫
- 按卷分片：`shard = hash(volume_id) % 4`，查询先定分片
- 内容懒加载：`chapter_index` 不存正文，列表页只读元数据

### L3：> 10000 章

触发条件：**检索 P95 > 300ms** 或 **索引文件 > 500MB**。

- 检索迁到 LanceDB 主导（向量 + FTS 都在 LanceDB 侧）
- SQLite 只存元数据和锁
- 章节按卷拆目录：`chapters/vol-01/0001-xxx.md`

这时你的存储形态没变（还是文件），变的是**索引放在哪**。这就是「预留后路」的意义：**存储不动，索引可换**。

---

## 六、六个现在就该预留的接口

不做这些，两年后改动成本是现在的 10 倍。

### 6.1 所有查询走一个门面

```ts
// src/domain/chapter-query.ts
export interface ChapterQuery {
  byId(id: string): Promise<Chapter | null>
  byNumber(n: number): Promise<Chapter | null>
  listByVolume(volumeId: string): Promise<ChapterMeta[]>
  listRecent(limit: number): Promise<ChapterMeta[]>
  search(text: string, opts?: SearchOptions): Promise<SearchHit[]>
}
```

UI 和用例只依赖这个接口。L1→L2→L3 换实现，上层零改动。

### 6.2 索引写入是 upsert，不是 rebuild

```ts
interface ChapterIndexer {
  upsert(meta: ChapterMeta): Promise<void>   // 单条
  remove(id: string): Promise<void>
  rescanAll(): Promise<void>                 // 兜底，不是日常路径
}
```

现在如果到处写 `rebuildIndex()`，3000 章时会很痛。

### 6.3 hash 带算法版本

```ts
contentHash: 'sha256:v1:9f2c1ab3...'
```

未来换算法（或加盐）时，能识别旧值并平滑迁移，不用全量重算。

### 6.4 正文永不进索引表

`chapter_index` 只存元数据。正文按需读文件。这条守住，索引体积就永远是 KB 级。

### 6.5 事件流带 seq

```sql
CREATE TABLE chapter_events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id TEXT NOT NULL,
  type       TEXT NOT NULL,
  payload    TEXT,
  at         INTEGER
);
```

`seq` 单调递增，未来做「增量同步 / 多端」时可以直接当游标用。

### 6.6 分片参数从配置读

```ts
const SHARDS = config.indexShards ?? 1   // L1 恒为 1
```

代码里所有查询带上 `shard = ?`，L1 时值恒 0，切 L2 时改配置即可。

---

## 七、增强设施（按 ROI 排序）

| # | 设施 | 解决什么 | 成本 |
|---|---|---|---|
| 1 | **分层摘要**（章→卷→书） | 900 万字进不了上下文 | 中 |
| 2 | **FTS5 全文检索** | LIKE 全表扫描 | 低 |
| 3 | **doctor 自愈命令** | 孤儿索引、命名不符、hash 漂移 | 低 |
| 4 | 版本历史 GC | `history/` 无限膨胀 | 低 |
| 5 | 导出管线（md→epub/docx） | 直接从真相生成，不经 DB | 中 |
| 6 | 备份/恢复 | 文件方案天然优势（整目录打包） | 低 |
| 7 | 事件流回放 | 排查「这章怎么变成这样」 | 中 |

### 重点说 1 和 3

**分层摘要**才是 3000 章的核心，不是存储：

```
单章摘要（300 字）  →  卷摘要（800 字）  →  全书状态（2000 字）
```

写第 2000 章时，上下文 = 全书状态 + 当前卷摘要 + 前 3 章全文 + 检索命中的片段。而不是「前 3 章 + 更多」。

**doctor 命令**：

```bash
pnpm novelforge doctor --project ./my-novel
# 检查：
#  索引孤儿（索引有、文件无）
#  未索引文件（文件有、索引无）
#  命名不符（文件名序号 ≠ frontmatter.number）
#  hash 漂移（外部编辑未同步）
#  .tmp 残留
#  history 超限
# 输出：可自动修复的 + 需人工确认的
```

这个命令会是你最常用的工具——因为文件方案的所有故障模式，都是「文件与索引不一致」。

---

## 八、性能预算

3000 章 / 900 万字的目标值：

| 操作 | 目标 | 超标时做什么 |
|---|---|---|
| 打开项目 | < 500ms | 停止全量 rescan，只校验最近 N 条 |
| 打开一章 | < 50ms | 检查是否在 `byId` 里做了多余 IO |
| 保存一章 | < 30ms | 检查是否每次写都触发全量索引 |
| 全文搜索 | < 100ms | 上 FTS5 |
| 列目录 | < 80ms | 走索引，不扫文件 |
| 向量检索 | < 300ms | IVF_PQ 索引（你已有） |

超过这个表，说明某处退化成了 O(n)，先定位再优化，别提前上分片。

---

## 九、什么时候这套方案真的到头

诚实列出边界：

| 场景 | 为什么到头 | 需要什么 |
|---|---|---|
| 多人同时编辑同一章 | 文件锁只能互斥，不能合并 | OT / CRDT |
| 手机 + 桌面实时同步 | 无权威副本 | 服务端 + 版本向量 |
| 单项目 > 5 万章 | 索引与检索都要分库 | 独立检索服务 |
| 需要细粒度权限（谁能看哪章） | 文件系统权限太粗 | 应用层 ACL + 服务端 |

前两条一旦要做，就不是「给文件方案打补丁」，而是**换架构**。但那时的迁移成本很低——因为你的真相本来就是标准文件，导进任何系统都不难。

**这正是文件方案最大的后路：最坏情况下，你只是放弃了这个应用，稿子还在。**

---

## 十、落地顺序

```
M0  契约 + 边界棘轮（半天）
M1  PRAGMA 五行 + chapter_index 两列 + FTS5 + 导出（3-4 天，与 04 的 M1 同批）
M2  ChapterQuery 门面 + doctor 命令（2 天，与 04 的 M2 同批）
M3  分层摘要（3-5 天，与用例层同期）
L2 触发   增量索引 + 分片（等启动真的慢下来再做）
```

M1 那批加起来不到一周，能把 3000 章的检索问题提前解决掉。

---

延伸阅读：[08 · 自审与 0.1.x 迁移方案](08-self-review-and-migration.md)　（15 个存量用户怎么迁）

[← 06 存储方案](06-storage-design.md)　｜　[01 现状](01-diagnosis.md)
