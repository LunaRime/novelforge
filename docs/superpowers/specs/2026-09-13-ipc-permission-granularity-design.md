# L4 IPC 权限粒度细化设计

> **For agentic workers:** 本设计供 subagent-driven-development / executing-plans 实现。**本档只做设计，不含实现**；实现计划（SDD 任务拆分）在本档评审通过后另出。
> **Status:** 设计草案 v1（待用户审阅：§4 方案取舍 + §9 三处裁决）
> **范围归属:** 档 3 L4（CC 计划 `docs/superpowers/plans/2026-08-29-cc-remaining-implementation.md` Task L4「IPC 权限粒度细化（§五.4，安全敏感）」）
> **基线:** master @ `dd7dc4f`（L3 收口 + 计划书回填 + 真机测试项目提交后）

---

## 1. 背景与现状

### 1.1 实测事实（本设计全部基于代码核对，非推测）

| 事实 | 证据 |
|---|---|
| 主进程 `ipcMain.handle` **200 处**，散布 17 个 controller | `grep -c 'ipcMain.handle('` = 200；`electron/controllers/*-controller.ts` 17 个 |
| **无 `ipcMain.on`**（全部请求/响应式） | `grep -c 'ipcMain.on('` = 0 |
| 注册集中于一个函数 | `electron/ipc-handlers.ts:28 registerIPCHandlers()` → 依次调 18 个 `register*Controller()` |
| preload 白名单是**前缀式**，共 22 个 invoke 前缀 + 3 个 event 前缀 | `electron/preload.ts:11-34`；校验实现 `:49-53` 用 `channel.startsWith(prefix)` |
| 前缀一放就是**整族**授权：`db:` 一个前缀放行 **73** 个通道 | 通道数统计：`db:` 73 / `fs:` 19 / `llm:` 18 / `embedding:` 14 / `mcp:` 11 / `kb:` 11 / `project:` 8 / `update:` 8 / `dialog:` 6 / `log:` 5 / `memory:` 5 / … |
| 渲染进程已是最严配置 | `electron/main.ts:152-154`：`nodeIntegration:false` / `contextIsolation:true` / `sandbox:true`；另有 CSP（`:163-181`） |
| **全应用只有 2 个 `BrowserWindow`**，其中只有 1 个能调 IPC | `main.ts:138`（主窗口，带 preload）；`report-controller.ts:16-21`（离屏截图窗，`data:` URL，**无 preload** → 结构上无法 invoke） |
| dev 走 `VITE_DEV_SERVER_URL`，生产走 `file://{RENDERER_DIST}/index.html` | `main.ts:233-239` |
| fs 沙箱根 = **`~/.novelforge` + 整个用户主目录** | `fs-controller.ts:16 SANDBOX_ROOTS = [VELA_HOME, os.homedir()]` |
| 该沙箱之上只有一个**黑名单**兜底 | `fs-controller.ts:95-106 BLOCKED_PATHS`：`.ssh/.gnupg/.aws/.docker/AppData/Roaming/AppData/Local/Windows` + `/etc,/sys,/proc,/dev` |
| 路径校验是**白名单 + 黑名单串行** | `fs-controller.ts:131-152 validateSandbox()`：先 `isGranted` 放行 → 再 `SANDBOX_ROOTS` 必须命中 → 再 `BLOCKED_PATHS` 必须不命中 |
| 有两条会话级授权集（进程重启即失效） | `grantedDirs`（`fs-controller.ts:113`，`grantDirectory()` :116）；`grantedExternalFiles`（`:84`） |
| 目录授权**只来自对话框** | `grantDirectory` 调用点仅 `project-controller.ts:285`（选项目目录）、`:299`（保存文件）、`export-controller.ts:308`（选输出目录） |
| ⚠️ **外部文件授权通道可被渲染层自行调用** | `fs-controller.ts:273 ipcMain.handle('fs:grant-external-file', (_e, filePath) => { grantedExternalFiles.add(path.resolve(filePath)) })` —— **入参即真相**，通道内不校验「刚发生过一次系统对话框」 |

