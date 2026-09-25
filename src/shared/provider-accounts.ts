/**
 * 模型供应商账户 —— 纯逻辑（无 IO、无 electron 依赖，可直接单测）
 *
 * **为什么是「账户 + 派生」而不是改 `models.json` 的形状**：
 * `models.json` 有 10 个读点、凭据字段（apiKey/baseUrl/protocol）有 91 处引用；
 * 而路由 / 默认模型 / 会话**只按 `id` 引用模型**。所以只要派生条目的 `id` 稳定且
 * `ModelProfile[]` 形状不变，那些读点与引用**一行都不用改**。
 *
 * 存储：`~/.novelforge/providers.json` 是账户的唯一真相；`models.json` 里的派生条目
 * 持有凭据**副本**，由本模块的同步函数维护。
 */
import type { ModelProfile, ProviderAccount } from './ipc-channels'

/** 派生条目 id 的分隔符 —— 手工条目是 uuid，不含它 */
const SEP = '::'

/**
 * 派生模型的 id：`{accountId}::{modelName}`。
 *
 * ⚠️ **必须确定性**：反复勾选/取消勾选同一个模型时 `id` 要一模一样，
 * 否则三层路由、默认模型、会话历史里对它的引用会在一次取消+重选后**静默失效**。
 */
export function deriveModelId(accountId: string, modelName: string): string {
  return `${accountId}${SEP}${modelName}`
}

/** 该条目是否由指定账户派生 */
export function isModelOfAccount(modelId: string, accountId: string): boolean {
  return modelId.startsWith(`${accountId}${SEP}`)
}

/** 新建派生条目时，逐模型设置的初值（由调用方按预设给出） */
export type NewModelDefaults = Pick<
  ModelProfile,
  'temperature' | 'maxTokens' | 'contextWindow' | 'purposes'
>

/**
 * 按账户的勾选清单同步派生条目。
 *
 * ⚠️ **合并语义，不是覆盖**：派生条目上的 `name` / `temperature` / `maxTokens` /
 * `contextWindow` / `purposes` 是用户在「模型卡片」里改的，**账户同步必须原样保留**；
 * 只更新由账户提供的三个凭据字段。否则改一次 API Key 就会把用户的逐模型调参全部冲掉。
 *
 * 不碰手工条目（无账户）与其它账户的条目；保持既有顺序，新条目追加在后。
 */
export function syncAccountModels(
  account: ProviderAccount,
  existing: ModelProfile[],
  newModelDefaults: (modelName: string) => NewModelDefaults,
): ModelProfile[] {
  const credentials = {
    provider: account.provider,
    protocol: account.protocol,
    apiKey: account.apiKey,
    baseUrl: account.baseUrl,
  }
  const wanted = account.modelNames.map((name) => ({ name, id: deriveModelId(account.id, name) }))
  const wantedIds = new Set(wanted.map((w) => w.id))

  const out: ModelProfile[] = []
  const seen = new Set<string>()

  for (const m of existing) {
    if (wantedIds.has(m.id)) {
      out.push({ ...m, ...credentials }) // 保留逐模型设置，只换凭据
      seen.add(m.id)
    } else if (!isModelOfAccount(m.id, account.id)) {
      out.push(m) // 手工条目 / 其它账户：原样
    }
    // 属于本账户但已取消勾选的：丢弃
  }

  for (const w of wanted) {
    if (seen.has(w.id)) continue
    out.push({
      id: w.id,
      name: w.name, // 初值取模型名；之后用户改的就是权威值
      modelName: w.name,
      ...credentials,
      ...newModelDefaults(w.name),
    })
  }

  return out
}

/** 一处对某模型的引用 */
export interface ModelReference {
  kind: 'default' | 'defaultEmbedding' | 'llmEmbedding' | 'route' | 'conversation'
  /** 给人看的说明，含具体位置（如「三层路由 · standard」「会话 · 第一章」） */
  label: string
}

/** 引用检查的输入（由渲染层从各 store 汇集；本模块保持纯函数） */
export interface ModelReferenceSources {
  defaultModelId?: string | null
  defaultEmbeddingModelId?: string | null
  /** 向量化用的 LLM 模型（vector-config-store） */
  llmEmbeddingModelId?: string | null
  modelRoutes?: { elite?: string[]; standard?: string[]; budget?: string[] } | null
  conversations?: Array<{ id: string; title?: string | null; modelId?: string | null }>
}

/**
 * 找出谁在引用这个模型 —— 取消勾选 / 删账户**会删掉模型条目**，删之前必须查。
 *
 * 返回全部命中（可能多处），让调用方一次性告诉用户要改哪些地方，
 * 而不是改一处再撞下一处。
 */
export function findModelReferences(
  modelId: string,
  sources: ModelReferenceSources,
): ModelReference[] {
  const refs: ModelReference[] = []

  if (sources.defaultModelId === modelId) {
    refs.push({ kind: 'default', label: '默认生成模型' })
  }
  if (sources.defaultEmbeddingModelId === modelId) {
    refs.push({ kind: 'defaultEmbedding', label: '默认向量模型' })
  }
  if (sources.llmEmbeddingModelId === modelId) {
    refs.push({ kind: 'llmEmbedding', label: 'LLM 向量化配置' })
  }

  for (const tier of ['elite', 'standard', 'budget'] as const) {
    if (sources.modelRoutes?.[tier]?.includes(modelId)) {
      refs.push({ kind: 'route', label: `三层路由 · ${tier}` })
    }
  }

  for (const conv of sources.conversations ?? []) {
    if (conv.modelId === modelId) {
      refs.push({ kind: 'conversation', label: `会话 · ${conv.title || conv.id}` })
    }
  }

  return refs
}
