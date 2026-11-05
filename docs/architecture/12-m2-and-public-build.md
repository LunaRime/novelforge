# M2 合流与公开构建隔离（2026-11-05）

## 本轮交付

UI、agent 与意图入口发送类型化的 `startWorkflow` 请求。核心负责校验和分派，renderer 适配器负责项目状态、工作流构建、启动回执与完成回调。自定义提示、审稿维度、步进模式和 checkpoint 参数保留。

原项目仍使用 DB；本轮没有自动迁移用户项目、冻结旧表或改变版本号。`draftId` 仍是真实数据库身份，没有用章号或虚构的新 id 代替它。`chapterDir/getDraftDir/getDraftPath` 已从生产代码移除。

正文更新的两个既有 IPC 通道现在共用核心提交用例与 DB 适配器。agent 编辑前快照与 CAS 在同一事务中，后置 CAS 拒绝会回滚快照。缺库、缺草稿、提交失败不再返回成功。UI 合并不会覆盖已有脏标签或等待期间的新输入；项目 session 在 create/open/close 时递增，异步读写、模型返回和配置撤销会检查源项目。

通用写入和编辑工具禁止改写草稿 URI 与 `chapters/`。主进程对项目内写路径检查链接祖先，并在写入队列中和 rename 前复查，防止 junction/symlink 绕过词法路径限制。

## 开发者控制台不进入公开产物

`__DEV_CONSOLE__` 由构建配置注入 renderer、主进程与 preload：只有开发服务器或编号式 alpha 版本开启。beta/release 即使使用 development mode、环境变量、CLI 参数或旧配置，也不能重新启用已经裁掉的控制台。

- UI 面板通过编译期条件懒加载；命令、启动 query、全局打开 hook 与设置中的控制台区块同步受控。
- SQL 检查、性能快照、IPC 指标和隔离实例控制器独立加载；公开构建移除对应实现。外部 API 和浏览器接入仍是原有产品功能，保持可用。
- 构建插件检查实际输出模块，公开产物包含调试实现时直接失败。
- 构建后审计同时拦截旧 alpha 遗留 chunk；直接运行 electron-builder 的 beforePack 也执行审计。
- 两个 `dev-instance` CLI 脚本仅在 alpha 中加入文件列表并解包；beta/release 排除。

验证入口：`node scripts/check-public-console.mjs`。`scripts/build.cjs` 已在 Vite 构建之后自动调用；不需要打安装包才能先验证模块裁剪。当前没有生成或发布新安装包。

## GitHub 议题

### [#41 UI in CN](https://github.com/LunaRime/novelforge/issues/41)

已读取原截图。架构文档编辑器的保存按钮正文硬编码中文，而 tooltip 已翻译。按钮改用已有 `action.save`。真实组件触发 dirty 状态后检查中、英、俄三语可见按钮和 tooltip；英文、俄文用例先失败后通过。

### [#42 Thinking content exported](https://github.com/LunaRime/novelforge/issues/42)

已读取原截图并结合用户澄清定位：Plot Outline 文档存入了模型思考，思考还引述了中文结构提示。

OpenAI 兼容 provider 原先用字面的 `thinking/response` 将 reasoning 拼进最终结果，标签清理无法识别；Gemini 原先没有过滤 `thought`，也只取第一个 part。现在流式展示仍保留标准 `<think>` 区块，但落库只取最终答案；仅返回推理或空最终答案会报错，不覆盖文档。reasoning 后直接返回工具调用时，先结束思考块再展示工具内容。

同时将六类内置故事结构指导和 POV 标签迁入三语字典，按 locale 注入，并保留输出语言约束。不会删除用户自写内容或中文人名。

回归覆盖 OpenAI/Gemini 的流式和非流式、多 part、reasoning-only、工具调用边界，以及 SSE 格式回放 → 实际 provider → BaseWorkflowCommand → Plot Outline 命令 → 保存 IPC 边界。测试断言发往 DB 的正文与无最终答案时禁止写入；没有调用真实远程模型或写入用户数据库。原始思考仍可供 UI 展示，最终正文保留合法中文人名。

议题回复与关闭按用户后续的提交指令执行，必须区分“分支已修复”和“安装包已发布”。真实项目副本验收与存储切换继续按 09–11 的边界执行。

## 最终验证

2026-11-05，本机 Node v24.22.2：

- 全量 Vitest：295 个文件，3,240 条测试通过。
- 全量 TypeScript、ESLint（0 warnings）、core 独立检查通过。
- 边界检查：core=0；agent 引用 stores 的文件数=34，getState 调用=37，基线由 47 收紧为 37。
- 实际 beta 生产 Vite 构建、公开产物审计和构建契约通过；beta 的 development mode 构建也经过裁剪验证。release/alpha 的策略与 CLI 文件清单由矩阵测试覆盖，没有临时修改 package.json 的版本号。
- package.json 与本轮开始前一致；验证过程未生成安装包或发布。推送后的远程 CI 需另行核对本分支提交，不以旧远程绿色 run 冒充。

本机 pnpm 的依赖健康检查问题仍存在，验证直接使用 node_modules 内的 tsc、ESLint、Vitest 和 Vite 入口，未重装依赖或改 lockfile。
