# 模型管理整合设计（v2）：dsh 式一体卡 + 拉取对齐

> 2026-09-28 · 状态：待审 · 依据：用户四点指令（一体卡 / 供应商与自定义 API 两模式 / 删温度 / 已添加模型置顶）+「获取模型列表改成与 dsh 一样」+ pi-ai 目录移植（用户已选「规格数据 + 新供应商」）
> 前序：v1 spec `2026-09-28-model-management-ui-design.md`（已实现：行内编辑 / 按钮规范 / 搜索全选 / 获取面板）。**本设计取代 v1 的信息架构**（两段列表 → 一体卡）；v1 的交互组件在卡内沿用。

## 一、目标形态

```
设置 → AI 模型
┌─ 模型 ──────────────────────────────────────────────┐
│ ▸ OpenAI ───────────────────────────────────┐       │
│ │ api.openai.com · 凭据已配置           [编辑]│       │
│ │   gpt-4o                     生成 · 默认   │       │
│ │   text-embedding-3-small     向量          │       │
│ │   + 添加模型                               │       │
│ └───────────────────────────────────────────┘       │
│ ▸ 自定义 API（api.example.com） ─────────────┐       │
│ │   ...                                      │       │
│ └───────────────────────────────────────────┘       │
│ ▸ 其他（无归属的历史模型，如有） ────────────┐       │
│ └───────────────────────────────────────────┘       │
│ [+ 添加供应商] ← 菜单：从供应商目录 / 自定义 API      │
└─────────────────────────────────────────────────────┘
```

- 全设置**只有一个模型管理区**：「AI 模型」段即全部；「向量模型」段移除重复的模型管理（保留本地向量/维度等配置）
- 卡 = 凭据（key/地址）+ 它名下的模型行（**生成/向量混排**，行带类型标签）；自定义 API 就是一张普通卡
- 新模型**倒序显示**（最新添加在卡顶；纯显示层 reverse，不动存储顺序）——「置顶」需求①「模型区即主体」+ ②「新行在前」同时满足

## 二、数据与兼容（**存储结构不动**）

- 一体卡 = 现有 `ProviderAccount`（凭据 + `modelNames`）+ `isModelOfAccount` 派生的 `ModelProfile` 行——机制已存在，生成/向量本就同账户混装
- 自定义 API = `provider: 'custom'` 的账户——类型已支持，零数据改动
- **无归属的历史模型**（id 无 `accountId::` 前缀）→ 兜底一张「其他」卡收留（可见、可编辑、可删）；**不做自动迁移**
- `models.json` / 供应商账户存储**不动**；本设计的唯一数据层改动见 §五

## 三、组件结构

| 组件 | 职责 | 来源 |
|---|---|---|
| `ModelProviderCard`（新） | 一张供应商卡：头部（名称/地址/凭据状态/编辑）+ 模型行列表（倒序）+「添加模型」入口 | 新写；行内编辑复用 v1 的 `ModelForm` 行内展开形态 |
| `ModelPickerDialog`（新） | 「获取模型」Modal：拉取 → 候选（搜索/全选/多选/已添加禁用）→「采用所选」批量加行；含手工输入出口 | 替换 v1 的供应商区内联清单与模型表单 Popover 面板 |
| `ProviderCardForm`（演进自 `ProviderAccountForm`） | 新建/编辑卡的凭据表单：**两模式**（从供应商目录选 / 自定义 API 手填地址）；**目录模式可勾选初始模型**（来自该家预设，写入 `modelNames`），自定义模式建卡后在卡内添加 | 现 `ProviderAccountsSection` 的编辑表单改造 |
| `ModelListSection`（改组） | 从「模型列表 + 表单替换」改为「卡列表容器」；`ModelForm`（行内编辑/字段）保留 | v1 产出，砍掉列表级状态机，保留行组件 |
| `SettingsModal` | llm 段承载一体卡区；embedding 段移除模型管理 | 段结构重组 |