### 1.2 由此得到的三个真实缺口

**缺口 A — 文件系统权限实质是「整个用户主目录」，且授权可自我签发。**

把 1.1 的两条合起来看：`SANDBOX_ROOTS` 含 `os.homedir()`，`validateSandbox` 对主目录下**任意路径**放行（除黑名单那 7 个目录）。而 `fs:grant-external-file` 可以对**任意路径**登记授权，`fs:read-external-file` 随后按「1MB + 可读扩展名（`.md/.txt/.json/.yaml/.yml/.csv/.markdown`）」读取它。

也就是说：**能调用 `fs:` 前缀的代码，可以读主目录下任何 `.json/.md/.txt/...`，也可以写/删主目录下任何文件（除黑名单目录）。** 授权机制（granted*）本意是「用户点过对话框」，但 `fs:grant-external-file` 没有把授权绑定到那次对话框——它是渲染层自己报的路径。黑名单是网，不是墙：`~/.kube`、`~/.npmrc`、`~/.config`、`~/.local`、`~/.vscode`、`AppData/LocalLow` 都不在其中。

**缺口 B — 前缀白名单把「通道存在」等同于「有权限」。**

preload 的 `startsWith` 校验决定的是**渲染层能不能发出这个通道**，不是**这次调用该不该被允许**。`db:` 一放就是 73 个通道，其中既有只读查询，也有删除/覆盖式写入；`fs:` 一放就是 19 个，含 `fs:delete-file`。新增通道时，只要前缀在列，就自动获得整族权限——**默认放行**。

**缺口 C — 没有来源校验，且新增窗口会静默获得全部权限。**

当前没有一处 `event.senderFrame` 校验。今天能 invoke 的只有主窗口一个 webContents（离屏截图窗无 preload），所以现状侥幸安全；但这是**默认放行**结构：任何未来新增的、带 preload 的窗口（或 Electron 默认值变化）都会自动拿到全部 200 个通道。

---

## 2. 目标 / 非目标

### 2.1 目标

1. **默认拒绝**：权限由「前缀是否存在」变为「策略表里是否登记；未登记 = 不注册」。
2. **文件权限从「主目录白名单」改为「显式白名单」**：`~/.novelforge` + 当前项目根 + 会话内对话框授权的目录/文件，其余一律拒绝。
3. **授权必须由主进程签发**：对话框结果由主进程登记，渲染层不得自行申报路径。
4. **读写意图分级**：同一路径的「读」与「写/删」分开授权。
5. **来源校验**：只接受应用自己的帧（top frame + 己方 origin/webContents）。
6. **破坏面可核对**：产出 200 个通道的权限分类表，作为后续新增通道的强制登记处。

### 2.2 非目标

- 不引入沙箱新机制（不改成 utility process / 不拆 preload 之外的新进程）。
- 不做加密、不做签名校验、不做杀软对抗。
- 不重写 73 个 `db:` 通道名（理由见 §4.5；改名列为可选阶段，非本档必做）。
- 不改渲染层业务逻辑（调用方只在自己需要授权时才需要改动）。
- 不在本档做实现——本档交付设计 + 破坏面清单方法。

---

## 3. 威胁模型（**先把「防得住什么」说清楚**）

主进程持有的能力是「以用户身份读写文件 + 起子进程 + 持有 API Key」。渲染层是唯一入口，且渲染层里跑的是**应用自己的代码 + 用户内容**（导入的小说、AI 生成文本、分享卡 HTML）。

