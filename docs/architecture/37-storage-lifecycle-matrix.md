# E1 存储生命周期矩阵

2026-11-13 核对。Electron 应用继续以项目 `vela.db` 为创作数据源。`FileChapterStore` 用于独立章节存储验证，迁移 CLI 接受一致的离线数据库副本。本文记录现行读写契约、离线交付物和切换前需要验证的职责。[后续实施计划](18-followup-implementation-plan.md) · [当前核心使用与验证](10-core-usage.md)

## 草稿与创作数据

| 生命周期 | 应用入口与 SQLite 关联 | 文件侧现状与后续职责 | 失败语义与现有证据 |
|---|---|---|---|
| 新建草稿、读取和切换版本 | `db:draft-create/list/get-meta/get-full/get-latest/next-version` 对应 `DraftRepository`。草稿行以 `drafts.id` 标识，`content_id → contents.id`；章号可早于蓝图存在。版本按章与分支分配，`branch_id = NULL` 表示主线。 | 离线当前稿写入 `chapters/{NNNN}.md`，其余版本写入历史文件。切换前须明确项目、稳定章 ID、草稿 ID、分支和版本间的映射，以便同章同版本的分支能够独立打开。 | 当前文件端口可用 `expectedRevision: null` 排他新建；章号与文件身份冲突会拒绝。业务读取按草稿 ID 区分同号分支。[无 UI 业务链路](../../src/core/application/draft-lifecycle.test.ts) · [文件仓储契约](../../src/contracts/chapter-store.contract.test.ts) |
| 保存正文 | 编辑器 `db:draft-update-content` 与 Agent CAS 写入 `db:draft-apply-content` 汇合到 `commitDatabaseDraft`。正文、字数、hash、更新时间及按策略生成的快照在事务内处理。 | 文件仓储已有按稳定章 ID 读写、整文件 revision CAS 与写前历史。接入创作用例时须同时验证草稿版本身份、只读状态和快照策略。 | SQLite 写入拒绝已归档或定稿稿件，Agent 的旧 hash 或更新时间返回冲突。文件提交后若索引更新失败会返回 `indexed: false`，恢复索引即可，正文已提交。[SQLite 写入测试](../../electron/services/draft-write-service.test.ts) · [文件仓储契约](../../src/contracts/chapter-store.contract.test.ts) |
| 分支创建、列表、合并与归档 | `db:draft-branch-{list,create,merge,archive}`。 `draft_branches` 记录名称、状态、基线快照和 head；分支稿通过 `drafts.branch_id` 关联。合并新建主线版本并标记分支。 | 分支稿正文已有历史文件，基线、head、状态等随 `legacy.db` 保留。切换前需要可读写的分支与版本目录，能核对分支、基线和 head 的归属。 | 现有服务拒绝找不到源稿、空名称和不可合并的分支。创建和合并跨多次仓储调用，恢复须能识别中间状态。[分支服务](../../electron/services/draft-branch-service.ts) · [分支测试](../../electron/services/draft-branch-service.test.ts) |
| 快照创建、列表、读取、清理与回退 | `db:draft-snapshot-{create,list,get-full,prune}` 经 `DraftSnapshotRepository`。 `draft_snapshots` 按草稿 ID 关联 `drafts`，并保存分支、类型、hash、正文引用。版本服务另提供历史正文读取与创建新主线版本的入口。 | DB 快照行及正文随 `legacy.db` 保留。文件仓储写前历史、离线草稿版本和应用快照各有独立语义。快照接口需要保留来源、类型、保留策略和恢复目标。 | CLI 校验快照关联正文及其 hash。应用清理只针对自动快照。恢复测试须覆盖读取旧版本、另存新版本和缺失关联。[版本服务](../../src/services/version-service.ts) · [快照测试](../../electron/repositories/draft-snapshot-repository.test.ts) · [迁移契约](../../src/contracts/migration-core.contract.test.ts) |
| 修稿与返修 | `saveDraftRevision` 经 `db:revision-create` 写提案，列表、待合并和正文按修稿 ID 或 `base_draft_id` 查询。 `revisions` 另有 `content_id`、`review_source_id`、`merged_to_draft_id`。 `db:revision-merge` 提交正文、快照、稿件状态和修稿状态。 | 修稿正文及关联随 `legacy.db` 保留。切换前需可按源稿定位提案，保留来源审稿及合并目标，并提供可恢复的合并提交。 | SQLite 合并检查预期正文，写入失败回滚；已合并提案拒绝重复合并。CLI 检查修稿正文存在，来源与合并关联需要额外校验。[修稿用例](../../src/core/application/draft-feedback.ts) · [SQLite 合并测试](../../electron/services/revision-merge-service.test.ts) |
| 审稿 | `saveDraftReview` 经 `db:review-create` 写报告。 `db:review-{list,get-latest,get-full,next-index}` 查询 `reviews`。 `base_draft_id` 关联所选稿件，`content_id` 指向报告正文。 | 报告正文和关联随 `legacy.db` 保留。切换前须按草稿 ID 枚举和打开报告，保留审稿返修的来源。 | 审稿持久化后才展示报告，保存报告本身保持草稿状态。CLI 检查报告正文存在。[无 UI 业务链路](../../src/core/application/draft-lifecycle.test.ts) · [数据库 IPC](../../electron/controllers/db-controller.ts) |
| 场景卡 | `db:scene-{list,upsert,delete,reorder}`。 `scene_cards.chapter_number` 归属章节，`sort_order` 决定章内顺序，`content_id` 可空。 | 场景卡和可选正文随 `legacy.db` 保留。卷章场景导航需能通过稳定章 ID 读取卡片、保存排序与可选正文。 | CLI 只对非空正文引用检查缺失，空正文引用合法。章内重排按章更新。[场景仓储测试](../../electron/repositories/scene-repository.test.ts) |
| 草稿归档 | `db:draft-archive` 按项目、草稿 ID 和章号更新 `drafts.status`，保留正文。分支归档另走 `db:draft-branch-archive`。 | 归档稿只进入离线历史文件。切换前须支持按 ID 查阅归档及维持只读规则，并明确当前稿如何重新选择。 | 找错章或项目时拒绝变更；归档稿仍可按 ID 查阅，创作正文写入拒绝。[归档测试](../../electron/repositories/draft-archive.test.ts) · [SQLite 写入测试](../../electron/services/draft-write-service.test.ts) |
| 定稿与后处理 | `FinalizeChapterCommand` 经 `db:draft-finalize` 校验项目会话、草稿 ID、章号及已存正文后更新 `drafts.status`。随后按这份正文输出稿件并运行后处理；后处理状态仍由项目 DB 管理。 | 文件 frontmatter 可表示状态。应用接入须保持定稿回执、正文校验、只读和后处理重试契约，保留定稿版本的确切身份。 | 正文变动返回冲突，相同正文重复定稿可获已定稿回执。状态提交与后续文件输出、后处理存在独立结果。[SQLite 定稿测试](../../electron/services/draft-write-service.test.ts) · [定稿命令测试](../../src/services/workflows/commands/finalize-chapter.command.test.ts) |
| 删除 | 内部 `DraftRepository.delete` 按草稿 ID 删除；快照、修稿、审稿按 schema 外键级联，原草稿的正文行尝试清理。蓝图、场景、卷有各自的删除入口。 | `ChapterRepo.remove` 按章 ID 与 revision 移除当前文件并留历史。切换前须分别定义草稿版本与整章删除，明确子记录、分支指针、检查点引用及历史的处理。 | 删除前须核对关联范围；无硬外键的引用需独立诊断。文件端口拒绝过期 revision，保留历史的测试已覆盖。[SQLite 删除实现](../../electron/repositories/draft-repository.ts) · [数据库 schema](../../electron/database.ts) · [文件仓储契约](../../src/contracts/chapter-store.contract.test.ts) |
| 活页夹重排与章号调整 | `db:binder-reorder` 事务更新 `blueprints.volume_number/sort_order`，重算受影响的 `volumes.chapter_start/chapter_end`，保持章号。场景排序由场景入口处理。 | 卷章顺序继续由 DB 持有。文件仓储支持单个章节变更编号，编号变化涉及文件路径及所有按章号关联的数据。跨存储重排须有一致的编号映射与恢复策略。 | SQLite 活页夹的移动和区间重算同事务。文件改号崩溃可能留下同 ID 双文件，扫描拒绝发布部分索引。[活页夹测试](../../electron/services/binder-service.test.ts) · [文件仓储契约](../../src/contracts/chapter-store.contract.test.ts) |

