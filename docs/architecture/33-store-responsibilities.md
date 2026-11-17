# D1 状态职责清单

2026-11-12，源码基线 `b06ce08`。承接 [18 总计划](18-followup-implementation-plan.md) 的 D1。逐项核对四个 store 的异步 action，并记录会触发 IO 的同步入口、被调用的异步辅助函数及现有测试。表中的职责标签用于确定后续落点。「提交点」指事实源发生持久变化的位置，renderer 收到结果、发布投影和发完成事件分别记录。

## 项目

入口为 [project-store](../../src/stores/project-store.ts)，主进程端口位于 [project-controller](../../electron/controllers/project-controller.ts) 与 [project-core-repository](../../electron/repositories/project-core-repository.ts)。打开后的初始化、关闭清理及刷新事件由 [project-service](../../src/services/project-service.ts) 调度。

| Action | 生产调用者 | IO、作用域与提交点 | 投影、职责与现有证据 |
|---|---|---|---|
| `createProject` | `NewProjectDialog`、`ImportNovelDialog` | `project:create` 创建目录和核心记录、写最近列表，finally 恢复先前连接；随后调用 `openProject`。创建与打开各有结果。创建/打开互斥，等待确认后校验 session 和角色保存状态。 | **adapter 接线 / 编辑会话保留**。store 仍编排建库后打开和失败时恢复标签。测试覆盖 IPC 前确认和打开失败恢复。 |
| `openProject` | `App`、`CommandPalette`、`ProjectSquareList`、`EditorArea`、`ProjectTree`、`HomeSidebarPanel`、`store-facade`、新建交接 | `project:open` 切连接、读取或初始化核心配置、记入最近列表；renderer 在请求前递增 session，收到回执核对 session，再异步加载 Prompt、写 `config:set`、读树和初始化 Layer 2。 | **adapter 接线 / 编辑会话保留**。发布项目、清配置快照/版本、恢复失败标签和布局切换还与生命周期绑定。已有标签同 ID 碰撞及旧文件树回执测试；初始化各阶段的来源传递仍需单独验证。 |
| `saveProject` | `novel-config-adapter`、`analyze-style.command`、旧快照撤销 | 拷贝当前项目及可选配置快照，经 `project:save` 写 `project_core`，随后维护最近列表。主进程写当前连接，`_projectId` 未参与校验，`data.path` 用于必填检查和最近记录。15 秒超时只结束等待；异常、超时和拒绝均返回 false。 | **adapter 接线（D2）**。store 不替换编辑输入；B2 用例已有实例内互斥和回执后的来源核对，不能覆盖其他实例和调用者。已有显式快照持久化测试，超时后晚提交尚待注入验证。 |
| `refreshFileTree` | 打开项目、`ProjectTree`、`project-service`、蓝图/角色 adapter、`merge-revision`、目录/导入工作流、草稿生成/定稿/导入命令 | `fs:list-dir` 按捕获路径读取；发布前校验 id/path/session。无写入。 | **UI 投影保留 / adapter 接线**。store 保存文件树；现有测试覆盖来源变化和当前响应。相同 session 的读没有独立请求序号。 |
| `loadRecentProjects` | `App`、`store-facade` | `project:recent-list` 读取应用级最近项目 JSON；无项目 session、无写入。 | **UI 投影保留 / adapter 接线**。结果整表发布；未发现专用的晚到列表回归。 |
| `updateCharacterStates` | 未检出生产调用者 | 先发布内存角色状态，再用 `project:save` 写完整项目快照。15 秒本地超时，未读取业务 success。 | **adapter 接线（D2 核对旧入口）**。乐观投影无回滚；未发现专用测试。保留签名直到调用者和配置保存合同一并核实。 |
| `deleteProjectFolder` | `ProjectSquareList`、`HomeSidebarPanel` | 按明确路径操作；若为当前项目先关闭。`project:delete-folder` 校验路径后删目录，再移除应用级最近记录；两项有各自的失败边界。 | **adapter 接线 / UI 投影保留**。success 后过滤最近列表，失败提示；专用 UI/部分失败回归待补。 |
| `removeRecentProject` | `ProjectSquareList`、`HomeSidebarPanel` | `project:remove-recent` 按路径更新应用配置。当前 action 只等 Promise 完成，未检查返回的 success。 | **adapter 接线 / UI 投影保留**。收到已解决的 Promise 就过滤列表；未发现专用拒绝回执测试。 |

