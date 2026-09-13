# Ollama 本地向量模型 实施计划（SDD）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（recommended）或 superpowers:executing-plans。Steps 用 checkbox（`- [ ]`）追踪。

**Goal:** 为知识库向量化提供**用户可自行开启的本地向量模型**（Ollama，localhost HTTP，零打包/零原生模块，双通道获取：应用内 pull + 手动导入检测），使其在远程 Embedding API 受限/限流/离线时仍具备语义检索能力。

**Architecture:** 按设计 `docs/superpowers/specs/2026-08-29-local-ollama-embedding-design.md` 五层落地：① `fetchWithTimeout` 导出 + 超时参数化（pull 长任务 300s）；② 新模块 `electron/ollama-embedding.ts`（纯 HTTP：detect/listModels/pullModel/embedLocal）；③ 降级链从三级扩为**四级 + 用户优先级**（纯函数 `resolveEmbeddingOrder`）+ **向量维度硬校验**（v1 必做）；④ `GlobalConfig.localEmbedding` + IPC 通道（**经 L4 的 `guardedHandle` + 策略表**）+ pull 进度 event 通道；⑤ 设置页卡片（`VectorConfigSection`）+ i18n 三语。

**Tech Stack:** TypeScript + Electron 主进程 + better-sqlite3/LanceDB（既有）+ Ollama REST（`/api/tags` `/api/embed` `/api/pull` `/api/version`）+ vitest（mock fetch）。**零新依赖**。

**Spec:** `docs/superpowers/specs/2026-08-29-local-ollama-embedding-design.md`（决策记录 §7 七条已裁决）
**基线:** master @ `7c87f5b`（`git rev-parse HEAD` 应等于该值）

## Global Constraints

- **v1 范围**（设计 §6）：T1 超时参数化 / T2 新模块 / T3 降级链 + 维度硬校验 / T4 config + IPC / T5 UI + i18n。
- **非目标（无任务）**：内置 Ollama 安装包或代管进程（只做引导）；ONNX 内嵌推理；`/api/embeddings` 旧接口兼容（v1 仅 `/api/embed`，探测失败提示升级 Ollama）；Ollama 进程守护（v2）；检索侧对本地维度的阈值适配（v2）。
- **⭐ L4 之后的 IPC 铁律（新增通道必须同时满足）**：
  1. 通道签名在 `src/shared/ipc-channels.ts` 声明；
  2. invoke 通道**必须在 `src/shared/ipc-policy.ts` 策略表登记**（`Record<InvokeChannel, ChannelPolicy>` 编译期把关，漏一条编译失败）；
  3. event 通道必须在运行时单一真源 `IPC_EVENT_CHANNELS` 登记；
  4. 主进程注册**一律用 `electron/security/ipc-guard.ts` 的 `guardedHandle`**（不得直接 `ipcMain.handle`）；
  5. preload 白名单**已派生**（invoke ← 策略表 / event ← `IPC_EVENT_CHANNELS`），**不要手工加前缀**；
  6. 通道对账测试（`src/shared/ipc-channel-parity.test.ts`）必须绿。
- **行为兼容优先**：`localEmbedding.enabled = false`（默认）时，`importContent`/`backfillVectors` 的降级路径与现状**逐字等价**（既有三级链不变）；`fetchWithTimeout` 默认超时仍 10s。
- **维度硬校验（v1 必做）**：本地模型（bge-m3 1024 维）与 API 模型（1536 维等）**不得混入同一 LanceDB 表**——写入前检测现有表向量维度，不一致 → **拒绝写入并返回明确错误**（提示重建索引），**不静默降级**；切换模型形态时 UI 提示重建。
- **静默失败禁止**：本地推理失败 → 降级下一档 + `logger.warn`（错误脱敏）；pull 失败 → 错误原文展示 + 通道 B 兜底提示。
- **i18n**：所有用户可见文本走 `t()`，新增 key 前缀 `localEmbedding.*`，**三语齐全**（zh-CN/en-US/ru-RU），与使用它的代码**同任务落 key**（`TextKey` 严格 union，否则 typecheck 红）。
- **质量门禁**：`pnpm run typecheck`、`pnpm run lint`（--max-warnings 0）、`pnpm run test` 全绿；**本地绿 ≠ CI 绿** —— 提交后 `gh run list --repo LunaRime/novelforge` 确认远程绿（`electron/**` 测试若 import 到 `electron` 模块必须 `vi.mock('electron')`，见 `ci-parity-standard`）。
- **提交规范**：`feat:`/`fix:`/`docs:` 前缀、一个提交一件事；不提交 `.claude/`/`.codex/`；版本号只在发版改。

