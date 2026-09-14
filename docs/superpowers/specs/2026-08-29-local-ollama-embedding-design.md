# Ollama 本地向量模型设计（2026-08-29）

> 对应实施计划：后续产出（0.1.6 发布后实施）
> **实施状态：✅ 已实施（2026-09-14，分支 `feat/ollama-local-embedding`）** —— SDD 任务 T1–T6 + T3b + FW-1 全部落地：T1 `d534ab9`（`fetchWithTimeout` 导出 + 超时参数化）、T2 `6ef64d4`（`electron/ollama-embedding.ts` 新模块）、T3 `0ea04d8`+R1 `482f569`（四级降级链 + 维度硬校验）、T4 `232c6cf`+R1 `f6b8196`（`GlobalConfig.localEmbedding` + `embedding:local-*` 通道）、T3b `6166259`+R1 `685a4a1`（查询侧接入）、T5 `50c0da5`（设置卡片 + i18n 三语）、FW-1 `314edcc`（pull 失败终态帧 + `:latest` 双向规范化）；T6（本任务）= 全量门禁 + 真机验证清单 + 文档回更，**无生产代码改动**。逐条差异、任务序列变更与实测更正见 §9，真机清单见 §10。
> ~~**实施状态：⏸️ 未实施**（2026-09-14 核对：全库无 `detectOllama`/`pullModel`/`ollama-embedding` 等任何实现代码；仅有 `provider-presets.ts` 的 Ollama **聊天** provider 与 `url-utils.ts` 的 URL 归一化——与本设计的**本地向量**目标无关）~~ ← 该状态行已过时（描述的是本次改造**之前**的状态），保留仅为追溯。
> ⚠️ **真机（Ollama 实机）验证尚未执行**：本分支的结论止于「单元测试 + 门禁 + 代码审查」；安装/拉模型/导入/降级/维度切换等实机链路**待人工按 §10 清单执行**，本设计不主张已通过。
> 触发背景：2026-08-29 冒烟实测——embedding API 请求挂起 30s（限流环境）导致 kb:import-text 三次 IPC 超时、后处理管线中止。用户提出"可自行开启的基于本地的向量检索模型"以摆脱对远程 API 的依赖（免费/隐私/离线可用）。

## 1. 背景与目标

知识库向量化当前完全依赖远程 Embedding API（openai/gemini 协议），网络受限/限流时导入链路挂起（修复 abort 兜底后降级 FTS-only，但语义检索不可用）。目标：提供**用户可自行开启的本地向量模型**——基于 Ollama（localhost HTTP 集成，零打包、零原生模块），双通道获取（应用内 pull + 手动导入检测），完全离线可用。

**非目标**：不内置 ollama 安装包/代管进程（引导用户安装）；不做 ONNX 内嵌推理（用户已裁决 Ollama 方案）。

## 2. 现状分析（代码锚点）

| 锚点 | 现状 |
|---|---|
| `electron/embedding.ts:23-45` | `fetchWithTimeout`（10s abort 兜底，2026-08-29 修复）——Ollama 调用复用 |
| `electron/knowledge-base.ts:71-101` | `importContent` 三级降级：Embedding API → LLM 向量化 → FTS-only（:104） |
| `electron/knowledge-base.ts:332`（`backfillVectors`） | 同三级降级 |
| `electron/kb-controller.ts:16-32` | `getEmbeddingConfig()` 读 config.json + models.json |
| `~/.novelforge/config.json` | GlobalConfig（模型列表/默认模型/路由）——本地模型配置并入 |
| 模型列表 | 已有 ollama 协议先例（llama3.3 等本地模型走 ollama baseUrl） |

## 3. 设计

### 3.1 新模块 `electron/ollama-embedding.ts`（纯 HTTP，可单测）

```ts
// Ollama REST API（v0.1+ 兼容）
GET  {base}/api/tags            → 已装模型列表 [{name, size, ...}]
POST {base}/api/embed           → { embeddings: number[][] }（批量，v0.3.5+ 推荐接口）
POST {base}/api/pull            → NDJSON 流式进度（{"status":"pulling","digest":...,"completed":...}）
GET  {base}/api/version         → 健康检查 + 版本（**实现口径**：`detectOllama` 的探测端点；`/api/tags` 只服务模型列表）
```

导出（全部 mock-fetch 可测）：
- `detectOllama(baseUrl): Promise<{ ok: boolean; version?: string; error?: string }>`（**`/api/version` 探测**——2026-09-14 更正：本文档此处原写 `/api/tags`，与决策 6 及实现冲突；实现在 `electron/ollama-embedding.ts:54`，`version` 即由此端点返回）
- `listModels(baseUrl): Promise<Array<{ name: string; size: number }>>`（已装模型，过滤 `:latest` 标签规范化）
- `pullModel(baseUrl, model, onProgress): Promise<{ success: boolean; error?: string }>`（/api/pull，NDJSON 行解析 → onProgress({ status, completed, total, percent })；复用 fetchWithTimeout 的 abort 兜底语义——**pull 是长任务，超时需更长（如 5 分钟）**，单独超时参数）
- `embedLocal(texts: string[], baseUrl, model): Promise<number[][]>`（/api/embed 批量；按 index 排序保序；失败 throw 供降级）

