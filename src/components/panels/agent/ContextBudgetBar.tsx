import type { ContextUsage } from '../../../services/agent/context-usage'
import { t } from '../../../shared/locale'

/** 上下文占用预算条：基础/记忆/历史/当前 四段 vs 模型上限 */
export default function ContextBudgetBar({ usage }: { usage: ContextUsage | null }) {
  if (!usage || usage.modelMax <= 0) return null
  const pct = Math.min(100, Math.round((usage.total / usage.modelMax) * 100))

  return (
    <div className="px-3 pt-1 pb-0">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: 'var(--color-bg-hover)' }}>
        {[
          { label: t('ccr.segBase'), value: usage.base, color: 'var(--color-accent)' },
          { label: t('ccr.segMemory'), value: usage.memory, color: 'var(--color-info)' },
          { label: t('ccr.segHistory'), value: usage.history, color: 'var(--color-warning)' },
          { label: t('ccr.segCurrent'), value: usage.current, color: 'var(--color-success)' },
        ].map(seg => (
          <div
            key={seg.label}
            title={`${seg.label}: ${seg.value} tokens`}
            style={{
              width: `${Math.max(0, Math.min(100, (seg.value / usage.modelMax) * 100))}%`,
              backgroundColor: seg.color,
            }}
          />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
        <span>{t('ccr.budgetLabel').replace('{base}', String(usage.base)).replace('{memory}', String(usage.memory)).replace('{history}', String(usage.history)).replace('{current}', String(usage.current))}</span>
        <span>{t('ccr.budgetTotal').replace('{total}', String(usage.total)).replace('{max}', String(usage.modelMax)).replace('{pct}', String(pct))}</span>
      </div>
    </div>
  )
}