---

### Task 1: `fetchWithTimeout` 导出 + 超时参数化

**Files:**
- Modify: `electron/embedding.ts`（`fetchWithTimeout` 导出 + 可选 `timeoutMs` 参数）
- Modify: `electron/embedding.test.ts`（超时参数化用例）

**Interfaces:**
- Produces（T2 消费）：`export function fetchWithTimeout(url: string, init: RequestInit, timeoutMs?: number): Promise<Response>`（默认 `EMBEDDING_TIMEOUT_MS = 10_000` 不变）

- [ ] **Step 1: 写失败测试**（`electron/embedding.test.ts` 追加）
  - 默认超时仍是 10s（挂起 fetch + fake timers → 10s 时 reject `AbortError`）。
  - 显式 `timeoutMs=300_000` → 10s 时不 reject，300s 时才 reject（验证长任务参数生效）。
  - 正常返回（fetch resolve 先于超时）→ 不触发 abort。
  > 复用既有 `embedding.test.ts` 的 mock fetch / fake timers 模式。

- [ ] **Step 2: 跑失败** → `node node_modules/vitest/vitest.mjs run electron/embedding.test.ts`

- [ ] **Step 3: 实现**：`fetchWithTimeout` 加 `export` + 第三参 `timeoutMs: number = EMBEDDING_TIMEOUT_MS`（`setTimeout(..., timeoutMs)`）。既有 `embedOpenAI`/`embedGemini` 调用**不传第三参**（行为不变）。

- [ ] **Step 4: 跑测试通过**

- [ ] **Step 5: 门禁 + 提交**
  ```bash
  pnpm run typecheck && pnpm run lint && node node_modules/vitest/vitest.mjs run electron/embedding.test.ts
  git add electron/embedding.ts electron/embedding.test.ts
  git commit -m "feat: fetchWithTimeout 导出 + 超时参数化（Ollama pull 长任务复用，T1）"
  ```

---

### Task 2: `electron/ollama-embedding.ts` 新模块（纯 HTTP）

**Files:**
- Create: `electron/ollama-embedding.ts`
- Create: `electron/ollama-embedding.test.ts`

**Interfaces:**
- Consumes: T1 `fetchWithTimeout`
- Produces（T3/T4 消费，签名锁定）:
  - `export async function detectOllama(baseUrl: string): Promise<{ ok: boolean; version?: string; error?: string }>`
  - `export async function listOllamaModels(baseUrl: string): Promise<Array<{ name: string; size: number }>>`（`/api/tags`；`:latest` 规范化、去重、按 name 排序）
  - `export interface PullProgress { status: string; completed?: number; total?: number; percent?: number }`
  - `export async function pullModel(baseUrl: string, model: string, onProgress?: (p: PullProgress) => void): Promise<{ success: boolean; error?: string }>`（`/api/pull` NDJSON 流式解析；**超时 300_000ms**）
  - `export async function embedLocal(texts: string[], baseUrl: string, model: string): Promise<number[][]>`（`/api/embed` 批量；**按 index 保序**；失败 throw 供降级）

- [ ] **Step 1: 写失败测试**（mock `fetch`，参照 `embedding.test.ts` 模式）
  - `detectOllama` 三态：`/api/version` 200 → `{ok:true,version}`；连接拒绝/超时 → `{ok:false,error}`；非 200 → `{ok:false,error}`。
  - `listOllamaModels`：解析 `{models:[{name,size}]}`；`bge-m3:latest` → 规范化为 `bge-m3`；去重 + 排序。
  - `pullModel`：构造 NDJSON 流（`{"status":"pulling","digest":..,"completed":..,"total":..}` 多行 + 末行 `{"status":"success"}`）→ 断言 `onProgress` 收到多帧且末帧 success、`percent` 计算正确；失败行 → `{success:false,error}`。
  - `embedLocal`：`{embeddings:[[...],[...]]}` → 返回保序；乱序 index → 仍保序；非 200/畸形 → **throw**。
  - 超时参数：pull 路径用 300s（挂起 mock + fake timers），embed 用默认 10s。

