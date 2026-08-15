# NovelForge 整体框架检查报告

> 检查范围：主进程（main/preload/ipc-handlers/controllers/repositories/LLM/MCP/utils/health-check）、渲染进程（App/main.tsx/stores/services/components/shared）、构建（vite.config/electron-builder）、安全（CSP/sandbox/IPC 白名单）、工程化脚本。
> 规模基线：主进程 ≈7.6k 行（controllers 15 个 3245 / repositories 14 个 2025 / llm 745 / mcp 534 / utils 1022）；渲染进程 ≈50k 行（stores 3651 / services 18719 / components 22629 / shared 4778）。

---

## 一、总体结论

**框架整体健康、分层清晰、防护意识强——属于"中型项目里架构纪律很好的样本"。** 核心评价：

1. **Electron 分层正确**：主进程只做 IO（DB/文件/网络/进程），业务编排（工作流/命令/Agent）放渲染进程 services——避免主进程阻塞 UI 的正确选择；
2. **IPC 设计是本项目最扎实的部分**：preload 前缀白名单（编译时派生类型）+ `ipc-channels.ts` 统一签名 + `ipc-client` 30s 超时/浏览器降级 + 主进程错误归一化；
3. **数据层严谨**：WAL + integrity_check + 损坏自动备份 + `user_version` 幂等迁移（v15）+ 事务合并；
4. **工程化成熟**：verify-contract → tsc → vite → electron-builder → verify-packed-app → organize-release 全链门禁，启动计时/错误落盘/双环境日志俱全。

发现的框架级问题集中在**安全（生产 CSP 缺失）与规范一致性（i18n 漏网）**，另有若干可维护性优化点——详见下文分级。

---

## 二、架构分层（现状）

