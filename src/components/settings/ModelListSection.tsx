/**
 * ModelListSection — 「模型」段（模型管理 v3 §2，2026-10-01）。
 *
 * 本文件是**薄容器**：标题（计数）+ `ProviderRowList`。
 * 行的行为（单开/三态灯/删除顺序/添加块/「其他」卡）全在 `ProviderRowList` 里，这里不重复。
 *
 * 渲染顺序（2026-10-01 用户要求）：供应商行 → 「其他」卡（无归属条目）→ 添加块；
 * 容器只计算 `orphans` 并传入（数据在容器、版位在行列表）。
 */
import { useLLMStore } from '../../stores/llm-store'
import { isModelOfAccount } from '../../shared/provider-accounts'
import { useTranslation } from '../../hooks/useTranslation'
import { ProviderRowList } from './ProviderRowList'

export function ModelListSection() {
  const { t } = useTranslation()
  const models = useLLMStore((s) => s.models)
  const providers = useLLMStore((s) => s.providers)

  /** 「其他」卡：不属于任何供应商账户的历史条目（P3 兼容——可见可编辑可删，不自动迁移） */
  const orphans = models.filter((m) => !providers.some((p) => isModelOfAccount(m.id, p.id)))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
          {t('model.configured').replace('{n}', String(models.length)).replace('{label}', '')}
        </span>
      </div>

      <ProviderRowList orphans={orphans} />
    </div>
  )
}