| 攻击路径 | L4 是否防得住 | 说明 |
|---|---|---|
| **A. 其它 webContents / iframe / webview 调 IPC** | ✅ 防住（§4.4） | 来源校验 + 默认拒绝；今天无此路径，属**防未来** |
| **B. 渲染层 XSS / 恶意依赖 / 供应链在**主帧**内执行** | ⚠️ **不能完全防住** | 主帧就是合法来源，它调用任何已登记通道都会通过来源校验。L4 对这条路径的作用是**收窄爆炸半径**：默认拒绝 + 路径显式白名单 + 授权不可自签发，使「一次 XSS = 整个主目录读写」变成「一次 XSS = 项目目录 + 显式授权目录」 |
| **C. Agent（LLM 工具链）被提示注入后诱导读写** | ✅ 显著收窄 | 工具侧走 `fs:` 通道，L4 后 LLM 无法再用「自报路径登记 + 读取」绕过确认 |
| **D. 恶意项目文件 / 导入内容** | ✅ 部分 | 路径白名单把可触达范围限制在项目内 |
| **E. 本地其它进程伪装** | ❌ 不在本档范围 | 进程级对抗另立专项（可考虑 OS keychain 存储 Key） |

> **一句话**：L4 的主要价值是**把默认从「放行」翻成「拒绝」并收窄爆炸半径**，而不是「让 XSS 无法作恶」。任何把 L4 描述成后者的说法都是不准确的（对照：`event.senderFrame` 校验挡不住主帧 XSS）。

---

## 4. 设计

### 4.1 单一收口：策略表 + `guardedHandle`（替代裸 `ipcMain.handle`）

现状 200 处 `ipcMain.handle` 散在 17 个文件，没有一处统一入口。**先立收口，再谈粒度**——否则策略表无处生效。

```
electron/security/
├── ipc-policy.ts        # 唯一真源：channel → { authority, senderTier, pathArgs?, note }
├── ipc-guard.ts         # guardedHandle / assertPathAllowed / classifySender
└── grants.ts            # 主进程签发的授权集（目录/文件/意图）
```

**接口（刻意小，深的实现藏在里面）：**

```ts
// ipc-guard.ts —— 对外只有这几个词
export function guardedHandle<C extends IpcChannel>(
  channel: C,
  handler: (ctx: GuardedCtx, ...args: ChannelArgs<C>) => Promise<ChannelReturn<C>>,
): void

export function assertPathAllowed(candidate: string, intent: 'read' | 'write' | 'delete'): string
export function grantFromDialog(kind: 'dir' | 'file', absPath: string, intent: 'read' | 'write'): void
```

- `guardedHandle` 内部依次做：① 通道是否在策略表（不在 → **注册即抛错**，启动期就炸，不留到运行期）② 来源校验（§4.4）③ 路径参数按 `pathArgs` 声明的意图逐个 `assertPathAllowed` ④ 才调业务 handler。
- 业务 handler 签名**不变**：现有 controller 只把 `ipcMain.handle(` 换成 `guardedHandle(`，其余不动。这是刻意的——收口不应引发业务代码重写。

**为什么用策略表而不是 200 个守卫函数**：策略表是数据，可以整体审阅、可以 diff、可以测试（`it('每个通道都有策略')`）；200 个散落的 if 不行。

**契约（写进代码注释与测试）：**
- 策略表键集合 **必须**等于 `src/shared/ipc-channels.ts` 的通道集合；测试断言双向相等（防漏登记、防幽灵条目）。
- preload 白名单**由策略表生成**（构建期或启动期校验一致），消除「两处白名单漂移」这个既有的长期隐患。

### 4.2 权限分类（`authority`）

每个通道登记一个权限类，决定它能触达什么：

| authority | 含义 | 例 |
|---|---|---|
| `read-project` | 只读当前项目数据 | `kb:search`、`db:draft-list` |
| `write-project` | 改当前项目数据 | `db:revision-create`、`fs:write-file`（项目内） |
| `read-global` | 读全局配置/用户数据 | `config:get`、`log:read` |
| `write-global` | 改全局配置 | `config:set`（含 API Key） |
| `destructive` | 不可逆 / 覆盖面大 | `db:*delete*`、`fs:delete-file`、`uninstall:clean-user-data` |
| `spawn` | 起子进程 | `mcp:*`（`mcp-manager.ts:13,230` spawn）、`update:*`（`update-controller.ts:14`） |
| `network-secret` | 携带 API Key 出网 | `llm:*`、`embedding:*` |
| `dev-only` | 仅开发/内嵌桥接 | `dev:invoke`、`browser:list-tabs` |

