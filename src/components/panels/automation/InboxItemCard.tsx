/**
 * InboxItemCard — 自动化收件箱条目卡（D 档）
 *
 * 操作按钮**严格按 action_policy 渲染**（三态真做，spec §7.2）：
 * - `confirm`     → 「确认运行」+「忽略」
 * - `notify_only` → 只「忽略」+「仅提醒」标注 —— **绝不出现执行按钮**（UI 不得绕过策略选择）
 * - `auto_run`    → 无操作按钮（已执行，条目仅作历史）
 */
import { useState } from 'react'
import { CheckCircle2, Circle } from 'lucide-react'
import { Button } from '../../ui/Button'
import { useTranslation } from '../../../hooks/useTranslation'
import { useAutomationStore } from '../../../stores/automation-store'
import type { InboxItem, TriggerEvidence } from '../../../services/automation/types'

interface Props {
  item: InboxItem
}

/** 证据默认展示条数（多出的折叠） */
const EVIDENCE_PREVIEW = 3

export default function InboxItemCard({ item }: Props) {
  const { t } = useTranslation()
  const { confirmInboxItem, dismissInboxItem } = useAutomationStore()
  const [expanded, setExpanded] = useState(false)

  const evidence: TriggerEvidence[] = item.evidence ?? []
  const shown = expanded ? evidence : evidence.slice(0, EVIDENCE_PREVIEW)
  const hiddenCount = evidence.length - shown.length

  const isPending = item.status === 'pending'
  const canRun = isPending && item.actionPolicy === 'confirm'
  const canDismiss = isPending

  return (
    <div
      className="px-2 py-1.5 rounded-md"
      style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)' }}
    >
      {/* 标题行：未读以实心点区分 */}
      <div className="flex items-center gap-1.5">
        {item.readAt
          ? <CheckCircle2 size={11} style={{ color: 'var(--color-text-muted)' }} />
          : <Circle size={11} style={{ color: 'var(--color-accent)', fill: 'var(--color-accent)' }} />}
        <span className="text-xs flex-1 truncate" style={{ color: 'var(--color-text)' }}>{item.title}</span>
        {item.actionPolicy === 'notify_only' && (
          <span
            className="text-micro px-1 rounded flex-shrink-0"
            style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-muted)' }}
          >
            {t('automation.inbox.notifyOnly')}
          </span>
        )}
        <span className="text-micro flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
          {new Date(item.createdAt).toLocaleString()}
        </span>
      </div>

      {/* 摘要 */}
      <p className="text-micro mt-1 leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
        {item.summary}
      </p>

      {/* 证据（默认 3 条，多出的可展开） */}
      {shown.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {shown.map((ev, i) => (
            <li key={`${ev.source}-${ev.ref ?? i}`} className="text-micro truncate" style={{ color: 'var(--color-text-muted)' }}>
              {ev.source} · {ev.title}{ev.ref ? ` (${ev.ref})` : ''}
            </li>
          ))}
          {hiddenCount > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="text-micro cursor-pointer"
                style={{ color: 'var(--color-accent)' }}
              >
                {t('automation.inbox.moreEvidence').replace('{n}', String(hiddenCount))}
              </button>
            </li>
          )}
        </ul>
      )}

      {/* 执行失败原因（卡片上可见，不静默） */}
      {item.actionError && (
        <p className="text-micro mt-1" style={{ color: 'var(--color-error)' }}>{item.actionError}</p>
      )}

      {/* 操作行：按策略裁剪 */}
      {(canRun || canDismiss) && (
        <div className="flex items-center gap-1.5 mt-1.5">
          {canRun && (
            <Button variant="success" size="sm" onClick={() => void confirmInboxItem(item.id)}>
              {t('automation.inbox.confirmRun')}
            </Button>
          )}
          {canDismiss && (
            <Button variant="outline" size="sm" onClick={() => void dismissInboxItem(item.id)}>
              {t('automation.inbox.dismiss')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
