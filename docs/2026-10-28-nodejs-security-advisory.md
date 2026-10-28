# Node.js 2026-10-21 安全发布对 NovelForge 的影响评估与处置建议

- 文档日期：2026-10-28
- 评估对象：NovelForge `0.1.7-beta.3`（Electron 41.2.0）
- 结论：**本项目运行时确实落在受影响区间**，其中 1 项可直接导致主进程远程代码执行，建议按 P0 处理
- 本轮改动：**仅新增本报告，未修改任何代码、依赖或 lockfile**

---

## 1. 结论摘要（先看这段）

1. Node.js 于 **2026-10-21** 发布安全版本（26.12.1 / 24.22.1 / 22.23.4），修复 10 个漏洞，其中 4 个 HIGH。
2. NovelForge 桌面端运行在 **Electron 41.2.0 → Node 24.14.0**（实测确认），**24.14.0 < 24.22.1**，因此本次 10 个 CVE 中有 **7 个在理论上命中本项目运行时**。
3. 最需要处理的是 **CVE-2026-111497（Brotli 解码器越界写，可 RCE）**：
   - 主进程所有出站 HTTPS 请求都通过 `fetch` 发出，undici 默认发送 `Accept-Encoding: br, gzip, deflate, zstd`；
   - 实测 `Electron 41.2.0` 的 `zlib.brotliDecompressSync` 可用，brotli 版本 **1.0.9（未含修复）**；
   - 即：**任何一个能返回响应的 LLM/Embedding 端点（或用户配置的代理）返回恶意 `Content-Encoding: br` 响应，就可能打穿主进程**。主进程拥有完整文件系统、API Key、SQLite 库权限，RCE 等于用户级完全失陷。
4. 次要但真实的风险：**TLS 主机名校验绕过（CVE-2026-105483 / 106069 / 106072）** 会削弱 API Key 的传输安全；**c-ares 1.34.6 的 UAF/双重释放（CVE-2026-33630，7.5）** 可被恶意 DNS 触发。
5. 根因不只是"Node 有洞"，而是 **Electron 41 已于 2026-08-25 进入 EOL**（44.0.0 同日发布，按"最新 3 个大版本受支持"策略，当前受支持线为 43 / 44 / 45）。继续留在 41.x 意味着**后续任何 Chromium/Node 漏洞都不会再有补丁**。
6. 另有一条**独立于 Node 的依赖漏洞**：直接依赖 `undici@8.9.0` 命中 `CVE-2026-109869`（HIGH 7.5，恶意响应可让进程崩溃），修复版 **8.12.2**；Node 内置 undici 7.21.0 同样命中。

**处置优先级**

| 级别 | 动作 | 目标版本 | 说明 |
|---|---|---|---|
| P0 | 升级 Electron | `44.10.0` | 内置 Node **24.22.1**、Chromium 148，已覆盖本次全部 Node CVE；不建议直接跳 45.1.0（发布仅 1 天） |
| P1 | 升级 undici | `^8.12.2` | 直接依赖，proxy 路径实际在用 |
| P2 | 升级开发机 / CI Node | `22.23.4` 或 `24.22.1` | 本机为 22.22.2，受影响；CI 的 `22.x` 浮动会自动取到新版，但缺显式下限 |
| 可选 | 出站请求禁用 `br` | `Accept-Encoding: gzip, deflate` | 无法立即升 Electron 时的临时缓解，需改代码，**本轮未实施** |

---

## 2. 事件背景

Node.js 官方安全发布（2026-10-21）：

- 修复版本：**Node.js 26.12.1 / 24.22.1 / 22.23.4**
- 漏洞总数 10 个：4 HIGH / 3 MEDIUM / 3 LOW
- 同时包含依赖升级：c-ares（→1.34.9）、undici（→7.30.1）、OpenSSL（→3.5.9，22.x/24.x）、NSS 根证书（→3.131.1，含 eMudhra 中间 CA 吊销）、brotli（补丁 cherry-pick）、SQLite（仅 22.x）

