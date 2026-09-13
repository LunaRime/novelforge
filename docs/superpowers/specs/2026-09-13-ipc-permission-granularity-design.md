# L4 IPC 权限粒度细化设计

> **For agentic workers:** 本设计供 subagent-driven-development / executing-plans 实现。
> **Status:** 设计草案 **v3**（2026-09-13）。v1→v2 修 9 处（§0）；**v2→v3 并入独立安全评审 + 独立可行性评审的发现（§0.2），其中 2 个 blocker 改变了本档的优先级排序**。
> **范围归属:** 档 3 L4（CC 计划 `docs/superpowers/plans/2026-08-29-cc-remaining-implementation.md` Task L4「IPC 权限粒度细化（§五.4，安全敏感）」）
> **基线:** master @ `1754259`

---

## 0. 评审记录（v1 → v2 修订）

v1 写完未经独立核对就当作依据，复核后发现 **9 处问题**，其中 5 处会直接导致实施出错。逐条修订：

| # | v1 的说法 | 复核结果（证据） | v2 修订 |
|---|---|---|---|
| 1 | 「200 处 `ipcMain.handle` 散布 **17 个 controller**」 | 实为 **19 个文件**：17 个 controller + `electron/mcp/mcp-ipc-bridge.ts`（**11 个 `mcp:` 通道**）+ `electron/controllers/health-check.ts`（2 个）。且注册有**两个入口**：`ipc-handlers.ts:28 registerIPCHandlers()` 与 `main.ts:276 registerMCPHandlers()` | §4.1 收口必须覆盖**两个入口**；策略表覆盖 19 个文件 |
| 2 | 「策略表键集合 === `ipc-channels.ts` 通道集合」 | 实际 200 注册 vs 201 声明，其中 **5 个是事件通道**；**4 个通道注册了但零声明**（`health:check`/`health:check-llm` @ `health-check.ts:111,129`；`embedding:clear-dedup`/`embedding:dedup-stats` @ `embedding-controller.ts:153,158`） | 断言改为「策略表键集合 === **已注册 invoke 通道集合**」；并要求补全 4 处声明（§5.3） |
| 3 | 未提事件通道 | 主→渲染事件共 5 个：`llm:stream-chunk/done/error`、`update:download-progress`、`update:status-changed`（`webContents.send`） | 事件通道**不进策略表**，单独保留 preload 的 event 白名单（§4.1） |
| 4 | P1「当前项目根」直接可用 | `getCurrentProjectPath()` 是 `kb-controller.ts:35` 的**局部函数**，非共享模块 | 新增 §4.3(e)：先建共享 active-project 模块 |
| 5 | P1 授权改用**一次性 nonce** | **过度设计**：`dialog:select-folder`（`project-controller.ts:285`）与 `dialog:save-file`（`:299`）**已经在主进程内登记授权**。缺这条的只有 4 个对话框（`kb-controller.ts:215,226`、`import-controller.ts:272`、`skill-controller.ts:93`） | 删掉 nonce 方案，改为「把既有 1 行模式补到缺失的 4 处，然后**删除** `fs:grant-external-file`」（§4.3(d)） |
| 6 | 未评估测试破坏面 | 全仓仅 **4 处** `ipcMain` 引用（`import-controller.test.ts`、`memory-controller.test.ts` 各 2） | §6 据此下调 P0 风险；§7 顺序不变 |
| 7 | 未点名 `dev:invoke` | `dev-controller.ts`：对已配置 baseUrl 发**任意 path/method** 的 HTTP——通用出网桥 | §4.6 列为「非 dev 构建不注册」的首要对象 |
| 8 | 「业务 handler 签名不变」只是暗示 | 未写清实施机制 | §4.1 明确：`guardedHandle` **保持 `(event, ...args)` 签名** → P0 是**纯改名**（handler 函数体零改动）；路径校验按策略表 `pathArgs` 集中在 guard 内做 |
| 9 | 未发现 `skill-controller.ts` 的 i18n 残留 | `skill-controller.ts:97,98` 硬编码中文对话框标题/过滤器名 | 记入 §8 顺带修复项（非 L4 主范围） |

> 说明：本档引用的行号均为 2026-09-13 于 `1754259` 实测。**P0 的第一步是重新生成这些清单**（§5），不要直接信任本档行号。

### 0.2 独立评审补充（v2 → v3）——**改变了优先级排序**

两位独立评审（安全 / 可行性）在 v2 后给出如下发现，均已**由我逐条复核证据属实**。

**A. 两个 blocker：破坏点根本不在 `fs:` 通道上**（v2 的着力点选错了）

| # | 通道 | 问题 | 证据 |
|---|---|---|---|
| B1 | **`project:delete-folder`** | **`fs.rmSync(projectPath, {recursive:true, force:true})`，入参直接来自渲染层，无任何沙箱/项目校验**（只查 `existsSync` + `isDirectory`）→ 可递归删除用户任意目录 | `project-controller.ts:247-266`；调用点 `src/stores/project-store.ts:247` |
| B2 | **`export:export-chapters`** | `params.outputPath` 来自渲染层 → `path.join(outputPath, safeProjectName)` → `mkdir` + `writeFile` / `zip.writeToFile`，**全程无 `validateSandbox`**；只有 `export:select-output-dir` 才 `grantDirectory` | `export-controller.ts:217-223`、`:257-265`、`:272-282` |

> 含义：**先建策略表并把这些通道登记为 `destructive` + `pathArgs`，优先级高于 fs 白名单**。只做 fs 收紧而放过这两条，等于门锁好了却把墙留着。

**B. 一条与路径无关的高危项：官方 API Key 明文出主进程**