**fetchWithTimeout 复用**：embedding.ts 的 `fetchWithTimeout` 导出并支持可选超时参数（默认 10s，pull 传 300s）。

### 3.2 降级链集成（四级 + 用户优先级开关）

```
用户开启本地模型（config.localEmbedding.enabled）：
  优先本地  → Ollama 本地 → Embedding API → LLM 向量化 → FTS-only
  优先 API  → Embedding API → Ollama 本地 → LLM 向量化 → FTS-only
（未开启   → 现状三级不变）
```

- **新配置** `GlobalConfig.localEmbedding: { enabled: boolean; baseUrl: string; model: string; preferLocal: boolean }`（默认：enabled=false, baseUrl='http://localhost:11434', model='bge-m3', preferLocal=true）
- **集成点**：`knowledge-base.ts` 的 `importContent`（降级段 :67-106）与 `backfillVectors`（:332）——新增纯函数 `resolveEmbeddingOrder(cfg): ('local'|'api'|'llm'|'fts')[]` 决定尝试顺序（可单测）；每档失败（throw/空向量）按序降级
- **推理失败语义**：本地失败（未连接/模型缺失/embed 报错）→ 降级下一档（不阻断导入；与现有 `AbortError` 修复后的降级路径一致）
- **backfillVectors 同步接入**（存量库重建索引也走本地——用户痛点场景）
- **维度硬校验（v1 必做）— ✅ 已实施（T3 `0ea04d8` + R1 `482f569`、T4 `232c6cf` + R1 `f6b8196`）**：bge-m3（1024 维）与 API 模型（1536 维）不得混入同一 LanceDB 表——`importContent`/`backfillVectors` 写入前检测现有表向量维度，不一致则**拒绝写入并返回明确错误（提示重建索引）**，不做静默降级；切换模型形态（本地↔API）时 UI 同步提示重建（含 i18n 错误文案）
  - **落点**：`electron/knowledge-base.ts` 的 `assertVectorDimCompatible`（`importContent` 在**删除同名旧文档之前**调用；`backfillVectors` 在**任何写盘动作之前**调用，维度取首个**非空**向量 `firstVectorDim`——T3 R1 修的正是「首位空向量 → `newDim=0` → 守卫静默自跳过」）；`electron/vector-store.ts` 的 `checkUpdateVectorsDim`（回填写入路径 `updateChunkVectors` 的**入口唯一收口点**，T4/A4.1，置于两条写分支之前）；`electron/controllers/kb-controller.ts` 的 `kb:backfill-vectors`（维度错误为**终态**，不再被降级成方式 2 的无守卫写入，T4/A4.2）
  - ⚠️ **为什么必须写前拦截**：实测（lancedb 0.27.2，两方向各被独立复现一次，见 §9.3）维度不匹配**不抛错**，而是静默把该行向量写成 `null`（数据被销毁）——「写后校验」等于数据已毁。

### 3.3 双通道获取

- **通道 A 应用内 pull**：设置页「下载模型」→ `detectOllama` 检查运行 → `pullModel(baseUrl, model)` 轮询进度（设置页进度条 + 状态文本；`{"status":"success"}` 完成）→ 完成后 `listModels` 刷新下拉
  - 网络应对：ollama 自身 registry 下载走 ollama 进程；国内网络问题 → 设置卡片提示文案引导配置 `OLLAMA_MODELS` 目录/代理环境变量（应用不代管代理；**pull 失败错误原文展示 + 手动导入作为通道 B 兜底**）
    - ✅ **已实施（FW-1 `314edcc`）**：原实现只在主进程日志里记录失败——渲染层收不到任何终态信号，进度条永久停帧、下载按钮永久 disabled。FW-1 让控制器在 pull 落定（`success:false` 或 reject）时**补发一帧** `{status:'error', error}` 到 `embedding:local-pull-progress`，渲染层据此收进度条 + 恢复按钮 + 落 `localEmbedding.pullFailed` 主文案（原始错误串只进「原始详情」折叠区，不当主文案）。
    - ⚠️ 遗留：**连接既不返 `{"error"}` 也不 EOF** 时无 app 级超时（`reader.read()` 永久挂起）——见 §8 的 v2 已知限制。
- **通道 B 手动导入**：用户自行 `ollama pull bge-m3`（或已有模型）→ 应用 `detectOllama` + `listModels` 自动检测 → 下拉选择启用；模型缺失状态徽标提示「模型未安装——应用内下载或 ollama pull」

### 3.4 UI（设置页「本地向量模型」卡片，参照 ModelsView 既有模式）

```
┌─ 本地向量模型 ─────────────────────────────┐
│ [开关] 启用本地向量模型                      │
│ Ollama 地址: [http://localhost:11434]       │
│ 状态: 🟢 已连接 v0.5.x / 🟡 未连接(引导)    │
│ 模型: [bge-m3 ▼]  (bge-m3 多语言 1024 维)    │
│ [⬇ 下载模型 (bge-m3)] [🧪 测试]             │
│ 向量优先级: ○ 本地优先(免费/隐私) ○ API 优先 │
│ └ 说明: 需已安装 Ollama；模型文件由 Ollama   │
│   管理（OLLAMA_MODELS 目录可自定）           │
└─────────────────────────────────────────────┘
```

