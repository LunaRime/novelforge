# 智能模型下载设计（2026-09-25）

> 范围：**只管 Ollama 模型下载**（不含 LLM/Embedding API 调用链）。
> 目标形态：**全自动无感** —— 应用自己测速选路、下载中变慢/断了自动换路，用户不碰任何环境变量。

## 1. 背景与目标

### 1.1 现象

本机拉取 `bge-m3`（1.2 GB）：`23:25:03` 开始 → `01:08:49` 结束 = **1 小时 43 分 50 秒**，平均 **202 KB/s**。

### 1.2 根因（2026-09-25 实测）

| 证据 | 内容 |
|---|---|
| Ollama 启动环境快照 | `%LOCALAPPDATA%\Ollama\server.log` 的 `server config` 行：`HTTPS_PROXY: HTTP_PROXY: NO_PROXY:` **全空** |
| 下载目标 | `registry.ollama.ai` → 307 → `dd20bb891979d25aebc8bec07b2b3bbc.r2.cloudflarestorage.com`（Cloudflare R2） |
| 速率对照（同 URL 同 30 MB range） | **直连 245 KB/s**（30 秒只拿到 7.4 MB） vs **经 127.0.0.1:7897 1,624 KB/s**（拿满）→ **6.6×** |
| 断连重试 | `unexpected EOF` / `wsarecv: An existing connection was forcibly closed by the remote host` / `part 9 stalled`，退避 1s→2s→4s→8s —— 这是墙钟时间远超带宽换算的另一半原因 |
| 反证 | 9/20 下午同一个 blob 仅 9m35s（约 2.1 MB/s）：同样无代理，纯粹是链路窗口不同 → 瓶颈在国际链路，不在应用/磁盘 |

### 1.3 为什么应用改不了

- Ollama 是**独立进程**，走哪条路由**启动时的环境变量**决定，运行期改不了。
- 应用配置里的代理只作用于**应用自己的进程**（且见 §2 末：那条链路本身也有问题）。
- 现设计 §3.3 明确写了「**应用不代管代理**」——本设计**推翻**该决定。

### 1.4 目标 / 非目标

- **目标**：应用内「下载模型」时自动探测最快路径、下载中断点续传、路径失效自动切换、失败自动回退到现有行为。
- **非目标**：不改 LLM/Embedding API 调用链的代理行为（另见 §8）；不碰系统环境变量；不重启用户的 Ollama；不做镜像源（YAGNI）。

## 2. 关键技术验证（本次实测，一次性脚本，非推测）

| 验证项 | 方法 | 结果 |
|---|---|---|
| registry 匿名可读 | `GET .../v2/library/bge-m3/manifests/latest` | 200，且返回内容与本地**已安装 manifest 逐字节一致** ✅ |
| Range 续传 | `curl -r 0-31457280` | 206 ✅ |
| 直连 vs 代理速率 | 同 URL 同 range | 245 KB/s vs 1,624 KB/s（6.6×）✅ |
| Node `fetch` 认环境变量代理 | `HTTPS_PROXY` 指向死端口 | **仍 200 —— 不认** ❌（`NODE_USE_ENV_PROXY` 必须在**启动期**设置才生效） |
| Electron `net.fetch` 认 session 代理 | 假代理监听 18888 看 CONNECT | **未收到 CONNECT —— 不认** ❌ |
| Electron `net.request` 认 session 代理 | 同上 | **收到 `CONNECT registry.ollama.ai:443`** ✅ |
| 模型库格式 | 对比注册表 manifest 与本地 manifest | 完全一致：blobs 按 `sha256-<hex>` 内容寻址、manifest 原样落盘 ✅ |

**选型结论**：下载专用 session + `session.setProxy()` + **`net.request`**（不是 `net.fetch`）。
digest 即文件名 ⇒ 校验、去重、续传全是白送的。

> **顺带发现（不在本次范围，另行处理）**：`electron/controllers/llm-controller.ts:67-85` 的
> `applyProxyConfig()` 在运行期设 `process.env.HTTPS_PROXY`，而主进程 `globalThis.fetch` 是
> Node 的 undici（实测 `globalThis.fetch !== net.fetch`）——**该设置完全不生效**。
> 即应用自己的代理开关目前是空操作。已记录，见 §8。

## 3. 设计

### 3.1 模块划分

四个新文件，**electron 依赖被压缩到唯一一个薄适配层**：