- [ ] **Step 2: 跑失败**

- [ ] **Step 3: 实现**：纯 HTTP 模块（无状态、无 electron 依赖）；NDJSON 解析用按行 split + 跨 chunk 行缓冲（参照 `electron/llm/openai-provider.ts` 的 SSE 行缓冲模式）；错误信息经 `t()` 或结构化返回（主进程日志脱敏）。

- [ ] **Step 4: 跑测试通过**

- [ ] **Step 5: 门禁 + 提交**
  ```bash
  pnpm run typecheck && pnpm run lint && node node_modules/vitest/vitest.mjs run electron/ollama-embedding.test.ts
  git add electron/ollama-embedding.ts electron/ollama-embedding.test.ts
  git commit -m "feat: ollama-embedding 新模块——detect/list/pull/embed（纯 HTTP，mock 全量单测，T2）"
  ```

---

### Task 3: 降级链集成（四级 + 优先级）+ 维度硬校验

**Files:**
- Modify: `electron/knowledge-base.ts`（`importContent` 降级段 + `backfillVectors` 接入 + 维度校验）
- Create: `electron/embedding-order.ts`（或置于 knowledge-base 内导出纯函数）+ 测试
- Modify: `electron/knowledge-base.test.ts` / 新建 `electron/embedding-order.test.ts`

**Interfaces:**
- Consumes: T2 `embedLocal`/`detectOllama`；`GlobalConfig.localEmbedding`（T4 定义，本任务按同形类型消费）
- Produces:
  - `export type EmbeddingSource = 'local' | 'api' | 'llm' | 'fts'`
  - `export function resolveEmbeddingOrder(cfg: { enabled: boolean; preferLocal: boolean }): EmbeddingSource[]`
    - 未开启 → `['api','llm','fts']`（现状三级，逐字等价）
    - 开启 + preferLocal → `['local','api','llm','fts']`
    - 开启 + !preferLocal → `['api','local','llm','fts']`
  - 维度校验：`assertVectorDimConsistent(projectPath, dim)`（现表已有向量且维度不同 → throw 明确错误）

- [ ] **Step 1: 写失败测试**
  - `resolveEmbeddingOrder` 三分支（未开启 / 本地优先 / API 优先）纯函数断言。
  - **维度硬校验**：构造已有 1536 维向量的表 → 以 1024 维写入 → **拒绝并返回明确错误**（非静默降级）；同维度 → 放行。
  - `importContent` 在 `enabled=false` 时**调用序列与现状一致**（既有测试回归）。
  - 本地失败（未连接/embed throw）→ 降级到 api（或 llm）→ 最终 FTS-only，导入不阻断。

- [ ] **Step 2: 跑失败**

- [ ] **Step 3: 实现**
  - `resolveEmbeddingOrder` 纯函数（无副作用）。
  - `importContent`：读 `GlobalConfig.localEmbedding`（经 `getEmbeddingConfig()` 扩展或新增参数），按 order 逐档尝试；每档 throw/空向量 → warn + 下一档（"本地失败不阻断"与现有 API 失败降级同构）。
  - `backfillVectors` 同步接入（存量库重建也走本地——用户痛点场景）。
  - 维度校验：`importContent`/`backfillVectors` 写入前检测现有表向量维度（复用 `vector-store.ts` 的 `detectVectorDimFromSchema`/表 schema 检测），不一致 → throw（错误文案走 i18n，提示重建索引）。

- [ ] **Step 4: 跑测试通过**（含既有 KB 测试回归）

- [ ] **Step 5: 门禁 + 提交**
  ```bash
  pnpm run typecheck && pnpm run lint && node node_modules/vitest/vitest.mjs run electron/knowledge-base.test.ts electron/embedding-order.test.ts
  git add electron/knowledge-base.ts electron/embedding-order.ts electron/embedding-order.test.ts electron/knowledge-base.test.ts
  git commit -m "feat: 降级链四级 + 用户优先级（resolveEmbeddingOrder）+ 向量维度硬校验（T3）"
  ```