`llm:list-models`（`llm-controller.ts:203`）直接返回 `loadModelConfigs()`，而该函数在 `:34` 做 `{...m, apiKey: decryptApiKey(m.apiKey)}` ——**解密后的明文**；`embedding:list-llm-candidates`（`embedding-controller.ts:210-214`）同样（`ModelProfile.apiKey` 见 `ipc-channels.ts:450-461`）。
→ 主帧 XSS **不需要任何 fs 通道**就能拿到用户的全部模型 Key。**v2 §9-2「把 config.json 关进主进程」对此基本无效**，必须单独修（list 类通道脱敏 / 明文 Key 不出主进程）。

**C. 其它高危 / 中危**

| # | 问题 | 证据 |
|---|---|---|
| H1 | `mcp:connect` 接受渲染层 `config` → `spawn(command,args,{env:{...process.env,...env}})`；`mcp:add-server` 落盘持久化 → **任意代码执行**，绕过整个 fs 白名单。v2 标了 `spawn` 但把「授权上下文」推到 P2 且未定义 | `mcp-ipc-bridge.ts:56-63,106-123`；`mcp-manager.ts:225-233` |
| H2 | `project:create` / `project:open` / `project:get-summary` 用渲染层入参拼路径 → 任意目录建库/开库 | `project-controller.ts:49-61,105-113,304-319` |
| H3 | `dev:test` 接受渲染层 `override.apiBaseUrl` 并 GET，未纳入 dev-only → 主进程侧任意 URL 探测 | `dev-controller.ts:112-116,48-51` |
| M1 | **`os.tmpdir()` 白名单根没有生产调用点**（全仓 `os.tmpdir` 仅在 6 个测试文件里）→ v2 §4.3(a) 标注的「截图/工作流临时」与证据不符，**应删该根**（纯增攻击面） | `vector-store.test.ts:138` 等；生产截图走 `dialog:save-file`→`grantDirectory` |
| M2 | `~/.vela` 遗留根被产品逻辑依赖（`readJsonFile` 回退、uninstall 双删）；`src/stores/project-store.ts:162` 硬编码写 **`/tmp/vela_error.log`**（Windows 上落到当前盘 `\tmp\`）→ 白名单生效后怎么处置未写 | `config-utils.ts:142-147`；`update-controller.ts:136-137`；`project-store.ts:162` |
| M3 | **v2 §4.1「只换函数名、其余不动」与 P1 自相矛盾**：`fs-controller.ts` 内仍有 **10 处**显式调用旧 `validateSandbox`（`:188/287/303/319/327/337/345/357/369`），其根仍是 `SANDBOX_ROOTS=[VELA_HOME, homedir()]` → 不重定向它就是「新守卫有白名单、旧守卫继续放行主目录」 | `fs-controller.ts:16,131-152` |
| M4 | `db:get-daily-activity` 路径参数在**第 2/3 位**（`[days?, projectPath?, currentProjectPath?]`）→ `pathArgs` 必须支持**多索引/按名**声明，否则漏检 | `ipc-channels.ts:576`；`db-controller.ts:538-540`；`activity-repository.ts:48-51,92-97` |

**D. 可行性评审对 v2 机制描述的 4 处修正**（§4.1 已据此改写）

- **不是「纯改名」**：首参普查 `_event` 112 / 无参 58 / `_e` 16 / **活 `event` 4**。用活 event 的 4 处必须拿到原始 event：`import-controller.ts:272→273`、`llm-controller.ts:129→136`、`skill-controller.ts:93→94`（`BrowserWindow.fromWebContents(event.sender)`）+ `import-controller.ts:313/318/365/370`（`event.sender.send('import:progress')`）。
- **「注册即抛错」是最危险的失败模式**：`registerIPCHandlers()` 全库仅 `main.ts:275` 调用、**0 测试覆盖** → 漏登记 = 应用启动即死而 CI 全绿。必须降级。
- **preload 构建约束**：`vite.config.ts:47-63` 的 preload 块**没有** `rollupOptions.external`（main 块 `:38` 有）→ preload import 什么就被打进 `preload.cjs`。故策略表**必须放 `src/shared/` 且零 import 纯字面量**（v2 已选对位置，但没写清这个约束的原因）。
- **事件方向已有反向漂移（现存 bug）**：`ALLOWED_EVENT_CHANNELS = ['llm:','update:','menu:']` 不含 `import:`，而 `import-controller.ts:313` 确实 `send('import:progress')` → 渲染层订阅会被 `checkChannel` 抛错，是一条**静默死通道**；另有 `menu:check-update`（`main.ts:63,79`）绕开类型化 `ipc.on` 走裸 `api.on`。

**E. 另外两处事件通道两边都没声明**：`import:progress`（`import-controller.ts:313,318,365,370`）、`menu:check-update`（`main.ts:63,79`）。加上 §5.1 的 4 条 invoke 缺口，**共 6 条声明要在 S1 补齐**。

**F. 缺口 A 的调用点清单漏了主链路**：除 `audit-context.ts:80` 外，真实还有 `src/components/panels/agent/FilePickerMenu.tsx:49`（`:46` 先 `dialog:select-files`、`:49` 再把 `paths[0]` 报回）——正是「Agent 添加外部文件」链路。`grantDirectory` 全库仅 3 处（`project-controller.ts:285,299`、`export-controller.ts:308`）。

---

## 1. 背景与现状

### 1.1 实测事实

| 事实 | 证据 |
|---|---|
| 主进程 `ipcMain.handle` **200 处**，分布 **19 个文件** | 逐文件：`db-controller` 73 / `fs-controller` 19 / `embedding-controller` 16 / `llm-controller` 15 / `kb-controller` 13 / **`mcp/mcp-ipc-bridge` 11** / `project-controller` 10 / `config-controller` 9 / `update-controller` 8 / `memory-controller` 5 / `skill-controller` 4 / `templates-controller` 4 / `dev-controller` 2 / **`health-check` 2** / `import-controller` 2 / `styles-controller` 2 / `export-controller` 2 / `browser-controller` 2 / `report-controller` 1 |
| **两个注册入口**（并列，互不覆盖） | `electron/ipc-handlers.ts:28 registerIPCHandlers()`；`electron/main.ts:276 registerMCPHandlers()`（定义在 `electron/mcp/mcp-ipc-bridge.ts:44`） |
| **无 `ipcMain.on`**（全部请求/响应式） | `grep -c 'ipcMain.on('` = 0 |
| preload 白名单为**前缀式**：22 个 invoke 前缀 + 3 个 event 前缀 | `electron/preload.ts:11-34`；`startsWith(prefix)` 校验 `:49-53` |
| 前缀=整族授权：`db:` 一个前缀放行 **73** 个通道 | 通道统计见上 |
| 渲染进程已是最严 | `main.ts:152-154`：`nodeIntegration:false`/`contextIsolation:true`/`sandbox:true`；CSP `:163-181` |
| **只有 2 个 `BrowserWindow`，只 1 个能 invoke** | `main.ts:138`（主窗，带 preload）；`report-controller.ts:16-21`（离屏截图窗，`data:` URL，**无 preload** → 结构上无法 invoke） |
| dev 走 `VITE_DEV_SERVER_URL`，生产走 `file://{RENDERER_DIST}/index.html` | `main.ts:233-239` |
| fs 沙箱根 = `~/.novelforge` + **整个用户主目录** | `fs-controller.ts:16 SANDBOX_ROOTS = [VELA_HOME, os.homedir()]` |
| 之上只有**黑名单**兜底 | `fs-controller.ts:95-106 BLOCKED_PATHS`：`.ssh/.gnupg/.aws/.docker/AppData/Roaming/AppData/Local/Windows` + `/etc,/sys,/proc,/dev` |
| 授权集为进程内会话级 | `grantedDirs` `fs-controller.ts:113` + `grantDirectory()` `:116`；`grantedExternalFiles` `:84` |
| 目录授权**已由主进程对话框签发** | `project-controller.ts:285`（select-folder）、`:299`（save-file）、`export-controller.ts:308` |
| ⚠️ 但**外部文件授权通道可被渲染层自行调用** | `fs-controller.ts:273`：`grantedExternalFiles.add(path.resolve(filePath))`——入参即真相 |