[项目 store 测试](../../src/stores/project-store.test.ts)；[创建与打开主进程测试](../../electron/controllers/project-controller.test.ts)；[配置用例](../../src/core/application/novel-config.ts)；[配置用例测试](../../src/core/application/novel-config.test.ts)；[配置适配器](../../src/services/config/novel-config-adapter.ts)。

- **编辑会话保留**。`updateNovelConfig` 持有唯一配置投影和字段版本。B2 撤销由用例校验来源与字段版本，只修改本次应用的字段，显式保存仍走独立命令。旧 `snapshotNovelConfig` / `restoreNovelConfigSnapshot` 目前只检出定义和测试，后者恢复整份内存快照后异步保存，返回 true 表示完成内存恢复。两条撤销语义需在 D2 单独核实。
- **adapter 接线 / 编辑会话保留**。`closeProject` 同步使 session 失效并清项目投影；动态调用 `onProjectClosed` 重置角色和草稿，编辑标签也经异步导入清除。`confirmEditorTabSwitch` 则在异步确认后复查受保护标签。生命周期仍通过 renderer 单例调度。

## 草稿

入口为 [draft-store](../../src/stores/draft-store.ts)。`draftsByChapter` 缓存 SQLite 元数据，真实草稿 ID 来自 DB。草稿打开、编辑、修稿合并分别复用 [打开用例](../../src/core/application/open-editor-document.ts)、[编辑用例](../../src/core/application/draft-editor.ts) 和 [合并用例](../../src/core/application/commit-revision-merge.ts)。

| Action | 生产调用者 | IO、作用域与提交点 | 投影、职责与现有证据 |
|---|---|---|---|
| `loadChapterDrafts` | `project-service` 定稿事件、`merge-revision` | `db:draft-list` 读一章；返回后核对捕获项目，同会话无单章序号。无写入。 | **UI 投影保留 / adapter 接线**。按版本降序替换该章，应用读期间的归档回执；异常跳过。草稿箱现有测试主要覆盖全量刷新与归档。 |
| `loadAllDrafts` | `ProjectTree`、`ManuscriptBoard`、`project-service`、`import-workflow`、`generate-draft.command` | 先 `db:draft-get-all-chapter-numbers`，再逐章 `db:draft-list`；每次读取前后核对来源，只有最新全量序号发布。无写入。 | **UI 投影保留 / adapter 接线**。整表发布前应用晚到归档；当前读失败保留已有列表并向调用者抛错。草稿箱测试覆盖刷新与归档交叠。 |
| `archiveDraft` | `DraftBoxGroup` 的确认入口 | `db:draft-archive` 传项目路径、draftId 和章号；仓储校验当前连接路径，单条 SQL 只归档匹配的 draft、revised 或 reviewed 行。回执携带时间戳。 | **adapter 接线 / UI 投影保留**。提交后仅原 session 应用状态和归档版本；既有写条件和晚到读保护由仓储/草稿箱回归覆盖。 |

`reset` / `invalidateChapter` 属于 **UI 投影保留**，分别清来源与归档序号、逐章失效。`readDraftBody` 是该模块导出的异步辅助函数，`draft-editor-adapter`、`ReviewReport` 和 `project-service` 经它读取正文。它包装 `readVelaContent` 并在读取后校验捕获来源，属于 **adapter 接线**，随 D4 核对读正文的入口和结果合同。

[草稿箱组件测试](../../src/components/panels/sidebar/DraftBoxGroup.test.tsx)；[草稿索引测试](../../src/services/draft-index.test.ts)；[打开适配器测试](../../src/services/editor/open-editor-document.test.ts)；[SQLite 归档测试](../../electron/repositories/draft-archive.test.ts)；[编辑适配器](../../src/services/editor/draft-editor-adapter.ts)。

## 角色