- 状态徽标三态：未连接（引导安装说明）/ 已连接但模型缺失（双通道提示）/ 就绪（绿色）
- 测试按钮：`embedLocal(['测试文本'])` 验证推理 + 维度显示
- i18n 三语 key：`localEmbedding.*` 约 12-15 个

### 3.5 错误处理

| 场景 | 行为 |
|---|---|
| ollama 未安装/未运行 | 状态徽标引导（安装 Ollama → 启动）；降级链自动走下一档，不阻断导入 |
| 模型缺失 | 双通道提示（应用内下载 / ollama pull）；降级 |
| pull 网络失败 | 错误原文展示 + 提示配置代理/镜像；通道 B 兜底。**✅ 已实施（FW-1 `314edcc`）**：控制器在 pull 落定时补发终态帧 `{status:'error', error}`（渲染层原来看不到失败 → 进度条永久停帧 + 按钮永久 disabled），UI 据此收进度条 / 恢复下载按钮 / 落 `localEmbedding.pullFailed` 主文案（原始错误串只进「原始详情」折叠区，不作主文案）。**遗留**：连接既不返 `{"error"}` 也不 EOF 时无 app 级超时 → §8 的 v2 已知限制 |
| embed 推理失败（OOM / 网络 / 5xx 等**瞬时性**失败） | 降级下一档 + 日志 warn（错误脱敏） |
| embed **维度不符**（本次生成维度 ≠ 现有索引维度） | ⛔ **终态，不降级** —— 与 §3.2 / §9.4 及实现一致（T4/A4.2）：`assertVectorDimCompatible` 抛 `VectorDimMismatchError`，`backfillVectors` 以 `errorCode: 'dim-mismatch'` 上交，controller 见即**原样透传**、绝不进「换下一种方式」。理由：写侧换档只会得到另一组维度，继续尝试等于用**静默破坏**（§9.3 实测：两方向都静默写坏）换一个假成功；正确出路是提示用户重建索引。**final wave W3 更正**：本行原与「OOM」合并为「降级下一档」，与实际行为及 §3.2/§9.4 自相矛盾 |
| 配置损坏 | 读失败回退默认值（既有 GlobalConfig 模式） |

### 3.6 与 fetchWithTimeout 修复的关系

`fetchWithTimeout` 导出 + 超时参数化（默认 10s 不变；pull 长任务 300s）——2026-08-29 的 abort 兜底（Promise.race 立即 reject）对 Ollama 调用同样生效（挂起的 ollama 请求 10s 内 reject → 降级）。

## 4. 影响面与风险

| 项 | 风险 | 缓解 |
|---|---|---|
| 新模块 ollama-embedding.ts | 纯 HTTP 无状态 | mock fetch 全量单测 |
| 降级链改动 | 既有三级路径行为变化 | resolveEmbeddingOrder 纯函数 + 既有测试回归（importContent 未开启本地时路径不变） |
| config 扩展 | GlobalConfig 兼容 | 可选字段默认值，读失败回退 |
| pull 长任务 | IPC 30s 超时（渲染端） | pull 走专用通道 + 进度事件（`embedding:local-pull-progress` event 通道，非 invoke 等待）；或 invoke 超时参数豁免——**设计裁决：专用 event 通道推送进度，invoke 仅发起**（参照 llm:generate-stream 模式） |
| Ollama API 版本差异 | /api/embed 在旧 ollama 缺失 | 检测失败回退 /api/embeddings（单文本循环）——**v1 仅支持 /api/embed，探测失败提示升级 ollama**（版本引导文案） |

## 5. 测试计划

- `electron/ollama-embedding.test.ts`（mock fetch）：detect 三态、listModels 过滤/排序、pull NDJSON 解析与进度回调、embed 保序/失败 throw、超时参数化（挂起 mock + fake timers——复用 embedding.test.ts 模式）
- `knowledge-base` 降级顺序：resolveEmbeddingOrder 四分支（未开启/本地优先/API 优先）纯函数测试
- 集成测试（可选）：mock embedding 服务顺序调用断言
- 组件测试：设置卡片状态徽标/开关/测试按钮（参照 ModelsView 测试模式）
- 门禁：typecheck / lint 零错误零警告；全量测试绿

## 6. 任务拆分建议（0.1.6 发布后执行）

- **T1**：`fetchWithTimeout` 导出 + 超时参数化（embedding.ts，小）+ 既有测试适配
- **T2**：`ollama-embedding.ts` 新模块（detect/list/pull/embed + 测试）
- **T3**：降级链集成（resolveEmbeddingOrder + importContent/backfillVectors 接入 + **维度硬校验** + 测试）
- **T4**：config 扩展（GlobalConfig.localEmbedding + config-controller 读写 + 默认值）+ IPC 通道（`embedding:local-*`：detect/list/pull 发起 + pull-progress 事件，preload 白名单 'embedding:' 已有）
- **T5**：设置页 UI 卡片（开关/地址/模型下拉/下载进度/测试/优先级单选 + i18n 三语）+ 组件测试
- **顺序**：T1 → T2 → T3 → T4 → T5（每任务独立 commit，SDD 或 Inline）

**实际执行序列（2026-09-14，SDD）**：**T1 → T2 → T3(+R1) → T4(+R1) → T3b(+R1) → T5 → FW-1 → T6** —— 与原建议的两处差异，均已落进计划文件：

