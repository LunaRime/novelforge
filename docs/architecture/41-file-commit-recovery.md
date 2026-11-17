# F2 文件与数据库提交恢复

F2 首批交付跨存储提交协议和 SQLite 入口保护。正常项目仍由 SQLite 服务，候选文件项目通过 F1 的编辑器打开。[切换设计](40-file-storage-cutover-design.md)

## 一次提交

1. 使用章节仓储的项目写锁串行处理协作写入。为操作提供固定 ID、业务类型、关联记录 ID、预期文件 revision 和目标章节。重试沿用相同参数。
2. 在保留业务数据库中写入待提交记录。同一个项目一次允许一条待恢复记录。操作 ID 被不同请求复用时返回冲突。
3. 在预期 revision 匹配时发布文件。发现目标 revision 已存在时继续数据库提交。发现第三种 revision 时保留文件与待恢复记录，等待核查。章号调整使用单独的恢复流程。
4. 用同一个 SQLite 事务应用关联数据并保存提交回执。失败回滚关联和回执，文件可由待恢复记录继续提交。成功后清除重放正文，仅保留操作摘要和回执。

## 恢复边界

- 启动恢复需要先核验项目身份、锁状态及隔离屏障。进程中断留下的写锁仍按 E2 流程诊断，核验所有权后再处理。[只读诊断](10-core-usage.md#e2-只读诊断)
- 普通 SQLite 初始化在发现文件项目描述或旧库路径屏障时拒绝打开，并保留当前数据库连接。损坏的描述也会触发拒绝。
- 本批用真实 SQLite 和文件仓储复现意图写入后中断、文件已提交而关联更新失败、数据库重新打开、并发锁、重复回执和外部编辑冲突。[恢复契约](../../src/contracts/file-commit-recovery.contract.test.ts)

## 候选项目接入

恢复协议基础已提交为 `03510b4`，候选业务 IPC 已提交为 `431024f`。候选项目启用这些操作时，在 `.novelforge/file-editor.json` 中加入 `"lifecycle": 1`，并准备独立的 `.novelforge/retained.db`。候选 IPC 使用这份业务库记录操作和关联，原始迁移备份和旧库路径屏障继续保留。

- `project:file-editor-commit` 用窗口会话令牌、稳定章节 ID 和文件 revision 接收合并、归档及定稿。合并仅使用属于当前迁移草稿的待接受修稿，并在数据库提交时复核修稿正文。归档和定稿将状态写入文件并记录回执。
- 候选项目打开时先尝试恢复待提交操作，再返回文档。存在待恢复操作时，普通保存在同一写锁下拒绝推进文件 revision。
- IPC 测试用 SQLite 触发器模拟定稿的关联事务失败，重建控制器后重新打开，验证恢复的正文与只读状态，并验证归档。[业务服务测试](../../electron/services/file-draft-lifecycle.test.ts) · [候选 IPC 测试](../../electron/controllers/file-project-editor-controller.test.ts)

候选界面操作已提交为 `746648c`。候选编辑器根据当前稿状态显示可用操作。接受修稿前可预览正文，界面提交预览哈希与当前稿 revision，主进程复核后才允许提交。归档和定稿经确认后执行。提交成功后重新读取正文和只读状态；已收到提交回执但重新读取失败时提示重新打开项目。[界面回归](../../src/components/dialogs/FileProjectEditorDialog.test.tsx)

## 准备候选目录与冻结旧章表

使用 Node 22.16+ 和仓库开发依赖准备一个独立目录：

```sh
node scripts/prepare-file-project.mjs ./offline-vela.db ./pristine-export ./file-candidate
```

命令验证暂存副本，安装旧版路径屏障，生成身份映射，并从备份创建保留业务库。候选目录在上述准备成功后发布。验证仍可针对原样导出重复运行。候选准备命令拒绝已有目标和导出目录下的目标。

保留库使用持久 SQLite 触发器冻结 `drafts`、`draft_snapshots` 和 `draft_branches` 的增删改，以及这些表所引用的正文行。修稿、审稿和其他独立正文行仍可写。打开已有候选时也会安装相同保护。触发器安装使用保存点，失败时回滚并报告。

Node 22 实测从一个 E3 真实副本准备候选目录，验证了 11 个当前章、14 条草稿映射，保留库拒绝旧草稿写入，原样导出仍通过校验。合成测试还覆盖第二个数据库连接、`REPLACE` 和审稿写入。

## 常规项目入口

「打开项目」识别文件项目描述或旧库路径屏障后，将目录交给文件项目编辑器。该编辑器重新验证目录授权、身份映射和隔离屏障，然后打开候选文件会话。分流不切换原 SQLite 连接，也不把候选目录登记到 SQLite 最近项目。已有未保存的文件正文会阻止切换。

Windows Electron 生产构建实测从常规打开按钮进入候选编辑器，保存当前稿并在进程重启后恢复只读历史稿。测试在隔离配置和项目副本上运行，由自动化提供目录选择结果。

## 通用文件写入边界

常规打开分流已提交为 `696e878`，通用写入保护已提交为 `6dd8f3d`。主进程的通用文件写入和删除入口拒绝修改候选项目的章节、历史、业务库、身份文件和迁移备份。保护依据磁盘上的候选标记，覆盖目录别名以及尚未创建的目标。成品导出校验每个实际写入路径，避免目录授权绕过正文的 revision 提交。普通导出目录仍可写入。[文件 IPC 回归](../../electron/controllers/fs-file-project.test.ts) · [目录别名回归](../../electron/security/file-project-write-path.test.ts)

Windows Electron 生产构建复用 E3 旧项目验证包的副本和隔离配置。自动化提供目录选择结果并通过 preload 调用 `fs:write-file`，确认章节覆盖请求被拒、原文件字节一致、普通导出文件可写。随后通过专用编辑器保存当前稿，重启后恢复只读历史稿选择。

## 新章首次发布

候选项目首次发布协议已提交为 `4e50d73`。

`project:file-editor-commit` 接受 `create`，在候选项目的有效生命周期会话中首次发布正文。调用方提供稳定的 `chapterId`、章号、标题、正文和创建时间，重试沿用同一请求。主进程在写锁下检查章节身份、章号和目标路径，以空 revision 独占发布，再在保留库的同一事务记录初始状态与回执。迁移身份和仅历史稿占用的章号留给显式恢复流程。

恢复时若文件已发布，只补交数据库事务；文件仍缺失时按已登记的请求创建；文件被外部修改时保留待恢复记录。契约测试覆盖事务回滚、重开后重试、章号冲突和重复请求。候选 IPC 测试验证回执修复后，新稿可以按 `doc://chapter/{chapterId}` 重新打开。[提交恢复契约](../../src/contracts/file-commit-recovery.contract.test.ts) · [候选 IPC 回归](../../electron/controllers/file-project-editor-controller.test.ts)

Windows Electron 生产构建在 E3 旧项目验证包的隔离副本中，通过 preload 首次发布第 999 章。重启后可按相同定位符读取原正文和可编辑状态，使用同一请求重试得到相同回执。

## 候选项目正文导入

文件编辑器的「导入正文文件」复用小说选文件与拆章功能。确认前显示拆章数量和可修改的起始章号，默认从现有当前稿的最大章号之后开始。导入按拆章顺序逐章发布可编辑正文，保留标题。完成后重新读取项目并打开本批首章。

每章的导入身份由项目、目标章号、标题和正文计算。重试选择相同输入和起始章号会复用已有回执。若目标章号已被其他稿件或迁移历史占用，导入停在冲突处，保留此前已提交的章节。若发布后数据库事务中断，重开项目恢复待处理章节，再用原输入和起始章号重试。[候选 IPC 回归](../../electron/controllers/file-project-editor-controller.test.ts) [编辑器回归](../../src/components/dialogs/FileProjectEditorDialog.test.tsx)

Windows Electron 生产构建在 E3 旧项目验证包的隔离副本中测试。自动化提供项目和源文件选择结果，通过编辑器将一个文本文件拆为两章，指定从第 999 章开始导入。重启后重新打开正文，再以原输入和起始章号重试，得到相同的已提交章节和首章定位符。

正文导入发布章节文件。发布后可在编辑器为本批正文建立全文索引，生成全局设定或逐章蓝图预览，并确认补入空白设定或缺失蓝图。候选编辑器也支持 Agent 正文问答、修改提案和下一章续写。后续补齐创作工作流的项目上下文、文件稿版本和业务关联，并验证正式激活和打包应用。

## 导入推演接入顺序

旧 SQLite 导入的蓝图推演在调用模型前捕获项目会话和数据库连接令牌。模型返回后重新核对会话和取消状态，主进程在实际写入前同步核验连接令牌。单章写入失败计入失败数，后续章节仍可处理。此步骤负责逐章保存蓝图，完成日志记录实际成功和失败数量。

1. 候选项目通过 `project:file-editor-import-source` 读取推演输入。调用方传入当前候选会话令牌、原起始章号和拆章结果。主进程从只读保留库查询回执，在第一处缺失或待恢复回执停止，再从章节文件读取连续已发布的正文。返回项目 ID、章节 ID、章号、标题、正文及 revision。已提交的章缺失或 revision 变化会使本次快照读取失败。重开后携带新令牌可查询同一批，读取期间切换项目会拒绝返回旧会话的结果。候选 IPC 回归覆盖重复导入、占用章号、发布中断后恢复、正文外部修改和读取期间切换项目。
2. 候选编辑器通过 `project:file-editor-index-import` 建立本批正文的 SQLite FTS5 索引。索引沿用正文快照校验，在章节写锁内核验当前会话，用同一事务按章 ID 替换分块。每块保留发布 revision。独立的 `.novelforge/file-import-index.v1.db` 可由已发布正文重建，失败时保留上次索引结果，编辑器可用同一请求单独重试。重新打开后可重选原文件和起始章号找回导入回执，再建立索引。
3. 索引后选择「用 AI 推演本批设定」生成预览。`project:file-editor-import-inference` 在全文检索排序及截取前按当前批次的章 ID 和 revision 过滤，附上首、中、末章的正文样本。编辑器调用已配置的模型生成世界观、核心大纲、主角人设与写作风格。在显示前再次核对候选会话与完整 revision 列表。取消和切换项目会中止模型调用并丢弃迟到结果。预览仅在当前编辑器会话中展示。[索引与会话回归](../../electron/controllers/file-project-editor-controller.test.ts) [模型取消与结果校验](../../src/services/workflows/file-import-inference.test.ts)
4. 「应用到空白设定」经确认后调用 `project:file-editor-apply-import-settings`，写入当前候选项目保留库的 `project_core`。预览会话记录源 revision 与目标字段版本。主进程在章节锁内重新核对来源，并在一个 SQLite 事务内只填入预览开始时为空且版本吻合的字段。已有设定保留，任一拟填字段发生变更会使本次应用失败。候选保留库的独立版本触发器跟踪实际字段变化，支持检测改动后又还原的情况。旧副本缺少字段时仍可查看预览，可应用字段以保留库现有列为准。常规 SQLite 项目继续使用原入口。[候选写入与回滚回归](../../electron/controllers/file-project-editor-controller.test.ts)
5. 「用 AI 推演缺失蓝图」通过 `project:file-editor-import-blueprints` 从已发布章节快照读取候选输入，排除预览开始时已有蓝图的章号。按章调用模型并显示进度，以已发布章节的章号为准，完成后再次核对来源 revision。用户确认后，`project:file-editor-apply-import-blueprints` 在同一候选会话的章节锁内核对来源和预览目标，再使用一个 SQLite 事务补入缺失行。确认时已有的蓝图和笔记保留，任一实际写入失败时回滚整批。旧副本缺少蓝图列时仍可查看预览。[模型回归](../../src/services/workflows/file-import-inference.test.ts) [候选蓝图回滚回归](../../electron/controllers/file-project-editor-controller.test.ts)

## Agent 正文问答与修改提案

候选编辑器的「与 Agent 讨论已保存的正文」使用现有 ReAct 循环，每次提问拥有独立的工具目录。`list_chapters` 按章号列出当前稿和定位符，每页最多 20 项。`read_file` 按 `doc://chapter`、`doc://history` 或可解析的 `vela://draft` 定位符分页读取，每次最多 440 个字符。历史稿继续校验迁移映射和原文件摘要。主进程在前后检查窗口令牌和候选目录。切换项目或关闭编辑器时取消旧轮次，当前问答保留在编辑器会话内。[Agent 循环与工具隔离](../../src/services/agent-adapters/file-project-agent.test.ts) [候选 IPC 回归](../../electron/controllers/file-project-editor-controller.test.ts)

当前打开的章节可编辑且没有未保存修改时，本轮可以调用 `propose_edit`。工具沿用本轮实际读取的 revision，主进程核对章节状态及原文的唯一匹配，返回原文和替换文本供预览。用户点击「接受并保存」时，主进程在章节锁内核对 revision，并在正文发布前再检查会话和提案。成功后编辑器采用落盘回执刷新正文与 revision。丢弃提案只释放会话中的提案记录。

## 下一章续写

从当前最后一章打开续写，填写新章标题和可选创作要求。流程使用 `draft_chapter` 路由和输出语言偏好，最多发送前章结尾的 4,000 个 UTF-16 代码单元。生成过程可取消，关闭、切换章节或切换项目时撤销旧轮次。生成结果先在编辑器预览。

确认创建后，沿用 `project:file-editor-commit` 的首次发布协议。创建请求包含来源章 ID 与 revision。主进程在章节锁内、登记写入意图前核对来源仍是前一章且 revision 一致，并用同一请求摘要跟踪重试。已登记的操作沿用原有恢复流程。收到回执后重新打开新章。[候选 IPC 回归](../../electron/controllers/file-project-editor-controller.test.ts) [编辑器回归](../../src/components/dialogs/FileProjectEditorDialog.test.tsx)
