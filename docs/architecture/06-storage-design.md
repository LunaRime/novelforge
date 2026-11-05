# 06 · 小说存储方案：文件是真相，索引是派生

> 当前实施边界（2026-11-05）：本轮仅交付独立存储核心、契约与离线迁移验证；应用入口继续读写现有 DB。下文的文件真相、冻结旧表与 UI/agent 切换属于后续里程碑，尚未启用。迁移输出使用独立空目录，不修改原项目。

> 解决痛点：单一事实源 / 稳定 ID / 作者心智 / 并发写 / 外部编辑 / 索引可重建
>
> 配套原型：`prototype/chapter-store.mjs`（纯 Node，无依赖，`node docs/architecture/prototype/chapter-store.mjs`（默认系统临时目录；显式目录必须为空） 跑 11 条断言）

---

## 一、一句话设计

**章节正文存 Markdown 文件，ID 写进 frontmatter，SQLite 降级为可随时删除重建的索引。**

判断标准只有一条：**删掉 `.novelforge/index.db`，重启后一章不少。**

---

## 二、磁盘布局

```
my-novel/
├── novel.json                  # 项目清单：id / name / schemaVersion
├── chapters/
│   ├── 0001.md
│   ├── 0002.md
│   └── 0003.md
├── volumes/
│   └── 01.md                   # 卷元数据
├── setting/
│   ├── world.json              # 世界观
│   ├── outline.md              # 大纲
│   └── characters/
│       ├── char_001.json
│       └── char_007.json
├── memory/
│   ├── chapter/0001.md
│   ├── volume/01.md
│   └── book.md
├── history/
│   └── ch_7f3a9b21/
│       └── 1793188671024.md    # 写入前的旧版本
└── .novelforge/
    ├── index.db                # 可删，派生
    └── locks/                  # 跨进程锁
```

`chapters/` `setting/` `memory/` 全部是普通文件，用户能在资源管理器里看见、能用 git 提交、能用 Obsidian 打开。

---

## 三、章节文件格式

```markdown
---
id: ch_7f3a9b21
number: 3
volume: 1
title: 雨夜
status: finalized
createdAt: 2026-10-20T10:00:00+08:00
updatedAt: 2026-10-28T19:00:00+08:00
contentHash: 9f2c1ab3d4e5f607
characters: [char_001, char_007]
pov: char_001
legacyDraftId: 421
---

正文从这里开始……
```

四个关键字段：

| 字段 | 作用 | 为什么不能省 |
|---|---|---|
| `id` | 唯一身份，永不变 | 文件名会改、章号会重排，只有它稳定 |
| `number` | 显示与排序 | 可重排，不承担身份 |
| `status` | 状态机 | 状态是数据的一部分，不是 DB 的字段 |
| `contentHash` | 冲突与索引失效判断 | 外部改动只能靠内容比对发现 |

**文件名规则**：`{4 位序号}.md`，只用于人类浏览和文件管理器排序。程序**任何关系都不认文件名**。

---

## 四、六个关键机制

### 4.1 原子写：不让用户丢过稿

```js
async function atomicWrite(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  const fh = await fs.open(tmp, 'w');
  try {
    await fh.writeFile(content, 'utf8');
    await fh.sync();            // 真正落盘
  } finally {
    await fh.close();
  }
  await fs.rename(tmp, file);   // 同目录 rename 原子
}
```

直接 `writeFileSync` 的风险：写到一半崩溃 → 半截文件；三方并发（自动保存 / agent 改稿 / 撤销）→ 互相覆盖。

**写失败必须有反馈**：按 `.agents/skills/save-feedback-standard` 补日志 + toast，
并记录 `shadow_write_fail` 事件；连续失败 3 次自动降级为只写 DB 并提示用户。
（原稿漏了这条，见 08 的 P0-3。）

### 4.2 索引永远在文件之后写

```
写 .tmp → fsync → rename → 更新 index.db
```

顺序不能反。索引写失败不回滚文件——**下次启动 rescan 会修正**。这是「索引是派生」的必然推论：派生数据允许短暂不一致，只要可重建。

### 4.3 读的时候校验，不一致就重载

```js
async function byId(id) {
  const entry = idx[id];
  const text = await fs.readFile(path.join(ROOT, entry.path), 'utf8');
  const h = sha(text);

  if (h !== entry.hash) {          // 外部编辑过
    const { meta, body } = parse(text);
    idx[id] = { ...entry, hash: h, title: meta.title, status: meta.status };
    await writeIndex(idx);
    return { ...idx[id], reloadedFromDisk: true };
  }
  return entry;
}
```