| 文件 | 职责 | 是否 import electron |
|---|---|---|
| `electron/net-path.ts` | 候选路径枚举、测速排序、换路判定（纯逻辑） | ❌ 否（可 mock 单测） |
| `electron/ollama-registry.ts` | registry 协议：manifest 获取/解析、blob 下载（Range 续传 + 流式 sha256） | ❌ 否（注入 Transport） |
| `electron/model-installer.ts` | 编排 + 落库：定位模型目录、去重跳过、原子落盘、自检、回退决策 | ❌ 否（注入 Transport + 只用 `node:fs`） |
| `electron/net/electron-net-transport.ts` | 唯一的 electron 实现：`session.setProxy` + `net.request` → 归一化为 `Transport` | ✅ 是（薄适配，无业务逻辑） |

沿用 `ollama-embedding.ts` 的既有约束：**业务模块不 import electron**，保持 CI 无 electron 二进制下可直接单测（与 `AgentEngineDeps` 依赖注入同款做法）。

### 3.2 选路器 `net-path.ts`

```ts
export interface NetPath {
  id: 'direct' | 'proxy'
  /** 供日志/UI 展示，如 'direct' / '127.0.0.1:7897' */
  label: string
  /** 传给 session.setProxy 的 proxyRules；direct 时为 undefined */
  proxyRules?: string
}
```

**候选枚举** `buildPathCandidates(proxy?)`：

- `direct`（恒有）
- `proxy`：仅当 `config.proxy.enabled && host` 时加入，`proxyRules = '<host>:<port>'`
  （⚠️ Chromium 的 `proxyRules` **不接受** `http://` 前缀——实测带前缀会被静默忽略）

**测速** `PROBE_BYTES = 2 MiB`、`PROBE_TIMEOUT_MS = 8000`：对**首个 layer 的真实 blob** 发 `Range: bytes=0-(PROBE_BYTES-1)`，按「收到字节数 ÷ 耗时」算吞吐；探测字节**丢弃**（成本约 2 MB/候选，对 GB 级模型可忽略）。
测速对象用真实 blob 而非 manifest：**延迟 ≠ 吞吐**，本次瓶颈正是吞吐。

**排序** `rankPaths(probes)`：成功的按吞吐降序在前，失败的按候选原序在后（保证全失败时仍有可用候选）。

**换路判定**（下载中）：

| 信号 | 阈值 | 含义 |
|---|---|---|
| `STALL_TIMEOUT_MS` | 20s 无任何字节 | 路径停滞（实测本机就是这种：文件 mtime 在动、大小不变，长时间零进展） |
| `MAX_PATH_ERRORS` | 连续 3 次连接错误 | 路径不可用（`unexpected EOF` / RST） |
| `MAX_SWITCHES` | 3 次 | 换路上限，超过即回退 |

命中即**换下一条候选**，从当前 offset **续传**（不重下已得字节）。

### 3.3 registry 协议层 `ollama-registry.ts`

```ts
export interface Transport {
  request(url: string, opts: {
    headers?: Record<string, string>
    signal?: AbortSignal
    path: NetPath
  }): Promise<{ status: number; headers: Record<string, string | undefined>; body: AsyncIterable<Uint8Array> }>
}
```

- `registryManifestUrl(name, tag)` → `https://registry.ollama.ai/v2/library/{name}/manifests/{tag}`
- `registryBlobUrl(name, digest)` → `https://registry.ollama.ai/v2/library/{name}/blobs/{digest}`
- `parseManifest(text)` → 校验 `schemaVersion`/`config`/`layers` 形状，畸形返回 `null`（不抛）
- `digestToBlobName('sha256:ab…')` → `'sha256-ab…'`（Ollama 的落盘命名）
- `downloadBlob(transport, { url, destPath, paths, resumeFrom, onProgress, onSwitch, signal })`：
  - **换路循环归属在此**（不是 installer）：重试与续传是字节层的关注点，交给用户层编排会重复实现
  - 从 `paths[0]` 起：有部分文件则从 `resumeFrom` 发 `Range: bytes=<from>-`，追加写入
  - **停滞检测**：定时器盯「距上次收到字节的毫秒数」，超 `STALL_TIMEOUT_MS` → `abort()` 当前请求 → 换 `paths[n+1]` 续传
  - 连续连接错误达 `MAX_PATH_ERRORS` → 同样换路；换路次数达 `MAX_SWITCHES` → 返回 `{success:false}`
  - **流式 sha256**（`node:crypto`），收满后与期望 digest 比对，不符 → 删除部分文件并报错
  - 进度 `completed = resumeFrom + 本次已收字节`（跨路累加，不能从 0 重算）
  - 返回 `{success, usedPath, bytesWritten, error?}`（**不抛**）