## 导入、导出与恢复

| 生命周期 | 应用入口与 SQLite 关联 | 文件侧现状与后续职责 | 失败语义与现有证据 |
|---|---|---|---|
| 导入已有小说 | `import:split-chapters` 解析输入；`ImportInitializeCommand` 查已有章号并逐章写草稿，再由后续命令推演蓝图、设置和索引。 `drafts` 与 `blueprints` 可分阶段写入。 | 应用导入接入文件存储时，须按章追踪正文落盘与推演阶段，保存章 ID 与导入冲突判定。 | 已有原创稿的冲突检查、分章和后续推演各有独立结果。接入验收需覆盖正文已写、蓝图未完成后重新打开和继续导入。[导入控制器测试](../../electron/controllers/import-controller.test.ts) · [导入命令](../../src/services/workflows/commands/import-novel.command.ts) |
| 应用成品导出 | `export:export-chapters` 读取每章版本最高的 `finalized` 草稿及其正文，标题取蓝图或回退标题。查询当前无分支过滤条件。 | 文件侧读取成品时须保留定稿选稿、章选择、标题回退和输出目录授权。离线当前稿只代表迁移规则选择的版本。 | 无可导出定稿返回失败，写出失败由控制器报告。切换测试需覆盖最新草稿与定稿分属不同版本的情况。[成品导出控制器](../../electron/controllers/export-controller.ts) |
| DB 离线导出 | `scripts/migrate-to-files.mjs` 只读打开无 WAL 的一致副本，读取草稿和蓝图标题，并将完整数据库备份为 `legacy.db`。 | 输出 `novel.json`、当前与历史正文及 `migration-manifest.json`。按章选择最高版本的非归档主线稿。当前稿和同章历史稿使用该当前稿派生的章 ID；只有历史稿的章按各稿 ID 派生。清单保存全部草稿、源指纹和文件校验值。 | 遇到内容缺失、当前主线版本歧义或目标校验失败时退出。重复运行核验同源、备份、清单和逐文件结果。真实导出清单也包含正文，按项目内容管理。[离线导出实现](../../src/core/migration/export-legacy-project.ts) · [迁移契约](../../src/contracts/migration-core.contract.test.ts) |
| Agent 与工作流 | Agent 通过草稿读取与工作流命令访问创作数据。工作流按项目与所选草稿启动，创作写入走业务用例；通用 `edit_file`、`write_file` 拒绝章节写路径。 | 文件适配器应接在创作用例之后，沿用项目、草稿身份和权限检查。章节文件、历史与项目元数据路径继续受路径策略保护。 | 旧项目会话、过期写入或直接章节写路径须拒绝。现有测试分别覆盖通用文件工具与工作流启动。[Agent 编辑工具测试](../../src/services/agent/tools/edit-file.tool.test.ts) · [工作流启动测试](../../src/core/application/start-workflow.test.ts) |
| 工作流 checkpoint 与恢复 | `db:checkpoint-{save,load,clear}` 按项目库读写 `workflow_checkpoints` 单行 JSON。运行时处理读取、恢复和清除。 | checkpoint 随备份库保留，仍由 DB 持久化。恢复入口须复核项目和 JSON 内的业务引用，涉及旧草稿 ID 时通过明确映射解析。 | 缺少记录可返回空；无法解析目标项目或稿件时需要可报告的恢复结果，避免重复提交已完成写入。[checkpoint 仓储测试](../../electron/repositories/workflow-checkpoint-repository.test.ts) · [恢复流程测试](../../src/stores/workflow-store.checkpoint.test.ts) |

