import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Spinner } from '../ui/Spinner'
import { useTranslation } from '../../hooks/useTranslation'
import { ipc } from '../../services/ipc-client'
import type { DevIpcMetricsData } from '../../shared/ipc-channels'

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`
}

export default function DevIpcTab({ active }: { active: boolean }) {
  const { t } = useTranslation()
  const [data, setData] = useState<DevIpcMetricsData | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setData(await ipc.invoke('dev:ipc-metrics'))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    if (!active) return
    const kickoff = setTimeout(() => { void load() }, 0)
    const timer = setInterval(() => { void load() }, 1000)
    return () => { clearTimeout(kickoff); clearInterval(timer) }
  }, [active, load])

  const clear = async () => {
    try {
      await ipc.invoke('dev:ipc-clear')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const recent = data ? [...data.recent].reverse().slice(0, 100) : []

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-shrink-0 items-center justify-between gap-3 px-6 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{t('dev.ipcTitle')}</span>
          <span className="text-micro" style={{ color: data?.enabled ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
            {data?.enabled ? t('dev.ipcEnabled') : t('dev.ipcDisabled')}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void clear()}>
          <Trash2 size={12} />
          {t('dev.ipcClear')}
        </Button>
      </div>

      {error && (
        <div className="mx-6 mt-3 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 8%, transparent)', color: 'var(--color-error)' }}>
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
        {!data ? (
          <div className="flex h-full items-center justify-center"><Spinner size={18} /></div>
        ) : data.metrics.length === 0 ? (
          <EmptyState message={t('dev.ipcEmpty')} />
        ) : (
          <>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr style={{ color: 'var(--color-text-muted)' }}>
                  <th className="py-1.5 text-left font-medium">{t('dev.ipcChannel')}</th>
                  <th className="py-1.5 text-right font-medium">{t('dev.ipcCalls')}</th>
                  <th className="py-1.5 text-right font-medium">{t('dev.ipcErrors')}</th>
                  <th className="py-1.5 text-right font-medium">{t('dev.ipcAvg')}</th>
                  <th className="py-1.5 text-right font-medium">{t('dev.ipcLast')}</th>
                </tr>
              </thead>
              <tbody>
                {data.metrics.map((metric) => (
                  <tr key={metric.channel} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td className="max-w-[360px] truncate py-1.5 pr-3 font-mono" style={{ color: 'var(--color-text)' }}>{metric.channel}</td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{metric.calls}</td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: metric.errors > 0 ? 'var(--color-error)' : 'var(--color-text-muted)' }}>{metric.errors}</td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{formatDuration(metric.avgMs)}</td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{formatDuration(metric.lastMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-4 text-xs font-medium" style={{ color: 'var(--color-text)' }}>{t('dev.ipcRecent')}</div>
            <div className="mt-1 space-y-0.5">
              {recent.map((call, index) => (
                <div key={`${call.at}-${index}`} className="flex items-center gap-2 text-micro" style={{ color: 'var(--color-text-muted)' }}>
                  <span className="w-[86px] flex-shrink-0 tabular-nums">{new Date(call.at).toLocaleTimeString()}</span>
                  <span className="min-w-0 flex-1 truncate font-mono" style={{ color: 'var(--color-text-secondary)' }}>{call.channel}</span>
                  <span className="w-[70px] flex-shrink-0 text-right tabular-nums">{formatDuration(call.durationMs)}</span>
                  <span className="w-[42px] flex-shrink-0 text-right" style={{ color: call.ok ? 'var(--color-success)' : 'var(--color-error)' }}>
                    {call.ok ? t('dev.ipcStatusOk') : t('dev.ipcStatusError')}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex-shrink-0 px-6 pb-3 text-micro" style={{ color: 'var(--color-text-muted)' }}>
        {t('dev.ipcHint')}
      </div>
    </div>
  )
}