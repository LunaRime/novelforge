# C1f 目录蓝图生成写入实施计划

> 2026-11-12，基线 `133c8bb`。承接 [18 总计划](18-followup-implementation-plan.md) 与 [28 补缺口协议](28-blueprint-gap-insert-only-plan.md)。按任务使用 `executing-plans`，每项先复现失败，再实现和验收。

**目标**是让目录生成在产出齐备且原蓝图快照仍有效时一次提交。取消、切项目、解析失败或冲突时保留数据库里的编辑。

生成命令在内存累计结果。主进程在同步 SQLite 事务中校验来源、范围及快照，再写入生成字段和清理本次全书重建的多余蓝图。沿用 TypeScript、Electron IPC 和现有 SQLite 蓝图表。

## 现有路径

- `DirectoryConfigDialog` 经 `workflow-starter` 派发 `createDirectoryWorkflow`。全书、前 N 章、按卷、自定义范围共用该工作流。按卷和自定义范围传显式 `append.startChapter`，按卷的现有行为允许在范围内重生成。
- `GenerateDirectoryCommand` 在普通解析和 JSON 修复两条路径提前调用 `saveAllBlueprints`。修复路径还会直接跳到最大章号之后，留下中间缺口。普通路径发现头部缺口时可能反复收到同一批高位章节，持续清零失败计数。
- 工作流最后一步的 full 清理是在前面批次已经落库后逐章删除，低覆盖率判定使用已被修改的集合。append 则把原始蓝图和产出一起 upsert，可能覆盖生成期间对其他章的编辑。
- `loadDirectoryBlueprints` 吞掉读取失败，仍有 `generate-draft.command.ts` 消费。目录生成改走严格快照。校检补缺口继续使用 C1e 的仅插入接口。

## 写入规则

| 入口 | 允许写入 | 清理范围 | 提交冲突检查 |
| --- | --- | --- | --- |
| 全书重生成 | 1 到捕获的计划总章数 | 产出完整时清理该快照中不在新目录里的蓝图 | 整张蓝图表 |
| 前 N 章重生成 | 1 到 N，N 上限为计划总章数 | 保留其余章节 | 目标范围 |
| 续写追加 | 从严格快照的最大章号 + 1 起；指定数量时按数量，否则到计划总章数 | 保留已有章节 | 目标范围，新增抢占时整批冲突 |
| 按卷或自定义范围 | 显式起点和数量，允许重生成目标范围里的已有章 | 保留范围外章节 | 目标范围 |

- 按章号完整覆盖目标范围后才能提交。解析和本地修复共用累计路径，按章号去重并保留首次接受的结果。游标从最早缺口继续，连续无有效推进按既有降级次数终止。普通模式继续接受本次目标范围内超批结果，分批模式的普通解析和修复均受当前批上限约束。
- 生成只更新标题、定位、目的、事件、出场角色、悬念。已有蓝图保留用户指导、笔记及其时间、排序、优先级、卷归属和创建时间。全书清理仅操作蓝图表。前 N 章即使达到旧清理阈值也保留范围外蓝图。
- 范围起止、数量和计划总章数使用正安全整数，保留 `count: 0` 或省略代表默认范围的现有调用。显式 `append.startChapter` 的旧断点仍按显式范围解释。无后续章节的隐式追加直接完成，写入量为零。
- 全书范围从弹窗传入显示的总章数。主进程发现显示值与持久化值不一致时拒绝生成，避免以较短的范围清理用户仍在计划中的章节。
- renderer 绑定项目 id/path/session，SQLite 绑定 C1e 的连接 token。快照摘要以原始行的固定列序和章号顺序计算，覆盖手工字段、排序和时间戳。同一秒的不同内容也会冲突，完全相同的行状态视为相同快照。
- 旧断点缺少受保护的快照，或进程重启后 token 已失效时，生成和保存阶段提示重新发起。步骤编号与既有 checkpoint 格式沿用。SQLite 提交成功后才刷新列表，刷新失败单独记录。最终提交开始后，单项取消和全部取消都保留已在提交的任务，等待实际回执决定终态。

## 任务 1　纯 core 范围与提交规则

文件为 `src/core/application/directory-blueprint-write.ts`、同名 `.test.ts` 和 `src/core/index.ts`。复用 core 已有的 `BlueprintWriteScope`。