---

### Task 4: `GlobalConfig.localEmbedding` + IPC 通道（L4 铁律）

**Files:**
- Modify: `src/shared/ipc-channels.ts`（`GlobalConfig.localEmbedding?` + 4 invoke 通道签名）
- Modify: `src/shared/ipc-policy.ts`（**策略表登记 4 条 invoke**）
- Modify: `src/shared/ipc-channels.ts` 的 `IPC_EVENT_CHANNELS`（**登记 1 条 event**：`embedding:local-pull-progress`）
- Modify: `electron/controllers/kb-controller.ts`（或新建 `electron/controllers/local-embedding-controller.ts`）——**全部用 `guardedHandle`**
- Modify: `electron/utils/config-utils.ts`（`DEFAULT_GLOBAL_CONFIG.localEmbedding` 默认值）
- Modify: 通道对账测试（若需同步快照）

**Interfaces:**
- Produces:
  - `GlobalConfig.localEmbedding?: { enabled: boolean; baseUrl: string; model: string; preferLocal: boolean }`（默认 `{enabled:false, baseUrl:'http://localhost:11434', model:'bge-m3', preferLocal:true}`；读失败回退默认，既有 GlobalConfig 可选字段模式）
  - IPC（invoke，经策略表 + `guardedHandle`）：
    - `'embedding:local-detect'` → `{ ok: boolean; version?: string; error?: string }`
    - `'embedding:local-list-models'` → `Array<{ name: string; size: number }>`
    - `'embedding:local-pull'`（**仅发起**，立即返回；进度经 event 推送）→ `{ started: boolean; error?: string }`
    - `'embedding:local-test'`（`embedLocal(['测试文本'])`）→ `{ success: boolean; dim?: number; error?: string }`
    - `'embedding:local-get-config'` / `'embedding:local-set-config'` → 读写 `localEmbedding`（含默认值合并）
  - event：`IPC_EVENT_CHANNELS` 增 `'embedding:local-pull-progress'`（`{ status, completed, total, percent }`）

- [ ] **Step 1: 写失败测试**
  - `DEFAULT_GLOBAL_CONFIG.localEmbedding` 默认值断言；读损坏 config → 回退默认。
  - 通道对账：新 5 条通道在 `ipc-channels.ts` 声明、策略表存在、`IPC_EVENT_CHANNELS` 含新 event（`ipc-channel-parity.test.ts` 既有断言覆盖）。
  - controller 层：`embedding:local-detect`/`local-test` 用 mock 的 ollama 模块返回结构断言。
  > **注意**：`electron/**` 测试若 import 到 `electron` 模块，必须 `vi.mock('electron')`（CI 无 electron 二进制，见 `ci-parity-standard`）。

- [ ] **Step 2: 跑失败**

- [ ] **Step 3: 实现**
  - `GlobalConfig` 加可选字段 + `DEFAULT_GLOBAL_CONFIG` 默认值。
  - 通道签名 + **策略表登记**（`ChannelPolicy`：这 5 条无路径参数 → 路径类 none；`local-pull` 涉及外部进程 → 按 L4 语义选择是否需要 `destructive`/`spawn` 类标记，**读 `src/shared/ipc-policy.ts` 现有同类通道的 policy 取值**）。
  - controller：`guardedHandle` 注册；pull 发起后在主进程订阅 `pullModel` 进度 → `event.sender.send('embedding:local-pull-progress', ...)`（**不要**在 invoke 里等 pull 完成——IPC 30s 超时）。
  - preload **不改**（派生）。

- [ ] **Step 4: 跑测试通过**（含通道对账）

- [ ] **Step 5: 门禁 + 提交**
  ```bash
  pnpm run typecheck && pnpm run lint && node node_modules/vitest/vitest.mjs run src/shared/ipc-channel-parity.test.ts
  git add src/shared/ipc-channels.ts src/shared/ipc-policy.ts electron/controllers/ electron/utils/config-utils.ts
  git commit -m "feat: GlobalConfig.localEmbedding + embedding:local-* 通道（guardedHandle + 策略表 + pull 进度 event，T4）"
  ```

---

### Task 5: 设置页「本地向量模型」卡片 + i18n 三语