`destructive` / `spawn` 两类**要求显式授权上下文**（见 §4.3），不是「有前缀就能调」。

### 4.3 文件权限：显式白名单 + 意图分级 + 授权不可自签发

**(a) 白名单根（默认拒绝）**

| 根 | 读 | 写/删 | 来源 |
|---|---|---|---|
| `VELA_HOME`（`~/.novelforge`） | ✅ | ✅（限定子目录，见下） | 常量 |
| 当前项目根 | ✅ | ✅ | **主进程在「打开/切换项目」时登记**（不依赖对话框） |
| 对话框选中的目录 | ✅ | ✅（仅 write 意图） | `grantFromDialog()` |
| 对话框选中的单个文件 | ✅ | ✅ | `grantFromDialog()` |
| `os.tmpdir()` 的己方子目录 | ✅ | ✅ | 常量（工作流输出/截图临时） |
| 其它 | ❌ | ❌ | 默认 |

`VELA_HOME` 内部再分层（避免「全局目录=全权」）：`config.json`（含 API Key）**只允许主进程自己读写**，不经 `fs:` 通道；`agent-archive/`、`agent-results/`、`workflow-output/` 走各自专用通道（已有 `fs:agent-*` / `fs:workflow-output-*`），**不接受任意路径入参**（现有实现已用 `sha1`/`RUN_ID_RE` 白名单正则，保持并统一到 `assertPathAllowed`）。

**(b) 意图分级**：`assertPathAllowed(p, 'read' | 'write' | 'delete')` —— 同一目录的读授权不等于写授权；`fs:delete-file` 一律要 `delete` 意图。

**(c) 授权不可自签发（修缺口 A）** —— 这是本档**最高价值**的一条：

- `grantedExternalFiles` / `grantedDirs` **只由 `grantFromDialog()` 写入**，调用方是对话框的实际结果处理点（`dialog:select-folder` / `dialog:select-files` / `dialog:save-file` / `export:select-output-dir`），不经 IPC。
- `fs:grant-external-file` 通道**行为改变**：不再是「登记入参路径」，而是「**回执确认**」——渲染层传回主进程在对话框环节签发的一次性 nonce；主进程核对后把**自己记下的**路径登记授权，入参里的路径**不被信任**。
- 需要外部文件的正常链路（Agent「添加外部文件」）改为：渲染层发起 `dialog:select-files` → 主进程弹框 → 主进程把结果路径登记 + 返回 nonce/路径给渲染层。**用户点过框**这个事实由主进程掌握，而不是由渲染层声称。
- `audit-context.ts:80`（当前直接调 `fs:grant-external-file` 登记项目内文件）改为走项目根白名单，不再需要该通道。

**(d) 黑名单保留但降级为「纵深防御」**：BLOCKED_PATHS 不再承担边界职责（边界是白名单），保留作为第二道，并补上 `.kube/.npmrc/.git-credentials/.config/.local/.vscode/AppData/LocalLow` 等条目。

### 4.4 来源校验（诚实定位）

```ts
// classifySender：只认应用自己的帧
//  - 已知 webContents（主窗口）→ 'app'
//  - 其余（含未来新增窗口、iframe、devtools 扩展）→ 'denied'
//  - 生产：url 必须 file:// 指向 RENDERER_DIST/index.html
//  - 开发：url 必须 VITE_DEV_SERVER_URL 的 origin（且仅在 dev 构建放开）
```

- 校验 `event.senderFrame`：必须是 **top frame**（`frame.parent === null`）+ `webContents.id` 在己方白名单 + url 命中生产/开发二者之一。
- **今天只有 1 个可 invoke 的 webContents**（离屏截图窗无 preload），所以这一条**不是修既有漏洞，而是把「默认放行」改成「默认拒绝」**，防未来新增窗口静默提权。
- 不给「aux tier」这种今天无对象的抽象：**一个适配器不构成接缝**。等真有第二个带 preload 的窗口时再加分层（记录为 §8 已知限制）。