```ts
type DirectoryWriteMode = 'replace-all' | 'replace-range' | 'append'
type DirectorySnapshotRequest = {
  mode: 'full' | 'append'
  startChapter?: number
  count?: number
  expectedTotalChapters?: number
}
type DirectoryWriteRange = {
  mode: DirectoryWriteMode
  first: number
  last: number
  totalChapters: number
}
type GeneratedBlueprintFields = {
  chapterNumber: number
  title: string
  role: string
  purpose: string
  keyEvents: string
  characters: string[]
  suspenseHook: string
}
type DirectoryWriteSnapshot = {
  scope: BlueprintWriteScope
  range: DirectoryWriteRange | null
  digest: string
}
type DirectoryWriteInput = {
  snapshot: DirectoryWriteSnapshot
  items: GeneratedBlueprintFields[]
}
type DirectoryWriteResult =
  | { success: true; writtenChapterNumbers: number[]; deletedChapterNumbers: number[] }
  | { success: false; reason: 'scope' | 'conflict' | 'invalid' | 'storage'; error: string }
```

- [x] 先写范围、空追加、溢出、稀疏目录、首尾及中间缺章、重复章、越界章、非法字段、删除集合的用例。区分全书 `full count=0`、前 N 章与显式 append 的三种写入结果。
- [x] 运行 `node node_modules/vitest/vitest.mjs run src/core/application/directory-blueprint-write.test.ts`，确认新规则未实现时失败。
- [x] 实现 `resolveDirectoryWriteRange(params, totalChapters, highestChapter): DirectoryWriteRange | null`、`validateDirectoryWriteItems(range, items): GeneratedBlueprintFields[]`、`getDirectoryBlueprintDeletions(range, existingChapterNumbers): number[]`。完整覆盖校验先比较数量和章号范围，避免为异常大范围分配占位数组。合法产出按章号排序并复制角色数组。
- [x] 复跑任务测试及 `pnpm run typecheck:core`，期望全部通过。

## 任务 2　主进程快照、事务与 IPC

修改 `electron/controllers/db-controller.ts`、`electron/repositories/blueprint-repository.ts`、`src/shared/ipc-channels.ts`、`src/shared/ipc-policy.ts`、`src/shared/ipc-channel-parity.test.ts`。新增 `electron/services/directory-blueprint-write-service.ts` 及同名测试，复用 `blueprint-gap-service.ts` 的 `captureBlueprintWriteScope`。

```ts
type DirectorySnapshotRead = {
  snapshot: DirectoryWriteSnapshot
  existingBlueprints: BlueprintData[]
}
// db:blueprint-directory-snapshot(args: [DirectorySnapshotRequest]): DirectorySnapshotRead
// db:blueprint-directory-commit(args: [DirectoryWriteInput]): DirectoryWriteResult
```

IPC 共享声明中引用 core 定义的请求形状，工作流参数沿用同一模式与范围字段。读取快照在主进程连接上同时取得项目总章数及蓝图原始行，返回正常化蓝图供提示词使用。提交在事务中重读计划总章数与受影响行并比对，处理冲突后才执行 SQL。隐式追加仅允许插入，按卷与自定义范围使用仅更新生成字段的 upsert。

- [x] 先用真实内存 SQLite 写旧字段保留、空行、稀疏章号、范围外并发保存、范围内并发编辑及删除、同时间戳编辑、计划总章数变化和同路径换连接用例。全书事务通过触发器在清理阶段抛错，验证前面的多章写入也回滚。追加和范围重生成用后续插入故障验证回滚。测试桩沿用 `blueprint-gap-service.test.ts`，任何实际可达的 Electron 模块必须打桩。
- [x] 运行 `node node_modules/vitest/vitest.mjs run electron/services/directory-blueprint-write-service.test.ts src/shared/ipc-channel-parity.test.ts`，观察用例失败。
- [x] 实现快照读取与事务。范围读取复用章号主键，按章号排序。回执基于事务实际写入和删除结果。读取标记为读项目，提交能清理全书蓝图，沿用蓝图删除的 `destructive` 分类。preload 从策略派生，IPC 对账更新至 270 invoke、278 总声明。业务错误沿用已有翻译或补齐三语。
- [x] 复跑上述命令，再加入 `electron/services/blueprint-gap-service.test.ts` 与 `electron/repositories/blueprint-repository.test.ts`，确认新旧写入语义。