| CVE | 严重性 | 问题 | 修复版本线 |
|---|---|---|---|
| CVE-2026-111497 | HIGH | Brotli 解码器越界写 → 远程代码执行 | 22/24/26 |
| CVE-2026-105482 | HIGH | `dns.resolve` 截断含 NUL 的域名 | 22/24/26 |
| CVE-2026-105483 | HIGH | IP 写成全角数字时绕过 TLS 主机名校验 | 24/26 |
| CVE-2026-106069 | HIGH | 主机名宽松解析为 IP 时绕过 TLS 主机名校验 | 22/24/26 |
| CVE-2026-105481 | MEDIUM | keep-alive 连接处理"请求发出前写入的响应" | 22/24/26 |
| CVE-2026-106072 | MEDIUM | 非规范 IPv4 主机名校验不当，DNS SAN 可认证 IP 端点 | 22/24/26 |
| CVE-2026-106074 | MEDIUM | `crypto.randomUUID/randomInt` 熵缓存写入 startup snapshot / SEA | 22/24/26 |
| CVE-2026-106070 | LOW | ZipFile 头校验失败后返回攻击者控制的字节 | 26 only |
| CVE-2026-106071 | LOW | Permission Model 通配符越权 | 26 only |
| CVE-2026-106073 | LOW | `fs.realpathSync` 绕过 Permission Model | 22/24/26 |

---

## 3. 本项目运行时画像（实测）

```
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe -e "console.log(process.versions)"
```

```
node      24.14.0          ← 低于修复线 24.22.1
electron  41.2.0
chrome    146.0.7680.179
undici    7.21.0           ← 低于修复线 7.30.1（CVE-2026-109869 命中）
brotli    1.0.9            ← 未含 2026-10-21 的 cherry-pick
ares      1.34.6           ← 低于 1.34.7/1.34.9（CVE-2026-33630 等命中）
napi      10
```

补充事实：

- `package.json` 直接依赖 `undici@^8.9.0`（实测安装 8.9.0），用于 `electron/net/proxy-fetch.ts` 的代理路径；直连路径走 Node 内置 undici 7.21.0。两条路径都在受影响区间。
- 代码中**没有** `setCertificateVerifyProc` / `rejectUnauthorized` / `NODE_TLS_REJECT_UNAUTHORIZED` 覆写，也没有自建 HTTP 服务端（`createServer` 零命中）、没有 WebSocket 客户端。
- Electron 41.2.0 于 2026-04-07 随 41 线发布；41 线最后一版 41.10.7 发布于 **2026-08-25**，同日 44.0.0 发布 → **41 线已 EOL**。

---

## 4. 逐项影响判定

判定口径：`受影响` = 漏洞代码路径在本项目可达；`条件受影响` = 需要特定用法/配置；`不适用` = 代码路径不可达。

| CVE | 本项目判定 | 判定依据与攻击面 |
|---|---|---|
| **CVE-2026-111497** Brotli RCE | **受影响（最高优先）** | 主进程 `fetch`（`electron/net/proxy-fetch.ts`、`electron/controllers/update-controller.ts`）默认协商 `br`，解压走 Node zlib 的 brotli 1.0.9。攻击者 = 恶意/被攻陷的 LLM 端点、用户配置的代理、或具备 MITM 位置的第三方；返回一个精制的 `Content-Encoding: br` 响应即可触发越界写 |
| **CVE-2026-105483** 全角数字 TLS 绕过 | **条件受影响** | 影响 24.x。需攻击者持有一张能通过宽松匹配的证书 + 网络中间位置。本项目对 API Key 只做 Bearer 传输、无证书 pinning，一旦绕过即等同凭据泄露 |
| **CVE-2026-106069** 宽松解析 TLS 绕过 | **条件受影响** | 同上；影响所有 24.x/22.x。用户可自定义 `baseUrl`（第三方中转 API 很常见），放大了"对端不可信"的概率 |
| **CVE-2026-106072** 非规范 IPv4 证书校验 | **条件受影响（低-中）** | 与上两条同族，触发条件更窄 |
| **CVE-2026-105482** `dns.resolve` NUL 截断 | **不适用/极低** | 项目未直接调用 `dns.resolve`；Electron 渲染层的 DNS 由 Chromium 处理。Node 侧解析走 `getaddrinfo`（c-ares 路径见下） |
| **CVE-2026-105481** keep-alive 响应错序 | **不适用** | 项目不是 HTTP 服务端，也无多租户连接复用；客户端单用户场景无可劫持的相邻响应 |
| **CVE-2026-106074** randomUUID 熵缓存 | **不适用** | 仅影响 user-land startup snapshot / SEA；Electron 应用不构建 SEA。（若后续做 CLI/SEA 版本需重新评估） |
| **CVE-2026-106070** ZipFile | **不适用** | 仅 26.x；且项目导出用的是 `zlib.deflateRawSync` 自造 xlsx，未用 `node:zlib` 的 ZipFile |
| **CVE-2026-106071** Permission Model 通配符 | **不适用** | 仅 26.x，且需 `--permission` 启用权限模型；Electron 未启用 |
| **CVE-2026-106073** `fs.realpathSync` 绕过 | **不适用** | 需启用 Permission Model |

