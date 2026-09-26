/**
 * SubAgentConfirmCard — 子 agent 写操作的父方审批卡（C 档第二轮）。
 *
 * 渲染在输入框上方（与父自己的确认卡同一区域、**不同渲染面**：父卡在消息内）。
 * 刻意**不提供「始终允许」**：委派路径的批准不写 workspace 规则——否则子 agent 的
 * 批准会放大用户的常驻授权（spec §3.5）。允许只对本次调用有效。
 * 超时（120s）与父取消都会让 store 侧自动拒绝，此卡随之消失。
 */
import { ShieldAlert } from 'lucide-react'
import { useAgentStore } from '../../../stores/agent-store'
import { useTranslation } from '../../../hooks/useTranslation'

export default function SubAgentConfirmCard() {
  const { t } = useTranslation()
  const pending = useAgentStore(s => s.pendingSubAgentConfirmation)
  const resolve = useAgentStore(s => s.resolveSubAgentConfirmation)
  if (!pending) return null

  const target = typeof pending.toolCall.arguments?.file_path === 'string'
    ? String(pending.toolCall.arguments.file_path)
    : ''

  return (
    <div
      className="mb-1.5 rounded-lg border px-2.5 py-2"
      style={{ borderColor: 'var(--color-warning)', backgroundColor: 'var(--color-panel)' }}
    >
      <div className="flex items-start gap-1.5 mb-1.5">
        <ShieldAlert size={12} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-warning)' }} />
        <div className="text-xs flex-1 min-w-0" style={{ color: 'var(--color-text)' }}>
          <div>{t('subagent.confirmTitle').replace('{agent}', pending.description)}</div>
          <div className="text-2xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {t('subagent.confirmTool').replace('{tool}', pending.toolCall.toolName)}
            {target ? ` · ${t('subagent.confirmTarget').replace('{path}', target)}` : ''}
          </div>
          <div className="text-2xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {t('subagent.confirmHint')}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 justify-end">
        <button
          type="button"
          onClick={() => resolve(false)}
          className="px-2 py-0.5 text-xs rounded cursor-pointer"
          style={{ color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
        >
          {t('subagent.confirmDeny')}
        </button>
        <button
          type="button"
          onClick={() => resolve(true)}
          // accent 实底 + 白字：与 SegmentedControl 的激活档同口径（全仓无 --color-accent-fg 令牌）
          className="px-2 py-0.5 text-xs rounded cursor-pointer bg-[var(--color-accent)] text-white"
        >
          {t('subagent.confirmAllow')}
        </button>
      </div>
    </div>
  )
}
