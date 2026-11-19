# 后续重构计划：前端用例收口到存储切换

2026-11-06。基线：`c2709ad`，知识库侧栏 PR #47 已合并。本文为后续计划，所有未勾选项均未实施。

执行时使用 `executing-plans` 按任务验证并复核，明确采用多 agent 执行时可使用 `subagent-driven-development`。A 已提交为 0c1375c、B1 为 5085aa0、B2 为 51dbe88、B3 为 bbb479e。C1a 为 632ac52、C1b 为 288773d、C1c 为 22ac0d2、C1d 为 7f04bbe、C1e 为 133c8bb、C1f 为 2d4c7aa、C1g 为 0373b7d，C2 为 4445a83。[C3 角色模板与重复角色合并](32-character-templates-and-merge-plan.md) 已通过本地验收。[D1 状态职责清单](33-store-responsibilities.md) 已完成，[D2 项目保存与配置撤销](34-project-config-save-plan.md) 已提交为 `6e13992`。[D3 Runtime 实例隔离](35-runtime-instances-plan.md) 已提交为 `d5c964d`。[D4 无 UI 创作业务链路](36-headless-draft-lifecycle-plan.md) 已提交为 `45a6530`。[E1 存储生命周期矩阵](37-storage-lifecycle-matrix.md) 已提交为 `22fcdd8`。[E2 只读诊断](10-core-usage.md#e2-只读诊断) 已提交为 `46dd042`。[E3 副本验证包](38-storage-export-verification.md) 已提交为 `9f1c1ff`。[E4 旧版隔离与恢复](39-legacy-storage-isolation-and-restore.md) 已提交为 `4f3508d`。[F1 切换设计与身份映射](40-file-storage-cutover-design.md) 离线映射与候选 IPC 已提交为 `d00c870`、`80dd06e`。候选编辑器界面已提交为 `bf7de59`。[F2 提交恢复协议](41-file-commit-recovery.md) 基础提交为 `03510b4`，候选业务 IPC 已提交为 `431024f`。候选界面已提交为 `746648c`，候选准备与旧章表冻结已提交为 `1cee167`。常规打开分流已提交为 `696e878`。通用写入保护已提交为 6dd8f3d，新章首次发布已提交为 4e50d73。候选编辑器已接通正文导入、全文索引、空白设定应用、缺失蓝图补入与 Agent 正文问答及确认后保存，并支持预览后创建续写草稿。续写已读取候选作品设定和目标章蓝图，导入及续写生成的章节可定稿和归档。文件稿可保存 Agent 提案为待合并修稿并确认合并。[F3 验收](52-f3-file-storage-acceptance.md) 已记录 Windows 打包应用的显式激活、重启和隔离回退。各批记录见 [架构索引](README.md)。第九至十二节给出 B–F 的拆分、证据与准入条件。各批按专项实施细则推进，数据迁移另按专项设计执行。

**目标**：组件只处理输入、渲染与反馈，应用用例组织业务，适配器连接 IO；最终在完整生命周期验收后切换章节存储。

前端可先开展 U0 合成样板和基线采集。通过后端交接验收后，再按批实施应用壳、编辑区、导航和功能页改造。交接清单、阶段依赖和验收见 [42 V3 前端重构与落地计划](42-v3-frontend-delivery-plan.md)。

**技术栈**：沿用 React 19、TypeScript 6、Vite 8、Zustand 5、Tailwind CSS 4、Radix UI、CodeMirror 6 和 Electron。不换框架、不拆 monorepo、不先做全仓目录改名。

## 一、当前真实状态

| 已交付 | 证据/边界 |
|---|---|
| 独立文件核心与离线导出 | 09–10；应用仍读写 DB，离线导出不是线上迁移工具 |
| 工作流入口、agent 端口与草稿标签身份 | 11–14；agent 直接 store 导入清零不代表完整引擎已移入 core |
| 编辑器应用用例 | 15；加载、保存、修稿/审稿/定稿、翻译与打开文档已抽离 |
| 原子修稿合并 | 16；正文、状态、修稿标记与相关快照同事务，失败回滚 |
| 知识库侧栏 | 17；请求失效、项目隔离、摘要/删除和真实组件回归已交付 |

基线验证为 308 个测试文件、3,361 条测试；TypeScript、ESLint、core 独立编译、边界门禁、生产 Vite 构建及公开产物审计通过。PR #47 的三平台 CI 对提交 `5bc1046` 全绿；合并后 master 有独立 CI，须按其 head 核对。

仍未启用：文件真相切换、旧表冻结、实时外部文件编辑恢复、完整引擎独立打包。当前版本仍为 `0.1.7-beta.3`。

## 二、全程约束

- 用户数据不删、不以空正文掩盖读取失败；不自动迁移真实项目，不引入影子双写或长期存储开关。
- 用户可见文本走三语字典；颜色、层级和交互沿用仓库语义令牌及现有组件。视觉改版单列，不夹带到职责拆分中。
- core 不依赖 React、Zustand、Electron、组件或 renderer store；外部从 core 公共入口消费。
- 项目作用域按值捕获 id/path/session，同路径重开也失效。UI 操作在确认前绑定来源，await 后不能重新捞“当前项目”冒充源项目。
- 持久化成功与投影刷新成功分别表达。保存/删除失败保留输入；刷新失败不把已提交操作说成失败。
- 未保存正文与 inline 接受会话是编辑会话状态，不是可随意重建的缓存。
- 不改依赖、schema 或版本，除非当批任务有明确必要性及对应规范；新增 IPC 同步类型、权限、preload 派生白名单与 parity。
- 临时测试、构建、CI 诊断日志统一放 `logs/tmp/`。本地记忆不强制加入版本库，共享结论写入架构文档。

## 三、批次顺序

| 批次 | 交付物 | 出口条件 |
|---|---|---|
| **A 已提交** | 知识库总览接入应用层 | 总览无直接 IPC/模型/回填业务编排；加载、检索、维护和导出元数据按项目隔离；提交 0c1375c，远程 CI 待推送 |
| **B** | 架构文档和小说配置用例 | 保存、生成、重载统一入口；脏编辑和晚到结果不互相覆盖 |
| **C** | 章节/角色等领域面板分批接入 | 一次只交付一类领域操作；改名、合并、保存的不变量在用例/事务中可测 |
| **D** | 状态与运行时剩余边界收口 | store 中剩余业务有清单并逐项退出；可用内存端口跑关键业务链路 |
| **E** | 项目生命周期、doctor 与恢复验收 | 副本导出、重建、历史/分支/审稿等生命周期无缺口，恢复演练可重复 |
| **F** | 文件存储正式接入 | 通过切换验收，旧表冻结保留，旧版隔离与备份恢复方案有效 |

A→B→C→D 是主实施顺序。E 的离线研究和测试夹具可提前准备，但正式切换必须等待 D/E 出口；F 不由前端“看起来已完成”触发。每批均可独立提交、停下，不按周数承诺进度。

## 四、A：知识库总览接入（已按以下步骤本地实施）

### A1：维护操作的纯核心用例

**文件**：新增 `src/core/application/knowledge-maintenance.ts`、`src/core/ports/knowledge-maintenance.ts` 与共置测试；修改 `src/core/index.ts`。复用已有 `knowledge.ts` 的公共查询用例，不给侧栏强塞维护功能依赖。

计划接口：

```ts
type MaintenanceKind = 'vectors' | 'tokens'
interface MaintenanceResult {
  success: boolean
  processed: number
  failed: number
  error?: string
  errorCode?: 'dim-mismatch'
}
interface KnowledgeMaintenancePorts {
  scope(): { id: string; path: string; session: number } | null
  vectorlessCount(): Promise<number>
  backfill(kind: MaintenanceKind): Promise<MaintenanceResult>
}
interface MaintenanceReceipt {
  result: MaintenanceResult
  vectorlessCount?: number
  refreshError?: string
}
```

`createKnowledgeMaintenanceApplication(ports, source)` 提供 `count(): Promise<number>`、`run(kind): Promise<MaintenanceReceipt>`、`dispose(): void`；`run` 返回维护结果，不发 toast。维护成功且源项目仍有效时读取缺向量数，成功填入 receipt.vectorlessCount，统计失败写入 receipt.refreshError 而不篡改维护结果；缺省字段不代表计数为零。`count` 最新请求优先。一个绑定实例内的维护写操作互斥，拒绝重复进入，不把按钮 disabled 当作唯一防线。

- [x] 先写延迟端口测试：同路径重开、count 乱序、维护重入、异常释放 busy、partial success、dim-mismatch 保留。
- [x] 确认测试能因缺少对应检查而失败，再实现最小用例。
- [x] 维度不匹配是失败终态，不能自动降级成另一种向量写入；不改现有后端检索/回填算法。
- [x] 区分操作结果与后续统计刷新。成功写入后刷新失败仍保留真实结果，源项目失效则停止 UI 发布。

**明确限制**：已有长 IPC 不支持实际取消。dispose/项目变化只取消后续 UI 发布，不宣称撤销已发出的维护写入；跨窗口并发不由实例内 busy 保证，若本批确认存在跨窗口写冲突，需在主进程增加项目级执行保护并补测试。

### A2：renderer 适配器与主进程作用域核对

**文件**：新增 `src/services/knowledge/knowledge-maintenance-adapter.ts` 及测试；复用 `knowledge-adapter.ts`、`knowledge-service.ts`。必要时窄改 `electron/controllers/kb-controller.ts` 及其测试。

- [x] 适配 `kb:get-vectorless-count`、`kb:backfill-vectors`、`kb:backfill-tokens`，完整保留 processed/failed/errorCode。
- [x] 核对主进程长操作是否在第一次 await 前捕获源路径与连接；禁止 await 后重新取当前 DB 来完成旧项目操作。
- [x] 用延迟 mock 证明向量路径和本地分词路径的项目归属；Electron 测试显式打桩，不依赖本机 Electron 二进制。
- [x] 适配器只接线，不决定 UI 文案、卡片、按钮或对话框。

### A3：导出元数据准备

**文件**：新增 `src/core/application/prepare-knowledge-export.ts`、`src/core/ports/knowledge-export.ts`、共置 `.test.ts` 和 `src/services/knowledge/knowledge-export-adapter.ts`；修改 core 公共导出，复用现有 `src/components/dialogs/ChapterExportDialog.tsx` 执行实际导出。

- [x] 将 `KnowledgeOverview` 内逐章读取蓝图标题的 IPC 循环移出组件。
- [x] 返回 `{ chapterNumbers: number[]; chapterTitles: Record<number, string> }`，过滤无法提取正章号的条目并去重。
- [x] 标题读取失败可回退该文档名称；项目过期必须整体停止，不能把过期当成普通标题缺失继续读新项目。
- [x] 此处章号仅用于已有导出接口，不作为草稿或文件章节身份，不据此生成新稳定 id。

### A4：总览组件接线与实际组件回归

**文件**：修改 `src/components/pages/KnowledgeOverview.tsx`，新增共置测试；扩展 `scripts/check-boundaries.mjs` 与测试。

- [x] 使用与侧栏相同的公共 load/search 用例，不复制一套 IPC 查询逻辑；维护操作通过 A1/A2 执行。
- [x] 保留 topK 1–50、现有三语提示、部分成功计数、分词入口可达条件和现有页面布局。
- [x] 输入编辑/清空与新查询使旧结果失效；旧请求的 success/error/finally 都不能覆盖新结果或 loading。
- [x] 项目切换/同路径重开清理旧投影；EventBus 刷新使用最新请求语义，维护完成只给源项目发更新。
- [x] 维护期间禁用冲突写入口；失败、部分成功、成功后统计刷新失败分别反馈并留日志。
- [x] 真实组件测试覆盖以上分支，尤其失败后 busy 复位、切项目后的旧维护返回不刷新新项目、回填无异常降级、导出标题途中切项目。
- [x] 为总览增加与侧栏等价的运行时 IO 导入门禁，允许中立 DTO 的 type-only 导入。

**A 的交付边界**：不改向量维度、分词策略、RRF、别名扩展、阈值与候选数；不顺带重写整个知识库主进程。

## 五、B–D：后续前端与状态边界

### B：架构文档与小说配置（每小批独立交付）

源码入口：`ArchFileViewer.tsx`、`WorldBuildingEditor.tsx`、`NovelConfigEditor.tsx`；复用 editor 应用层的项目会话与保存反馈模式。

- [x] B1：抽出架构文档读取/保存/生成用例；先补保存期间新输入、切项目、保存拒绝、失败不清 dirty 的组件回归。
- [x] B2：小说配置单字段生成与保存接入用例；生成只替换对应目标字段，不覆盖等待期间的用户修改，保留既有工作流可取消/流式/检查点行为。
- [x] B3：世界观读取与相关角色数据组合移出组件；失败不清空已有数据，跨项目不回写。

出口：这些组件不再直接调用数据库/模型/工作流实现；使用窄端口单测和真实组件回归证明行为，保存仍有 Save 日志与手动/自动反馈区分。

### C：章节卡片与角色等面板

入口：`ChapterCardEditor.tsx`、`CharacterEditor.tsx`、`DraftBoxGroup.tsx` 及相应 store。一次只处理一种领域操作，不把几个大面板混成一个 PR。

- [x] 章节卡片：加载、保存、排序、卷归属和生成入口逐项收口，失败不发布伪造草稿/蓝图。
- [x] 角色：模板、角色合并、改名分别定义用例；遵守 `character-data-standard` 的仅填空合并、renameMap、loadSeq、项目路径与 saving 防护。
- [x] 涉及关联更新时，核对引用、索引、导出与记忆的联动范围，并在事务/提交边界验证。

出口：改名与合并的失败不会覆盖手工字段或留下部分关联更新；单一业务规则无需在多个 UI/store 重复实现。

### D：store 与 runtime 的剩余收口

- [x] 按模块清点四个 store 的异步 action 及写入编排，记录加载投影、选择状态与临时编辑会话的归属，见 [D1 清单](33-store-responsibilities.md)。
- [x] 对 `services/agent` 中默认安装端口、引擎与上下文构建逐步建立独立实例入口；保留审批、工具结果顺序、超时、checkpoint 和子任务语义。
- [x] 验证两个独立项目实例并行不串数据；超时的 Promise.race 不等于操作已取消，不把现有限制包装成取消保证。
- [x] 用内存端口跑打开→编辑→保存→修稿→合并→审稿/定稿的关键链路，不需要 React 或 Electron。

出口：不以 store 导入计数为唯一结论；业务流程确实能在中立用例中执行，renderer 只承担组合与 UI 投影。先满足这一点，再讨论抽包。

## 六、E/F：存储切换专项前置

这些是硬门槛，必须另写实施与恢复设计，不能在普通 UI 批次中顺手启用。

- [x] [E1 生命周期矩阵](37-storage-lifecycle-matrix.md) 已记录 SQLite 与文件侧的职责、缺口和验收证据。逐项适配及验证仍是应用存储切换的准入条件。
- [x] [E2 只读诊断](10-core-usage.md#e2-只读诊断) 已报告重复身份、编号冲突、缺正文、孤儿引用、锁和临时文件。索引重建和故障恢复分别验证。
- [x] [E3 副本验收](38-storage-export-verification.md)：一致离线库副本导出到独立目录，逐条比对正文、身份、历史和关联；重复执行、外部修改、损坏数据都按失败策略验证。
- [x] [E4 旧版隔离与恢复](39-legacy-storage-isolation-and-restore.md) 已验证标记方案的误读风险、独立文件目录的旧版打开屏障，以及完整备份恢复与重启。
- [x] [F1 切换设计与身份映射](40-file-storage-cutover-design.md) 已核验项目级映射、候选编辑器保存及重启恢复。正式项目激活随 F2/F3 验收。
- [x] [F2 文件项目提交与恢复](41-file-commit-recovery.md) 激活项目的当前正文由文件编辑器写入 Markdown，旧章表冻结保留，派生索引可从正文重建。
- [x] [F3 Windows 文件项目验收](52-f3-file-storage-acceptance.md) 打包应用通过索引缺失重建、重启恢复、定稿只读、历史与分支完整性及隔离回退。验收范围为激活文件项目的现有专用入口。
- [ ] 发布验收按目标平台和实际交付范围执行。旧表删除不早于 1.0，并另走既定验收。

## 七、每批质量门禁与交付规则

先为实际风险补失败用例，再实现、定向复跑、独立审查，最后执行全量门禁。不得以 mock 内“传了参数”替代真实组件和事务边界验证。

优先使用仓库 pnpm 脚本；若本机既有 pnpm 健康检查尝试重装并因无 TTY 中止，使用同一 node_modules 的实际入口，不重装依赖或改锁文件：

```powershell
node node_modules/typescript/bin/tsc --noEmit --pretty false
node node_modules/eslint/bin/eslint.js . --ext ts,tsx --max-warnings 0
node node_modules/typescript/bin/tsc -p tsconfig.core.json
node node_modules/vitest/vitest.mjs run > logs/tmp/followup-tests.log 2>&1
node node_modules/vitest/vitest.mjs run src/contracts
node scripts/check-boundaries.mjs
node node_modules/vite/bin/vite.js build > logs/tmp/followup-build.log 2>&1
node scripts/check-public-console.mjs
git diff --check
git status --short package.json
```

每条命令都须核对退出码。记录实际测试数，不把本文件的基线数当成下一批结果。构建后 package.json 必须核查。

用户要求提交时：只提交该批源代码/测试/共享文档，推送后用 PR 触发 CI，核对当前 head 的三平台结果再合并；master 合并后另有 CI，不混用两次结果。记忆索引须区分本地待提交、PR 已通过和 master 已合并。

## 八、本次计划交付

计划初稿定义了后续路线。A1–A4 的本地实施见 [19 知识库总览应用层实施](19-knowledge-overview-application.md)，B1–B3、C1a–C1g、C2–C3 和 D1–D4 的进度见 [架构索引](README.md)。E/F 按各自出口条件推进，前端改造见 [42 V3 前端重构与落地计划](42-v3-frontend-delivery-plan.md)。

## 九、源码核对与优先风险（2026-11-06 补充）

本节记录补计划时基线 `c2709ad` 的源码观察，不是已完成修复的声明；A/B1/B2/B3 后续实施状态分别见 19–22。路径均相对仓库根目录；后续新增文件名是建议落点，实施前须确认不会重复已有职责。

| 当前入口 | 核对发现 | 计划归属 |
|---|---|---|
| `src/components/editor/ArchFileViewer.tsx` | 直接组合 `readCoreContent/writeCoreContent`、文件 IPC、生成工作流和角色提取 | B1 将读写与生成入口分开迁出，保留确认与编辑会话 |
| `src/components/editor/NovelConfigEditor.tsx`、`src/stores/project-store.ts` | 组件 `await saveProject()` 后直接显示成功，但 store 签名是 `Promise<boolean>` | B2 先覆盖返回 false 的失败语义，再抽用例；不能只测抛异常 |
| `src/components/editor/WorldBuildingEditor.tsx` | 同时消费角色投影、架构状态、后处理状态与生成入口 | B3 拆读取组合和命令，不另建角色事实源 |
| `src/stores/character-store.ts` | `saveAll` 组织改名映射、查旧名、删除与保存，多次 IPC 组成写链路 | C2 单列原子提交设计；搬进一个 adapter 不能自动获得事务性 |
| `src/core/ports/chapter-repo.ts` | 当前只有 `byId/list/save/remove`，更新通过 `expectedRevision` 检查版本 | E1 登记版本、分支、快照与关联协议缺口，切换前补齐 |
| `src/core/migration/export-legacy-project.ts`、`scripts/migrate-to-files.mjs` | 输出当前章与历史文件并备份完整库；命令检查部分关联内容完整性，但没有把这些关联全部转成可独立使用的文件模型 | E1/E3 区分“备份保留”与“应用可读写”，逐项验证 |
| 同一离线导出器 | 同源、同项目、文件完整时可核验已有输出并返回 `alreadyExported`；失败 staging 在 finally 清理 | E3 按实际协议测试，不把“目录已存在一律拒绝”或“失败现场总会保留”当作现状 |
| `src/core/adapters/file-chapter-store.ts` | 离线仓储使用项目锁，陈旧锁只报告；实时外部编辑协调另行处理 | E2/F2 不自动删除活跃锁，不把协作锁当作外部编辑器也遵守的锁 |

旧文档中的迁移历史片段与当前导出实现有差异：以 08 第二部分的用户数据保护原则、09/10 的实际交付边界和本次源码核对共同约束后续工作。E 批必须同步澄清文档中的目录重跑与失败清理口径，不复制历史双写方案。

### A 的补充契约

- [x] 项目过期与请求过期复用现有 `KnowledgeRequestCancelled`；业务失败保留后端结果。组件对取消不显示失败 toast，且只由当前请求结束当前 loading。
- [x] `run` 同步占用实例 busy，第二次调用在发 IPC 前拒绝；拒绝使用独立可识别错误，不能伪装成维护失败结果。finally 释放 busy，但 dispose 后实例不可重新使用。
- [x] `count` 的请求序号同时覆盖显式统计与维护后的统计刷新：较早发出的请求最后返回也不能覆盖较新统计。维护后的刷新失败只填 `refreshError`。
- [x] 维护返回时先校验源作用域；若已过期，结束发布，不继续读统计或发 EventBus。已发出的主进程操作可能已提交，取消异常不代表事务回滚。
- [x] partial success 原样保留 `success/processed/failed/errorCode`，不推算一个新 success；UI 按实际计数反馈。`dim-mismatch` 不自动重试、不切算法。
- [x] A3 在 core 内部复用 `KnowledgeDocument` 等中立 DTO，通过窄端口读取蓝图标题；组件仅接收章号/标题结果，不把 IPC client 或 store 传进 core。

## 十、B/C：拆成可独立验收的小批次

以下列出每批文件责任、最先失败的用例和完成证据。B1、B2、B3、C1、C2、C3 分别交付，不能以一组大组件改动共同报完成。

### B1：架构文档读取、保存与生成入口

**现有文件**：`src/components/editor/ArchFileViewer.tsx`、其共置测试、`src/services/vela-protocol.ts`、`scripts/check-boundaries.mjs` 及测试。

**建议新增**：`src/core/application/architecture-document.ts`、`src/core/ports/architecture-document.ts`、`src/services/architecture/architecture-adapter.ts` 与各自测试。core 接受文档身份、正文和来源作用域；adapter 解析内部 URI 或受支持的文件路径，保留原权限规则。

- [x] 先在现有组件测试加入：写入返回 false、抛错、读失败、保存中继续输入、保存中切项目、同路径重开、重载遇到 dirty；逐条确认断言确实失败。
- [x] 保存捕获正文与编辑版本。成功只推进该份正文的保存基线；若当前正文已变化仍保留 dirty。失败保留正文与旧基线，不靠 finally 清 dirty。
- [x] 加载返回“内容/缺失/失败”的可辨识结果；空字符串是合法空文档，不用作读取失败回退。重载先完成现有丢弃确认，再读源文档，不能先清空编辑器。
- [x] 生成和角色提取通过应用命令启动；保留已有工作流事件、运行 id、确认参数与完成刷新。取消发布和取消工作流分开表达，不声称主进程任务已撤销。
- [x] 接线真实组件并加运行时 IO 导入门禁；执行新用例、adapter、组件与边界测试，再执行第七节全量门禁。

**交付证据**：保存 false 不提示成功；旧返回不更改新编辑会话；文件路径和内部 URI 均由真实 adapter 分支覆盖。架构字符提取若涉及写库仍遵守角色合并标准，不在此批改角色事务模型。

### B2：小说配置保存与单字段生成

**现有文件**：`src/components/editor/NovelConfigEditor.tsx`、`src/stores/project-store.ts` 及测试、`src/services/workflows/commands/generate-field.command.ts`。

**建议新增**：`src/core/application/novel-config.ts`、`src/core/ports/novel-config.ts`、`src/services/config/novel-config-adapter.ts` 及测试、`NovelConfigEditor.test.tsx`。store 继续保存当前配置投影与撤销快照；应用用例负责提交与生成结果能否应用。

- [x] 先证明 `saveProject() -> false` 时组件不显示成功；分别覆盖异常、项目失效和保存期间新输入。返回 boolean 的适配必须显式归一成成功或失败。
- [x] 每次生成捕获项目会话、字段名和字段编辑版本；只在目标字段版本仍一致时应用产出。其他字段等待期间的输入必须保留。
- [x] 同字段已编辑时不静默覆盖；产出保持为待用户明确应用的结果，或沿用现有可用的冲突确认。具体展示复用既有对话框，新增文案补三语。
- [x] 保留配置生成的流式、取消、运行状态和 checkpoint 现有能力；先核对注册/恢复链路，不把当前未支持的恢复能力写成此次交付。
- [x] 验证撤销只作用于来源会话，保存反馈仍有 `Save:Config` 日志；组件/工作流命令/项目 store 回归与全量门禁通过后交付。

**交付证据**：false/异常两条失败路径均有断言；目标字段与其他字段的并发输入分别有回归；没有创建第二份长期配置镜像。

### B3：世界观与架构状态组合

**现有文件**：`src/components/editor/WorldBuildingEditor.tsx`、`src/services/workflows/architecture-workflow.ts`。读取组合复用 B1 的架构端口，不重复实现读写。

**建议新增**：`src/core/application/architecture-overview.ts` 及测试、`WorldBuildingEditor.test.tsx`；扩展 B1 adapter。

- [x] 先覆盖架构状态读取乱序、某一项失败、角色后处理完成后刷新、切项目后晚到事件和同路径重开。
- [x] 四类架构状态按来源组合，失败保留同一项目已成功投影并标记错误；切项目必须清掉旧项目投影，不以“失败保留”继续展示旧项目内容。
- [x] 角色数量继续来自已有角色投影；提取命令使用同一来源作用域，不从完成回调重新取得新项目。
- [x] 组件只显示状态和发命令；现有徽章、入口及三语反馈可达，真实组件与边界门禁通过。

### C1：章节蓝图与草稿列表命令

C1a 加载与保存已完成，含快照、来源隔离、逐行 dirty 确认和既有批量事务的真实 SQLite 回滚验证，见 [23 实施记录](23-blueprint-load-save-application-plan.md)。C1b 活页夹重排及其实际成员/顺序投影也已完成，见 [24](24-binder-application-plan.md)，沿用现有主进程事务并补真实 SQLite 失败回滚证据。C1c 手动删除已通过共享写锁、失败保留编辑和同路径重开验证，见 [26](26-blueprint-delete-application-plan.md)。C1d 目录生成入口、补缺口与校检已完成及通过 118 条相关回归，见 [27](27-blueprint-generation-verification-plan.md)；2026-11-11 完整 335 文件/3,702 条测试、标准生产构建与公开产物审计已通过本地验收。C1e 执行期补缺口仅插入事务及必要的自动/等待断点恢复来源保护已完成，见 [28](28-blueprint-gap-insert-only-plan.md)，最终338文件/3,749条测试和全部本地门禁通过。

**现有入口**：`src/components/editor/ChapterCardEditor.tsx`、`src/components/panels/sidebar/DraftBoxGroup.tsx`、`src/stores/draft-store.ts`。两组件分别接线验收；第一小批只抽蓝图加载/保存，排序、卷归属、删除和生成逐项追加。

**建议落点**：`src/core/application/chapter-blueprints.ts`、`src/core/ports/chapter-blueprints.ts`、`src/services/chapters/chapter-blueprint-adapter.ts` 及测试。

- [x] 蓝图的单项和批量保存、排序、卷归属、删除、补缺口及目录生成写入入口已按 23–24、26–29 逐项核对并接入。
- [x] 已验证保存失败、批量中途失败、项目切换、保存中新编辑和删除失败保留选中项。草稿归档在 SQLite 写入时校验定稿状态。
- [x] 活页夹排序/卷归属沿用主进程单事务，C1b 已验证关联顺序/卷区间中途失败整体回滚；本批无新增 IPC。
- [x] C1f 按 [29](29-directory-blueprint-write-plan.md) 接入目录生成原子提交、范围快照冲突及断点失效处理，342 文件、3,785 条测试通过。
- [x] C1g 按 [30](30-draft-box-application-plan.md) 复用既有打开文档和修稿合并用例。草稿标签绑定真实草稿 ID。蓝图读取失败时继续显示已有草稿与本地化章号。
- [x] 各项完成后执行组件、应用用例与主进程相关测试。C1g 全量 345 文件、3,805 条测试通过。

### C2：角色保存、改名与删除事务

**现有入口**：`src/stores/character-store.ts` 及测试、`src/components/editor/CharacterEditor.tsx` 及测试、`electron/repositories/character-repository.ts`。

**建议落点**：`src/core/application/commit-character-edits.ts`、`src/core/ports/character-edits.ts`、`src/services/characters/character-edits-adapter.ts` 及测试。主进程命令落点在进入本批时核对现有角色 controller 后确定，不臆造当前通道名。

- [x] [31 专项记录](31-character-edits-transaction-plan.md) 列出引用、索引、导出和历史记忆消费者，并记录派生更新的冲突处理。
- [x] 回归覆盖连续改名、撞名、保存期间新增角色、并发手改、关联清理失败和同路径重开。
- [x] 角色行、结构化关系与蓝图出场引用由一个主进程命令提交。改名保留 UID 和创建时间，引用更新故障时验证所有写入回滚。
- [x] 模型写时填空与人工字段编辑分走不同入口。档案补全继续使用 `mergeFields`。
- [x] 提交回执更新基线，保存期间的新编辑与改名映射保留。角色加载与基线读取均为只读。
- [x] 角色组件、store、主进程事务和角色工作流回归已通过，完整本地门禁见 31。

**交付证据**：故障注入后库内容逐行不变；并发新增角色仍存在；改名关联无悬空；保存失败保留输入和映射。

### C3：角色模板与模型合并

与 C2 分开交付。`CharacterEditor.tsx` 的 `templates:list/get/save` 通过独立模板 adapter 连接；模板是应用级资源还是项目级资源须按现有实现逐项标明，不强行套同一项目生命周期。

- [x] 模板列表失败不覆盖编辑卡；模板读取晚于角色切换时不应用到新角色；保存失败保留名称与内容。
- [x] 重复角色合并先展示预览和确认，提交时校验最新库值并保留手工字段。冲突、取消和派生刷新失败有独立回归。
- [x] 复用 C2 的项目写作用域与蓝图引用重写。一次 IPC 提交整个合并事务，三语反馈、日志和组件验收见 [32](32-character-templates-and-merge-plan.md)。

## 十一、D：状态与 runtime 收口的证据清单

本批先产出清单，再每次处理一个模块。目标是可独立调用的业务链路，不能用“store 行数减少”代替完成证据。

| 小批 | 已有文件入口 | 需要产出的证据 |
|---|---|---|
| [D1 状态职责清单](33-store-responsibilities.md) | `src/stores/project-store.ts`、`draft-store.ts`、`character-store.ts`、`workflow-store.ts` | 每个异步 action 的调用者、IO、作用域、提交点、投影与未迁出原因 |
| [D2 项目保存与配置撤销](34-project-config-save-plan.md) | `src/stores/project-store.ts`、`src/services/config/novel-config-adapter.ts`、`electron/controllers/project-controller.ts` | 超时后真实提交结果可辨识；旧会话不能恢复新会话快照；保存互斥规则可测。直接写入的调用者见 D1 |
| [D3 Runtime 实例隔离](35-runtime-instances-plan.md) | `src/services/agent/runtime-ports.ts`、`src/services/agent/agent-engine.ts`、`src/services/workflows/workflow-runtime.ts` | 两实例端口/事件/审批/checkpoint 不串用，全局默认安装点不绕过实例 |
| [D4 无 UI 业务链路](36-headless-draft-lifecycle-plan.md) | `src/core/application/draft-editor.ts`、`commit-revision-merge.ts` 等公共用例 | 内存端口执行打开→编辑→保存→修稿→合并→审稿/定稿，断言真实状态和正文 |

- [x] D1 每项标记“纯业务迁出 / adapter 接线 / UI 投影保留 / 编辑会话保留”，附实际用例与测试路径；不先统一改 store API。
- [x] D2 注入延迟，让调用超时后底层成功；确认不会自动重发造成重复提交。未有操作 id/幂等协议时，明确显示结果待核验，禁止当作确定失败重试。
- [x] D3 双实例回归覆盖取消、超时、异常、审批顺序、工具结果、事件订阅与 checkpoint 隔离。
- [x] D4 测合并失败保留原文、重复接受拒绝或按既定协议幂等、定稿只读、过期 revision 拒绝；核对事务 adapter 测试，内存测试不替代真实 DB 原子性。
- [x] 实例化与关键业务链路已通过，独立 core 编译和边界门禁通过。独立引擎打包仍需单独构建验证。

## 十二、E/F：切换前验证包与恢复协议

### E 的交付顺序

1. **[E1 生命周期矩阵](37-storage-lifecycle-matrix.md)**（已完成）：逐项列出现有命令、DB 表/关联、目标文件或保留 DB 的职责、读写入口、失败语义和测试。草稿版本、分支、快照、修稿、审稿、场景卡、归档、定稿、删除、重排、导入导出、agent 和 checkpoint 均须有归属；有未覆盖项就不进入切换。
2. **[E2 只读诊断](10-core-usage.md#e2-只读诊断)**（已提交）：`scripts/doctor.mjs` 通过窄诊断端口扫描文件项目和离线备份，报告重复身份、编号冲突、缺正文、孤儿关联、锁和临时文件。修复与扫描分离。
3. **[E3 副本验证包](38-storage-export-verification.md)**（合成与真实副本已验收）：用固定合成夹具和获准使用的真实项目一致离线副本分别验收；原路径只读，目标必须隔离。记录清单、正文及历史 hash、关联计数、工具/应用版本和源指纹。真实副本未提供时标记该项未验，不能拿合成夹具代替。
4. **[E4 隔离与恢复演练](39-legacy-storage-isolation-and-restore.md)**（Windows 已验收）：指定打包旧版验证了目录屏障，完整归档在独立目录中恢复并通过重启验证。文件项目发布与打开入口的准入由 F 实施。

**E3 必测矩阵**：

| 情况 | 必须观察到的结果 |
|---|---|
| 空正文与缺失 contents | 空正文保留；缺失关联返回失败，不生成成功报告 |
| 多版本、分支、归档和审稿关联 | 每个来源 id 均可追溯，当前章选择无歧义；关联不只存在于备份中而无法在目标应用访问 |
| 同源同目标重跑 | 只核验，不重写；源码、目标正文或备份被改动时拒绝冒充已完成 |
| 同源不同空目标 | 比较章节身份、业务内容与映射；区分备份字节差异和业务不一致，不只比较文件数量 |
| 源库有 WAL 或导出期间变化 | 当前 CLI 拒绝非一致副本；不忽略 sidecar 后声称备份完整 |
| 重复身份、编号冲突、损坏 frontmatter | 报告具体冲突，禁止自动选择一份覆盖另一份 |
| 进程中断、遗留锁、外部改动 | 重新打开可诊断；未经确认不删锁、不覆盖外部稿；中断恢复另用真实子进程故障注入验证 |
| 删除派生索引后重建 | 章节与历史正文 hash 不变，重建后的查询与关联符合矩阵 |

**恢复记录最少字段**：源/目标绝对路径、源指纹、备份位置、迁移清单版本、验证报告位置、切换时间点、失败阶段、恢复使用的应用版本与快照时间点。报告共享前移除真实小说正文与个人路径；真实数据不提交到仓库。

### F 的提交点与失败处理

F 的切换条件和身份设计见 [F1 专项设计](40-file-storage-cutover-design.md)。激活前须完成项目入口、仓储与生命周期联调及故障复验。

| 阶段 | 事实来源与提交点 | 失败时处理 |
|---|---|---|
| 准备 | 原 DB 仍是事实源；完成一致副本与清单 | 原项目继续可用；不写切换成功标记 |
| 隔离目标验证 | 目标尚未激活，按 E 的矩阵完整验证 | 保留可诊断报告；不改原项目，不自动删除失败目标 |
| 激活 | 全部写入口已接线，以可恢复的激活协议切换项目入口 | 激活中断按协议核对清单和状态；未确认前不开放写入，不能同时启用两份事实源 |
| 文件正文提交 | 预期 revision 检查及文件原子替换成功 | 写文件失败保留 dirty，返回失败；不回退 DB-only 保存 |
| 派生索引更新 | 文件已成功提交，索引可重建 | 返回“已保存、索引待修复”，记录并安排重建；不能把正文已提交说成未保存而诱发重复写 |
| 返回旧版 | 使用匹配的旧版应用与迁移前完整快照，在独立恢复目录验证 | 明确回到快照时间点；切换后新增文件稿先另行导出保全，禁止覆盖回冻结旧库冒充无损回退 |

- [ ] 冻结旧章表的同时核对设定/角色/大纲等仍保留 DB 的写入；冻结范围精确到表和操作，不把整个 DB 一刀设为不可写。
- [ ] 章节文件与仍在 DB 的修稿/审稿等跨介质关联必须有崩溃恢复协议及故障注入证据；SQLite 事务无法让文件写入自动成为同一原子提交。协议未定，不开放该链路。
- [ ] 文件 revision 冲突时保留两份内容和来源，要求明确解决；不盲目覆盖外部编辑。活跃锁拒绝冲突写，陈旧锁修复需核验所有权和恢复状态。
- [ ] UI 保存、agent 工具、工作流续跑和导入均跑真实入口；定稿只读、历史分支和外部编辑恢复分别验收。
- [ ] 使用目标平台的打包应用复验打开、保存、重启恢复和旧版隔离。[Windows 文件项目证据](52-f3-file-storage-acceptance.md)已收录，其余发布目标随实际交付验收。

### 本次补充的检查记录

- [x] 对照当前源码核实 B/C 入口、项目保存 boolean、章节仓储端口和离线导出边界。
- [x] 保留 A→B→C→D→E/F 顺序；将 B/C 拆成独立验收小批，补 D 的实例证据和 E/F 故障矩阵。
- [x] 区分正文提交、派生刷新、过期发布和实际取消；未把存储版本标记当作已发布旧版的隔离保证。
- [x] 按各批实际交付回填 A、B、C 和 D1–D4。真实副本验证及引擎独立打包仍有各自的验收项。

A、B1–B3、C1a–C1g 与 C2–C3 已本地实施。D1 状态职责清单已完成，[D2 项目保存与配置撤销](34-project-config-save-plan.md) 已提交为 `6e13992`。[D3 Runtime 实例隔离](35-runtime-instances-plan.md) 已提交为 `d5c964d`。[D4 无 UI 创作业务链路](36-headless-draft-lifecycle-plan.md) 已提交为 `45a6530`。[E1 存储生命周期矩阵](37-storage-lifecycle-matrix.md) 已提交为 `22fcdd8`。[E2 只读诊断](10-core-usage.md#e2-只读诊断) 已提交为 `46dd042`。[E3 副本验证包](38-storage-export-verification.md) 已提交为 `9f1c1ff`。[E4 旧版隔离与恢复](39-legacy-storage-isolation-and-restore.md) 已提交为 `4f3508d`。[F1 切换设计与身份映射](40-file-storage-cutover-design.md) 离线映射与候选 IPC 已提交为 `d00c870`、`80dd06e`。候选编辑器界面已提交为 `bf7de59`。[F2 提交恢复协议](41-file-commit-recovery.md) 基础提交为 `03510b4`，候选业务 IPC 已提交为 `431024f`。候选界面已提交为 `746648c`，候选准备与旧章表冻结已提交为 `1cee167`。常规打开分流已提交为 `696e878`。通用写入保护已提交为 6dd8f3d，新章首次发布已提交为 4e50d73。候选编辑器已接通正文导入、全文索引、空白设定应用、缺失蓝图补入与 Agent 正文问答及确认后保存，并支持预览后创建续写草稿。续写已读取候选作品设定和目标章蓝图，导入及续写生成的章节可定稿和归档。文件稿可保存 Agent 提案为待合并修稿并确认合并。[F3 验收](52-f3-file-storage-acceptance.md) 已记录 Windows 打包应用的显式激活、重启和隔离回退。
