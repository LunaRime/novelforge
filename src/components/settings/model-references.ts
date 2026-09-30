/**
 * 模型引用检查（模型管理 T9 自 `ProviderAccountsSection` 迁出，行为零变化）。
 *
 * 为什么住在渲染层：判据要从**三个 store** 汇集（llm 的默认模型与路由、agent 的会话、
 * vector 的向量化配置）；下沉 `src/shared/` 会把 store 依赖带进主进程，得不偿失。
 */
import { useLLMStore } from '../../stores/llm-store'
import { useAgentStore } from '../../stores/agent-store'
import { useVectorConfigStore } from '../../stores/vector-config-store'
import { findModelReferences, type ModelReferenceSources } from '../../shared/provider-accounts'

/** 汇集引用检查需要的输入（各 store 直接读，避免层层传参） */
function collectReferenceSources(): ModelReferenceSources {
  const llm = useLLMStore.getState()
  const agent = useAgentStore.getState()
  const vector = useVectorConfigStore.getState()
  return {
    defaultModelId: llm.defaultModelId,
    defaultEmbeddingModelId: llm.defaultEmbeddingModelId,
    llmEmbeddingModelId: vector.llmEmbeddingSettings.modelId,
    modelRoutes: llm.modelRoutes,
    conversations: agent.conversations.map((c) => ({ id: c.id, title: c.title, modelId: c.modelId })),
  }
}

/**
 * 这些模型里，哪些还被别处引用？有则返回可读提示（一次列全），无则 null。
 *
 * ⚠️ 取消勾选 / 删账户会**真的删掉模型条目** —— 不查引用的话，默认模型、三层路由、
 * 会话会指向不存在的 id（界面上表现为空白或静默回退）。
 */
export function blockingReferences(modelIds: string[]): string | null {
  const sources = collectReferenceSources()
  const hits = modelIds.flatMap((id) => findModelReferences(id, sources))
  if (hits.length === 0) return null
  return hits.map((h) => h.label).join('、')
}