### 1.2 四个真实缺口

**A — 文件权限实质是「整个用户主目录」，且授权可自我签发。** `SANDBOX_ROOTS` 含 `os.homedir()`，主目录下任意路径放行（除黑名单 7 处）；`fs:grant-external-file` 可对任意路径登记，`fs:read-external-file` 随后按「1MB + 可读扩展名」读取。黑名单是网不是墙：`~/.kube`、`~/.npmrc`、`~/.config`、`~/.local`、`~/.vscode`、`AppData/LocalLow` 都不在其中。

**B — 前缀白名单把「通道存在」等同于「有权限」。** preload 的 `startsWith` 决定的是「能不能发出这个通道」，不是「这次调用该不该被允许」。`db:` 一放就是 73 个，含删除/覆盖式写入；`fs:` 一放 19 个，含 `fs:delete-file`。新增通道只要前缀在列就自动获得整族权限——**默认放行**。

**C — 没有来源校验，且新增窗口会静默获得全部权限。** 全仓 `event.senderFrame` **0 命中**。今天能 invoke 的只有主窗一个 webContents，现状侥幸安全；但结构是默认放行，任何未来带 preload 的新窗口都自动拿到全部 200 个通道。

**D — 通道类型声明与实际注册已经漂移。** 4 个通道有实现无声明（§0 #2），且 `ipc-channels.ts` 混装 invoke 与事件通道——这让「权限清单」无法用类型系统兜住，只能靠人工记忆。这既是本次要修的，也是策略表能否落地的**前提**。

---

## 2. 目标 / 非目标

### 2.1 目标

1. **默认拒绝**：权限由「前缀是否存在」变为「策略表是否登记；未登记 = 注册期抛错」。
2. **收口覆盖两个入口**（含 `registerMCPHandlers`），不留平行注册路径。
3. **文件权限从「主目录白名单」改为显式白名单**：`VELA_HOME` + 当前项目根 + 对话框授权目录/文件，其余拒绝。
4. **授权只能由主进程签发**：删除可被渲染层自行调用的 `fs:grant-external-file`。
5. **读写删意图分级**。
6. **来源校验**：只接受应用自己的 top frame + 已知 webContents + 己方 URL。
7. **通道清单可核对**：补全 4 处缺失声明；策略表与注册集合有双向断言测试。

### 2.2 非目标

- 不引入沙箱新机制（不改 utility process、不拆 preload 之外的新进程）。
- 不做加密/签名/杀软对抗。
- **不重写 73 个 `db:` 通道名**（理由 §4.5）。
- 不改渲染层业务逻辑（除 §4.3(d) 的授权链路外，调用方无需改动）。
- 不改事件通道机制（§0 #3）。

---

## 3. 威胁模型（**先说清防得住什么**）

| 攻击路径 | L4 是否防住 | 说明 |
|---|---|---|
| **A. 其它 webContents / iframe / webview 调 IPC** | ✅ | 来源校验 + 默认拒绝。今天无此路径，属**防未来** |
| **B. 渲染层 XSS / 供应链在**主帧**执行** | ⚠️ **不能完全防住** | 主帧就是合法来源，它调用任何**已登记**通道都会通过来源校验。L4 对这条的作用是**收窄爆炸半径**：从「一次 XSS = 整个主目录读写 + 全部 200 通道」变为「项目目录 + 显式授权目录 + 按权限类分级的通道」 |
| **C. Agent 工具链被提示注入** | ✅ 显著收窄 | 工具走 `fs:` 通道；删掉自签发授权后，LLM 无法再靠自报路径越出项目 |
| **D. 恶意项目文件 / 导入内容** | ✅ 部分 | 路径白名单把可触达范围限制在项目内 |
| **E. 本地其它进程伪装 / OS 级对抗** | ❌ 不在本档 | 另立专项（可考虑 keychain 存 Key） |

