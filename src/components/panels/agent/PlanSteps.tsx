import { CheckCircle2, Circle, Loader2, ListChecks } from 'lucide-react'
import type { PlanStep } from '../../../services/agent/plan-steps'
import { useTranslation } from '../../../hooks/useTranslation'

/**
 * Agent 计划卡：有序步骤 + 三态。
 *
 * 这是「操作日志」的一部分，不是聊天内容：固定浅底、无气泡尾巴、步骤编号可见。
 * 状态只靠图标形状 + 颜色区分（不依赖 Emoji）。
 */
export default function PlanSteps({ steps }: { steps: PlanStep[] }) {
  const { t } = useTranslation()
  if (steps.length === 0) return null
  const done = steps.filter((s) => s.status === 'done').length

  return (
    <div
      data-plan-steps="true"
      style={{
        margin: '2px 0 8px',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        backgroundColor: 'var(--color-bg)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: 30,
          padding: '0 10px',
          borderBottom: '1px solid var(--color-border)',
          color: 'var(--color-text-secondary)',
          fontSize: 11,
        }}
      >
        <ListChecks size={13} style={{ color: 'var(--color-text-muted)' }} />
        <span style={{ flex: 1 }}>{t('agent.plan')}</span>
        <span className="tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
          {t('agent.planProgress').replace('{done}', String(done)).replace('{total}', String(steps.length))}
        </span>
      </div>
      <ol style={{ margin: 0, padding: '6px 10px 8px 10px', listStyle: 'none' }}>
        {steps.map((step, index) => {
          const color = step.status === 'done'
            ? 'var(--color-success)'
            : step.status === 'active'
              ? 'var(--color-accent)'
              : 'var(--color-text-muted)'
          return (
            <li
              key={step.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '3px 0',
                fontSize: 12,
                lineHeight: 1.5,
                color: step.status === 'pending' ? 'var(--color-text-secondary)' : 'var(--color-text)',
              }}
            >
              <span style={{ display: 'inline-flex', marginTop: 1, color, flexShrink: 0 }}>
                {step.status === 'done' ? <CheckCircle2 size={13} />
                  : step.status === 'active' ? <Loader2 size={13} className="animate-spin" />
                    : <Circle size={13} />}
              </span>
              <span style={{ flexShrink: 0, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>
                {index + 1}.
              </span>
              <span style={{ minWidth: 0, textDecoration: step.status === 'done' ? 'line-through' : undefined }}>
                {step.title}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