### 4.5 `db:` 粒度：策略表优先，改名可选

计划原文给了两条路：「按 controller 分组前缀**或**通道级校验」。**本设计选通道级校验（策略表），不改名**，理由：

| 方案 | 成本 | 收益 |
|---|---|---|
| 策略表（不动通道名） | 中：200 条登记 + 收口替换 | 默认拒绝 + 分类 + 可测试；调用点零改动（渲染层的 `ipc.invoke('db:...')` 原样可用） |
| 改名细粒度前缀（`db:character:*` 等） | 高：`ipc-channels.ts` + preload + 全部调用点 + 测试全量改；且**改动本身就是新的破坏面** | 前缀语义更清晰；但安全性并不比策略表更高（策略表已能逐通道判权） |

**结论**：先把「权限判定」做对（策略表），改名作为**可选阶段 3**，仅在有实际收益（例如要让第三方插件只拿 `db:character:*`）时再做。这避免了为「看起来细」而引入 73 处 + 调用点的机械改动风险。

### 4.6 `dev-only` 通道的处理

`dev:invoke` / `browser:*` 是开发者模式的桥（外部 API + CDP 回环查询）。策略：
- `dev:invoke` 归属 `dev-only`，**非 dev 构建下不注册**（发布版从结构上就不存在该通道，而不是靠运行时开关）。
- `browser:*` 保持仅回环 `127.0.0.1` + 端口校验（现状已如此，`browser-controller.ts:40-47`），归 `dev-only`。

---

## 5. 破坏面评估（Step 0，实现的第一步）

计划要求「现有 70 通道调用点全量核对」。方法（产出物 = 分类表 + 变更点清单）：

1. **枚举**：`ipcMain.handle` 200 处 → `(channel, controller, file:line)`。
2. **分类**：按 §4.2 打 `authority`；不确定的一律先按**更严**的一类登记。
3. **定位路径参数**：每个通道的哪些入参是路径（`pathArgs`），给 intent。**只读**通道里凡接受任意路径的（`fs:read-file`/`fs:read-external-file`/`fs:list-dir`/`fs:check-exists`/`fs:read-json`）逐个确认白名单根是否覆盖真实调用点。
4. **核对真实调用点**：渲染层每个 `ipc.invoke('fs:...')` 的实际入参从哪来（对话框？项目内？用户输入？）——**这里是本档最大的未知**（见 §8）。
5. **产出**：`ipc-policy.ts` 初稿 + 一份「本次收紧会影响到的调用点」清单，二者进同一个 PR 便于评审。

**已知高风险清单（Step 0 优先核对）**：

| 通道 | 风险 |
|---|---|
| `fs:grant-external-file` | 可自我签发（缺口 A）——**必须改造** |
| `fs:read-file` / `fs:write-file` / `fs:delete-file` | 主目录全通（缺口 A） |
| `fs:read-external-file` | 依赖自签发的授权 |
| `db:` 中一切 delete/overwrite | 73 个通道同把钥匙，破坏面无区分（缺口 B） |
| `uninstall:clean-user-data` | 不可逆 |
| `mcp:*` | spawn 子进程，启动即执行 |
| `llm:*` / `config:` | API Key 读取与出网 |
| `dev:invoke` | 通用出网桥 |

---

## 6. 测试策略

