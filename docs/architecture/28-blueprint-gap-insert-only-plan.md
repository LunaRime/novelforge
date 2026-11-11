# C1e 补缺口执行期仅插入协议

2026-11-11，基线 `7f04bbe`。承接18/27。用户授权C1d提交后继续；本批只处理 `FillGapsCommand` 与两类校检/补缺口工作流。目录全量替换、append增量覆盖、导入蓝图和DraftBoxGroup另批。

## 协议与范围

- [x] 先补core、真实SQLite、renderer及命令失败回归，再接线。禁止补写复用全列upsert。
- [x] 纯core校验目标与产出：正安全整数、唯一章号、完整字段、产出只允许落在目标集合；允许部分产出但不谎报全覆盖。
- [x] 新增 `db:blueprint-write-scope` 严格获取主进程连接作用域 `{projectPath, token}`，`db:blueprint-insert-missing` 接收作用域、目标章号、产出并返回实际inserted/skipped章号。token由连接对象的WeakMap签发，不落盘，DB关闭重开/进程重启不可沿用旧token；renderer在模型调用前捕获，每次写前后另查id/path/session。无需更改database生命周期或schema。
- [x] 主进程单次同步事务内验证作用域并执行 `INSERT ... ON CONFLICT(chapter_number) DO NOTHING`。已有行全部字段及时间戳、guidance、notes、priority、sortOrder、volumeNumber原样保留；中途失败本组新增全回滚。权限策略为读项目/写项目，preload由策略派生，parity同步。
- [x] `FillGapsCommand` 只报告真实插入数量；模型返回后、写前以及下一组之前检查取消/来源，传递LLM取消context。失败向工作流传播，不以100%吞错成功。已提交前组允许保留，恢复重放依靠insert-only不覆盖，返回值不声称已取消提交。
- [x] 两类工作流按工厂捕获renderer来源，模型或架构读取晚到不触达新项目。checkpoint继续既有格式及工厂恢复规则，恢复生成可能重复模型成本，本批不引入游标协议或exactly-once承诺。
- [x] 独立复核、完整测试/typecheck/lint/core/边界、标准Vite与公开审计通过，回填18/索引/记忆。单批验收后不自动扩大范围，不推送或发布。

## 失败矩阵

已有章不覆盖（含未生成空行与卷成员）、执行期间另一写入抢先插入、重复执行、同路径DB重开token失效、renderer同路径会话变化、取消后模型晚回、无DB/非法或越界/重复产出、中途SQLite触发器异常回滚、空或部分输出、某组写入失败不显示总成功、架构读取期间切项目。手工编辑器和目录生成既有upsert保持不变。

## 实施与复核

- 纯core `insertMissingBlueprints` 校验并捕获目标、业务字段和角色列表，在窄端口的单次事务内返回实际插入/跳过的章号。主进程 `blueprint-gap-service` 以当前DB连接对象签发WeakMap token，写入同步事务校验path/token后执行insert-only；不改现有表、迁移或手工upsert。
- `createMissingBlueprintWriter` 在模型IO前捕获连接身份，拒绝不匹配或空token，并要求回执的inserted/skipped无重复、无越界、完整覆盖本次产出章号。补写命令在构造时复制gaps/source，传递取消context，提交前检查来源与取消；仅累计真正新增蓝图，保留原有行并在日志提示跳过章号。
- 真实SQLite验证原有行的全部字段/时间、卷归属原样保留，生成期间抢先插入不覆盖，重放不覆盖，中间触发器异常回滚本组全部新增；同路径重开的另一DB对象不接受旧token。
- 新增IPC两项同步类型、权限策略与数量对账：268 invoke、276总声明，preload沿用策略派生，不增手工白名单副本。用户提示三语齐全，原有中文补写上下文保持契约。
- 原命令5条覆盖/取消/来源/吞错/空产出回归先失败，再实现后通过。新core/SQLite测试先观察到缺模块失败，接线后通过；renderer失败回执和参数快照亦已覆盖。

### 必需的恢复链补修

独立终审确认既有恢复链有跨项目风险，补写工厂自身来源守卫不能拦住“先切项目、再重建工厂”：

1. `restoreCheckpoint` 在DB读取与registry异步加载之后才绑定归属，旧checkpoint可能在新项目重建/自动重放。新增sticky来源检查，在读取、工厂重建和发布/重放前拒绝失效；legacy localStorage迁移写回也在DB读后检查来源。4条先红回归覆盖同路径重开、切项目、A→B→A及旧迁移写入；另加registry等待窗口回归，测试工厂用不同匹配键避免先注册工厂遮蔽断言。
2. 恢复出的waiting任务点继续时原逻辑再次重建工厂，可能捕获另一项目。现在缓存恢复时已接受的definition与来源检查，确认续跑复用原闭包，失效时不执行、不清掉waiting标记；指定/全部取消清理缓存。3条先红回归覆盖原项目正常续跑（工厂只调用一次）、同路径重开及切项目。维持等待断点索引、上下文和零步完成语义，不变checkpoint格式。

上述是两类补写恢复安全所需的定点修复，不代表D阶段runtime/store整体改造已完成。最终独立复核无剩余P1/P2。

## 最终本地验收

- 完整 **338文件、3,749条测试全部通过**，包含恢复链、蓝图事务与IPC对账，无跳过/排除失败用例。
- 全量TypeScript、core独立编译、ESLint零警告、实际架构边界0/0/0、标准Vite构建和公开控制台审计通过（`skipped: false`）。现有构建依赖弃用、CSS及大chunk警告仍存在，不在本批宣称修复。
- `package.json`、锁文件、schema与database生命周期均无变动，不操作真实用户项目。UI原型、原`.gitignore`变更及测试/构建产物不混入本批。
- 本轮遗留`.tmp-boundary-*`测试目录已按用户要求核验夹具结构/无链接并经授权清理；最终测试后再复核根目录无遗留。

本批独立本地提交，不推送/发布；远程CI必须后续对本批真实head单独确认，旧主干绿色不能代替。下一小批需独立设计目录full/append生成写入协议：既有增量提前upsert、批量清理和快照冲突不能仅把末步改成事务就声称安全。DraftBoxGroup继续另批；整个C1仍未完成。