> **一句话**：L4 的价值是**把默认从「放行」翻成「拒绝」并收窄半径**，不是「让 XSS 无法作恶」。任何把 L4 说成后者的表述都不准确（`event.senderFrame` 挡不住主帧 XSS）。

---

## 4. 设计

### 4.1 收口：策略表 + `guardedHandle`（覆盖两个注册入口）

现状 200 处裸 `ipcMain.handle`，两个入口，没有统一处。**先立收口，再谈粒度。**

```
src/shared/ipc-policy.ts      # 唯一真源：通道 → { authority, pathArgs? }。放 shared
                              #   —— 主进程与 preload 都要用，放 electron/ 会让 preload 反向依赖主进程代码
electron/security/ipc-guard.ts # guardedHandle / assertSenderTrusted（主进程侧强制）
electron/security/grants.ts    # 主进程签发的授权集（目录/文件/意图）+ assertPathAllowed
```

**关键：`guardedHandle` 保持与 `ipcMain.handle` 完全相同的回调签名。**

```ts
export function guardedHandle(
  channel: IpcInvokeChannel,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown,
): void {
  const policy = IPC_CHANNEL_POLICY[channel]
  if (!policy) throw new Error(`[ipc-guard] 未登记策略的通道: ${channel}`)  // 注册期即失败
  ipcMain.handle(channel, (event, ...args) => {
    assertSenderTrusted(event)                 // §4.4
    assertPathArgs(channel, policy, args)      // §4.3，按 pathArgs 声明逐个校验
    return handler(event, ...args)
  })
}
```

**由此得到的实施性质（§0 #8）**：P0 是**纯改名**——200 处 `ipcMain.handle(` → `guardedHandle(`，**handler 函数体一行不动**，路径校验集中在 guard。这让 P0 的风险面被压到最小，也让它可以独立回归。

**为什么用数据表而不是 200 个守卫函数**：表可整体审阅、可 diff、可测试；散落的 200 个 if 不行。

**契约（写成测试）**：
- 策略表键集合 **=== 已注册 invoke 通道集合**（双向，见 §6）。
- preload 的 invoke 前缀**由策略表派生**（消除两处白名单漂移）；事件前缀（`llm:`/`update:`/`menu:`）保持独立常量。
- **两个入口都必须改用 `guardedHandle`**；`electron/ipc-handlers.ts` 增加一条「注册后自检」：断言两个入口注册的通道总数与策略表一致（防未来有人重新用裸 `ipcMain.handle` 绕开）。

### 4.2 权限分类（`authority`）

| authority | 含义 | 例 |
|---|---|---|
| `read-project` | 只读当前项目 | `kb:search`、`db:draft-list` |
| `write-project` | 改当前项目 | `db:revision-create`、`fs:write-file`（项目内） |
| `read-global` | 读全局配置/用户数据 | `config:get`、`log:*` |
| `write-global` | 改全局配置（含 API Key） | `config:set` |
| `destructive` | 不可逆/覆盖面大 | `db:*delete*`、`fs:delete-file`、`uninstall:clean-user-data` |
| `spawn` | 起子进程 | `mcp:*`（`mcp-manager.ts:13,230` spawn）、`update:*` |
| `network-secret` | 携带 API Key 出网 | `llm:*`、`embedding:*` |
| `dev-only` | 仅开发/桥接 | `dev:invoke`、`browser:*` |

`destructive` / `spawn` 在 P2 起要求显式授权上下文（§7）。

### 4.3 文件权限

**(a) 白名单根（默认拒绝）**

| 根 | 读 | 写/删 | 来源 |
|---|---|---|---|
| `VELA_HOME`（`~/.novelforge`） | ✅ | ✅（子目录分层，见 (b)） | 常量 |
| 当前项目根 | ✅ | ✅ | **主进程在打开/切换项目时登记** |
| 对话框选中的目录 | ✅ | ✅ | 主进程对话框处理器 |
| 对话框选中的单个文件 | ✅ | ✅ | 同上 |
| `os.tmpdir()` 己方子目录 | ✅ | ✅ | 常量 |
| 其它 | ❌ | ❌ | 默认 |

**(b) `VELA_HOME` 内部分层**：`config.json`（含 API Key）**只允许主进程内部读写，不经 `fs:` 通道**；`agent-archive/`、`agent-results/`、`workflow-output/` 走各自专用通道，**不接受任意路径入参**（现有实现已用 sha1 / `RUN_ID_RE` 白名单正则，统一到 `assertPathAllowed`）。

**(c) 意图分级**：`assertPathAllowed(p, 'read'|'write'|'delete')`——读授权 ≠ 写授权；`fs:delete-file` 一律要 `delete` 意图。

**(d) 授权只能由主进程签发（修缺口 A）—— 本档最高价值项**

v1 设计了一次性 nonce；复核后**否决**，因为代码里已有正确范式：