- **策略表完整性**：`ipc-policy` 的键集合 === `ipc-channels.ts` 通道集合（双向），漏登记即失败。
- **默认拒绝**：未登记通道 `guardedHandle` 抛错（启动期失败，测 `registerIPCHandlers()` 不抛）。
- **路径白名单**：对每个 `authority` 的样例通道，构造「项目内 / VELA_HOME 内 / 授权目录内 / 主目录其它位置 / 白名单外盘符」五种路径断言放行与否；**读/写/删三意图交叉**（读放行 ≠ 写放行）。
- **授权不可自签发**：直接 invoke `fs:grant-external-file`（伪造路径）→ 未授权；走对话框链路 → 授权；nonce 重放 → 拒绝。
- **来源校验**：伪造 sender（非 top frame / 非己方 webContents / 错误 origin）→ 拒绝；dev 与生产两种 URL 形态各测。
- **回归（既有链路不许断）**：对话框授权 / 外部文件读取 / 导出到任意目录 / 分享卡 PNG 落盘 / 工作流输出读写 / 项目在**主目录之外**（如 `D:\`）时打开与保存。
- **electron 侧测试**：遵循 `ci-parity-standard` —— 凡 import 到 `electron` 的测试必须 `vi.mock('electron')`（CI 无 electron 二进制）。

---

## 7. 分阶段落地建议

| 阶段 | 内容 | 可独立发布 |
|---|---|---|
| **P0（收口 + 来源）** | `guardedHandle` + 策略表（先按现状宽松登记）+ 来源校验 + 完整性测试 | ✅ 行为基本不变，纯加固 |
| **P1（文件权限，最高价值）** | 显式白名单 + 意图分级 + 授权改由主进程签发（修缺口 A） | ✅ 需 §5 Step 4 的调用点核对 |
| **P2（权威分类收紧）** | `destructive` / `spawn` 要求授权上下文；`dev-only` 非 dev 不注册 | ✅ |
| **P3（可选）** | `db:` 前缀改名细粒度 | 按需 |

> P0 与 P1 分开，是为了让「结构性改造」与「行为收紧」可以分别回归——两者混在一个 PR 里出问题很难定位。

---

## 8. 风险 / 已知限制 / 待确认

**已知风险**

1. **主目录之外的项目**：当前 `validateSandbox` 对 `D:\...` 的项目路径**本来就不放行**（`SANDBOX_ROOTS` 只含主目录），实际靠对话框选目录时的 `grantDirectory` 兜住（`project-controller.ts:285`）。**从最近项目列表直接打开（无对话框）**是否仍能读写项目内文件，Step 0 必须实测确认——若今天就有洞，L4 的「打开项目即登记项目根」正好补上（属于顺带修 bug）。
2. **dev 模式 origin 校验**：dev server URL 可变（端口/主机），策略须限定 origin 且仅 dev 生效；误配会让开发环境全挂。
3. **未覆盖的内核级逃逸**：L4 不改 OS 边界，Node 侧仍有完整 fs 能力（设计与实现都在主进程内），这是有意的。

**已知限制**

- 离屏截图窗（`report-controller.ts:16`）无 preload，今天不构成来源风险；**未来若给它加 preload，必须同时给它一个窄策略层**（本档刻意不预造该抽象，避免空接缝）。
- 主帧 XSS 仍可调用一切**已登记**通道（§3 已明示）——L4 只收窄半径。
- 授权集是进程内会话级（重启失效），与现状一致；不做持久化授权（持久化会扩大攻击面，需单独设计）。

---

## 9. 待用户裁决

| # | 裁决点 | 选项 | 建议 |
|---|---|---|---|
| 1 | `db:` 是否改名细粒度 | (a) 只做策略表不改名 (b) 策略表 + 改名 | **(a)** 先做 (a)；改名收益不足、改动面大（§4.5） |
| 2 | `VELA_HOME/config.json`（含 API Key）是否允许经 `fs:` 通道读写 | (a) 只允许主进程内部访问 (b) 维持现状 | **(a)**；(b) 等于把 Key 放在渲染层可读路径上 |
| 3 | 阶段 P0/P1 是否一起做 | (a) 分两批 (b) 一批 | **(a)** 分开才可分别回归（§7） |

---

*设计草案 v1。本文档只做设计——实现计划（SDD 任务拆分）待本档评审通过后另出，见 `docs/superpowers/plans/`。*