- **T3b（查询侧接入，新增，v1 必做）**：T3 review 裁定原 §8 的「检索侧适配」**不能留 v2** —— 写入侧接了本地档、查询侧未接，等于**开启开关反而让语义检索从「能用」变「不能用」**（纯本地用户没有查询向量；有 API Key 的用户是 1536 维 query 打 1024 维表）。开关因此不具可观察价值，故提升为 T3b（`6166259` + R1 `685a4a1`）。**v2 只剩检索侧「阈值/RRF 权重/top-K 调参」**（查询侧**接线**已 v1 落地）。
- **T3b 的范围由 review 追加（scope override）**：模块层 `searchKnowledge` 接好后，「纯本地用户」在 controller 层仍走不到它（`getEmbeddingConfig()` 返回 `null` → handler 直接落 `searchKnowledgeFTS`）——R1 因此追加了 `kb-controller.ts` 的查询 handler 门控（`kb:search` / `kb:search-with-scope`）。这与 T4/A4.2 修好的**回填侧**门控是同一类「模块层修好但用户不可达」缺陷。
- **R1 修复轮**：T3 R1 `482f569`（backfill 守卫改用首个**非空**向量）、T4 R1 `f6b8196`（review Minor 收口）、T3b R1 `685a4a1`（上述门控）。
- **FW-1（final fix wave）`314edcc`**：pull 失败终态帧 + 模型名 `:latest` 双向规范化。

## 7. 决策记录（已裁决）

| # | 决策 | 理由 |
|---|---|---|
| 1 | Ollama 形态（非 ONNX） | 用户裁决——零打包、零原生模块、模型管理移交 ollama |
| 2 | 双通道获取（应用内 pull + 手动导入检测） | 用户裁决——网络环境兜底 |
| 3 | 优先级用户可选（preferLocal 开关） | 用户裁决——本地优先（免费/隐私）与 API 优先（质量/速度）由用户权衡 |
| 4 | 默认模型 bge-m3 + 下拉可换 | 用户裁决——多语言 1024 维中文强；nomic-embed-text 等备选 |
| 5 | pull 进度走 event 通道（非 invoke 等待） | IPC 30s 超时约束——参照 llm:generate-stream 模式 |
| 6 | v1 仅支持 /api/embed（旧 ollama 引导升级） | 简化 v1；版本检测在 detectOllama 返回 version |
| 7 | fetchWithTimeout 导出 + 超时参数化 | 复用 2026-08-29 abort 兜底；pull 300s 长任务 |

## 8. Deferred（不阻塞）

- Ollama 进程自管理（内置安装/启动守护）——v2
- /api/embeddings 旧接口兼容——v2
- 本地模型与 RAG 检索链路检索侧优化（searchKnowledge 混合检索对本地模型维度/阈值的适配）——v2（**维度一致性硬校验已升为 v1 必做，见 §3.2 / T3**；**查询侧接线已由 T3b 落地 v1**——v2 只剩阈值 / RRF 权重 / top-K 调参）

### 8.1 已知限制（v2 待修，登记于 T6；W3/W9 于 final wave 补充）

- **v2 已知限制：`pullModel` 的 NDJSON 流读取无 app 级超时**（`fetchWithTimeout` 的 300s 仅覆盖响应头，`clearTimeout` 在 `electron/embedding.ts:45` 已执行）；若连接既不返 `{"error"}` 也不 EOF，进度条将保持不确定态。**修法（v2）**：在 `electron/ollama-embedding.ts:194` 的 `reader.read()` 外包 idle watchdog（如 300s 无数据帧 → `reader.cancel()` + 返回 `{success:false,error}`），并补 fake-timer 用例证明「慢但在进展」不误杀。
  - 影响面：仅通道 A（应用内 pull）的**不确定态**；已有 `{"error"}` 帧 / 流截断 / 非 200 / 发起超时四类失败均由 FW-1 的终态帧正常收敛（终态帧补发见 §3.3、§3.5）。
  - 来源：FW-1 报告 §⑦.1（reviewer 指定 T2 不动，作为独立后续项登记）。
  - **如何摆脱该状态（W3 更正）**：这是本页原表述**写错**的一点。`pullsInFlight`（`electron/controllers/local-embedding-controller.ts` 的**模块级** Map）是**主进程模块**状态：
    - ✅ **只有重启 app**（主进程模块重新求值）才会清掉它 → 之后可以重新发起 pull；
    - ❌ **重开设置页不会清** —— 重开只重置**渲染层** React state（进度条消失、按钮看起来可点），主进程 Map 里的 key 还在；用户一点「下载模型」就撞上 `{started:false, error: …}`（`error.localPullInProgress` 的「该模型正在下载中」），而**进度事件早已不再产生** → 呈现出「没在下但说在下」的**假进行态**，比原表述的「重开即恢复」更糟。
    - **交叉引用**：上面那条 v2 idle-watchdog 修法的 `reader.cancel()` 分支**也应同时 `pullsInFlight.delete(key)`**（与 FW-1 在 `.finally` 里补的删除同法），否则 watchdog 只让进度条收敛、重试仍被同一个 Map 挡住。