### 3.4 编排与落库 `model-installer.ts`

```
installModel(deps, name, tag)
 1. 定位模型目录：process.env.OLLAMA_MODELS → 否则 ~/.ollama/models
 2. 可写性预检（不可写 → 直接回退）
 3. 取 manifest（候选路径按序试，小请求）
 4. 测速 → rankPaths
 5. 逐 layer：
      dest = {models}/blobs/sha256-<hex>
      已存在且 size 相符 → 跳过（去重：与其它模型共享的 layer 不重下）
      否则：staging 里续传下载 → 校验 → fs.rename 进 blobs/（同卷原子）
 6. 原样写 manifest 到 {models}/manifests/registry.ollama.ai/library/{name}/{tag}
      （先写 .tmp 再 rename，保证原子）
 7. 自检：listModels() 里是否出现该模型
      未出现 ⇒ 目录猜错 → 清理刚写入的 manifest → 回退
```

**staging 目录**：`{models}/.novelforge-staging/` —— 与 `blobs/` **同卷**才能 `rename` 原子落盘（跨盘 rename 会失败）。选这个位置而非系统临时目录，是为了避免「下完 1.2 GB 再跨盘复制一份」。⚠️ 「Ollama 不会扫到该目录」是**推断**（它的启动日志只报 `total blobs: N / total unused blobs removed: N`，未见扫描其它目录的迹象），**列入 T6 真机验证**：跑一次 Ollama 重启，确认 staging 残片不被误删、正式落盘的 blob 不被误清。

**回退契约**：`installModel` 任何一步失败都返回 `{success:false, error}`（**不抛**）→ 控制器回退现有 `pullModel()`。**回退是设计的一部分，不是兜底**：目录不可写 / registry 全路径不通 / 换路超限 / 自检失败，都走它。

### 3.5 Transport 适配层（唯一的 electron 文件）

```ts
// electron/net/electron-net-transport.ts
export function createElectronTransport(): Transport
```

- 专用 session：`session.fromPartition('persist:novelforge-model-download')` —— 与其它流量隔离
- 每次请求按 `path.proxyRules` 调 `session.setProxy({ mode:'direct' } | { proxyRules })`
- `net.request` → 包成 `AsyncIterable<Uint8Array>`；`abort()` 接 `AbortSignal`
- ⚠️ **必须用 `net.request` 不是 `net.fetch`**（实测后者绕过 session 代理）

### 3.6 控制器接线

`local-embedding-controller.ts` 的 `embedding:local-pull` **通道名与入参契约不变**（渲染层不传模型名，沿用 `381f0b8` 决定），内部改为：

```
installModel(...) 成功 → 推终帧 success
                 失败 → 回退 pullModel(...)（今天的行为）
```

**进度事件 `embedding:local-pull-progress` 载荷扩展**（可选字段，向后兼容）：
`path?: 'direct'|'proxy'`、`bytesPerSec?: number`、`switched?: boolean`。
既有 `{status, completed, total, percent}` 与 FW-1 的终态 `{status:'error', error}` 语义不变。

### 3.7 UI

- 进度条下方一行小字：`经代理 · 1.5 MB/s` / `直连 · 240 KB/s`
- 换路时一行提示：`网络变慢，已切换到 127.0.0.1:7897`
- 文案全部走 i18n（三语），新增 key 约 4-5 个
- 设置卡片里现有的「网络应对」说明改为反映实际行为（应用自动选路，无需手工配环境变量）

## 4. 影响面与风险

| 风险 | 评估 | 缓解 |
|---|---|---|
| 写进 Ollama 模型库可能被上游布局变更打破 | 布局多年未变，且注册表 manifest 与本地 manifest 已实测逐字节一致 | 步骤 7 自检；不符即回退，不会留下坏状态 |
| 与 Ollama 自身 pull 并发写同一 blob | 双方都是「写临时文件 + rename」，内容寻址 ⇒ 幂等 | staging 用独立目录；`pullsInFlight` 已防同模型重入 |
| 下载中磁盘写满 | 会留下 staging 残片 | 失败路径清理该模型的 staging 文件；错误上报用户 |
| `net.request` 与 Chromium 缓存/重定向交互 | 307 由 Chromium 自动跟随（默认 `redirect:'follow'`） | 已实测 307 链可通 |
| 探测本身失败（所有路径都不通） | 退化为「按候选原序逐个试」 | `rankPaths` 保证全失败时仍有候选 |