### 4.1 依赖层独立漏洞（不在 Node 发布清单内，但同样要处理）

| 组件 | 当前 | 漏洞 | 修复版 | 判定 |
|---|---|---|---|---|
| npm `undici` | 8.9.0 | **CVE-2026-109869**（HIGH 7.5）：恶意服务端返回 >5 层 `Content-Encoding` 并提前断连，`fetch()` 令进程崩溃（未捕获异常） | **8.12.2** | **受影响**，代理路径实际在用 |
| npm `undici` | 8.9.0 | CVE-2026-109383（HIGH 7.4）：`Agent` 深拷贝丢弃函数型 `tls` 选项 | 8.12.2 | 不适用：项目未传 `checkServerIdentity` |
| npm `undici` | 8.9.0 | CVE-2026-109932（WebSocket PONG 内存放大） | 8.12.2 | 不适用：无 WebSocket 客户端 |
| npm `undici` | 8.9.0 | CVE-2026-109841（SRI 大小写绕过）、CVE-2026-84933（共享缓存泄露 Cookie） | 8.12.2 | 不适用：未用 `integrity` / cache interceptor |
| Node 内置 undici | 7.21.0 | CVE-2026-109869 同款 | 随 Node ≥24.22.1 | **受影响**，直连 `fetch` 路径 |
| c-ares | 1.34.6 | **CVE-2026-33630**（7.5，UAF/双重释放，可 DoS 或代码执行）、CVE-2026-69184（7.5，DNS 解析 DoS）、CVE-2026-69186（5.3） | Node ≥24.22.1（c-ares 1.34.9） | **条件受影响**：需恶意/被劫持 DNS（公共 Wi-Fi、被入侵路由器） |
| brotli | 1.0.9 | CVE-2026-111497 的底层库 | Node ≥24.22.1 | **受影响**，见上 |

### 4.2 不适用于 Electron 的修复项（避免误判为"已修/必修"）

- **OpenSSL 3.5.9**：Electron 使用 BoringSSL，不链接 Node 的 OpenSSL（实测 `process.versions.openssl` 为 `0.0.0`），该项升级对 Electron 无效。
- **NSS 根证书 / eMudhra 中间 CA**：Electron 走 Chromium 的证书库与证书验证器，不读 Node 的 `ca-certificates`。**但这不构成豁免**——Chromium 侧的根证书更新由 Electron 升级（41 → 44/45）一并带入。

---

## 5. 处置建议

### P0：Electron 41.2.0 → 44.10.0（本周内）

理由：一步同时解决 7 个 Node CVE + 三档 Chromium 累积 CVE + 脱离 EOL 线。

- 版本选择：
  - **44.10.0（推荐）**：Node 24.22.1、Chromium 148，2026-08-25 起已迭代 10 个补丁版，稳定性有验证。
  - 43.8.4（备选）：同样 Node 24.22.1，但 41→43 改动面更小、支持窗口也更短（46 发布即 EOL）。
  - 45.1.0：Node 24.22.1，支持窗口最长，但 2026-10-27 才发布，**不建议在生产/发版前一周内引入**。
  - 注意：42.11.18 虽在同批发布，但内置 Node 仍是 **24.19.0**，**不解决本次 Node CVE**，不要选它"顺便升级"。
- 变更范围（下一轮实施时）：
  - `package.json` 仅 `electron` 版本行；`pnpm-lock.yaml` 相应更新。
  - 需执行 `pnpm run rebuild`（Electron ABI 变化，`better-sqlite3` 必须重编）；`@lancedb/lancedb` 原生绑定需实测加载。
  - 41 → 44 跨 3 个大版本，需重点回归：`BrowserWindow` / `webPreferences` 默认值、`utilityProcess`、`protocol` 注册、`session` 代理、`app.getPath`、菜单与快捷键、自动更新（`latest.yml` 资产名）。
- 验收（升级后必须跑）：
  ```
  pnpm run typecheck
  pnpm run lint
  pnpm run test
  pnpm run build
  ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe -e "console.log(process.versions)"
  ```
  期望：`node >= 24.22.1`、`undici >= 7.30.1`、`ares >= 1.34.9`、`brotli > 1.0.9`。

