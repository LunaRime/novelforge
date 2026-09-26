# 上下文工程：压缩可证明性 / 原文保留 / 前缀记账 / 回执 / 明细面板（B 档第二轮）设计

> **Status**: 设计已获批准（2026-09-26 用户拍板：原文分卷落盘保留全部、前缀认证做记账告警），待实施。
> **依据**: `docs/superpowers/plans/2026-09-08-agent-capabilities-plan.md`（§7.1-B 条目 B2-B7 / §3.1 B 档 ⑥′⑦′）
> **参照**: Denova `agent/definition_compaction.go`（可证明性）、`agent/compaction/standard.go`（原文退回）、`agent/model_loop.go`（前缀认证）、`agent/compaction_receipts.go`（副作用回执）

## 1. 目标与非目标

### 1.1 目标

把 CCR 压缩从「压完即信」变成**可证明、可回溯、可解释**：

- 压缩后能证明「token 确实降下来了」，无收益时明确标记而非静默
- 被压缩的原文**永不丢失**（分卷落盘），摘要可重生成、内容可回溯
- 前缀缓存失效**可见**（记账 + 告警），不再只有一句无校验的注释
- 副作用类工具的回执随压缩保留（防重放、可追溯）
- context 明细面板能回答「这轮请求到底发了什么、每段来自哪、占多少字节」

### 1.2 非目标

- **前缀硬拒绝**（Denova 式）：NF 的摘要每轮都会进 system 尾部，硬拒绝会堵死正常对话；本轮只做记账与告警
- **上下文分层重构**（把摘要移出 system 前缀区）：那是更深的结构性改动，与 B4 的"硬拒绝"耦合，留待后续
- 原文分卷的**自动 GC**：本轮保留全部 + 会话删除时级联清理；配额/GC 策略留待有真实压力时再做

## 2. 现状与五个无护栏点（调研结论）

| # | 事实 | 位置 |
|---|---|---|
| 1 | **原文清理只清下标 0**（注释说"超过 3 代丢弃最旧一代"）→ batch 2+ 的 original 永久保留，既不满足"2-3 代"不变量，磁盘也无界增长 | `agent-store.ts:653-654` |
| 2 | 压缩后**零校验、零日志、零降幅断言**（唯一的"节省"数字是 UI 纯展示，不含注入截断与后续裁剪） | `agent-store.ts:634-669`、`CompressedBatchCard.tsx:10` |
| 3 | 面板的 history **≠ 实发请求**（发送前再裁到 4000、引擎内又按 16k/32k 压一次、预取与 RAG 完全不计入） | `AgentConversation.tsx:254,266-268` vs `agent-store.ts:671-684` vs `agent-engine.ts:761-819` |
| 4 | `rollingSummary` 注入 system 尾部 → **每轮压缩都改写前缀**；而引擎注释声称"前缀稳定"却无任何校验 | `context-builder.ts:76` vs `agent-engine.ts:215-218` |
| 5 | 摘要输入只拼 `role: content`，**丢弃 toolCalls/artifacts**；被压缩消息的 artifacts 随 original 一起消失 | `ccr-summary.ts:26-28`、`CompressedBatchCard.tsx:38-43` |

## 3. 设计

### 3.1 B3 —— 原文分卷落盘（用户拍板：保留全部）

**存储形态**：

- 新文件：`~/.novelforge/agent-archives/<conversationId>.originals.json`
- 形状：`{ version: 1, batches: { [batchNumber]: AgentMessage[] } }`
- 会话 archive（`<conversationId>.json`）里的 `CompressedBatch.original` 改为**引用**：

```ts
export interface CompressedBatch {
  batch: number
  /** 原文字节数（分卷文件里对应批次的体量；0 = 分卷不可用） */
  originalBytes: number
  /** 摘要（会话 JSON 内联，注入用） */
  summary: string
  compressedAt: number
  originalTokens: number
  /** 可重生成标记：原文在分卷文件中可用 */
  recoverable: boolean
  /** B2：真实降幅（面板展示用；旧档案无此字段时回落到 originalTokens - estimateTokens(summary)） */
  beforeTokens?: number
  afterTokens?: number
  changeTokens?: number
  /** B7：产物依赖的历史指纹（历史变更后失配 → invalidated） */
  dependencyHash?: string
  invalidated?: boolean
}
```