- `dialog:select-folder`（`project-controller.ts:285`）与 `dialog:save-file`（`:299`）**已经在对话框处理器内部**调用 `grantDirectory(...)`——路径来自主进程自己弹的框，渲染层无法伪造。
- 缺这条的只有 4 处：`dialog:select-files`（`kb-controller.ts:215`）、`dialog:select-import-folder`（`kb-controller.ts:226`）、`dialog:select-novel-files`（`import-controller.ts:272`）、`dialog:select-skill-file`（`skill-controller.ts:93`）。
- **修法**：这 4 处在返回路径前登记授权（目录授目录、文件授文件）；然后 **删除 `fs:grant-external-file` 通道**（`fs-controller.ts:273`）及其调用点（`src/services/audit/audit-context.ts:80` 改为依赖项目根白名单）。
- 为什么不保留 nonce：对话框结果本来就在主进程手里，nonce 只是把「主进程已知道的路径」再绕一圈回传，多一个可重放的东西。**能用「删掉通道」解决，就不要引入新协议。**

**(e) 当前项目根的单一真源（§0 #4）**：`getCurrentProjectPath()` 现为 `kb-controller.ts:35` 的局部函数。P1 先建 `electron/utils/active-project.ts`（`setActiveProject(p)` / `getActiveProject()` / `subscribe`），由项目打开/关闭路径调用，供 `assertPathAllowed` 与既有 `kb-controller`、`project-controller` 共用。

**(f) 黑名单降级为纵深防御**：边界由白名单承担；`BLOCKED_PATHS` 保留为第二道，并补 `.kube/.npmrc/.git-credentials/.config/.local/.vscode/AppData/LocalLow`。

### 4.4 来源校验（诚实定位）

只认应用自己的帧：`event.senderFrame` 必须是 **top frame**（无 parent）+ `webContents.id` 在己方白名单 + URL 命中：
- 生产：`file://` 且指向 `RENDERER_DIST/index.html`
- 开发：`VITE_DEV_SERVER_URL` 的 origin（仅 dev 构建放开）

今天只有 1 个可 invoke 的 webContents（离屏截图窗无 preload），所以这条**不是修既有漏洞，而是把「默认放行」改成「默认拒绝」**。

**刻意不做 sender 分级抽象**：一个适配器不构成接缝。等真有第二个带 preload 的窗口时再加策略层（§8 记录）。

### 4.5 `db:` 粒度：策略表优先，不改名

计划原文允许「分组前缀**或**通道级校验」。选**通道级校验（策略表）不改名**：

| 方案 | 成本 | 收益 |
|---|---|---|
| 策略表（不动通道名） | 中：200 条登记 + 收口替换 | 默认拒绝 + 分类 + 可测；渲染层调用点零改动 |
| 改名细粒度前缀 | 高：`ipc-channels.ts` + preload + 全部调用点 + 测试；**改动本身即新破坏面** | 前缀语义更清晰，但安全性不高于策略表 |

改名列为可选阶段 3，仅在确有收益（如第三方插件只拿 `db:character:*`）时做。

### 4.6 开发者模式桥接（**S6 修正：原「按构建类型门控」方案被否决**）

⚠️ **安全评审建议「`dev:*` 一律「非 dev 构建不注册」，本档经复核后否决该建议** —— 理由是它会把一个**已发布的用户功能**删掉：

| 证据 | 内容 |
|---|---|
| 设置项 | `settings.developer`「开发者选项」/ `settings.developerDesc`「接入外部程序 API（如浏览器），AI 工具可调用」（`locale-data.ts:684-685`） |
| 发布记录 | CHANGELOG 0.1.5 与 0.1.5-beta.2 均列为正式功能（「开发者模式（外部 API 接入 + 浏览器 CDP 桥接）」） |
| 命名歧义 | `dev:` 前缀指**开发者选项**，不是「development build」；按构建类型门控会误删功能 |
| 覆盖参数非提权 | `dev:test` 的 `apiBaseUrl` 覆盖**不构成新的能力**：渲染层本就能用 `config:set`（`config-controller.ts:50`）改同一个 `devMode.apiBaseUrl`，再走 `dev:invoke`。两者能力等价 |

**保留的真实风险（如实登记，不掩饰）**：开发者模式让主进程成为「对用户配置端点发 HTTP 的客户端」，这是该功能的本意（`dev-controller.ts:1-13` 的模块头明确写了「SSRF 面收窄到配置的单一端点」），且需用户显式启用。**缓解措施**：`path` 只接受相对路径、拒绝绝对 URL/协议注入（`dev-controller.ts:59-60`）、method 白名单、响应 1MB 截断、超时。

**因此本档对该类的处理**：
- 权限类由 `dev-only` **更名为 `dev-bridge`**，语义是「用户启用的桥接能力」，**不按构建类型门控**；
- `browser:*` 保持仅回环 `127.0.0.1` + 端口校验（`browser-controller.ts:40-47`）；
- 若未来要收窄，正确的方向是**给该功能加显式授权上下文**（S10 的 `destructive`/`spawn` 同类机制），而不是删除它。

---

## 5. Step 0：破坏面评估（实现的第 0 步，产出即清单）

**已完成（2026-09-13 实测）**，实施时用同样方法**重新生成**，不要信任本文行号：

1. **枚举**：19 个文件的 200 处 `ipcMain.handle` → `(channel, file:line, handler)`。
   ⚠️ 注意**多行写法**（如 `embedding-controller.ts:79,102` 的 `ipcMain.handle(\n  'embedding:compare',`）——行级正则漏过，必须用跨行匹配或人工核对。
2. **分类**：按 §4.2 打 `authority`；不确定一律往更严的一类登记。
3. **路径参数**：标出每个通道哪些入参是路径（`pathArgs` + intent）。重点核对只读通道里接受任意路径的：`fs:read-file`/`fs:read-external-file`/`fs:list-dir`/`fs:check-exists`/`fs:read-json`。
4. **核对真实调用点**：渲染层每个 `ipc.invoke('fs:...')` 的入参从哪来（对话框？项目内？用户输入？）——**本档最大未知**，见 §8。
5. **补全声明**（§5.3）。

### 5.1 通道清单实况（2026-09-13 实测）

