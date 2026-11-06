# B2：小说配置应用层与生成回写

2026-11-06，基线 `5085aa0`。只实施 18 的 B2：配置保存、单字段生成、既有批量生成的结果应用与撤销保护。B3、角色事务、runtime 全量抽离与存储切换不在本批。

使用 `executing-plans` / `subagent-driven-development` 按任务实现并复核。沿用现有 React/Zustand、表单与工作流，不改依赖、版本或 schema；日志放 `logs/tmp/`。

## 任务一：中立配置用例与字段版本

新增 `src/core/ports/novel-config.ts`、`src/core/application/novel-config.ts` 及共置测试；新增 `src/services/config/novel-config-adapter.ts`/测试，更新 core 公共导出。用例对配置类型使用泛型，不让 core 依赖 IPC DTO 或 renderer store。

`createNovelConfigApplication(ports, source)` 提供 snapshot/update/save/applyGenerated/undo、startField/startBulk、hasModel/ownsRun、assertCurrent/dispose。snapshot 捕获配置与字段版本；applyGenerated 仅比较产出包含的字段，成功返回独立撤销 token，冲突返回字段清单，不覆盖。undo 仅恢复该 token 的字段，目标字段此后已被修改则拒绝；与其他字段的新输入互不覆盖。

- [x] 先写延迟端口失败用例：保存 false/异常/重入、同路径重开、模型等待中的目标字段编辑/改回原值、其他字段编辑、撤销后续编辑冲突及旧会话撤销。
- [x] `project-store.updateNovelConfig` 维护每个被编辑字段的递增版本，即使改回相同文本也不能被当作未编辑。旧全量快照恢复同样递增对应字段版本；原配置仍是唯一 UI 投影，不建立长期镜像。
- [x] 保存按发出时配置快照持久化，false 归一为失败，返回后不覆盖等待中新配置。适配器只接 store/工作流与模型配置，core 不发 toast 或日志。

## 任务二：真实生成命令接入

修改 `GenerateFieldCommand`、`GenerateConfigCommand`（位于 `architecture.command.ts`）、`workflow-starter.ts` 的批量回调组合。新增 renderer 结果呈现服务与三语冲突文案。

- [x] 先测试实际命令的延迟 LLM、确认期间切项目、目标字段变化、其他字段保留、取消、空产出及 false 保存，不只断言 mock 传参。
- [x] 命令在首次 await 前捕获来源与字段版本；保留原覆盖确认、prompt、流式输出和运行面板，向已有 callLLM 传递取消 context，并在回写前再次校验。
- [x] 字段冲突时保留产出为 toast 的明确“应用”动作；用户点击后确认覆盖，再以确认开始时的字段版本检查。确认等待期间又编辑则继续保留待应用产出，不自动强写。
- [x] 应用结果后保存失败保留当前输入/产出，明确反馈失败，不报“已保存”。撤销按独立 token 做字段级恢复及保存，来源变更或字段后来被编辑时拒绝。
- [x] 批量产出回调改为成功应用后的通知；命令负责统一应用/保存，回调不再重复写配置。现有整批 config_generation 不可序列化回调的恢复限制仍保留，不宣称补齐它；单字段既有可重建路径继续验证。

## 任务三：表单与对话框

修改 `NovelConfigEditor.tsx`、`GenerateConfigDialog.tsx` 及真实组件测试，增加运行时 IO/模型/工作流实现导入门禁。

- [x] 保存 false/异常不显示成功；保存期间新输入保留；切项目或同路径重开后旧结果不发布新项目 toast/loading。
- [x] 表单仍从项目 store 读取配置，输入通过用例更新；生成按钮通过用例启动，批量对话框只保留输入、确认和反馈，不直接启动工作流或应用配置。
- [x] 对话框确认绑定来源，单字段/整批并发启动有入口保护；运行状态仍消费现有 workflow store 的本会话投影。
- [x] 保留题材/受众中文存储值、原布局及规模输入行为。所有新用户文案覆盖 zh-CN/en-US/ru-RU。