## 5. 测试计划

| 文件 | 覆盖 |
|---|---|
| `net-path.test.ts` | 候选枚举（代理关/开/缺字段）、`proxyRules` 不带前缀、测速排序、全失败排序、停滞判定、连续错误判定、换路上限 |
| `ollama-registry.test.ts` | manifest URL 拼接、畸形 manifest 返回 null、digest→blob 名、Range 请求头（含续传 offset）、流式 sha256 正确/不符、截断检测 |
| `model-installer.test.ts` | 目录定位（env/默认）、不可写回退、blob 已存在跳过（去重）、原子 rename、manifest 原子写、自检失败清理 + 回退、换路续传（mock transport 中途断流） |
| `local-embedding-controller.test.ts` | installModel 成功路径、失败回退 pullModel、进度帧扩展字段透传 |
| `VectorConfigSection.test.tsx` | 路径/速率/换路提示渲染 |

门禁：`pnpm run typecheck` / `pnpm run lint` / `pnpm run test` 全绿。

## 6. 任务拆分

| # | 任务 | 产出 |
|---|---|---|
| T1 | `net-path.ts` + 测试 | 纯逻辑选路器 |
| T2 | `ollama-registry.ts` + 测试 | manifest/blob 协议层 |
| T3 | `model-installer.ts` + 测试 | 编排与落库 |
| T4 | `electron-net-transport.ts` + 控制器接线 + 测试 | electron 适配与回退链 |
| T5 | UI + i18n + 组件测试 | 进度展示与提示 |
| T6 | 门禁 + 真机验证清单 | tsc/lint/test + 人工清单 |

## 7. 决策记录

| # | 决策 | 理由 |
|---|---|---|
| D1 | 推翻 §3.3「应用不代管代理」 | 用户实测 1h44m；代管是唯一能实现「下载中换路」的位置 |
| D2 | 应用自建下载器（而非 spawn 专用 ollama serve） | 同库双 server 有并发写风险、换路要重启实例、与用户自己的 Ollama 抢 GPU |
| D3 | 用 `net.request` 而非 `net.fetch` | 实测后者绕过 session 代理 |
| D4 | 不用环境变量代理 | 实测 Node fetch 不认（除非启动期 `NODE_USE_ENV_PROXY`），且无法按请求切换 |
| D5 | 复用 `embedding:local-pull` 通道与事件名 | 渲染层契约不变，仅加可选字段 |
| D6 | 不加「启用智能下载」开关 | 用户裁决「全自动无感」；失败自动回退已覆盖风险 |
| D7 | staging 放模型目录内（同卷） | 跨卷 rename 会失败；`{models}/.novelforge-staging/` 不在 Ollama 的扫描面内 |
| D8 | 探测用真实 blob 的 Range 请求 | 延迟 ≠ 吞吐；本次瓶颈就是吞吐 |

## 8. 真机验证清单（人工，T6）

1. **正常路径**：删掉一个已装模型 → 设置页「下载并切换」→ 期望：进度推进、显示路径与速率、完成后 `/api/tags` 出现该模型。
2. **选路生效**：把代理指向错误端口 → 期望：探测判失败 → 直连；再把直连断掉（拔网/屏蔽域名）→ 期望：自动换到代理。
3. **换路续传**：下载途中切断所选路径 → 期望：20s 内换路、从断点续传（不从头再来）、进度不回退。
4. **回退**：把 `OLLAMA_MODELS` 指向只读目录 → 期望：明确失败并回退到 Ollama 自身 pull（行为与今天一致），不出现半写坏状态。
5. **staging 隔离**：下载中途杀掉应用 → 重启 Ollama → 期望：staging 残片未被 Ollama 误删误清，正式 blob 完好；再次下载能从残片续传或干净重来。
6. **不干扰**：下载期间同时用 Ollama 跑一次推理 → 期望：互不影响。

## 9. 实施记录（2026-09-25，同日完成 T1-T6）