- **v2 已知限制：pull 进度载荷没有模型标识（W9-a）** —— `embedding:local-pull-progress` 的 payload 只有 `{status, completed, total, percent, error?}`，**不含 model**。两个并发 pull（不同 `(baseUrl, model)` 键可各自 in-flight）的进度帧因此无法区分，**后到的第一个终态帧会把另一个仍在下载的进度条一并清掉** → 表现为另一个下载的进度条提前消失。
  - 严重度：**外观级、自愈** —— 下载本身在 Ollama 进程内继续，模型最终仍会装好；`local-list-models` 轮询/重开设置页即可看到真实状态；无数据损坏、无假成功。
  - **修法（v2）**：payload 加 `model: string`，UI 只消费与当前展示模型匹配的帧（`p.model === model` 时才 setPull/收进度条）。**v1 不作**：需要同时改 T4 的 payload 类型、控制器补发点与 T5 的消费侧（3 处 + 三语无关），而收益只是并发 pull 的外观，不值当在合并前动 T2/T4 已冻结的载荷契约。
- **v2 待办清单（W9）**：以上两条即为 v2 的全部未结项 —— (a) pull 进度载荷缺模型标识（外观级）；(b) `pullModel` NDJSON 无 idle watchdog（含「顺带清 `pullsInFlight`」）。**除此之外无其它未登记项。**

## 9. 实施记录与文档回更（2026-09-14，T6）

### 9.1 交付物 ↔ commit

| 任务 | commit | 交付物 |
|---|---|---|
| T1 | `d534ab9` | `electron/embedding.ts`：`fetchWithTimeout` 导出 + 第三参 `timeoutMs`（默认 10s 不变） |
| T2 | `6ef64d4` | `electron/ollama-embedding.ts` + 单测（detect/list/pull/embed，纯 HTTP，不 import electron） |
| T3 | `0ea04d8` | `electron/embedding-order.ts`（`resolveEmbeddingOrder`/`hasUsableVectors`/`firstVectorDim`）+ `electron/knowledge-base.ts` 四级降级链 + `assertVectorDimCompatible` |
| T3 R1 | `482f569` | backfill 守卫改用 `firstVectorDim`（首位空向量不再让守卫静默自跳过） |
| T4 | `232c6cf` | `GlobalConfig.localEmbedding` + 6 条 invoke（`embedding:local-*`）+ 1 条 event（`embedding:local-pull-progress`，经策略表 + `guardedHandle`）+ `updateChunkVectors` 入口守卫 + backfill 门控 |
| T4 R1 | `f6b8196` | review Minor 收口（errorCode 真实断言 / 方式 2 错误面 / 文案清理） |
| T3b | `6166259` | `searchKnowledge` 查询侧接入本地档 + 维度兼容门 |
| T3b R1 | `685a4a1` | `kb:search` / `kb:search-with-scope` 的 controller 门控（纯本地用户可达性） |
| T5 | `50c0da5` | `src/components/settings/VectorConfigSection.tsx` 卡片 + `localEmbedding.*` 27 key × 三语 |
| FW-1 | `314edcc` | pull 失败终态帧（payload `error` + 控制器补发 + UI 落 `pullFailed`）+ `:latest` 双向规范化 |
| T6 | （本文档所在 commit） | 全量门禁 + 真机清单 + 本次回更，**无生产代码改动** |

### 9.2 本次回更的过时点（行号为回更**前**的行号）

| 原行 | 原文（要点） | 回更后 |
|---|---|---|
| `:4` | 「**实施状态：⏸️ 未实施**」 | ✅ 已实施（T1–T6 + T3b + FW-1）+ 标注**真机验证尚未执行** |
| `:33` | `/api/version → 健康检查（可选，tags 可兼作）` | `/api/version → 健康检查 + 版本`（**实现口径**：`detectOllama` 的探测端点；`/api/tags` 只服务模型列表） |
| `:37` | `detectOllama … （/api/tags 探测）` | `（/api/version 探测）`——与决策 6 及实现一致（`electron/ollama-embedding.ts:54`） |
| `:57` | §3.2 维度硬校验（未标状态） | 标注 ✅ 已实施 + 三条落点 + 「为什么必须写前拦截」（§9.3） |
| `:62` | §3.3「pull 失败错误原文展示 + 通道 B 兜底」 | 标注 ✅ **FW-1 `314edcc`** 已实施（终态帧机制）+ 遗留限制指向 §8.1 |
| `:90` | §3.5「pull 网络失败」行 | 同上（终态帧 + 原文只进折叠详情 + v2 遗留） |
| `:123` | §6「顺序：T1 → T2 → T3 → T4 → T5」 | 追加**实际序列**：T1 → T2 → T3(+R1) → T4(+R1) → **T3b(+R1)** → T5 → **FW-1** → T6，并记录 T3b 从 §8 v2 提升为 v1 的理由与 T3b 的 review 驱动扩权（查询 handler 门控） |
| `:141` | §8「检索侧优化——v2」 | v2 只剩**阈值/RRF/top-K 调参**（查询侧接线已由 T3b 落地 v1）；新增 §8.1 v2 已知限制（`pullModel` NDJSON idle watchdog） |

### 9.3 实测更正：维度不匹配是**静默破坏**，不是客户端报错

- **原表述（不成立）**：设计 §3.2 / T3 brief 记「1024 维写进 1536 维列 → 客户端抛 `TypeError`」。
- **实测（lancedb 0.27.2；T3 review、T4 review 与 final wave 各自独立复现一次）**：