**添加模型只有一个入口**：卡内「+ 添加模型」→ 打开 `ModelPickerDialog`（打开即用卡凭据拉取；失败/无列表时用对话框内手工输入行添加）——与 dsh 的"fetch 拿候选 or 手输"一致。

## 四、拉取对齐 dsh（ModelPickerDialog 交互契约）

- 打开 → 自动拉取（loading 态）→ 候选列表：**checkbox 多选 + 搜索过滤 + 全选/反选**
  - 已在卡内的模型：标记「已添加」且**禁用勾选**
  - 手工输入行（回车添加）常驻底部
- 失败 → 对话框内错误文案（沿用 NF 的分类文案：401/404/超时/其它）
- 「采用所选（N）」→ 合并进 `account.modelNames` 提交 → 新行**倒序出现在卡顶**
- Esc/关闭 → 不落任何更改（关闭即弃）

## 五、IPC 扩展（放开 v1 的「不动数据层」非目标，仅此两处）

1. `llm:list-provider-models`：返回由 `string[]` 改为 **`{ id: string; contextWindow?: number; maxTokens?: number }[]`**
   - provider 侧解析对齐 dsh：容量字段从多种拼写取（`context_length` / `max_input_tokens` / `max_output_tokens` / `max_tokens` / `limit.*` 等）、无 id 行跳过、按 id 去重、保持端点顺序
2. `llm:save-provider`：新增**可选** `modelSpecs?: Record<string, { contextWindow?: number; maxTokens?: number }>`——批量采纳时把探测到的规格传到主进程；`syncAccountModels` 的 `newModelDefaults` 优先用传入规格、回落预设（`presetModelDefaults`）

## 六、供应商目录移植（pi-ai → NF）

- 数据源：`@earendil-works/pi-ai@0.85.1` 的 `providers/data/*.json`（MIT；仓库 THIRD_PARTY_NOTICES 注明出处）——**纯数据移植，不引入依赖**
- ① **规格补全**：现有 17 家预设的模型补 `contextWindow`/`maxTokens`（pi-ai 数据为准，缺口才写，避免与 `ModelPreset.contextWindow` 的"例外才写"约定冲突）
- ② **新增供应商**（OpenAI 兼容 + key 鉴权，共 9 家）：`minimax`、`zai-coding-cn`、`kimi-coding`、`qwen-token-plan-cn`、`xiaomi-token-plan-cn`、`cerebras`、`together`、`fireworks`、`nvidia`
- 移植方式：一次性脚本 `scripts/migrate-pi-ai-catalog.cjs`（读 pi-ai JSON → 生成合并进 `provider-presets.ts`；脚本入库注明一次性用途）
- **不移植**：bedrock / vertex / azure（云厂鉴权）、copilot 等 OAuth 类、以及需要非 openai/gemini 协议的家

## 七、用户四点落法

1. **添加合一**：一体卡 + 唯一「添加模型」入口（Modal 批量）
2. **供应商与自定义一体**：同一卡体系 + 建卡表单两模式（目录 / 自定义 API）
3. **删温度**：`ModelForm` 移除 temperature 输入（存储保留默认 0.7，运行时行为不变）
4. **置顶**：模型区为主体（§一）+ 卡内新行倒序（显示层 reverse）

## 八、测试与验收

- `ModelProviderCard.test.tsx`：卡渲染 / 模型行倒序 / 类型标签 / 「其他」卡兜底
- `ModelPickerDialog.test.tsx`：拉取加载 / 勾选与搜索 / 已添加禁用 / 采用批量 / 手工输入 / 失败文案 / 关闭即弃
- controller 侧：`list-provider-models` 返回带规格（多拼写解析用例）；`save-provider` 应用 `modelSpecs`
- 预设数据：迁移后抽查（如 deepseek 模型带 contextWindow）；i18n 三语
- 三门禁全绿；既有 2217 测试不回归

## 九、非目标

- 不动 `models.json` / 账户存储结构；不自动迁移无归属模型
- **协议范围**：本次仅新增 `anthropic` 原生协议（§十一）；Bedrock / Vertex / Azure / OAuth 类**不进表**（见 §十的准入标准）
- 不动模型路由区 / 并发设置 / 本地向量（Ollama embedding）配置
- 不引入 `@earendil-works/pi-ai` 依赖（只移植数据）