**写入/读取**：

- 压缩时：原文写分卷（同会话同批次，覆盖式幂等），会话 JSON 只存引用字段
- 「展开原文」：`CompressedBatchCard` 展开时按需从分卷读（IPC `fs:agent-archive-original-read`）
- 删除会话：级联删除分卷（`fs:agent-archive-delete` 一并清理）
- 分卷不存在/损坏：`recoverable: false` + 卡片显示「原文不可用」（不崩）

**摘要可重生成**：分卷存在即可用原文重新生成摘要（本轮提供 `regenerateBatchSummary(convId, batch)` store 动作 + 卡片按钮；复用 `generateConversationSummary`）。

> ⚠️ 分卷是**新文件**：`archive-codec.ts` 的序列化/反序列化要区分两种文件，且**向后兼容**旧的 inline `original`（老档案仍能读）。

### 3.2 B2 —— 压缩可证明性

**压缩后立即重算并断言**（`agent-store.ts` 的压缩分支）：

```ts
const beforeTokens = /* 压缩前 history token（已算过） */
const afterTokens = estimateTokens(rest 的 content 合计) + estimateTokens(summary) + 注入截断开销
const changeTokens = beforeTokens - afterTokens
const degraded = changeTokens < MINIMUM_CHANGE_TOKENS   // 默认 200
```

- `degraded: true` → **不替换历史**（保留原 messages），记 `renderLog('warn')` + 会话内标记（UI 显示「本次压缩无收益，已跳过」）
- 正常 → 替换，并把 `{ beforeTokens, afterTokens, changeTokens }` 记入 `CompressedBatch`（供面板展示**真实**降幅）
- 压缩失败（摘要生成失败）保持现有降级（不压缩 + 硬截断窗口）

**`Degraded` 的可见性**：`CompressedBatchCard` 的"节省 tokens"改为读 `changeTokens`（真实降幅），并显示 `beforeTokens → afterTokens`。

### 3.3 B4 —— 前缀记账与告警（用户拍板：不做硬拒绝）

**指纹**：每轮请求构造完成后，对**system 段**取 `sha1(systemText).slice(0, 12)` 作为前缀指纹。

- 记录：`prefixFingerprint` / `prefixChanged: boolean` / `sharedPrefixChars`（与上次的公共前缀长度）
- 落库：随该轮 `db:log-llm-call` 一并记（新增列或复用现有 JSON 字段 —— 见 §5 迁移）
- 告警：`prefixChanged && lastCacheHitTokens > 0` → `renderLog('warn', ...)`「前缀变化导致缓存命中归零」
- 展示：`ContextBudgetBar` 的明细弹层加一行「前缀：稳定 / 已变化（共享 N 字符）」

**不改**：任何请求都照常提交（不做硬拒绝）。

### 3.4 B5 —— 副作用回执随压缩保留

**回执提取**：压缩时为该批次内**有副作用**的消息抽回执：

- 来源：`AgentMessage.toolCalls`（status 为 `completed`/`failed`）+ `AgentMessage.artifacts`
- 形状：`{ tool, target, outcome: 'ok'|'failed', artifactPaths: string[] }`
- 上限：**32 条 / 32KB**（超出丢最旧；同 target 只留最新一条 —— 防重放的核心）
- 去向：附加到该批次的 `summary` 尾部（`副作用回执：\n- write_file → drafts/ch1.md (ok)`），随摘要进上下文
- `CompressedBatchCard` 展开时独立成段展示（不混在摘要正文里）

**为何附在摘要而非独立注入**：独立注入会再占一个上下文段；附在摘要尾部零额外成本，且与"这批做了什么"的语义天然同处。

### 3.5 B6 —— context 明细面板补齐

**数据层扩展**（`context-usage.ts`）：

```ts
export interface ContextSegment {
  /** 'base' | 'l0' | 'l1' | 'tools' | 'skill-catalog' | 'memory-m2' | 'memory-m1' | 'prefetch' | 'rag' | 'history' | 'current' */
  key: string
  label: string
  tokens: number
  /** 字符数（与 token 并列展示；Denova 的分区形态要求"来源与字节"） */
  chars: number
  /** 来源细节（如具体 memory 文件 / 预取路径 / 截断发生） */
  source?: string
  truncated?: boolean
}
```