| 写入路径 | 写入形状 | 目标列 | 实测结果 |
|---|---|---|---|
| `table.update` | 1024 值 | `FixedSizeList(1536)` | **不抛错**：`rowsUpdated = 1`，该行向量被写成 **`null`**（向量被销毁，行退回「无向量」态） |
| `table.update` | 8 值 | `FixedSizeList(4)` | **不抛错**：同上，静默写 `null` |
| `table.update` | `[]`（空数组） | 任意维度 | **抛错**：`concat requires input of at least one array`（唯一会抛的形状） |
| **`table.add`** | **6 值** | **`FixedSizeList(4)`** | **不抛错，且列维度不变（仍 `FixedSizeList[4]<Float32>`）**：长向量被**静默截断**为 `[0.5,0.5,0.5,0.5]` |
| **`table.add`** | **2 值** | **`FixedSizeList(4)`** | **不抛错，列维度不变**：短向量被**静默补零**为 `[0.1,0.2,0,0]` |

> W3 补充的第 4/5 行（`table.add` 的截断/补零）来自 final wave 的真实 LanceDB 探针；前 3 行此前已在 T3/T4 review 各复现一次。**`table.add` 既不改列维度也不报错**这一点尤其值得记住 —— 它意味着「加列」不是维度不符时的兜底出路，只会静静篡改向量本身。

⇒ **维度不符时，两条写入路径都会在零报错的情况下改变向量内容**（`update` 把该行置 `null` = 销毁；`add` 截断/补零 = 篡改）——「写后校验」等于数据已毁。这就是守卫必须置于**写盘之前**的原因，也是 T4/A4.1 把守卫放在 `updateChunkVectors` **两条写分支之前**、T3 把校验放在**删除同名旧文档之前**的理由（§3.2 落点）。

### 9.4 既有缺陷登记：`addChunks` 自带的维度守卫**只在特定数据形状下可达**（T6 只记录，不修）

`electron/vector-store.ts` 的 `addChunks` 里有一段「采样现有行比维度」的守卫（`if (hasAllFields)` 分支内，`vector-store.ts:425-445`），其可达性取决于**表 schema 当前是否含全部 11 个 `requiredFields`**（`vector-store.ts:421`）——而这又取决于**建表时那些列有没有数据**。

> **本节曾两次写错机制**（`def2fdf` 的 T6 版写「在真实路径上永远跑不到」过于绝对；`ab5193c` 的 W3 版把因果错记为「剪枝只发生在 schema 推断路径」）。**以下为第三次订正，依据是 final wave R2 的 2×3 矩阵探针 + 形态复刻探针（lancedb 0.27.2）**，且规则已与整支复审的独立探针一致。

**剪枝规则（探针确立，请以此为准）**：

> 某列被剪 **当且仅当每条记录该字段的值都是 `undefined`** —— **与是否显式 schema 无关**。
> `null` **是一个值**：显式 schema 下保留；无显式 schema 走推断时 `null` 会**抛错**（而非被剪）。

| 建表方式 | 记录中该字段 | 探针结果 |
|---|---|---|
| 显式 schema | 全 `undefined`（键存在） | **剪掉** |
| 显式 schema | 全 `null` | **保留**（`null` 是值） |
| 显式 schema | 有值 | **保留** |
| 无 schema（推断） | 全 `undefined`（键存在或键缺失，等价） | **剪掉** |
| 无 schema（推断） | 全 `null` | **抛错** `Failed to infer data type for field chapterNumber at row 0` |
| 显式 schema | 多行混合：1 行 `undefined` / 1 行有值 | **保留**（「当且仅当**每条**都 `undefined`」） |

⇒ **上一版把因果记错了**：`addChunks` 的**首次建表也传显式 schema**（`await db.createTable(TABLE_NAME, records, { schema: targetSchema })`，`vector-store.ts:475`），并不是推断路径 —— 而全 `undefined` 列**在那条路上照样被剪**。故「剪枝发生在推断路径」这一因果**不成立**，唯一决定因素是**数据**。

`addChunks` 构记录时**总是**带上 `chapterNumber`/`chapterTitle` 两个键（无章节元数据时为 `undefined`，`vector-store.ts:401-402`）→

1. **首导是 chapter-less 文档**（最常见）→ 两列全 `undefined` → **首建即被剪**（实测列 = `id,docId,fileName,text,tokens,chunkIndex,totalChunks,importedAt`）→ `requiredFields` 缺 `chapterTitle`（首导无向量时还缺 `vector`；`chapterNumber` 会被 `ensureChunksSchema`（`vector-store.ts:272`）补上、`tokens` 已在）→ `hasAllFields === false` → 走**重建分支**，而守卫只存在于 `hasAllFields === true` 的**非重建分支** → **该次导入的守卫不可达**。
2. **首导同时满足「带章节元数据」与「带向量」** → 11 个字段在首建时即齐全（探针：列 = `…,chapterNumber,chapterTitle,…,vector,…`）→ 下一次导入 `hasAllFields === true` → **守卫可达**。
   - ⚠️ **两个条件都必需**：`requiredFields` 含 `vector`（`:421`），所以「章节名首导但**没有**向量」同样 `missing=[vector]` → `hasAllFields === false` → **该次导入守卫仍不可达**（W3 版漏了这条条件，R2 补上）。