**Files:**
- Modify: `src/components/settings/VectorConfigSection.tsx`（新增卡片）
- Modify: `src/shared/locale-data.ts`（`localEmbedding.*` 约 12–15 key × 三语）
- Create/Modify: `src/components/settings/VectorConfigSection.test.tsx`（组件测试）

**Interfaces:**
- Consumes: T4 IPC（`embedding:local-*` + pull 进度 event）
- Produces: UI 卡片（开关 / 地址输入 / 状态徽标三态 / 模型下拉 / 下载进度 / 测试按钮 / 优先级单选）

- [ ] **Step 1: 落 i18n key（三语，与组件同任务）**：`localEmbedding.title` / `enable` / `baseUrl` / `statusConnected` / `statusDisconnected` / `statusModelMissing` / `model` / `download` / `testing` / `test` / `preferLocal` / `preferApi` / `hint` / `pullProgress` / `pullFailed` 等。
- [ ] **Step 2: 写失败测试**（组件测试，参照 `ModelsView` 既有模式）：状态徽标三态渲染、开关切换调用 `local-set-config`、测试按钮调用 `local-test` 并显示维度、pull 进度 event 更新进度条。
- [ ] **Step 3: 实现**：卡片 UI（**颜色只用 CSS 变量**、`ui/` 组件复用、z-index 语义变量）；挂载时 `local-detect` + `local-list-models`；订阅 pull 进度 event（`ipc.on`，卸载时取消订阅）。
- [ ] **Step 4: 跑测试通过**
- [ ] **Step 5: 门禁 + 提交**
  ```bash
  pnpm run typecheck && pnpm run lint && node node_modules/vitest/vitest.mjs run src/components/settings/VectorConfigSection.test.tsx
  git add src/components/settings/VectorConfigSection.tsx src/components/settings/VectorConfigSection.test.tsx src/shared/locale-data.ts
  git commit -m "feat: 设置页「本地向量模型」卡片 + i18n 三语（T5）"
  ```

---

### Task 6: 全量门禁 + 真机验证 + 登记

- [ ] **Step 1: 全量门禁**：`pnpm run typecheck` / `pnpm run lint` / `pnpm run test` 全绿；提交后 `gh run list --repo LunaRime/novelforge` 确认 CI 绿。
- [ ] **Step 2: 真机验证（人工，无 Ollama 环境无法自动化）**：
  - 安装/启动 Ollama → 设置页卡片显示「已连接」；模型未装 → 「模型缺失」双通道提示。
  - 应用内 pull bge-m3 → 进度条推进 → 完成 → 下拉出现 bge-m3。
  - 导入文档 → 日志显示走本地向量；`embedding:local-test` 显示 1024 维。
  - 停掉 Ollama → 导入仍成功（降级 api/llm/fts）+ 不阻断。
  - **维度切换**：本地(1024) ↔ API(1536) 切换 → 拒绝写入 + 提示重建（不静默）。
- [ ] **Step 3: 登记已知限制**：Ollama 进程守护（v2）、`/api/embeddings` 旧接口（v2）、检索侧维度/阈值适配（v2）。

---

## Self-Review

**① Spec 覆盖**：设计 §3.1→T2；§3.2（四级+优先级+维度硬校验）→T3；§3.3 双通道→T2(pull)+T5(UI)；§3.4 UI→T5；§3.5 错误处理→T3/T5；§3.6 fetchWithTimeout→T1；§6 T1–T5→本计划 T1–T5（+T6 门禁）。
**② 占位符扫描**：无 TBD；各任务给接口签名/测试契约；T4 的策略表 policy 取值要求 implementer 参照现有同类通道（已指明文件）。
**③ 跨任务一致性**：`fetchWithTimeout(url,init,timeoutMs?)`（T1）被 T2 消费；`detectOllama/listOllamaModels/pullModel/embedLocal`（T2）被 T3/T4 消费；`GlobalConfig.localEmbedding`（T4）被 T3/T5 消费；`resolveEmbeddingOrder`（T3）纯函数独立；IPC 通道（T4）被 T5 消费。
**④ 非目标无任务**：内置 ollama 安装/代管、ONNX、`/api/embeddings` 旧接口、进程守护、检索侧适配——均仅声明。