这就是 genoffice `external-change.ts` 那套（mtime + size + hash 三重比对）的简化版。区别是这里 hash 是权威，mtime 只做提示。

### 4.4 外部改名要能自愈

用户把 `0002.md` 改成 `0002-旧书店-修订.md`，索引里的 path 就断了。

处理：`byId` 发现文件缺失返回 `{stale:true}`，UI 提示「文件被移动」，触发一次 `rescan()` 重新扫目录、按 frontmatter 的 `id` 重建 path。

原型验证过：改名后 rescan 能按 id 找回，不需要用户重新关联。

### 4.5 崩溃残留：`.tmp` 不是章节

启动时扫描 `chapters/*.tmp`，直接删除。因为 rename 是原子的，`.tmp` 存在就意味着没提交成功，删掉是安全的。

原型里验证：残留 `.tmp` 后 rescan，章节数仍是 2。

### 4.6 版本历史独立目录

每次写入前，把旧文件复制到 `history/{id}/{timestamp}.md`。

保留策略（可配）：
- 最近 50 个版本全留
- 每天保留 1 个
- `status: finalized` 的版本永久保留

好处：历史也是文件，可以直接 diff，可以导出成"修订对比"。比 `draft_snapshots` 表里存 BLOB 友好得多。

---

## 五、索引表设计

```sql
CREATE TABLE chapter_index (
  id            TEXT PRIMARY KEY,
  path          TEXT NOT NULL,
  number        INTEGER NOT NULL,
  title         TEXT NOT NULL,
  status        TEXT NOT NULL,
  word_count    INTEGER DEFAULT 0,
  content_hash  TEXT NOT NULL,
  mtime         INTEGER,
  indexed_at    INTEGER
);
CREATE INDEX idx_number ON chapter_index(number);

-- 全文检索（派生，可重建）
CREATE VIRTUAL TABLE chapter_fts USING fts5(
  id UNINDEXED, title, body, tokenize='unicode61'
);

-- 章节事件流（可选的 append-only 审计）
CREATE TABLE chapter_events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id TEXT NOT NULL,
  type       TEXT NOT NULL,     -- created / drafted / revised / reviewed / finalized
  payload    TEXT,
  at         INTEGER
);
```

整张 `index.db` 可以 `rm` 掉重扫。`chapter_events` 如果想长期留，可以落成 `chapters/.events.jsonl` 跟文件走。

---

## 六、并发控制

| 场景 | 机制 |
|---|---|
| 同进程（自动保存 + 用户编辑） | 内存 mutex（per-chapter） |
| 同机多窗口 / 多实例 | 文件锁 `.novelforge/locks/{id}.lock`，用 `O_EXCL` 创建 |
| 跨机（未来） | 需要服务端，这套方案不适用 |

锁的粒度是**单章**，不是整个项目——两个人同时改不同章节不该互相阻塞。

---

## 七、性能边界（诚实说明）

| 规模 | 全量 rescan | 单章读取 | 结论 |
|---|---|---|---|
| 100 章 × 3000 字 | < 100ms | O(1) | 无压力 |
| 1000 章 × 3000 字（约 900 万字） | < 1s | O(1) | 启动一次可接受 |
| 10000 章 | 10s+ | O(1) | **不能全扫**，需要增量 |

万章以上要改两处：
1. 启动不 rescan，只校验索引里最近 N 条的 mtime
2. 后台低优先级全量校验

但单本小说很少超过 3000 章，这个天花板够用。

---

## 八、迁移路径（从现在的 contents/drafts）

### 第一步：导出（只读，不动旧数据）

```sql
SELECT d.id, d.chapter_number, d.status, d.version, c.body, b.title
FROM drafts d
JOIN contents c ON c.id = d.content_id
LEFT JOIN blueprints b ON b.chapter_number = d.chapter_number
WHERE d.status != 'archived'
ORDER BY d.chapter_number, d.version;
```

每行生成一个 md，`frontmatter.id = 'ch_' + hash(d.id)`，`legacyDraftId = d.id`。

### 第二步：切换读路径（不双写）

`ChapterRepo` 直接指向 `FileChapterStore`，旧表整版**只读**：不再写入、不做双写、不保留 `NF_STORAGE=file|legacy` 开关。