| 集合 | 数量 |
|---|---|
| 注册的 invoke 通道 | **200** |
| `ipc-channels.ts` 声明的键 | **201**（含 5 个事件通道 → 196 个 invoke 声明） |
| preload invoke 前缀 | 22（+3 event 前缀 = 25） |
| **注册但未声明** | **4**：`health:check`、`health:check-llm`、`embedding:clear-dedup`、`embedding:dedup-stats` |
| **声明但非 invoke（事件）** | **5**：`llm:stream-chunk/done/error`、`update:download-progress`、`update:status-changed` |

恒等式：196（声明 invoke）+ 4（未声明注册）= **200** ✔

### 5.2 已知高风险清单（P0/P1 优先）

| 通道 | 风险 |
|---|---|
| `fs:grant-external-file` | 可自我签发（缺口 A）——**删除** |
| `fs:read-file` / `fs:write-file` / `fs:delete-file` | 主目录全通 |
| `fs:read-external-file` | 依赖自签发的授权 |
| `db:` 中一切 delete/overwrite | 73 通道同把钥匙 |
| `uninstall:clean-user-data` | 不可逆 |
| `mcp:*`（11） | spawn 子进程，连接即执行 |
| `llm:*` / `config:` | API Key 读取与出网 |
| `dev:invoke` | 通用出网桥 |

### 5.3 必须补的声明（P0 一并做）

`src/shared/ipc-channels.ts` 补 `HealthChannels`（2 条）+ `EmbeddingChannels` 的 `clear-dedup`/`dedup-stats`（2 条），并把 invoke/event 集合在类型层分开（事件通道单列 `EventChannels`），使策略表键类型与 invoke 集合一致。

---

## 6. 测试策略

| # | 测试 | 可行性 |
|---|---|---|
| 1 | **策略表完整性**：策略表键集合 === 注册的 invoke 通道集合（双向）。实现方式：导出「注册登记表」（`guardedHandle` 每次调用时记录 channel），在测试里与 `IPC_CHANNEL_POLICY` 比对 | ✅ 可写（`vi.mock('electron')` 打桩后调 `registerIPCHandlers()` + `registerMCPHandlers()`） |
| 2 | **默认拒绝**：未登记通道调 `guardedHandle` → 抛错（注册期） | ✅ 纯单测 |
| 3 | **路径白名单**：五形态（项目内 / `VELA_HOME` 内 / 授权目录内 / 主目录其它 / 白名单外）× 三意图（读/写/删）交叉断言 | ✅ 纯单测（`grants.ts` 不 import electron 即可纯测——**设计上把纯逻辑与 electron 依赖分开**） |
| 4 | **授权不可自签发**：`fs:grant-external-file` 已不存在（断言通道不在策略表）；走对话框链路后 `assertPathAllowed` 放行 | ✅ 单测 + 集成 |
| 5 | **来源校验**：伪造 sender（非 top frame / 未知 webContents / 错误 URL）→ 拒绝；dev 与生产 URL 各测 | ✅ 构造假 event 对象纯测（`assertSenderTrusted(event, ctx)` 接受注入的窗口注册表） |
| 6 | **既有链路回归**：见下清单 | ⚠️ 部分需真机 |

**回归不许断清单**（P1 后必须逐一验证；括号内为现有覆盖情况）：
对话框授权（`project-controller` 有测试？）→ 外部文件读取 → 导出到任意目录 → 分享卡 PNG 落盘 → 工作流输出读写 → **项目在主目录之外**（`D:\…`）打开与保存 → 记忆文件读写删（`memory-controller.test.ts` 已覆盖）→ 风格/模板/技能目录读写 → 导入源文件。

> **测试约束**：`ci-parity-standard` —— CI 无 electron 二进制，`electron/**` 凡 import 到 electron 的测试必须 `vi.mock('electron')`。破坏面实测很小：全仓仅 4 处 `ipcMain` 引用（`import-controller.test.ts`、`memory-controller.test.ts` 各 2）。

### 6.1 测试评审的修正（v2 §6 有 3 类写不出来）

| 问题 | 结论 |
|---|---|
| **第 1 类「策略表完整性」按 v2 文字写不出来** | `src/shared/ipc-channels.ts` **是纯类型文件（零运行时导出）**，运行期无法枚举通道集合。已采用的解：**源码↔源码对账**（正则扫 `ipcMain.handle('…')` vs 声明键），不 import electron，CI 可跑 —— **S1 已落地并通过**（`src/shared/ipc-channel-parity.test.ts`）。S2 起再加一条「策略表键 === 声明 invoke 集合」用 `satisfies Record<InvokeChannel, ChannelPolicy>` 让 **tsc 双向把关**（漏一条/多一条都编译失败） |
| **「注册即抛错」不可观测** | `registerIPCHandlers()` 全库仅 `main.ts:275` 调用 → 107 个测试 **0 覆盖**；漏登记 = 应用启动即死而 CI 全绿。**改为**：dev 抛错 / 生产记 error 日志 + 该通道不注册（等价默认拒绝）继续启动；正确性由上面的静态对账测试兜底，而不是靠运行时抛错 |
| **第 6 类「回归」会集体假绿** | `ipc.invoke` 不因 `{success:false}` 抛错（`ipc-client.ts:79-95` 直接 return），渲染层测试只断言通道名+参数 → P1 收紧后照旧全绿。**必须新增**：写失败可见性断言（S5） |
| **验证成本被低估** | 「启动不抛」要真跑注册需 mock better-sqlite3 / electron-updater / apache-arrow / jieba-wasm 全链重依赖 → 不划算。改用静态对账 + 真机冒烟 |
| **静默丢稿（P1 的前置风险）** | `DraftEditor.tsx:119/122`、`EditorArea.tsx:634` 不检查 `fs:write-file` 返回值即 `markTabSaved()` 并记成功日志 → 先修可见性（S5）再收紧 |