| 任务 | 交付 | 测试 |
|---|---|---|
| T1 | `electron/net-path.ts` | +17 |
| T2 | `electron/ollama-registry.ts`（含 `probePath`） | +18 |
| T3 | `electron/model-installer.ts` | +10 |
| T4 | `electron/net/electron-net-transport.ts` + 控制器接线 | +6（控制器新用例） |
| T5 | `VectorConfigSection` 路径/速率/换路展示 + 3 个 i18n key（三语） | +4 |

**门禁**：`tsc --noEmit` 零错误 / `eslint . --ext ts,tsx --max-warnings 0` 零告警 /
`vitest run` **1603 通过（127 文件）**——较改动前 1548 增 55 条。

### 真机验证（2026-09-25，一次性脚本，已删除）

用真实 Electron 传输层 + 真实注册表跑完整流程（`modelsDir` 指向临时目录，**不碰用户的 Ollama 模型库**），
再用一个**隔离的临时 Ollama 实例**（`OLLAMA_MODELS=临时目录` + 独立端口 11599）验证识别：

| 环节 | 结果 |
|---|---|
| 注册表匿名取 manifest | ✅ |
| 双路径真实测速 | ✅ `direct=325 KB/s` vs `127.0.0.1:7897=465 KB/s`（不再是退化值，见下） |
| 选路 | ✅ 正确选中更快的代理 |
| net.request + session 代理下载 43.8 MB | ✅ 25.9s，全程无停滞无换路 |
| sha256 校验 + 原子落盘 | ✅ blobs/manifest 落盘正确，staging 无残留 |
| **Ollama 是否认这个模型** | ✅ `/api/tags` 列出 `all-minilm:latest`（family=bert / 23M / F16 / dim=384） |
| **能否真跑推理** | ✅ `/api/embed` 返回真实 384 维向量 |

### 实施中发现并修掉的三个 bug（均已由回归测试锁定）

1. **错误计数被「收到任意字节」重置 → 无限重试**：流被截断时每轮都能收到少量字节，
   错误计数反复清零，重试永不终止且文件每轮增长（把测试 worker 撑爆，症状是
   `Worker exited unexpectedly`）。修法 = 引入 `MIN_ATTEMPT_PROGRESS`（1 MiB）：一次失败的尝试
   拿到 ≥1 MiB 才算「仍在推进」、不计错误。终止性因此可证（见 `ollama-registry.ts` 注释）。
2. **亚毫秒探测被误判失败**：`scoreProbe` 原先对 `elapsedMs <= 0` 返回 null，而 `Date.now()`
   只有毫秒粒度——最快的那条路（回环代理）恰恰最容易测出 0ms，于是被当成「不通」。
   修法 = 耗时按 1ms 下界钳制。
3. ⚠️ **探测对象取成了 config 层 → 选路退化成随机**（**只有真机跑才暴露**，mock 测不出来，
   因为 mock 返回的"blob"总是完整的）：原实现用 `layers[0]`，而 `layers[0]` 是 config
   （337 字节的 JSON），2 MiB 的 Range 请求只拿到 337 字节就结束，换算出的"速率"是个位数字节/秒
   （实测 `direct=275`、`proxy=142`）——**排序完全随机**。修法 = 取 `size` 最大的 layer。
   教训：mock 里所有响应都是"完整且瞬时"的，**任何"测量"类逻辑都必须真机验**。

### 与设计的两处偏差（实施中修正，以此为准）

- `downloadBlob` **不接受** `resumeFrom` 参数：断点即暂存文件的**实际大小**，单一真源，
  避免调用方传入与磁盘不一致的值导致拼接错位。
- `fetchManifest` 额外返回 `raw`（原始响应文本）：manifest 必须**原样落盘**，
  解析再序列化会改变字节使 Ollama 校验失败。

## 10. Deferred

- **`applyProxyConfig()` 空操作**（§2 末）：应用自身的 LLM/Embedding 请求代理设置不生效。与本次同源但不同链路，需独立设计与回归（涉及 `llm-controller` 与所有 fetch 路径）。
- SOCKS5 代理：`config.proxy.type` 支持 `socks5`，Chromium 的 `proxyRules` 用 `socks5://host:port` 形式（本次只验证了 HTTP 代理路径）。
- 镜像源（ModelScope 等）作为额外候选路径。
- 探测字节复用（把探测收到的 2 MB 直接作为下载前 2 MB）——省 2 MB，复杂度不划算。
