import { useLLMStore } from '../../stores/llm-store'
import { isModelOfAccount } from '../../shared/provider-accounts'
import { ProviderRowList } from './ProviderRowList'

export function ModelListSection() {
  const models = useLLMStore((s) => s.models)
  const providers = useLLMStore((s) => s.providers)

  // 保留历史手工配置。账号匹配失败的条目仍可在同一列表中编辑。
  const orphans = models.filter((m) => !providers.some((p) => isModelOfAccount(m.id, p.id)))

  return (
    <section className="nf-settings-panel">
      <ProviderRowList orphans={orphans} />
    </section>
  )
}
