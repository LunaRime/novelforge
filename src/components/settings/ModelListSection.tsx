/** 模型设置汇总配置数量，账户操作与历史条目由供应商列表处理。 */
import { Cpu } from 'lucide-react'
import { useLLMStore } from '../../stores/llm-store'
import { isModelOfAccount } from '../../shared/provider-accounts'
import { useTranslation } from '../../hooks/useTranslation'
import { ProviderRowList } from './ProviderRowList'

export function ModelListSection() {
  const { t } = useTranslation()
  const models = useLLMStore((s) => s.models)
  const providers = useLLMStore((s) => s.providers)

  // 保留历史手工配置。账号匹配失败的条目仍可在同一列表中编辑。
  const orphans = models.filter((m) => !providers.some((p) => isModelOfAccount(m.id, p.id)))

  return (
    <section className="nf-settings-panel space-y-3">
      <header className="nf-settings-resource-bar">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
          <Cpu size={16} className="text-[var(--color-accent)]" aria-hidden="true" />
          {t('model.configured').replace('{n}', String(models.length)).replace('{label}', '')}
        </span>
      </header>

      <ProviderRowList orphans={orphans} />
    </section>
  )
}
