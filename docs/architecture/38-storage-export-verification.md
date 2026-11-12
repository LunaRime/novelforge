# E3 副本验证包

E3 已使用固定合成 SQLite 夹具和获准使用的 7 个真实旧项目副本完成验证。[验收计划](18-followup-implementation-plan.md) · [合成验证契约](../../src/contracts/storage-export-verification.contract.test.ts)

## 执行离线验证

使用 Node 22.16+ 和仓库开发依赖。把源数据库副本放在导出目录之外。导出需要独立新目录，校验需要保持导出目录原样。用于写入演练和索引重建的目录从原样导出另复制一份。

```sh
node scripts/migrate-to-files.mjs ./offline-vela.db ./export-a project-id
node scripts/verify-storage-export.mjs ./offline-vela.db ./export-a
node scripts/migrate-to-files.mjs ./offline-vela.db ./export-a project-id
node scripts/migrate-to-files.mjs ./offline-vela.db ./export-b project-id
node scripts/verify-storage-export.mjs ./offline-vela.db ./export-b
```

第三条命令应返回 `alreadyExported: true`。两份独立校验报告应有相同的 `sourceFingerprint`、`databaseDigest`、`counts` 和 `chapters`。SQLite 备份字节哈希按各自清单核验，跨导出的数据库等价性用 `databaseDigest` 核对。

校验命令以只读模式检查源库与备份。它核对 SQLite 完整性、外键、schema、各表行数和行内容，检查分支、快照、修稿、审稿及场景的关联，并独立计算每个草稿的预期文件位置，核对 ID、版本、状态、正文和文件哈希。报告包含源与目标路径、源指纹、清单和备份哈希、工具及 schema 版本、关联计数和正文哈希。报告中的路径和项目 ID 留在本地，分享前按需脱敏。命令成功返回 `0` 和 JSON，校验失败返回 `1`，参数无效返回 `2`。

## 合成验收证据

| 场景 | 合成契约覆盖 |
|---|---|
| 多版本、分支、归档和空正文 | 两个当前章、三个历史稿、五个草稿 ID 可追溯。夹具包含空正文、先有草稿的章节、旧定稿、分支基线、修审稿关联、带正文与空正文引用的场景和 checkpoint。 |
| 同源重复导出与独立导出 | 原目标重复导出保留文件修改时间。第二目录的章节映射、正文哈希及 SQLite 逻辑摘要一致。 |
| 源和目标篡改 | 拒绝 WAL、缺失正文、导出过程中源指纹变化、导出后源变化、外部正文改动和清单计数或哈希改动。备份关联被修改且重算清单哈希时，独立校验仍能定位差异表。 |
| 进程中断与保留现场 | 子进程在重排已链接新路径、尚未移除旧路径时被终止。doctor 报告重复 ID、章号冲突、文件名异常和写锁。两份正文及写前历史可读取，仓储拒绝发布有冲突的索引。 |
| 索引重建 | 在单独副本删除磁盘 SQLite 派生索引，再打开仓储后按 ID 读回相同章节。当前和历史文件、原备份及清单字节哈希一致。 |

E2 契约另覆盖损坏的 frontmatter、临时文件、链接和 SQLite sidecar 的只读诊断。[诊断契约](../../src/contracts/project-doctor.contract.test.ts)

## 真实副本与切换准入

真实项目验收使用 Node 22.23.4 和当前应用数据库入口。7 个项目原库均为 Schema v19，包含 20 条草稿，其中 4 个项目无草稿。2 个项目带 SQLite WAL，先在隔离目录用主库与 WAL 生成一致副本。应用把各副本从 v19 升至 v23，草稿 ID、章号、版本、状态、正文引用与正文均通过前后比对。

旧库实测发现两项兼容问题。分支索引现于 `drafts.branch_id` 建立后创建。离线导出和校验将旧式 SQLite UTC 日期及毫秒数字字符串转换成文件中的 ISO 时间，迁移清单和备份库保留原值。[升级回归](../../electron/database.migration.test.ts)

7 个项目均通过重复导出、两份独立导出的 SQLite 与文件比对、doctor 和派生索引重建，共验证 16 个当前章与 4 个历史稿。原库及现有 SQLite sidecar 的 SHA-256 前后相同。真实数据、源指纹、报告与测试副本保存在仓库外。

文件仓储已可读回当前章，历史文件可按迁移映射追溯。分支、修审稿、场景和 checkpoint 的完整记录目前通过备份库查询。应用层的全生命周期读写等价性、旧版隔离与恢复，以及存储切换仍需按计划验收。[生命周期矩阵](37-storage-lifecycle-matrix.md)