```
┌─ 渲染进程（sandbox: true, contextIsolation: true, nodeIntegration: false）──┐
│  React 19 + Zustand（17 store）                                               │
│    stores（3651 行）→ 组件状态/持久化                                         │
│    services（18719 行）→ 业务编排：workflows/commands、agent、prompts、audit  │
│    components（22629 行）→ panels/editor/dialogs/settings/ui                  │
│        │ ipc.invoke('db:...') 类型安全                                         │
├─ Preload（白名单 20 前缀 invoke / 3 前缀 event）──────────────────────────────┤
│        │ ipcRenderer.invoke                                                     │
├─ 主进程（Node，CJS）──────────────────────────────────────────────────────────┤
│  controllers（15 个）→ ipcMain.handle 注册 + 错误归一化                        │
│  repositories（14 个）→ better-sqlite3 / LanceDB 数据访问                       │
│  llm / mcp / utils / health-check                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **动态 import 是循环依赖的既定解法**（workflow/archive 多处 `await import()`）——有效且已形成模式；
- **EventBus 解耦**跨模块通知（REFRESH_RESOURCE / WORKFLOW_COMPLETE）——避免 store 直接互相调用；
- **启动链路有计时埋点**（HTML_READY / T0 / 模块加载耗时），LanceDB 懒加载。

---

## 三、问题清单（按优先级）

### 🔴 P0 — 安全

**P0-1 生产环境实际没有 CSP（深度防御缺口）**
- `main.ts` 通过 `session.defaultSession.webRequest.onHeadersReceived` 注入 CSP——该机制只对 **HTTP 响应头**生效；
- 生产模式 `win.loadFile(file://)` 不产生 HTTP 响应头 → **CSP 注入不生效**（注释也承认"此处仅影响 dev 模式"）；
- `index.html` **没有 CSP meta 标签** → 生产环境 `script-src` 无限制。
- 已有防护：sandbox + contextIsolation + nodeIntegration:false + preload 白名单（核心防线在）。但 CSP 是 XSS 的第二道防线，缺失使「渲染进程被注入脚本 → 调用任意 db:/fs: 通道」的风险面放大。
- 修复：`index.html` 加 CSP meta（需处理两处内联脚本——主题检测/启动计时；方案：`'unsafe-inline'` 妥协 或 迁移到外部 chunk + `script-src 'self'` 严格模式；Electron 支持 meta CSP）。

### 🟠 P1 — 规范一致性（i18n）

**P1-1 health-check.ts 8 处硬编码中文未走 t()**
- `'数据库未连接' / '数据库完整' / 'LLM 服务可达'` 等——这些 message 经 `health:check` IPC 直达渲染进程展示，违反「所有用户可见文本必须走 t()」核心约束。
- 修复：8 处替换为 `t()` 键（三语），成本极低。

**P1-2 跨层 i18n 残留风险**
- 已抽查的 controller/repository 均走 t()；建议以「electron 层字符串字面量」为审计目标补一次全量扫描（health-check 是已确认的漏网点，可能还有同类）。

### 🟡 P2 — 可维护性

**P2-1 controller 层 try/catch 样板重复**
- 15 个 controller × 每个 handler 都是 `try { repo.x(); return {success:true} } catch { return {success:false, error} }` 四行样板。
- 建议：提取 `wrapHandler(fn)` 统一包装（约省 40% controller 行数），纯机械重构、低风险。

**P2-2 巨型文件开始出现**
- `SettingsModal.tsx` 51KB / `CharacterEditor.tsx` 37KB / `workflow-utils.ts` 36KB / `finalize-chapter.command.ts` 31KB / `EditorArea.tsx` 32KB。
- 当前仍有清晰分区（可读），但继续增长会到拆分阈值；建议后续按「设置分组组件 / 命令提取纯函数」渐进拆分，不必现在动。

**P2-3 repository 写接口返回风格不统一**
- 部分方法 throw（controller catch），部分静默（mergeFields 无行时不报）——语义可接受，但建议注释/命名约定统一（如 `updateX` throw、`tryX` 返回结果）。

### 🟢 做得扎实、不需要动的部分

| 项 | 说明 |
|----|------|
| IPC 白名单 + 类型派生 | 前缀机制 + as const 联合类型，新增通道编译期约束 |
| 30s IPC 超时 + 浏览器降级 | ipc-client 双保险 |
| 关闭前 dirty 检查 | 主进程 executeJavaScript 查询 `__vela_hasDirtyTabs`（含角色 dirty） |
| 数据库生命周期 | 损坏备份/重建 + WAL checkpoint + 版本降级哨兵 |
| 渲染错误落盘 | installRendererErrorCapture → render-logger |
| 构建门禁链 | verify-contract/verify-packed-app/organize-release 脚本 |
| chunk 分割 | vendor-react / vendor-editor / vendor-ui / vendor |
| 双环境日志 | dev 全量 DEBUG / 发布 INFO，按版本号自动识别 |
| 主进程崩溃兜底 | render-process-gone → 提示 + reload |

---

## 四、建议路线

1. **P0-1（安全，1 天内）**：index.html 补 CSP meta（严格模式优先，内联脚本迁移或 hash 放行）——生产防护补上最后一块；
2. **P1-1（规范，30 分钟）**：health-check 8 处走 t() + 全量扫描 electron 层字符串字面量；
3. **P2（渐进）**：wrapHandler 抽取（可与 1/2 同批）、巨型组件后续按需拆分；
4. 维持现状：分层/白名单/迁移体系/构建链均无需改动。

> 一句话结论：**框架骨架无需重构——当前最值得做的是补生产 CSP（真实安全缺口）与 i18n 漏网清理（规范一致性），其余是渐进式优化。**

---

## 五、修复状态（分点修复记录）

| 编号 | 问题 | 状态 | 落地位置 |
|------|------|------|----------|
| P0-1 | 生产环境无 CSP | ✅ 已修 | `index.html` 加 CSP meta（`script-src 'self'` 严格模式，`%VITE_CSP_SCRIPT%` 按模式替换：dev='unsafe-inline' / 生产='self'）；两个内联脚本外移 `public/theme-init.js`（主题+启动页 i18n）与 `public/startup-timer.js`（启动计时）；`vite.config.ts` 函数式配置注入占位；`main.ts` webRequest CSP 保留（dev 兜底，注释更新）。已用生产构建验证：meta 替换为 `'self'`、外移脚本进入 dist/ |
| P1-1 | health-check 硬编码中文 | ✅ 已修 | 11 处 → `t()`（`health.*` 13 键三语，含磁盘空间/LLM 状态动态文本） |
| P1-2 | electron 层 i18n 漏网 | ✅ 已修 | 全量扫描修复：`mcp-manager` SSE 错误、`browser-controller` 6 处（未启用/端口/连接失败）、`embedding-service` 4 处（进度 step 3 + 双重试错误 1）；新增 `browser.*`/`embedding.*`/`mcp.sseNotImplemented` 键三语 |
| P2-1 | controller try/catch 样板 | ⏳ 未做 | 机械重构面大，按报告建议后续渐进（不阻塞本轮） |
| P2-2 | 巨型文件 | ⏳ 未做 | 有清晰分区，按报告结论暂不拆分 |

> 门禁：typecheck 零错误、lint 零警告、525 测试全过、`vite build` 成功且产物 CSP 验证通过。