## 任务四：复核、验证与记录

- [x] 独立复核字段 CAS、撤销闭包、实际 workflow 回写和保存反馈；修复有行为证据的发现。
- [x] 全量 TypeScript、ESLint0、测试、core 编译、contracts、边界、生产构建、公开产物审计通过；检查 package.json/锁文件与 diff 空白。
- [x] 回填实际测试数、18/README及本地记忆。按批次保留可审查提交，不推送或冒用旧主干 CI。

## 实施记录

配置依旧以 project-store 的 novelConfig 为单一 UI 投影。core 使用泛型窄端口，不导入 IPC DTO；临时 snapshot 复制来源、值与字段版本，applyGenerated 只比较产出涉及的字段，撤销 token 按实例保存且只能使用一次。字段改为其他值再改回也会推进版本；legacy 全快照恢复同样推进版本，包括删除后来新增的可选字段。

NovelConfigEditor 的保存和生成入口已接入用例。保存传递发出时的配置快照；失败不替换内存输入，等待期间的新输入不被保存返回值覆盖。组件按项目 id/path/session 建立视图，旧输入回调、旧保存返回和旧弹窗确认不发布到新会话。GenerateConfigDialog 只负责输入和确认，由父用例启动；题材/受众存储值、规模参数和现有布局沿用。

单字段与批量实际工作流工厂在准备定义时就捕获生成会话，覆盖动态加载命令期间的项目变化；命令执行、确认和模型等待后都核对来源。原有 prompt/流式回调继续使用，单字段与批量调用都传递现有取消 context。单字段 checkpoint 仍通过已有 fieldKey/mode 重建，在恢复会话中重新捕获版本；没有改 checkpoint schema，也没有为原本不可序列化的整批回调增加恢复承诺。

冲突结果通过不自动消失的 toast 保留“应用”动作。点击后再次确认，以确认开始时的字段版本做 CAS；确认等待中新输入或取消确认会继续保留产出。应用后保存失败保留表单中的产出并显示失败；不显示“已保存”。撤销仅影响本次产出涉及的字段，字段后来被编辑或来源过期则不回滚。批量 onGenerated 现在是成功应用/保存后的通知，明确覆盖即时及稍后确认的应用路径；通知异常单独记录，不把已提交保存伪装成失败。

### 失败回归与复核

- 实际单字段命令初轮 7 条失败，覆盖目标编辑、改回原值、确认期间切项目、晚到模型、取消、false 保存及撤销。
- 配置组件初轮 4 条失败；生成对话框初轮 2 条失败；运行时导入门禁初轮 2 组失败。
- 追加工作流准备后同路径重开的两条失败回归，防止动态 import 后把旧任务绑定到新项目。
- 独立复核发现延后应用漏通知，补失败测试后将通知收口到共同的成功应用路径；同时覆盖空对象/null/数组产出不应用、不保存、不报成功。
- 追加旧弹窗的模型可用性检查、成功通知中切项目两条反馈隔离回归；修复后不产生旧 toast 或未处理的拒绝。

公开构建首次审计发现旧开发构建遗留的 console-controller chunk。已将完整旧 dist-electron 保留到忽略目录 logs/tmp/config-previous-dist-electron，重新生成生产产物并通过公开控制台审计；未修改业务或构建配置来放过该检查。

最终门禁：321 个测试文件、3,505 条测试全部通过；contracts 另复跑 2 文件/12 条通过。全量 TypeScript、ESLint（零警告）、core 独立编译、边界 0/0/0、生产 Vite 构建和公开控制台产物审计通过，package.json/锁文件无变化。独立复核发现及追加回归均已修复，最终复核无待修 P1/P2。

本批作为独立本地提交交付；没有迁移真实项目、改版本/schema、发包、推送或合并，没有对应远程 CI。B3 世界观/架构状态组合后续实施见 [22](22-architecture-overview-application-plan.md)；下一批为 C1，开始前核对当时源码并补独立细则。