**只能真机验证的**：`report:render-html` 截图链（`data:` URL + paint + `executeJavaScript` + `capturePage`）、原生对话框真实返回、启动期未登记的真实后果。

---

## 7. 分阶段落地（已按可行性 + 测试评审重排）

> **两条排序铁律**（评审结论，v2 没有）：
> ① **`event` 语义先行**：有 4 处 handler 用活的 `event`（§0.2 D），若先大批替换会在「看似成功」中把 `import:progress` 推送链改断 → 必须先立 `GuardedCtx` 契约并只迁这几个文件。
> ② **失败可见性先于收紧**：`DraftEditor.tsx:119/122`、`EditorArea.tsx:634` **不检查 `fs:write-file` 的返回值**就 `markTabSaved()` 并记成功日志 → P1 一旦开始拒绝写盘，用户会**静默丢稿**。必须先把「写失败」变成可见错误，再收紧权限。

| 阶段 | 内容 | 可独立回滚 | 客观验收 |
|---|---|---|---|
| **S0** | 只读盘点：200 invoke + 8 event 通道 + 不一致表（本文档 §5 即其产物） | 0 改动 | 人工核对 |
| **S1 ✅ 已完成**（`41994c5`） | 消差：补 4 条 invoke 声明（health ×2 / embedding ×2）+ 2 条事件声明（`import:progress`、`menu:check-update`）+ **修 `import:` 事件前缀缺失（静默死通道）** + 新增通道对账测试 | ✅ | `src/shared/ipc-channel-parity.test.ts` 4 断言绿；全量 108 files / 1258 tests 绿；tsc/eslint 0 |
| **S2 ✅ 已完成** | 金丝雀收口：`src/shared/ipc-policy.ts`（**200 条策略，纯数据、零运行时 import**）+ `electron/security/ipc-guard.ts`（`guardedHandle` 保持 `ipcMain.handle` 同签名），**只迁 `styles-controller.ts`**（2 通道、无事件、无路径） | ✅ | 全量 108 files / 1259 tests 绿；tsc/eslint 0；`Record<InvokeChannel, ChannelPolicy>` 使策略表完整性成为**编译期**保证 |
| **S3 ✅ 已完成** | `GuardedCtx` 契约 —— **实际不需要 ctx**：`guardedHandle` 保持 `ipcMain.handle` 同签名并**原样透传 `event`**，故 4 处用活 `event` 的 handler 零改动。已迁含活 event 的 3 个文件（`import-controller` 2 / `skill-controller` 4 / `llm-controller` 15），`event.sender.send('import:progress')` 4 处逐行核对保持原样 | ✅ | 全量 108 files / 1259 tests 绿；tsc/eslint 0 |
| **S4 ✅ 已完成** | 其余 198 处全部迁移（b1 templates/report/browser/dev/config/health-check/memory/export = 27；b2 kb/project/embedding/update = 47；b3 fs = 19；b4 db = 73；b5 mcp = 11 + **`registerMCPHandlers()` 并入 `registerIPCHandlers()`，收口为唯一注册入口**） | ✅ 每批一次提交 | 每批 tsc/eslint/全量 vitest 全绿；**迁移后全仓 `ipcMain.handle(` 只剩守卫自身调用与其注释**（200/200 收口）；策略表对账测试持续绿 |
| **S5 ✅ 已完成** | **失败可见性修复**（S8 的前置条件）：写通道返回 `{success:false}` 而非抛错，改造前 7 处调用方不检查返回值即报成功。已修 6 处数据丢失路径：`DraftEditor.doSave`（草稿/DB 双路径）、`EditorArea` 终稿保存、`export-service`（3 处格式）、`finalize-chapter.command`（物理文件）、`prompt-templates`（全局+项目级模板）、`project-store` 的写死 `/tmp/vela_error.log`（改为应用日志流）。未改：`ChapterCreationDialog` 的创建日志（非数据丢失路径，低危，已登记） | ✅ | 全量 108 files / **1260 tests** 绿；新增契约测试「写通道返回 `{success:false}` → 保存返回 false（不再假成功）」；修正 `prompt-templates.test.ts` 中不真实的 mock（原返回 `null`） |
| **S6 ✅ 已完成** | **来源校验**：`isSenderTrusted(probe, policy)` 纯函数（top frame + 存活 + 己方 webContents 白名单 + URL 判定）→ 接入 `guardedHandle`（默认拒绝 + 拒绝日志含 senderId/top/alive/url）；`main.ts` 显式登记己方窗口、`closed` 时注销（防 id 复用误放行）。**`dev-only` 按构建类型门控的方案被否决**（见 §4.6），权限类更名 `dev-bridge` | ✅ | 全量 109 files / **1272 tests** 绿；新增 `ipc-guard.test.ts` 12 例覆盖全部分支（子帧/帧销毁/null URL/未登记 id/远程 http/非法 URL/dev origin 命中与不命中/登记→放行→注销→再拒）；`dev:` 相关分类误判一并修正 29 条 |
| **S7 ✅ 已完成** | preload 白名单**改为派生**：invoke 前缀 ← `IPC_CHANNEL_POLICY`（与主进程同一对象），event 前缀 ← 新增的运行时单一真源 `IPC_EVENT_CHANNELS`（7 条）。两套前缀分开派生，手工元组消失 → 「加通道忘加白名单」在结构上不可能发生（该类漂移此前真实发生过，见 S1 的 `import:progress` 死通道）。新增对账断言 ⑥：事件清单与类型侧声明双向一致 | ✅ | 全量 109 files / **1273 tests** 绿；实测派生前缀集 = 原手工 22 个前缀，**无缺失无多余**（脚本比对） |
| **S8a ✅ 已完成** | 权限判定**纯模块** `electron/security/grants.ts`：`isPathAllowed/assertPathAllowed`（白名单根 = VELA_HOME ∪ 项目根 ∪ 会话授权 ∪ 过渡期主目录根）+ **意图分级**（读/写/删）+ 凭据拒绝（VELA_HOME 根级 `config.json`/`mcp_config.json` 三种意图一律拒）+ 平台归一化（Win 大小写不敏感、按路径段比较防 `/p1` 命中 `/p1-evil`）+ 会话授权登记（仅主进程可调）。`legacyHomeDir` 做成**单点开关**供 S9 收紧 | ✅ | 全量 110 files / **1304 tests** 绿；新增 `grants.test.ts` **31 例**（5 形态 × 3 意图 = 16 条矩阵 + 越界/凭据/意图粒度/大小写/空值）；路径全部由 `os.tmpdir()` 拼装，**不含硬编码盘符**（POSIX 上不会形同虚设） |
| **S8b ✅ 已完成** | 接线：`fs-controller` 的 9 处 `validateSandbox` 全部按通道补**意图**（读/写/删）；`fs:grant-external-file` **通道已删除**（含类型声明、策略表、2 个调用点）；4 处对话框处理器改为**主进程内签发**授权；保留 `agent-result` 自登记；`kb-controller` 的重复 `getCurrentProjectPath` 说明保留（语义略有差异，未强删）。**两个 blocker 一并修掉**：`project:delete-folder`（要求「确实是 NovelForge 项目」+ 路径断言）、`export:export-chapters`（`assertPathAllowedForIpc(outputPath,'write')`） | ⚠️ 行为变更 | 全量 110 files / **1305 tests** 绿；tsc/eslint 全仓 0；对账快照更新为 199 invoke + 7 event |
| **S8b-回归（待真机）** | 回归清单需真机确认：对话框授权 / 外部文件读取（Agent 添加文件）/ 导出到任意目录 / 分享卡 PNG 落盘 / 工作流输出读写 / **主目录之外的项目**打开与保存 / 记忆文件读写删 | — | 真机执行 §6 回归清单 |
| **S9 ✅ 已完成** | **移除主目录根**（单点开关：`currentPathPolicy().legacyHomeDir` 由 `os.homedir()` 改为 `null`）。文件边界自此真正等于 **VELA_HOME ∪ 当前项目根 ∪ 主进程签发的授权**，其余默认拒绝。回滚方式 = 把该行改回 `os.homedir()` | ⚠️ 行为变更（需真机回归） | 全量 110 files / **1305 tests** 绿；tsc/eslint 0。**副作用（正向）**：项目根与盘符无关，因此「主目录之外的项目」（如 `D:\…`）此前连文件树都读不出来（旧沙箱只认主目录），**现在修好了** |
| **S10** | `destructive`/`spawn` 要求授权上下文（含 `project:delete-folder`、`mcp:connect`）——**不要与其它收紧同批**（不可逆） | ⚠️ | destructive 无上下文被拒测试绿 |

