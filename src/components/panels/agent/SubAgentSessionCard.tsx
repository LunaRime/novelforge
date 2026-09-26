/**
 * SubAgentSessionCard — 父时间线内的子会话卡（C 档第二轮）。
 *
 * 挂在触发派发的助手消息下（AgentConversation 按 task 工具调用的 description 关联）：
 * 状态 + 描述 + 步数/工具数 + 可展开子转录（复用 AgentMessage 渲染）+ 运行中可单独取消。
 * 展开态是**唯一**看子 agent 过程的入口（本轮不做工作台 Tab，见 spec §1.2）。
 */
import { useState } from 'react'
import { Bot, ChevronDown, ChevronRight, Loader2, XCircle } from 'lucide-react'
import { useAgentStore } from '../../../stores/agent-store'
import { useTranslation } from '../../../hooks/useTranslation'
import AgentMessage from './AgentMessage'
import type { SubAgentSession } from '../../../services/agent/subagent/types'

const STATUS_KEY: Record<SubAgentSession['status'], string> = {
  running: 'subagent.cardStatusRunning',
  completed: 'subagent.cardStatusCompleted',
  failed: 'subagent.cardStatusFailed',
  cancelled: 'subagent.cardStatusCancelled',
}

const STATUS_COLOR: Record<SubAgentSession['status'], string> = {
  running: 'var(--color-accent)',
  completed: 'var(--color-success)',
  failed: 'var(--color-error)',
  cancelled: 'var(--color-text-muted)',
}

export default function SubAgentSessionCard({ session }: { session: SubAgentSession }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const cancelSubAgent = useAgentStore(s => s.cancelSubAgent)

  return (
    <div className="mx-2 my-1.5 rounded-lg border" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        {session.status === 'running'
          ? <Loader2 size={12} className="animate-spin flex-shrink-0" style={{ color: STATUS_COLOR.running }} />
          : <Bot size={12} className="flex-shrink-0" style={{ color: STATUS_COLOR[session.status] }} />}
        <span className="text-xs truncate flex-1" style={{ color: 'var(--color-text)' }} title={session.description}>
          {session.description}
        </span>
        <span className="text-2xs flex-shrink-0" style={{ color: STATUS_COLOR[session.status] }}>
          {t(STATUS_KEY[session.status] as never)}
        </span>
        <span className="text-2xs flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
          {t('subagent.cardTools').replace('{n}', String(session.toolCalls.length))}
        </span>
        {session.status === 'running' && (
          <button
            type="button"
            onClick={() => cancelSubAgent(session.id)}
            className="p-0.5 rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0"
            style={{ color: 'var(--color-text-muted)' }}
            title={t('subagent.cardCancel')}
          >
            <XCircle size={11} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="p-0.5 rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0"
          style={{ color: 'var(--color-text-muted)' }}
          title={open ? t('subagent.cardHide') : t('subagent.cardShow')}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      </div>
      {session.error && (
        <div className="px-2 pb-1.5 text-2xs" style={{ color: 'var(--color-warning)' }}>{session.error}</div>
      )}
      {open && (
        <div className="px-2 pb-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
          {session.messages.map(m => (
            <AgentMessage key={m.id} message={m} />
          ))}
        </div>
      )}
    </div>
  )
}
