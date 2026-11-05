# M4：草稿元数据与编辑器身份（2026-11-06）

基线：M3 `0c10c82`。用户要求提交后继续下一步。本轮执行 04 §4.1–4.2；§4.3 的旧表冻结以文件存储切换为前提，当前不执行。

## 设计

DB 草稿的真实身份仍为数值 draftId。`DraftMeta` 仅描述数据库元数据，不携带伪造的文件名、路径或冗余标题。需要读取正文时按 id 生成 `draftUri(id)`；URI 是访问投影。

草稿编辑器标签使用 `doc:{draftId}` 作为唯一键，通过 `docId` 保存身份。真实文件标签保留文件路径。定稿的只读语义、修稿 diff、审稿报告各自保留用途，不能因为 id 相同而错误合并。所有同一草稿的打开、刷新、保存和关闭入口必须使用一致身份；脏内容与 inline 接受会话不能被重新打开覆盖。

## 实施与验收

- [x] 删除 DraftMeta.filePath/fileName/chapterTitle，更新 UI、工作流与相关 fixture。
- [x] 增加按需 URI 投影，真实文件路径不变。
- [x] EditorTab 增加 docId，草稿标签键统一为 doc:{draftId}，消除旧路径双键。
- [x] 验证多入口去重、脏内容/inline 状态保护、保存失败、定稿与跨项目隔离。
- [x] core 在无 DOM/Electron 类型环境下独立编译；边界检查保持全 0。
- [x] 全量 TypeScript、ESLint、Vitest、生产构建与公开产物审计，记录实际结果。

## 存储边界

本轮不冻结 drafts、contents 或 draft_snapshots，也不修改 schema、版本号、用户数据、持久化 URI 格式。文件真相切换仍需完整生命周期适配与真实项目副本验收。core 的独立编译不代表 renderer 服务已经可以独立打包。

## 复核补修

M3 的区间工作流启动原先只在整批结束后检测项目变化。现将工作流启动本身纳入注入端口，并在每次派发前核对源项目/session，测试独立实例与区间中切项目。模型输出事件与存储切换边界保持原定义。

M3 提交 `0c10c82` 的远程 CI：Ubuntu、macOS 通过；Windows 在 AgentConversation 首次异步记忆加载测试超过 5 秒。仅该集成用例调整为 15 秒，未放宽全局测试超时；后续提交须重新核对三平台。

独立复核还发现 inline 动作不能仅按 URI 找标签：diff 与正文可能共享 locator。本轮由 DraftEditor 传显式 tabId，回退查找优先正文标签，补齐项目切换中断回归。未将既有 SidebarShared 延迟打开入口宣传为全面项目隔离。

## 本地最终验证

2026-11-06：298 个 Vitest 文件、3,264 条测试通过；全量 TypeScript、ESLint（0 warnings）、core 独立编译通过。生产 Vite 构建、公开产物审计与边界门禁通过，package.json 无改动。外部生产模块统一从 core 公共入口导入，新增门禁测试先红后绿。