- `computeContextUsage()` 从"4 个聚合数字"升级为**逐段明细**（每段带 source 与 bytes）
- **诚实口径**：新增 `historySentTokens`（发送前实际裁剪后的值）与 `historyPanelTokens`（面板展示值），差异在 UI 上显式标注

**面板**（`ContextBudgetBar` 的明细弹层）：

- 顶部 5 格指标（沿用）
- **分段明细**：每段一行（色点 + 标签 + token + 字符数 + 来源），可展开看 `source`
- **复制**：单段复制 + 整组复制（`navigator.clipboard`，复制为结构化文本）
- **移除当前压缩**：对 `compressed` 里某批次提供「恢复原文并移除该压缩」（复用 B3 的分卷原文）
- **调用级用量**：本会话最近一次 `llm_calls` 的 `prompt/cached/completion` + 缓存命中率（从 usage 数据取）
- 压缩段显示 `tokens_before → after`（来自 B2 的真实值）

### 3.6 B7 —— 压缩/清理类历史依赖的失效语义

**问题**：`rollingSummary` 与 `compressed` 是基于"当时的历史"生成的；若历史被外部改动（rewind / fork / 手动移除压缩 / 编辑消息），这些产物即过期，但现状只有 `stale` 标记。

**设计**：

- 为 `compressed` 与 `rollingSummary` 各记一个**依赖指纹**：`依赖的历史消息 id 列表的 hash`
- 历史变更（rewind / 移除压缩 / 编辑）后重算指纹 → 失配则把对应产物标 `invalidated: true`
- 失效的产物：**不注入上下文**（M1 摘要失效则跳过注入）、UI 显示「已失效（历史已变动）」+ 提供「重生成」
- 与 B3 的关系：原文在分卷里 → 失效后可**从原文重生成**（B3 的 `regenerateBatchSummary` 复用）

## 4. 测试策略

| 层 | 用例 |
|---|---|
| 分卷存储 | 写入/读取往返；会话删除级联；分卷缺失 → `recoverable:false` 不崩；旧 inline 档案向后兼容 |
| 可证明性 | 无收益（摘要 ≥ 原文）→ 不替换历史 + 标 degraded；正常 → 记 before/after/change |
| 前缀记账 | 指纹稳定 → `prefixChanged:false`；摘要变化 → true + 共享前缀长度正确 |
| 回执 | 只抽副作用工具；同 target 去重留最新；32 条/32KB 上限；失败工具标 failed |
| 明细面板 | 逐段 tokens/chars/source 正确；panel vs sent 差异标注；复制产出结构化文本；移除压缩后恢复原文 |
| 失效语义 | 历史变更 → 产物 invalidated；失效摘要不注入；重生成后恢复 |

## 5. 文件结构与迁移

| 文件 | 动作 |
|---|---|
| `src/services/agent/archive-codec.ts` | `CompressedBatch` 形状变更 + 分卷序列化 + 旧格式兼容 |
| `src/services/agent/compaction-originals.ts` | 新建：分卷读写（IPC 封装） |
| `electron/controllers/fs-controller.ts` | 新增 `fs:agent-archive-original-read/write/delete` |
| `src/stores/agent-store.ts` | 压缩分支：可证明性校验 + 原文写分卷 + 回执提取 |
| `src/services/agent/ccr-summary.ts` | 摘要 prompt 支持回执段 |
| `src/services/agent/context-usage.ts` | 逐段明细模型 |
| `src/services/agent/prefix-accounting.ts` | 新建：前缀指纹与记账 |
| `src/components/panels/agent/ContextBudgetBar.tsx` | 明细弹层重构 |
| `src/components/panels/agent/CompressedBatchCard.tsx` | 真实降幅 + 回执段 + 原文按需读 + 重生成/移除 |
| `electron/database.ts` | `llm_calls` 加前缀记账列（v19 迁移，幂等） |

**DB 迁移（v19）**：`llm_calls` 增 `prefix_fingerprint TEXT` / `prefix_shared_chars INTEGER`（幂等 ADD COLUMN，符合 `db-migration-standard`）。