beta 期的回滚手段是备份，不是开关：导出前 `VACUUM INTO backups/pre-file-{ts}.db`，回滚 = 还原备份 + revert 对应提交。双写会让"两套真相"合法化，而这正是本方案要消灭的东西（见 [03 · 三条激进规矩](03-roadmap.md)）。

### 第三步：切换读路径

所有读取走文件 + 索引。旧的 `draft-index.ts` 只保留只读兼容。

### 第四步：旧表标 deprecated（**不删**）

> 这一节已按 [08 自审](08-self-review-and-migration.md) 的 P0-1 修正。原稿写「删 `contents` / `draft_snapshots`」，对 15 个存量用户不可逆，且会让回退到 0.1.x 的用户直接 `no such table`。

正确做法：

- `contents` / `draft_snapshots` **保留至少两个大版本**，代码里标记废弃，不再写入
- 表结构不动（不删列、不改约束——见 `db-migration-standard` 的 v6 事故）
- 真要删，放到 1.0 之后单独一次迁移，且必须先满足「无回退用户 + 备份齐全」

**删除是不可逆操作，而保留的成本只是几十 MB 磁盘。**

---

## 九、失败模式

| 现象 | 原因 | 处理 |
|---|---|---|
| 索引有、文件没了 | 用户在外部删了文件 | 标记 stale，UI 提示；rescan 清理孤儿 |
| 文件有、索引没有 | 外部新建 / 索引损坏 | rescan 自动收编 |
| 文件被外部改 | 用户在 VS Code 编辑 | hash 不匹配 → 重载 + 回写索引 |
| `.tmp` 残留 | 上次写入崩溃 | 启动时删除 |
| 两窗口同时改 | 并发写 | 文件锁，后到者提示「章节被占用」 |
| 重排章号中断 | 批量 rename 途中崩溃 | 下次启动按 `number` 检测命名不符并修复 |

最后一条要特别说明：**重排不是事务性的**（文件系统没有多文件原子操作）。所以设计成「先改 frontmatter 的 number，再批量改文件名」——即使中途失败，`id` 和 `number` 是一致的，只有文件名难看。下次启动一条 `repairNames()` 修好。

**文件名是装饰，不是数据。**

---

## 十、验收标准

原型已跑通前 7 条，后 3 条需要在真实项目里验证：

| # | 验收 | 状态 |
|---|---|---|
| 1 | 创建后文件名只含序号，按 id 可读回 | ✅ 已验证 |
| 2 | 重排章号后 id 不变、路径自动更新 | ✅ 已验证 |
| 3 | 外部改名后索引失效可被发现，rescan 能找回 | ✅ 已验证 |
| 4 | 外部编辑内容后 hash 不一致，自动重载并回写索引 | ✅ 已验证 |
| 5 | 删除索引后重建，章节一章不少 | ✅ 已验证 |
| 6 | `.tmp` 残留不算正式章节 | ✅ 已验证 |
| 7 | 正文可从文件独立读出（不依赖 DB） | ✅ 已验证 |
| 8 | `kill -9` 保存瞬间，重启后文件要么旧版要么新版 | 待真机 |
| 9 | 1000 章启动 < 2s | 待压测 |
| 10 | `git diff` 能看懂这一章改了什么 | 待真机 |

第 10 条是文件方案的隐藏红利：**作者能用自己的 git 客户端看修订历史**，这是 DB 方案永远给不了的。

---

## 十一、这套方案不适合的场景

- **多端实时同步**（手机 + 桌面同时写）→ 需要服务端权威，走 DB
- **团队协作 / 多人编辑同一章** → 需要 OT / CRDT，文件锁不够
- **章节数 > 10000 且要求秒开** → 索引要改成增量 + 分片

单机、单人、单本小说，三条都不成立。

---

## 十二、与原方案的关系

这套方案**不改变** [02 目标架构](02-target-architecture.md) 的分层，只替换最底层的实现：

```ts
// 之前
const repo = new SqliteChapterRepo(db)

// 之后
const repo = new FileChapterRepo(root, index)
```

上层用例、agent runtime、UI 全部不用动——这正是"领域模型不关心存储介质"的价值。

前提是：**先把 `ChapterRepo` 接口立起来**。接口没定就换存储，等于把乱麻从一个盒子挪到另一个盒子。

---

延伸阅读：[07 · 在文件之上套 DB](07-db-and-scale.md)　（PRAGMA 调优 / FTS5 实测 / 3000 章演进三级）

[← 返回 01 现状](01-diagnosis.md)　｜　[05 可借鉴清单](05-lessons.md)