入口为 [character-store](../../src/stores/character-store.ts)，通过 [character-edits-adapter](../../src/services/characters/character-edits-adapter.ts) 接线。冲突和合并规则已进入 [core 用例](../../src/core/application/commit-character-edits.ts)，由 [主进程服务](../../electron/services/character-edits-service.ts) 和 [仓储](../../electron/repositories/character-repository.ts) 在连接 token 保护下执行事务。

| Action | 生产调用者 | IO、作用域与提交点 | 投影、职责与现有证据 |
|---|---|---|---|
| `load` | `project-service` 生命周期/刷新事件、`CharactersView` 显式刷新/修复、导入兼容入口 | `db:character-edit-snapshot` 读卡及连接 token；adapter 检查 id/path/session，store 检查 loadSeq、saving 和加载期编辑。无写入。 | **adapter 接线 / 编辑会话保留**。发布基线、当前卡和选中项；同源且有写入基线时，dirty 默认阻止重读，显式 force 可跳过该条件。读取失败记录日志并结束加载。 |
| `loadCharacters` | `import-workflow` 完成后兼容调用 | 传入的路径未使用，委托 `load` 从当前项目捕获来源。无独立 IO 或写入。 | **adapter 接线**。兼容入口仍留在 store；调用者迁移时应显式验证导入来源，沿用 `load` 的覆盖。 |
| `deleteCharacter` | `CharacterEditor` | 已保存卡经 `db:character-commit-edits` 校验基线并事务删除卡及关联；新建未保存卡只在内存删除。校验来源、连接 token 与 loadSeq。 | **纯业务迁出 / 编辑会话保留**。事务规则在 core/主进程，store 提交后重放其他未保存编辑并更新选择和反馈。失败保留待保存卡。 |
| `previewMerge` | `CharacterEditor` 的疑似重复与手动合并入口 | 读取当前连接快照，检查两卡本地基线、UID、token 和编辑对象身份。无写入。 | **adapter 接线 / 编辑会话保留**。返回带原始卡快照的预览给确认窗口，无长期预览投影；组件测试覆盖取消和失效。 |
| `commitMerge` | `CharacterEditor` 确认后 | `db:character-merge` 在事务内校验预览快照与 token，写合并卡、重定向引用和删除来源卡。 | **纯业务迁出 / 编辑会话保留**。store 发布事务回执，保留其他角色草稿；组件经 adapter 单独刷新蓝图和树。仓储测试覆盖冲突与回滚，组件测试覆盖刷新失败。 |
| `saveAll` | `CharacterEditor` | 由捕获基线和编辑快照生成字段编辑，经 `db:character-commit-edits` 同事务写卡和引用。来源、token、loadSeq 与保存互斥限制回执发布。 | **纯业务迁出 / 编辑会话保留**。store 保留待保存快照、改名映射、选中项和保存期间的新编辑；store 与仓储回归分别验证回执重放和事务。 |

`addCharacter`、`updateField`、`applyTemplate`、`setSelectedName` 和 `reset` 持有 **编辑会话**。C3 模板 IO 由 [应用级模板 adapter](../../src/services/characters/character-template-adapter.ts) 处理，store 只给同一张选中卡应用字段补丁。

[角色 store 测试](../../src/stores/character-store.test.ts)；[core 编辑测试](../../src/core/application/commit-character-edits.test.ts)；[角色编辑组件测试](../../src/components/editor/CharacterEditor.application.test.tsx)；[角色仓储测试](../../electron/repositories/character-repository.test.ts)。

## 工作流

入口为 [workflow-store](../../src/stores/workflow-store.ts)。启动请求的选择与校验已有 [core 用例](../../src/core/application/start-workflow.ts) 和 [workflow-starter](../../src/services/workflows/workflow-starter.ts)，步骤循环仍写 Zustand 单例，执行上下文与等待 resolver 仍在模块级 Map。

