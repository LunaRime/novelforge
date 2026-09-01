# Ollama 本地向量模型设计（2026-08-29）

> 对应实施计划：后续产出（0.1.6 发布后实施）
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
GET  {base}/api/version         → 健康检查（可选，tags 可兼作）
```

导出（全部 mock-fetch 可测）：
- `detectOllama(baseUrl): Promise<{ ok: boolean; version?: string; error?: string }>`（/api/tags 探测）
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
- **维度硬校验（v1 必做，T3 实现）**：bge-m3（1024 维）与 API 模型（1536 维）不得混入同一 LanceDB 表——`importContent`/`backfillVectors` 写入前检测现有表向量维度，不一致则**拒绝写入并返回明确错误（提示重建索引）**，不做静默降级；切换模型形态（本地↔API）时 UI 同步提示重建（含 i18n 错误文案）

### 3.3 双通道获取

- **通道 A 应用内 pull**：设置页「下载模型」→ `detectOllama` 检查运行 → `pullModel(baseUrl, model)` 轮询进度（设置页进度条 + 状态文本；`{"status":"success"}` 完成）→ 完成后 `listModels` 刷新下拉
  - 网络应对：ollama 自身 registry 下载走 ollama 进程；国内网络问题 → 设置卡片提示文案引导配置 `OLLAMA_MODELS` 目录/代理环境变量（应用不代管代理；**pull 失败错误原文展示 + 手动导入作为通道 B 兜底**）
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
| pull 网络失败 | 错误原文展示 + 提示配置代理/镜像；通道 B 兜底 |
| embed 推理失败（OOM/维度不符） | 降级下一档 + 日志 warn（错误脱敏） |
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
- 本地模型与 RAG 检索链路检索侧优化（searchKnowledge 混合检索对本地模型维度/阈值的适配）——v2（**维度一致性硬校验已升为 v1 必做，见 §3.2 / T3**）
