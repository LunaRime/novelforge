# C1b：活页夹卷归属与手动顺序

2026-11-06，基线 `632ac52`。承接 18/23 的 C1 拆批，使用 writing-plans、subagent-driven-development、TDD；沿用当前 codex/followup-plan 分支。本批交付侧栏活页夹重排命令、对应卷内投影与真实事务验证；不改蓝图编辑器排序偏好、不接管 DraftBoxGroup、删除/生成或分卷创建编辑。

## 已核对的入口与方案

- ProjectTree 是 db:binder-reorder 的唯一 renderer 调用者；VolumeGroup 的拖放与 Alt+方向键通过回调进入它。现有 ProjectTree 按卷章号区间过滤草稿，不能表达实际 volume_number/sort_order。
- db-controller → binder-service.reorderChapter 已用单个 SQLite 事务更新卷成员、目标/原卷顺序及展示区间；保留此事务。blueprint-update-sort-order 暂无 renderer 调用者，不为其新增入口。
- 沿用事务并建立窄 core 用例与 renderer adapter，新增 BinderVolumeGroup 接线与投影。相比把全部 ProjectTree 刷新迁出，本方案限制改动范围；相比仅包装 IPC，还能显示实际提交的结果。
- 蓝图有明确卷号时以成员关系为准（null 表示未分卷），按 sortOrder、chapterNumber 排序。仅有草稿、没有蓝图的旧章节仍按卷范围显示，保留旧项目可见性；蓝图但无草稿不生成空草稿。可见行索引须翻译为含隐藏蓝图的实际事务索引，避免 Alt+方向键提交成功却不移动。

## 契约与任务

- [x] 新增 core ports/binder.ts、application/binder.ts 与导出。BinderScope 复用 ChapterBlueprintScope；BinderChapter 为 chapterNumber/title/volumeNumber/sortOrder。工厂 createBinderApplication(ports, source?) 提供 load()、reorder({chapterNumber,toVolumeNumber,targetIndex?})、assertCurrent()、dispose()。load 最新优先；重排共享实例互斥、捕获参数，正安全章号/卷号、非负安全索引校验；允许 null 目标。写入使旧 load 失效。false 明确失败，成功后 refresh 失败返回 {refreshError}。来源 id/path/session 在每个 await 后检查，旧来源不刷新/发布。
- [x] renderer binder-adapter：createRendererBinderApplication(source?)，严格读取 db:blueprint-get-all 的窄 DTO（可缺 volumeNumber 归 null，其他数值必须合法），重排只用 db:binder-reorder，显式 success===true。refresh 仅调用 volume-store.load；独立复核确认需为 load 增加可选 isCurrent 发布守卫并在 reset 递增加载序号，防止旧项目刷新先写共享 store 再被 core 取消；UI 再读取投影并发资源事件，禁止回调触发无界全树旧会话刷新。
- [x] 先写延迟端口红绿回归，覆盖乱序、同路径重开、参数快照/重入、false/异常释放、刷新失败分离和失效。adapter 测读写映射及严格错误；实际 node:sqlite + Electron/database mock 测 binder-service 跨卷/同卷、null、稳定章号及第二阶段失败全表回滚，已有正确事务不改生产实现。
- [x] 新增 BinderVolumeGroup，按 id/path/session 建立实例，load 错误保留同来源已有投影，显示现有三语错误与重试；首次读取失败不启用重排。手动重排 try/catch、Save:Blueprint 日志/耗时与成功失败 toast，刷新失败单独反馈；旧来源不通知新项目。等待期间互斥，冲突回调不重复提交；StrictMode 不误杀实例。资源刷新读取最新投影。ProjectTree 删除重排 IPC，仅保留其他未迁出 IO。
- [x] 真实组件回归覆盖卷成员与顺序、旧草稿 fallback、失败保留投影、重排 false、旧会话不刷新/通知、成功后事件；仅为 ProjectTree 加 db:binder-reorder 边界禁用，组件 UI 不直接 IO。
- [x] 独立复核后跑全量 tsc、ESLint0、test、core tsc、contracts、boundaries、生产 Vite/公开产物审计、diff-check、package/lock 核对；回填 18/README 与本记录，本地提交及核对远程 run。C1 其余未完成，下一批 C1c。

日志统一 logs/tmp/binder-*.log；不改依赖、schema、版本、持久化身份或用户项目，不推送/发版。

## 实施与验收记录

已交付纯 core binder 端口/用例和 renderer adapter；ProjectTree 移除直接重排 IPC，新增 BinderVolumeGroup 按来源会话连接 VolumeGroup。列表失败保留同来源投影并提供重试，首次失败不开放重排；实际蓝图卷号和手动顺序决定已建蓝图章节的位置，无蓝图的旧草稿继续按卷区间显示，不创建空草稿。成功写入、刷新失败及失败写入有独立反馈和 Save:Blueprint/Refresh:Blueprint 日志，等待期间重入不重复写。

独立复核发现隐藏蓝图导致可见索引与事务索引错位，补回归观察 1 条失败后修复；将可见目标（含 legacy 回退行）映射到完整目标蓝图列表。恢复旧范围投影的故障注入另使 3 条组件断言失败，恢复实现后通过。初次模块缺失红灯及边界两条失败均记录在 logs/tmp。最终组件 8 条通过。

复核还发现仅在 core await 后检查会话不足以阻止 volume-store.load 提前发布旧卷列表。load 新增可选 isCurrent 回调，在 IO 前、成功发布前和失败清空前检查；reset 递增请求序号。不增加 project-store 依赖，原调用者默认行为保留。真实 store 的延迟成功/失败、reset、最新请求与默认行为 7 条，加 adapter 捕获来源/关闭/同路径重开 3 条先红后绿。独立复核最终无剩余 P1/P2。未接管未传守卫的其他分卷操作或全树刷新。

真实 node:sqlite + SQL trigger 验证跨卷、同卷、null、稳定章号、卷区间及排序/区间后半程失败时两表完整回滚；生产 binder-service 事务未修改，Electron/database 均显式 mock。应用/adapter/真实事务/真实 store 共 52 条定向测试通过。

最终门禁：333 个测试文件、3,655 条测试全部通过；contracts 另复跑 2 文件/12 条通过。全量 TypeScript、ESLint（零警告）、core 独立编译、边界 0/0/0、生产 Vite 构建与公开产物审计通过。package.json/锁文件无变化，diff 空白检查通过；日志位于 logs/tmp/binder-*.log。未进行安装包或真机 UI 验收；不把本地 Vite 构建作为存储切换验收。

本批仅本地提交，未推送，无对应远程 CI；不改依赖、schema、版本或用户项目。整个 C1 尚未完成，C1c 手动删除已按 [26](26-blueprint-delete-application-plan.md) 完成。下一批 C1d 核对生成与校检，草稿列表另批验收。
