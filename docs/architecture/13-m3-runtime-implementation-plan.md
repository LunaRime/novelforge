# M3：运行时依赖与事件收敛（2026-11-05）

> 执行方式：按 `executing-plans` / `subagent-driven-development` 逐项实施、独立验证。本轮用户已明确要求直接实施 M3。基线为已合并的 `3bb9668`，工作分支为 `codex/m3-runtime-core`。

**目标**：agent 不直接依赖 renderer stores；运行时用四类事实事件表达结果；工具显式声明并发与破坏语义。

**架构**：纯核心定义运行时契约与容器，renderer 在应用组合处提供端口实现。运行时不导入 React、Zustand 或 Electron。现有项目继续使用 DB 与真实 draftId；本轮不启用文件存储切换。

## 现状与实施约束

2026-11-05 源码与边界脚本实测：agent 引用 stores 的生产文件 34 个，`useXStore.getState()` 37 处，core 禁止导入数为 0。34 个文件包括类型依赖，不能仅清理执行语句。

`ToolArtifact` 当前有 13 种类型，同时用于运行结果、归档和 UI 卡片。模型输出的启发式提取并不能证明正文已保存；打开编辑器也不是文档变更。不能机械地把这两类行为转换成写入事件。

- 不改 `vela.db`、`.vela` 回退路径、持久化键、草稿 URI 或用户项目。
- 不把章号作为章节身份，不用 DB draftId 冒充已迁移的文件章节身份。
- 不以整体 store 状态接口冒充依赖注入；端口表达需要的能力。
- 项目切换后，异步结果不得污染新的项目状态。
- 当前归档保留读取能力；旧展示信息只能在归档边界解释，不能伪造新的领域事实。
- 新增可见文本使用现有翻译键或补齐三语。版本号不变。

## 任务 1：注入端口与中立类型

- [x] 将 agent 使用的会话、消息、工作流 DTO 从 store 定义中抽离，store 消费中立类型。
- [x] 定义项目、编辑器、工作流、模型、向量与会话所需的窄端口；core 提供可独立创建的 runtime/container。renderer 端口保留在服务层，避免 core 引用现有 IPC DTO。
- [x] renderer 组合层实现端口，明确初始化位置；agent 模块不反向导入该适配器。
- [x] 移除 `src/services/agent/**` 全部 store 导入，包括动态导入和类型导入。
- [x] 验证独立实例不串项目、缺少端口的失败可诊断、既有上下文构建与工具回归通过。

涉及：`context-builder`、`context-policy`、`ccr-summary`、归档/恢复/子任务类型、工具、项目/编辑器/工作流适配器与应用初始化。

## 任务 2：运行事件与归档边界

- [x] core 定义 `document.changed`、`chapter.draft_written`、`chapter.reviewed`、`workflow.progressed` 四类事件。
- [x] 实际文件提交与工作流回执使用真实资源身份；UI 展示信息与事件语义分开。
- [x] 删除运行时 `ToolArtifact` 定义与生产者，改 engine、子任务和消息结果消费者。
- [x] 移除仅靠输出猜测的写入事件，以及仅打开标签页的变更事件。
- [x] 归档读取时解码旧数据；缺少真实身份的旧卡片仅作静态历史展示。
- [x] 验证工具结果、父子任务汇总、工作流完成/失败回执及历史归档展示。

涉及：`tool-registry`、`agent-engine`、`output-post-processor`、`archive-codec`、`agent-store`、`App.tsx` 与 `ArtifactCard`。

## 任务 3：工具执行语义

- [x] `AgentTool` 增加 `isConcurrencySafe` 与 `isDestructive`；内置与外部工具采用明确默认值。
- [x] 只有只读、并发安全、非破坏且无需确认的工具进入并行批；仍遵守批次上限和结果顺序。
- [x] 破坏性操作串行，并走已有确认流程；错误配置的只读/确认标记不能绕过确认。
- [x] 对覆盖工具声明破坏性；外部工具缺少可靠声明时保守串行。
- [x] 回归并行批、串行屏障、确认拒绝和默认值。

## 任务 4：命名、边界与交付验证

- [x] 内存标识符 `velaAPI`、`VELA_HOME`、`getProjectVelaDir` 分别更名为 `novelforgeAPI`、`NOVELFORGE_HOME`、`getProjectDataDir`，同步 preload 和测试。
- [x] 修复边界脚本的漏计：没有直接 store 导入的 `getState()` 访问同样计数；先红后绿，边界脚本 12 条测试通过。
- [x] 边界基线收紧至全 0，保留门禁防止回升。
- [x] 全量 typecheck、lint、test；core 独立编译、契约与边界检查。
- [x] 生产 Vite 构建与公开控制台审计；构建后核查 package.json。
- [x] 复核最终 diff，更新架构入口与实测记录；未推送时不宣称远程 CI 已验证。

## 验证命令

优先使用 package.json 对应的 pnpm 命令。若本机既有 pnpm 依赖健康检查阻断，使用同一 node_modules 中的实际入口，并记录原始结果：

```sh
node node_modules/typescript/bin/tsc --noEmit --pretty false
node node_modules/typescript/bin/tsc -p tsconfig.core.json
node node_modules/eslint/bin/eslint.js . --ext ts,tsx --max-warnings 0
node node_modules/vitest/vitest.mjs run
node node_modules/vitest/vitest.mjs run src/contracts
node scripts/check-boundaries.mjs
node node_modules/vite/bin/vite.js build
node scripts/check-public-console.mjs
git status --short package.json
```

出口按实际结果核销。独立核心已存在不代表现有 renderer agent 引擎的所有服务都已可独立打包；文件真相切换与 M4 标签身份收尾另行验收。

## 最终实测（2026-11-06）

全量 Vitest 298 文件 / 3,255 测试通过；边界 core=0、agentStoreFiles=0、agentStoreRefs=0。生产 Vite 构建与公开产物审计通过，package.json 无改动。全量 TypeScript、core 独立编译与 ESLint 按上述入口执行。

运行时保留显式安装的默认应用端口，工具工厂可传入独立端口；纯核心容器和调度策略已抽离，现有 renderer agent 服务尚不等于完整可独立打包的引擎。章节事件当前是契约，未从模型文本推断保存成功。既有工具超时采用 Promise.race，不取消底层操作，本轮并发标记不提供超时取消保证。未提交、推送或发布，远程 CI 未验证。