| Action | 生产调用者 | IO、作用域与提交点 | 投影、职责与现有证据 |
|---|---|---|---|
| `startWorkflow` | `workflow-starter`、`automation/executor`、`character-archive-workflow` | 按 runId 登记，`onStarted` 同步回执；再执行步骤，返回 Promise 等运行结束。步骤各自决定业务写入，checkpoint/输出镜像异步落盘。项目来源由启动适配器和具体 workflow 捕获。 | **adapter 接线 / UI 投影保留**。活跃任务、步进投影及非 headless 面板联动留在 renderer；执行循环及模块级依赖归 D3 核对。headless 与 starter 测试分别覆盖回执和启动适配。 |
| `restoreCheckpoint` | `App` 初始化 | `db:checkpoint-load`，DB 无数据时尝试读取旧 localStorage，必要时异步回写；捕获项目 id/path/session 并在读、重建工厂和重放前校验。按断点重放可能触发步骤自己的业务写。 | **adapter 接线 / UI 投影保留**。先发布恢复的运行/等待状态，再自动重放可重建运行；不可重建的暂停或失败。recovery/checkpoint/replay 测试覆盖旧来源失效与续跑。 |
| `hydrateInterruptedOutputs` | `App` 在 checkpoint 恢复后 | 对暂停/失败运行经 `readStepOutputTail` 调 `fs:workflow-output-tail`，按 runId/stepIndex 读全量结果。无写入。 | **adapter 接线 / UI 投影保留**。只从启动时筛出的空结果候选补回净化文本，发布按活跃 runId 匹配；当前没有独立项目会话守卫。file-output 测试验证恢复与已有输出保留。 |

- `executeRunFromIndex` 由启动、自动重放及恢复后的 `confirmContinue` 调用。**纯业务迁出（D3 核对）** 的候选是步骤推进、取消与等待状态转换；现状直接读写单例、调用步骤 IO、广播 `WORKFLOW_COMPLETE`，终态入历史并清理输出。完成事件或 checkpoint 请求发出不能证明业务事务成功，实际提交由各步骤定义。
- **UI 投影保留 / adapter 接线**。`confirmContinue` 解析进程内等待，或用恢复时捕获的 definition 续跑；`cancelWorkflow` 置取消标志、解除等待、移入历史，并异步清输出/更新 checkpoint，已进入最终提交的 run 继续执行。`addLog` 同时更新界面和写日志。`clearCheckpoint` 与 beforeunload 保存使用模块级端口，checkpoint 的保存/清理均为尽力执行。

[启动适配测试](../../src/services/workflows/workflow-starter.test.ts)；[headless 测试](../../src/stores/workflow-store.headless.test.ts)；[replay 测试](../../src/stores/workflow-store.replay.test.ts)；[recovery 测试](../../src/stores/workflow-store.recovery.test.ts)；[checkpoint 测试](../../src/stores/workflow-store.checkpoint.test.ts)；[file-output 测试](../../src/stores/workflow-store.file-output.test.ts)。

## 后续批次的输入

- **D2** 从 `project:save` 的 SQLite 更新、最近记录维护及 15 秒等待边界开始。分别验证迟到成功、真实拒绝、同路径重开、其他调用者并发和撤销期间的新编辑；仅在可核验的提交协议下允许重试。写入调用者还包括 [导入命令](../../src/services/workflows/commands/import-novel.command.ts) 直接调用 `project:save`、[Agent 配置工具](../../src/services/agent/tools/update-config.tool.ts) 调用 `project:update-config`，以及旧整份快照撤销和角色状态写入。
- [风格分析命令](../../src/services/workflows/commands/analyze-style.command.ts) 在模型返回后取得当前 store 并保存，随后直接记录已保存。D2 需覆盖来源变更和非成功回执下的反馈。
- **D3** 从启动适配、runId、等待/取消、全局事件、输出和 checkpoint 端口核对实例归属。[runtime 容器测试](../../src/core/runtime/container.test.ts) 与上述工作流单例测试各自提供基线，双实例须经真实执行入口验证。
- **D4** 通过打开、编辑、保存、修稿、合并及定稿现有入口串起内存业务链路，分别保留真实事务、草稿身份及冻结状态的 adapter/仓储证据。

## 本地验收

TypeScript AST 与清单逐项对账，项目 8 项、草稿 3 项、角色 6 项、工作流 3 项，共 20 项。42 条本地链接和两处索引入口已核验。

全量 350 个测试文件、3,849 条测试通过，单跑契约 12 条通过。TypeScript、core 独立编译、ESLint 零警告、架构边界 0/0/0、Vite 生产构建和公开产物审计通过。全量测试及契约使用独立临时目录与用户配置目录重跑，以满足文件链接和原生存储测试的文件操作权限。