## 十、协议注册表单源收敛（2026-09-28 并入，源自 dsh 协议调研）

**问题**：协议枚举现在散在三处——`llm-factory.ts` 的 if/else、UI 的协议 `SelectItem` 硬编码、`ProviderPreset.protocol` 的 string 类型——加协议时容易漂移（dsh 的做法是 UI 从 schema 反读，保证"UI 可选集 ≡ 适配器可服务集"）。

**方案**：新建 `src/shared/llm-protocols.ts` 作为单一来源：

```ts
/** 协议准入标准（dsh 同款理念）：能被「一把 key + 一个 endpoint + headers」完整描述的协议才进表；
 *  Bedrock（SigV4）/ Vertex（project/ADC）/ Azure（env+api-version）/ OAuth 类一律排除——
 *  配置形状表达不了的认证，放进来只会交回一个「能选中但必然认证失败」的 provider。 */
export const LLM_PROTOCOLS = [
  { id: 'openai', labelKey: 'form.protocolOpenAI' },   // 含所有 OpenAI 兼容端点（多数供应商）
  { id: 'gemini', labelKey: 'form.protocolGemini' },
  { id: 'anthropic', labelKey: 'form.protocolAnthropic' },  // 原生 Messages API（§十一）
] as const
export type LLMProtocol = (typeof LLM_PROTOCOLS)[number]['id']
```

- `ModelProfile.protocol`、`ProviderPreset.protocol` 引用 `LLMProtocol`
- `llm-factory` 改为**映射表**（`Record<LLMProtocol, () => ILLMProvider>`，无匹配抛错明确）
- UI 协议下拉从 `LLM_PROTOCOLS` 生成（label 走 i18n）
- **错误码化核对**（dsh 教训："按文本判 429，每加协议重写一份正则"）：核对 `retry-handler` 只按 status/code 判定（现状已按 HTTP status ✓）；在 `provider.interface.ts` 写明契约"新协议失败必须抛带 `status` 的 `HttpError`（或等价），不得依赖 message 文本"

## 十一、`anthropic` 原生协议（2026-09-28 并入）

**动机**：NF 的 Anthropic 预设现走官方 **OpenAI 兼容层（beta）**——已文档化的限制：`response_format` 被静默忽略（JSON 约束流程失效）/ `temperature` 上限 1 / 无 prompt 缓存。换原生 Messages API 全部解除。

**实现**（照 dsh `llm-deepseek` 的 5 文件单一职责模式，按 NF 规模压缩为 1 个 provider 文件）：
- `electron/llm/anthropic-provider.ts`（新，~300-400 行）实现 `ILLMProvider`：
  - 端点 `POST {baseUrl}/v1/messages`；头 `x-api-key` + `anthropic-version: 2023-06-01`
  - system 从 messages 中提为顶层 `system` 字段；`max_tokens` 必填（取 `model.maxTokens`）
  - **SSE 解析**：`message_start` / `content_block_start` / `content_block_delta`（`text_delta`）/ `content_block_stop` / `message_delta`(usage) / `message_stop`——usage 先于 finish 交付、finish 后不再产出（dsh 流式契约三条）
  - `listModels`：`GET {baseUrl}/v1/models?limit=1000`（x-api-key；§五的"带规格"解析复用）
  - 错误映射：401/403→AUTH 类、429→限流（带 `retry-after`）、其它→HTTP status；**沿用现有 `HttpError(status)`**，retry-handler 无需改动
  - 注：NF 无 tool-calling（接口只有 generate/stream/listModels），故不做 tool 块映射
- `llm-factory` 注册（映射表一行）；预设 `anthropic` 的注释更新（原生协议，限制解除）
- UI 协议下拉自动出现（单源后零额外改动）
- 测试：mock fetch——请求构造（system 提取/max_tokens/头）、SSE 帧序列（含分片跨 chunk）、错误映射（401/429）、listModels