> **回滚成本提示**：`project:delete-folder` 与 `uninstall:clean-user-data` 不可逆，不与其它收紧同批；会话授权不落盘（`fs-controller.ts:84,113`），无持久化数据需迁移，故回滚成本总体低。
> **必须保留**：`fs-controller.ts:463` 的 `agent-result-write` **主进程自发授权**——删了它，LLM 读回自己写的 spill 文件会被拒。

---

## 8. 风险 / 已知限制 / 待确认

**必须在实施中确认的未知**
1. **主目录之外的项目**：当前 `validateSandbox` 对 `D:\…` 本就不放行（`SANDBOX_ROOTS` 只含主目录），实际靠 `dialog:select-folder` 的 `grantDirectory`（`project-controller.ts:285`）兜住。**从「最近项目」列表直接打开（无对话框）时是否还能读写项目内文件**，Step 4 必须实测——若今天就有洞，P1 的「打开项目即登记项目根」顺带修掉。
2. **渲染层对 `fs:` 的真实调用点分布**（决定白名单是否漏根）。
3. `VELA_HOME/config.json` 现有读取点是否全部在主进程内（决定 §4.3(b) 能否直接落地）。

**已知风险**
- dev 模式的 origin 校验：dev server URL 可变（端口/主机），策略须限定 origin 且仅 dev 生效；误配会让开发环境全挂。
- 主帧 XSS 仍可调用一切已登记通道（§3 已明示）——L4 只收窄半径。
- 授权集仍是进程内会话级（与现状一致）；不做持久化授权。

**已知限制**
- 离屏截图窗（`report-controller.ts:16`）无 preload，今天不构成来源风险；**未来若给它加 preload，必须同时给它窄策略层**（本档刻意不预造该抽象）。
- `skill-controller.ts:97,98` 硬编码中文对话框标题/过滤器名（i18n-standard §八违规）——**非 L4 主范围**，顺带修复项。

---

## 9. 待用户裁决

| # | 裁决点 | 选项 | 建议 |
|---|---|---|---|
| 1 | `db:` 是否改名细粒度 | (a) 只做策略表 (b) 策略表 + 改名 | **(a)**（§4.5） |
| 2 | `VELA_HOME/config.json` 是否禁止经 `fs:` 通道读写 | (a) 只允许主进程内部 (b) 维持现状 | **(a)** |
| 3 | P0/P1 是否分批提交 | (a) 分批 (b) 一批 | **(a)**（§7） |
| 4 | `fs:grant-external-file` 删除 vs 保留为回执 | (a) 删除 (b) 保留 | **(a)**（§4.3(d)） |

---

*v2 — 已按独立评审修订 §0 的 9 处问题。本文档仍只做设计；实施按 §7 分阶段，P0 先行。*