3. **可达性是「每次导入」判定的，不是库的永久属性** —— 这一点与 T6/W3 两版都不同。形态 1 的库并非**永远**不可达：若后续来一次「**章节化 + 带向量**」的导入，它因 `missing` 非空触发**重建分支**（`drop` + `create`，`vector-store.ts:464` / `:471`），重建后 `chapterTitle` 由**那次导入的行**重新带回 schema → 11 字段齐全 → **此后守卫可达**（探针实测：`导入2 重建后 missing=[] hasAllFields=true` → `导入3 判定 hasAllFields=true → 守卫可达`）。
   - 唯一**不能**靠时间自然恢复的情形：`ensureChunksSchema` **从不补 `chapterTitle`**（它只补 `chapterNumber` 与 `tokens`，`:272`）—— 所以若一个库**从未**经历过任何带章节元数据的（重）建表，`chapterTitle` 就回不来。
4. 即：**原「永远跑不到」不成立**。守卫是活代码；它是否生效取决于「当前表 schema 是否齐全」，而 schema 齐全与否由**最近一次建表时行的数据形状**决定。

**重建分支的具体危害**（守卫不可达的那条路）：

5. `rebuildSchema = VECTOR_DIM > 0 ? targetSchema : buildChunksSchema(detectVectorDimFromSchema(existingSchema.fields))`（`vector-store.ts:468-470`）→ **drop + create 静默采纳新维度**（实测 1536 → 1024），既有行的向量被静默截断；
6. `await db.dropTable(TABLE_NAME)`（`vector-store.ts:464`）先于 `await db.createTable(...)`（`:471`），**中途失败无恢复路径**（临时表 + 恢复逻辑只存在于 `backfillVectors`，不覆盖 `addChunks`）。
   > 行号锚点已于 R2 按 `ab5193c` 复核（T6/W3 版引的 `:418/:422-442/:461/:468/:472` 分别为本波改动所挤后，现为 `:421/:425-445/:464/:471/:475`）。

**防线现状（这才是真正拦住混维的两道）**：

| 写入路径 | 拦截者 | 落点 |
|---|---|---|
| `importContent` → `addChunks`（含 `kb:import-*`） | **T3 的写前校验** `assertVectorDimCompatible`（在删旧文档 / 任何写盘动作之前）。**主拦截者**——`addChunks` 自带的那段守卫只在 `hasAllFields === true` 时执行，而 `hasAllFields` 由建表时的数据形状决定（见上），不能依赖 | `electron/knowledge-base.ts` |
| `backfillVectors`（含 controller 方式 2 的 LLM 逐行写入） | T3 的写前校验 **+ T4 的 `updateChunkVectors` 入口守卫** `checkUpdateVectorsDim` | `electron/knowledge-base.ts` / `electron/vector-store.ts` |

**T6 不改**：本任务是验证 + 文档，任何生产代码改动都会让本次门禁与真机结论脱离最终产物；修 `addChunks` 应当独立成任务（连带 `drop`/`create` 的失败恢复）。

### 9.5 与实测冲突的代码注释

- `electron/vector-store.ts` 的 `checkUpdateVectorsDim` 文档注释原写「1024 写 1536 列在客户端抛 TypeError」——与 §9.3 的实测不符（实际是静默写 `null`）。**✅ 已由 final wave W2 订正**（该 commit）：注释改为记录两条路径的真实失败模式（`update` 静默写 `null`；`add` 静默截断/补零且不改列维度），并点明这正是写前守卫存在的理由。
- `electron/knowledge-base.ts` 的 `assertVectorDimCompatible` 注释里记的是 `addChunks`（`table.add`）路径「整列静默重写成 1024」——与 §9.3 的 `table.update`（`rowsUpdated`）路径是**两条不同路径**；§9.3 新增的 `table.add` 行（截断/补零、**不改列维度**）与之方向一致但机制不同，**该条仍未逐字复现，不主张其已订正或已证伪**（列入真机/后续核对）。行号锚点 R2 已改为**符号名**（原引 `:103-105` 已因本波注释插入而漂移）。

## 10. 真机验证清单（人工执行；**截至 2026-09-14 尚未执行**）

> 目的：本分支的全部自动化证据止于「mock fetch 单测 + 组件测试 + 门禁」，**没有任何一步跑在真实 Ollama 上**。
> 环境：Windows/macOS/Linux 桌面机 + `feat/ollama-local-embedding` 分支；`pnpm install` 后 `pnpm run dev`（或安装打包产物）。
> 日志：`~/.novelforge/logs/vela-YYYY-MM-DD.log`（LogsView 亦可）；文案以 zh-CN 为准。
> 每步都写「操作」+「期望观察」；**任何一步不符即为真机不通过**，请连同日志片段回填。

**A. Ollama 未安装**
1. 确认本机没有 `ollama` 命令/进程（`ollama --version` 报命令不存在）。
2. 打开 设置 → 向量配置，找到「本地向量模型」卡片。
3. 期望：状态徽标 = **「未连接」**；卡片出现**安装引导**（含 https://ollama.com）；「下载模型」与「测试模型」按钮**均不可点**（二者均要求「已连接」）；模型下拉仍列出配置里的默认模型名（`bge-m3`）。