## 任务 3　接入生成工作流

修改 `src/services/chapters/chapter-blueprint-adapter.ts`、`src/services/workflows/directory-workflow.ts`、`src/services/workflows/commands/directory.command.ts`、`src/components/dialogs/DirectoryConfigDialog.tsx` 及其测试。新增 `src/services/workflows/directory-workflow.test.ts` 与 `src/services/workflows/commands/directory.command.test.ts`。保留现有架构读取、模型路由、进度和重试结构，分批提示词只取游标前的最近蓝图。运行时取消保护位于 `src/stores/workflow-store.ts`，仅目录最终提交启用。

- [x] 先写测试证明普通批次和修复路径生成时没有蓝图写 IPC。覆盖有头部或中间缺口、重复高位章导致无进展、分批越界、生成后取消、架构读取或模型调用期间切换项目、提交冲突和失败回执、刷新失败、有效同连接断点及旧或换连接断点。另测按卷的显式起点透传和稀疏目录续写。
- [x] 运行 `node node_modules/vitest/vitest.mjs run src/services/workflows/directory-workflow.test.ts src/services/workflows/commands/directory.command.test.ts src/services/chapters/chapter-blueprint-adapter.test.ts`，确认回归先失败。
- [x] 工厂捕获参数与 renderer 来源。步骤 0 保存 `context.data.directoryWriteSnapshot`、架构、提示词用旧蓝图；步骤 1 校验连接后生成，传 `context` 给 `callLLM`，仅在内存发布去重结果；步骤 2 在调用回执型 adapter 前校验来源、取消及快照，发一次 commit。adapter 验证成功回执的章号和模式，响应后仅在原来源发布刷新。前 N 章的续写入口传数量并省略起点，由严格快照计算下一章。移除目录流程中失去调用者的批量保存函数，保留草稿生成仍使用的读取入口。
- [x] 复跑任务测试，并运行 `node node_modules/vitest/vitest.mjs run src/services/workflows/workflow-rehydrate.test.ts src/services/workflows/workflow-starter.test.ts src/stores/workflow-store.replay.test.ts src/stores/workflow-store.recovery.test.ts src/stores/workflow-store.checkpoint.test.ts`。期望现有工厂恢复、范围参数及取消语义继续通过。

## 任务 4　本地验收与交接

- [x] 对照 `git diff` 检查两个解析分支、三步恢复、全书清理和按卷重生成的真实入口。确认一旦事务提交，刷新失败不会把成功回执转换为失败，旧来源也不会刷新新项目。
- [x] 依次核对 `pnpm run typecheck`、`pnpm run lint`、`pnpm run typecheck:core`、`pnpm run check:boundaries`、`pnpm run test`、`pnpm run build:vite`、`node scripts/check-public-console.mjs`。pnpm 依赖检查试图重装时，直接使用现有 `node_modules` 工具入口运行相同命令。期望全量测试通过、lint 零警告、边界 0/0/0、公开审计实际执行。
- [x] 回填本页、[18 总计划](18-followup-implementation-plan.md) 和 [架构索引](README.md) 的实际验收结果。核对 `git diff --check` 和 `git status --short package.json pnpm-lock.yaml`。独立记录该批范围、基线和证据，按当前授权提交。

下一批是 `DraftBoxGroup` 草稿列表接入，复用已有的打开文档和修稿合并用例。C2 角色事务与文件存储切换仍按 [18 总计划](18-followup-implementation-plan.md) 的前置条件推进。

## 实施与验收记录

- 纯 core 范围与覆盖校验、真实 SQLite、IPC 对账、弹窗及正常工作流入口已验证。模型产出先暂存，SQLite 在同一事务内确认快照、写入生成字段并清理全书模式的多余行。连接同路径换库、手工编辑冲突与故障回滚均有回归用例。
- 独立复核发现的三项问题均先复现再修复。最终事务发出后由实际回执决定任务终态和列表刷新。全书范围的显示章数与数据库章数不一致时拒绝读取写入快照。早期范围分批生成只取游标之前的蓝图作上下文。
- 宿主环境全量 **342 文件、3,785 条测试全部通过**。全量 TypeScript、core 独立编译、ESLint 零警告、架构边界 0/0/0、标准 Vite 生产构建与公开产物审计均通过。包版本、锁文件和数据库 schema 沿用原值。
