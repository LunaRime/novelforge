# B1：架构文档应用层实施计划

2026-11-06，基线 `0c1375c`。承接 18 的 B1；B2/B3、角色事务与文件存储切换不在本批。沿用 React/Zustand、原有界面与工作流，不改依赖、版本、schema。

## 任务一：文档应用用例与 renderer adapter

新增 `src/core/application/architecture-document.ts`、`src/core/ports/architecture-document.ts`、各自行为测试及 `src/services/architecture/architecture-adapter.ts`/测试，更新 core 公共导出。

接口约定：`createArchitectureDocumentApplication(ports, locator, source = ports.scope())` 返回 `read()`、`save(content)`、`status()`、`existingCharacterCount()`、`generate(selectedSteps, stepGuidance)`、`extract(genre)`、`ownsRun(runId)`、`assertCurrent()`、`dispose()`。

- `read` 返回 `{ status: 'ready', content: string } | { status: 'missing' }`，IO 失败抛错，空正文是 ready。
- `save` 返回 `Promise<void>`；port 的 false 是保存失败，不能当成功。单实例保存互斥。
- `status` 返回四个架构步骤的 boolean 映射；core 负责现有长度大于 50 且无“待生成”占位的规则，该中文解析标记不翻译。
- `generate` 返回既有 `WorkflowReceipt`，复制步骤与指导，保留运行 id。`extract` 返回 `{ status: 'empty' } | { status: 'started', runId: string }`，先严格读取角色架构，长度不足 50 不启动。
- scope 为按值捕获的 id/path/session；所有 IO 前后核对，独立读取/状态请求最新优先。异常用 `ArchitectureRequestCancelled` 区分取消发布；dispose 永久失效，不能撤销已发出的写入。
- adapter 负责 core URI/物理文件 IO、项目核心读取和工作流启动；内部 URI 无效须拒绝，读失败不回退空文，缺失与失败分开。提取仍走既有 `extract_arch_characters` 工作流，不另写角色事务。

- [x] 先写并观察延迟端口失败用例：同路径重开、读取乱序、保存 false/异常/重入、启动失败、作用域变化与释放。
- [x] 实现最小用例及 adapter，覆盖真实 core URI 和物理路径、失败返回和工作流 receipt；定向测试与 core 编译通过。

## 任务二：ArchFileViewer 编辑会话

修改 `src/components/editor/ArchFileViewer.tsx` 与共置测试。按项目会话及文档路径建立独立内容组件；组件只管输入、确认、投影、toast 和 `Save:Arch` 日志。

- [x] 先写失败组件用例：保存中新输入、写拒绝/异常、同路径重开、手动重载取消、重载中输入、读失败、外部 props 更新碰到 dirty。
- [x] 保存按发出时正文推进基线，当前正文不同则保留 dirty/tab 内容。同步 tab 内容之前确保来源会话仍在；快捷键和按钮共享实例保存互斥。
- [x] 外部 props 更新仅在未脏且无保存竞争时采纳；采纳时失效更早的重载，不清用户输入。手动 dirty 重载使用 `editor.refreshConfirm`，确认后仍检查会话和编辑版本。
- [x] 自动工作流完成刷新在 dirty 时跳过，不弹出丢弃对话框；重载等待中新输入也不覆盖。读取失败保留正文/dirty并有错误反馈，finally 只结束自己的 loading。
- [x] 生成检查与对话框确认绑定来源，生成/提取返回 receipt 后保留运行 id；提取前角色读取失败应反馈，不跳过确认继续覆盖。卸载清理订阅，旧项目事件/返回不能更新新会话。
- [x] 运行归属在 `workflow-starter` 的同步 onStarted 回调记录 id/path/session，以 activeRuns/history 的保留范围清理；同项目其他入口和标签重挂载仍能识别完成事件。恢复 checkpoint 的 run 在重放前绑定本次恢复来源，不能把 await 后的新项目冒充旧来源。
- [x] 提取按钮按自己的 run id 观察 activeRuns/history 的终态或移除；用户取消不依赖 WORKFLOW_COMPLETE 才释放忙碌。忽略不带归属的全局提取事件，避免其他项目的晚到通知解除当前任务。

## 任务三：边界与交付

- [x] 为 ArchFileViewer 增加运行时 IPC、vela IO、工作流实现导入门禁，允许中立 DTO type-only 导入；先红后绿验证 CLI。
- [x] 复核真实组件、端口和 adapter 的取消/错误分支；执行全量 TypeScript、ESLint0、测试、core 编译、contracts、边界、生产构建与公开产物审计。
- [x] 构建后检查 package.json；更新本文件、18/README及本地记忆，区分 A 已提交与 B1 本地状态。日志放 logs/tmp/，不提交本地指引、记忆或日志。

本批完成后再单独进入 B2；不自动扩大到全部架构编辑器或角色事务重构。

## 实施记录

### 已接入的边界

ArchFileViewer 的直接 IPC、vela 读写及工作流实现调用已移至中立用例与 renderer adapter。core URI 区分缺失、空文与读取失败，物理路径保留现有 IPC 权限边界；非法内部 URI 拒绝，写入返回 false 不再走成功反馈。

保存只确认发出时的正文；等待期间的新输入仍为 dirty。重载在确认前绑定会话与编辑版本，等待期间的新输入、保存或新外部内容会淘汰旧读取；失败保留原文并复位 loading。props 外部更新与工作流自动刷新不覆盖脏编辑；手动丢弃复用现有三语确认。

生成/提取继续使用原工作流和运行 receipt。来源登记是运行时元数据，不写 checkpoint/schema；按运行保留范围清理。生成完成可跨标签挂载识别本会话任务，拒绝旧会话任务；提取取消通过自己的运行终态复位，不依赖没有 runId 的全局广播。模型提取的内部业务失败仍由既有后处理日志与状态表达，不将“任务正常结束”额外包装成“角色提取成功”。

### 失败回归与复核

组件首轮复现 8 条失败；追加“保存淘汰重载后 loading 卡住”和“已卸载编辑器回调污染新标签”两条先红后绿回归。导入门禁先复现 4 条失败；核心与适配器分别覆盖延迟返回、false/异常、重入、空文/缺失、非法 URI、读取与状态请求隔离及工作流启动拒绝。

独立复核发现标签重挂载丢失生成归属、取消提取不发完成事件两项问题，均补了失败回归后修复；运行来源登记在 onStarted 内、工作执行前完成。恢复归属另覆盖重放前注册与加载中项目会话变化。

最终门禁：316 个测试文件、3,465 条测试全部通过，contracts 另复跑 2 文件/12 条通过；全量 TypeScript、ESLint（零警告）、core 独立编译、边界 0/0/0、生产 Vite 构建及公开控制台产物审计通过。`git diff --check` 通过，构建后 package.json/锁文件无变更。日志统一位于本地忽略的 `logs/tmp/architecture-*.log`。

两项独立复核问题及 checkpoint 来源补充经复核无待修问题。本批作为独立本地提交交付，前批 A 的提交为 `0c1375c`。B2/B3 与 C–F 均未实施，未推送或合并本分支，不以旧主干 CI 代替本轮结果。没有执行真实项目迁移、schema/版本更新或安装包发布。