**B. Ollama 已安装、模型缺失**
4. 安装并启动 Ollama（`ollama serve` 或桌面端），**不**拉任何模型；回到设置页（或点「测试模型」触发一次探测）。
5. 期望：状态徽标 = **「已连接，但模型 bge-m3 未安装」** + 版本号；出现**双通道提示**：①点上方「下载模型」在应用内下载 ②终端执行 `ollama pull bge-m3`；此时「下载模型」按钮**可点**（已连接）。

**C. 应用内 pull（通道 A）**
6. 点「下载模型 bge-m3」。
7. 期望：先出现**不确定态**「正在下载…」（进度条动画），随后出现百分比并推进；期间按钮保持 disabled。
8. 完成后期望：进度条**消失**；模型下拉**自动刷新**并出现 `bge-m3`；状态徽标变 **「就绪」**。
9. 验证模型名规范化：`ollama list` 显示 `bge-m3:latest`，而卡片下拉显示 `bge-m3`（不应因此误报「未安装」）。

**D. ⭐ 拉取不存在的模型（FW-1 验收，最关键的一条）**
10. 把模型（下拉/配置）改成一个**不存在**的名字（如 `definitely-not-a-model`），点「下载模型」。
11. 期望（三条同时成立）：① 进度条**被清掉**（不留永久停帧）；②「下载模型」按钮**恢复可点**（可重试）；③ 出现 `localEmbedding.pullFailed`（「下载模型失败」）**主文案**，其后附可折叠的**原始错误详情**（含 Ollama 返回的原文）；④ 卡片不显示任何英文技术串当主文案。
    - 反例（改造前的行为，供对照）：进度条永久停帧 + 按钮永久 disabled。

**E. 导入走本地档**
12. 打开/新建一个测试项目；把本地向量开关**打开**、优先级选「本地优先」；点「测试模型」。
13. 期望：测试成功 → **「测试成功：1024 维」**（bge-m3 = 1024 维）。
14. 导入一份文档（设置页同页的导入入口或 `kb:import-*` 对应 UI）。
15. 期望：导入成功；日志出现本地档路径（`kb.vectorizingWith` 带 `Ollama (bge-m3)`）；`kb:stats` 的向量维度 = 1024。

**F. 停掉 Ollama 后导入不被阻断**
16. 退出 Ollama（确认 `ollama --version` 仍可用但服务不再监听 11434）。
17. 再导入一份文档。
18. 期望：导入**仍然成功**；日志出现本地档失败 warn 并降级（api → llm → FTS）；**不出现**导入失败对话框、不阻断后续流程。

**G. 查询侧（T3b 验收）**
19. 在「本地维度（1024）+ 本地档开启」的库上执行一次知识库检索（Agent 检索或 `kb:search` 入口）。
20. 期望：检索**走语义通道**（不是静默 FTS 兜底）；日志无 `log.embedding.queryDimMismatch`。
21. 把库切成 1536 维（例如用远端 Embedding API 模型重建一次，或换一个 1536 维的测试库），再用同一 query 检索。
22. 期望：**不报错**；按维度兼容门回落（本地档被跳过）；日志出现 `log.embedding.queryDimMismatch`（`table 1536 / got 1024`），随后仍有结果返回。

**H. 维度切换被拒绝 + U2 告警**
23. 库为 1536 维（API）时，开启本地档并导入一份文档。
24. 期望：写入**被拒绝**并给出 `error.embeddingDimMismatch`（中文：向量维度不一致…请重建知识库索引…），**不静默降级、不半写入**（文档不应出现在已导入列表里）。
25. 反向：库为 1024 维（本地）时改用 1536 维 API 模型导入 → 同样被拒绝。
26. 在设置页点「测试模型」：期望出现 **U2 黄色维度不匹配告警**（本地 1024 维 vs 索引 1536 维），文案为 `localEmbedding.dimMismatch`。
    - 注意：该告警由**点「测试模型」**触发（测试成功后另取 `kb:stats` 比对），不是打开卡片就自动出现。

**I. `kb:backfill-vectors` 纯本地可达（T4/A4.2 验收）**
27. 项目**不配置**任何远端 Embedding 模型（模型列表里没有 embedding 模型），仅开启本地档。
28. 触发 `kb:backfill-vectors`（向量回填入口）。
29. 期望：回填**走本地向量**并成功（`processed > 0`）；**不**出现 `kb.noVectorMethod`（「无可用向量化方式」）、**不**掉进 FTS-only。
30. 构造维度不匹配（表 1536 维 + 本地 1024 维）再回填。
31. 期望：返回维度错误并**原样透传**（终态），**不**降级到 LLM 逐行写入路径（日志中不应出现 `log.kb.embeddingFailedTryLlm` 的「换方式」提示）。

**J. 重启后配置持久**
32. 关掉应用、重启。
33. 期望：本地向量开关、Ollama 地址、模型、优先级单选**逐项保持**；卡片状态徽标重新探测后仍为三态中的正确一态（未连接 / 模型缺失 / 就绪）。

**回填格式**：逐步记录「步骤号 / 实际观察 / 是否一致 / 日志时间戳片段」；不一致项请附 `~/.novelforge/logs` 对应片段与截图。