### P1：undici `^8.9.0` → `^8.12.2`

代理路径（`electron/net/proxy-fetch.ts`）是唯一直接使用 npm undici 的地方，`ProxyAgent` + `undiciFetch` 仍在 API 兼容范围内，升级风险低。升级后需回归"开代理 / 关代理 / 直连内网地址"三条分支。

### P2：开发机与 CI 的 Node 版本

- 本机：`v22.22.2` → **22.23.4**（或 24.22.1）。
- CI：`.github/workflows` 使用 `node-version: 22.x`，下次运行会自动取到 22.23.4，**当前无需紧急改动**；建议后续显式写 `22.23.4` 作为下限，避免"浮动版本导致的不可复现构建"。
- 说明：CI 只跑测试与构建，不承载用户流量，风险等级低于运行时，但被污染的构建产物同样会流入安装包，故仍列为 P2 而非忽略。

### 可选临时缓解（需改代码，**本轮未实施，等批准**）

若 Electron 升级因原生模块/打包问题受阻，可先做一行级缓解：

```ts
// 出站请求显式去掉 br，规避 Brotli 解码器路径
headers: { ...init?.headers, 'accept-encoding': 'gzip, deflate' }
```

- 覆盖：CVE-2026-111497（Brotli）、CVE-2026-109869（>5 层编码链）。
- **不覆盖**：TLS 主机名校验绕过、c-ares UAF、Chromium 侧漏洞。
- 定位：止血，不是修复；不应替代 P0。

---

## 6. 风险矩阵（当前状态，未做任何改动）

| 风险场景 | 可能性 | 影响 | 综合 |
|---|---|---|---|
| 用户配置/接入的第三方 LLM 中转返回恶意 brotli 响应 → 主进程 RCE | 低-中 | 极高（完全失陷） | **高** |
| 恶意 DNS 触发 c-ares UAF → 主进程崩溃/潜在 RCE | 低 | 高 | 中-高 |
| MITM 利用 TLS 主机名绕过窃取 API Key | 低 | 高（凭据泄露、费用损失） | 中 |
| 恶意端点触发 undici 多编码链 → 进程崩溃（可用性） | 中 | 中（应用退出，数据未损坏） | 中 |
| 41.x EOL 后新增 Chromium 漏洞长期无补丁 | **高** | 中-高 | **高** |

---

## 7. 实施顺序与回归清单（供下一轮执行）

1. `pnpm add -D electron@44.10.0` → `pnpm run rebuild` → `pnpm run check:native`
2. `pnpm add undici@^8.12.2`
3. 三道门禁：`typecheck` / `lint --max-warnings 0` / `test`（当前 107 文件·1254 测试，基线不可回退）
4. 打包冒烟：`pnpm run build` → NSIS 产物启动；核对 `git status --short package.json`（electron-builder 覆盖 scripts/devDeps 的高频坑）
5. 功能回归：LLM 调用（直连 + 代理）、Embedding、导出 xlsx/docx、导入、自动更新检查、MCP 子进程
6. 发布前：确认 `latest.yml` + `.blockmap` 资产齐全、`url` 与资产名一致

---

## 8. 参考

- Node.js 安全发布（2026-10-21）：https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
- Node.js v24.22.1 release notes（依赖升级明细）：https://github.com/nodejs/node/releases/tag/v24.22.1
- Electron 发布与各版本内置 Node 对照：https://releases.electronjs.org/
- Electron 支持策略（最新 3 个大版本）：https://www.electronjs.org/docs/latest/tutorial/electron-timelines
- undici CVE-2026-109869：https://github.com/advisories/GHSA-XJJ6-F33Q-929C
- undici CVE-2026-109383：https://github.com/advisories/GHSA-2m5v-pch6-74hx
- c-ares CVE-2026-33630：https://www.cve.org/CVERecord?id=CVE-2026-33630
- c-ares CVE-2026-69184 / 69186：https://cve.org/CVERecord?id=CVE-2026-69184

---

## 9. 本轮边界声明

- 未修改 `package.json`、`pnpm-lock.yaml` 或任何源文件。
- 未执行依赖安装、未重新打包、未提交 commit。
- 上文所有"受影响"判定基于静态代码检索 + 版本比对 + `process.versions` 实测，未做漏洞利用验证（不建议在有真实用户数据的环境做）。
