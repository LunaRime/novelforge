# 当前核心使用与验证（2026-11-05）

本轮交付独立章节存储与离线迁移工具。现有 Electron/React 应用仍使用 DB；没有自动迁移、冻结旧表、修改用户项目或切换 UI/agent 入口。

## 核心接口

公共出口为 `src/core/index.ts`。`FileChapterStore.open({ projectPath, projectId, index })` 绑定项目身份，校验 `novel.json.id` 并重建索引。新空目录会创建清单，已有目录中的项目身份不能被覆盖。

`Chapter` 包含 `projectId`、稳定 `id`、`number`、`title`、`status`、`content`、ISO 时间戳和可选的 `metadata`。额外 frontmatter 保存在 `metadata`，保存与历史快照会保留它。frontmatter 的值采用 JSON（YAML 子集），不是完整 YAML 解析器；外部编辑必须保持该格式。

- `writeChapter(repo, chapter, { expectedRevision: null })` 新建；id 形如 `ch_` 加 8–64 位十六进制字符。
- `repo.byId(id)` 返回 `{ chapter, revision, indexed }`；`revision` 是整个文件的 SHA-256。
- 更新需传上次读取的 `expectedRevision`。正文、标题、状态或其他元数据被外部改动都会触发冲突，不会静默覆盖。
- `repo.remove(id, { expectedRevision })` 先保留历史再移除正文。
- `repo.rescan()` 按 frontmatter 重建索引，重复 id、重复章号、非法文件或项目身份不一致时拒绝发布部分索引。

`MemoryChapterIndex` 用于测试或临时工具。`SQLiteChapterIndex` 接受项目独占 SQLite 连接，调用者负责打开和关闭；适配器不依赖 Electron 或原生模块的加载路径。索引只存元数据，全量替换具有事务性；正文不会写入索引。

文件名为 `chapters/0001.md`，标题不参与命名。保存先保留 `history/{id}/` 快照，再原子发布文件，最后更新索引。索引更新失败时文件仍已提交，返回 `indexed: false`；可通过 `onIndexError` 接收错误，修复后 `rescan()`。接入应用时必须将结果映射到日志、toast 和错误处理，当前核心不直接操作 UI。

## 并发与恢复边界

当前实现用项目级独占锁 `.novelforge/locks/chapter-write.lock`，确保同一项目的章号空间不会被协作写入者并发覆盖。这是本轮对原“单章锁”方案的收敛；未来批量重排事务实现后再细化锁粒度。锁已占用时返回 `locked`，不会自动删除可能活跃的锁。

崩溃留下的 `.tmp` 不参与章节扫描，也不会自动删除。重排期间崩溃可能留下相同 id 的两份文件，扫描会报告冲突；需人工核对内容后恢复，不会自行选择并删除其中一份。当前没有自动 `repairNames` 或 `doctor` 命令。

写入使用同目录临时文件、fsync 和 rename；新文件用硬链接排他发布，需要支持本地硬链接的文件系统。外部编辑器不遵守本项目锁时仍存在最后一次检查与 rename 间的竞态窗口；因此当前核心先用于离线验证，不能据此宣称已经支持实时协同写入。

## 离线导出

使用 Node 22.16+（CI 为最新 22.x，本机验证版本见实施记录）；CLI 使用内置 `node:sqlite`，不加载 Electron 版 better-sqlite3。仓库的 TypeScript 开发依赖用于加载迁移模块，无新增依赖。

```sh
node scripts/migrate-to-files.mjs ./offline-vela.db ./new-export my-project-id
```

输入必须是关闭应用后取得的一致数据库副本；存在 `-wal` 文件会拒绝。不要只复制运行中的主 DB 而丢弃 WAL。目标必须不存在；唯一允许的已有目标是同一源、同一身份且逐文件核验通过的完整导出。

输出包括：

- `chapters/`：每章最新非归档主线草稿。
- `history/`：其余草稿版本、归档和分支正文。
- `migration-manifest.json`：全部草稿行、源指纹、输出校验值和数量。
- `legacy.db`：完整数据库备份，保留修稿、审稿、快照及其他关联数据。
- `novel.json`：项目身份。

迁移 id 为 `ch_` 加 `sha256(JSON.stringify([projectId, draftId]))` 的前 32 位，不依赖章号。当前主章选择与全部历史映射记录在导出中；源变化必须导出到新目录，不合并覆盖旧导出。

当前要求 v23 对应的草稿列，旧 schema、缺失正文、快照 hash 错误或主线版本歧义会安全失败。导出先写独立 staging，完整校验后发布，失败只清理本次创建的 staging。重复执行会拒绝源库变化、输出修改、额外文件或符号链接。

这不是应用切换工具，也不修改源库版本标记。真实项目副本验收后，才能继续 IPC 接入、统一 UI/agent 写入口和 M2–M4。
