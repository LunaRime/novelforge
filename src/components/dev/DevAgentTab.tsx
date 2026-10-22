import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bot, CircleDot } from 'lucide-react'
import { EmptyState } from '../ui/EmptyState'
import { useTranslation } from '../../hooks/useTranslation'
import { useAgentStore } from '../../stores/agent-store'
import { ipc } from '../../services/ipc-client'
import { formatDuration } from './dev-monitor-utils'

interface ArchiveEntry {
  id: string
  title: string
  updatedAt: number
}

export default function DevAgentTab({ active }: { active: boolean }) {
  const { t } = useTranslation()
  const conversations = useAgentStore((s) => s.conversations)
  const activeId = useAgentStore((s) => s.activeConversationId)
  const generating = useAgentStore((s) => s.generating)
  const progress = useAgentStore((s) => s.agentProgress)
  const selectConversation = useAgentStore((s) => s.selectConversation)
  const [archive, setArchive] = useState<ArchiveEntry[]>([])
  const [error, setError] = useState('')

  const loadArchive = useCallback(async () => {
    try {
      setArchive(await ipc.invoke('fs:agent-archive-list'))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    if (!active) return
    const kickoff = setTimeout(() => { void loadArchive() }, 0)
    const timer = setInterval(() => { void loadArchive() }, 5000)
    return () => { clearTimeout(kickoff); clearInterval(timer) }
  }, [active, loadArchive])

  const current = conversations.find((c) => c.id === activeId) ?? null
  const toolCalls = useMemo(() => {
    if (!current) return []
    return current.messages
      .flatMap((message) => message.toolCalls ?? [])
      .slice()
      .reverse()
      .slice(0, 20)
  }, [current])

  const activeConversations = conversations.slice(0, 30)

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[300px] flex-shrink-0 flex-col" style={{ borderRight: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between px-3 py-2 text-xs font-medium" style={{ color: 'var(--color-text)' }}>
          <span>{t('dev.agentActive')}</span>
          <span style={{ color: 'var(--color-text-muted)' }}>{conversations.length}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {activeConversations.length === 0 ? (
            <div className="px-2 py-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('dev.agentEmpty')}</div>
          ) : (
            activeConversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => selectConversation(conversation.id)}
                className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-[var(--color-hover)]"
                style={{
                  backgroundColor: conversation.id === activeId ? 'var(--color-hover)' : 'transparent',
                  color: conversation.id === activeId ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                }}
              >
                <Bot size={12} className="mt-0.5 flex-shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs">{conversation.title || conversation.id}</span>
                  <span className="mt-0.5 block text-micro" style={{ color: 'var(--color-text-muted)' }}>
                    {conversation.messages.length} {t('dev.agentMessages')} · {new Date(conversation.updatedAt).toLocaleTimeString()}
                    {conversation.archived ? ` · ${t('dev.agentArchived')}` : ''}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center justify-between px-3 py-2 text-xs font-medium" style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
          <span>{t('dev.agentArchive')}</span>
          <span style={{ color: 'var(--color-text-muted)' }}>{archive.length}</span>
        </div>
        <div className="max-h-[180px] overflow-y-auto px-2 pb-2">
          {archive.slice(0, 20).map((entry) => (
            <div key={entry.id} className="truncate px-2 py-1 text-micro" style={{ color: 'var(--color-text-muted)' }}>
              {entry.title} · {new Date(entry.updatedAt).toLocaleDateString()}
            </div>
          ))}
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto px-4 py-3">
        {error && (
          <div className="mb-3 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 8%, transparent)', color: 'var(--color-error)' }}>
            {error}
          </div>
        )}

        {!current ? (
          <EmptyState message={t('dev.agentNoActive')} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{current.title || current.id}</span>
              {generating && (
                <span className="flex items-center gap-1 text-micro" style={{ color: 'var(--color-accent)' }}>
                  <CircleDot size={10} /> {t('dev.agentStreaming')}
                </span>
              )}
              <span className="text-micro" style={{ color: 'var(--color-text-muted)' }}>
                {current.messages.length} {t('dev.agentMessages')} · {current.modelId ?? 'default'}
              </span>
            </div>

            <div className="mt-3 rounded-xl p-3" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
              <div className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{t('dev.agentProgress')}</div>
              {progress ? (
                <div className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2" style={{ color: 'var(--color-text-secondary)' }}>
                  <span>phase: <span className="font-mono">{progress.phase}</span></span>
                  <span>{progress.percentage}%</span>
                  <span>{t('dev.agentPlan')}: {progress.completedSteps}/{progress.totalSteps}</span>
                  <span>{t('dev.agentTools')}: {progress.toolIndex}/{progress.totalTools}</span>
                  <span>{t('dev.agentTokens')}: {progress.tokensUsed}</span>
                  <span>{formatDuration(progress.elapsedMs)}</span>
                  <span className="sm:col-span-2" style={{ color: 'var(--color-text-muted)' }}>{progress.description}</span>
                  {progress.currentTool && <span className="sm:col-span-2 font-mono" style={{ color: 'var(--color-accent)' }}>{progress.currentTool}</span>}
                </div>
              ) : (
                <div className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>—</div>
              )}
            </div>

            <div className="mt-4 text-xs font-medium" style={{ color: 'var(--color-text)' }}>{t('dev.agentTools')}</div>
            {toolCalls.length === 0 ? (
              <div className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>—</div>
            ) : (
              <table className="mt-1 w-full border-collapse text-micro">
                <thead>
                  <tr style={{ color: 'var(--color-text-muted)' }}>
                    <th className="py-1.5 text-left font-medium">Tool</th>
                    <th className="py-1.5 text-left font-medium">{t('dev.agentToolStatus')}</th>
                    <th className="py-1.5 text-right font-medium">{t('dev.agentToolDuration')}</th>
                  </tr>
                </thead>
                <tbody>
                  {toolCalls.map((call) => (
                    <tr key={call.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <td className="max-w-[280px] truncate py-1.5 font-mono" style={{ color: 'var(--color-text-secondary)' }}>{call.toolName}</td>
                      <td className="py-1.5" style={{ color: call.status === 'failed' ? 'var(--color-error)' : call.status === 'completed' ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                        {call.status}
                      </td>
                      <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                        {typeof call.duration_ms === 'number' ? formatDuration(call.duration_ms) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  )
}