## 数据归属与准入

- **章节身份**。离线 ID 由 `sha256(JSON.stringify([projectId, draftId]))` 的前 32 位加 `ch_` 构成，历史文件有 `legacyDraftId`，清单保留版本和分支。实时接入要先确定持久映射，确保切换当前稿、重排和重启后，原有草稿引用仍指向同一记录。
- **应用保留的 DB 职责**。卷和蓝图、小说配置、角色、世界实体和时间线、自动化、出版跟踪及工作流 checkpoint 继续按现有项目入口管理。切换章节正文前，逐项校验其中与章号或草稿 ID 有关的字段。历史库记录与在用数据库之间的身份桥接仍需实施。
- **可重建索引**。文件章节索引仅存元数据，可从 `chapters/` 校验后事务重建。知识库和向量派生项需保留权威输入及重建入口，验证重建结果后再纳入可恢复范围。[章节索引测试](../../src/core/adapters/sqlite-chapter-index.test.ts)
- **E2 只读诊断**。已交付 CLI，报告重复章 ID、章号冲突、正文缺失、分支 head 与基线、快照、修稿、审稿及场景正文的孤儿引用，并识别锁和临时文件。草稿可先于蓝图导入，场景可无正文。索引重建和修复单独执行。项目锁仅协调使用同一锁的写入者。[命令用法](10-core-usage.md#e2-只读诊断)
- **[E3 导出完整性](38-storage-export-verification.md)**。先用合成夹具、再用获授权的离线项目副本核对章、版本、分支、正文 hash 与 DB 关联。对原样输出验证重复导出，在另一个副本上验证可打开、可重建索引及故障恢复。现有 CLI 校验正文引用与快照 hash，草稿有已存 hash 时也会比对。E3 须独立核对清单计数、校验值和备份关联，并记录 DB 完整性与跨表归属结果。
- **E4 与 F**。E4 用旧版本和隔离路径验证完整备份的打开与恢复。F 在每项应用入口、关联、写入失败恢复和旧版本回退均通过后，才具备切换条件。E1 交付矩阵，后续批次补充实现与实测记录。[E/F 批次](18-followup-implementation-plan.md)
