import { useCallback, useEffect, useState } from 'react'
import { Spinner } from '../ui/Spinner'
import { useTranslation } from '../../hooks/useTranslation'
import { ipc } from '../../services/ipc-client'
import type { DevPerfSnapshot } from '../../shared/ipc-channels'

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl p-3" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
      <div className="text-micro" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
      <div className="mt-1 font-mono text-sm" style={{ color: 'var(--color-text)' }}>{value}</div>
      {hint && <div className="mt-0.5 text-micro" style={{ color: 'var(--color-text-muted)' }}>{hint}</div>}
    </div>
  )
}

export default function DevPerformanceTab({ active }: { active: boolean }) {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<DevPerfSnapshot | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setSnapshot(await ipc.invoke('dev:perf'))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    if (!active) return
    const kickoff = setTimeout(() => { void load() }, 0)
    const timer = setInterval(() => { void load() }, 2000)
    return () => { clearTimeout(kickoff); clearInterval(timer) }
  }, [active, load])

  const rendererMemory = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize

  return (
    <div className="h-full overflow-y-auto px-6 py-3">
      {error && (
        <div className="mb-3 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 8%, transparent)', color: 'var(--color-error)' }}>
          {error}
        </div>
      )}
      {!snapshot ? (
        <div className="flex h-full items-center justify-center"><Spinner size={18} /></div>
      ) : (
        <>
          <div className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{t('dev.perfMain')}</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Card label={t('dev.perfRss')} value={formatBytes(snapshot.main.rss)} hint={`PID ${snapshot.main.pid}`} />
            <Card label={t('dev.perfHeap')} value={formatBytes(snapshot.main.heapUsed)} hint={`/ ${formatBytes(snapshot.main.heapTotal)}`} />
            <Card label={t('dev.perfEventLoop')} value={`${snapshot.main.eventLoopDelayMs.toFixed(2)}ms`} />
            <Card label={t('dev.perfUptime')} value={formatUptime(snapshot.main.uptimeSec)} />
          </div>

          <div className="mt-4 text-xs font-medium" style={{ color: 'var(--color-text)' }}>{t('dev.perfDb')}</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Card label={t('dev.perfDb')} value={formatBytes(snapshot.db.size)} hint={snapshot.db.projectPath ?? '—'} />
            <Card label={t('dev.perfWal')} value={formatBytes(snapshot.db.walSize)} />
            <Card label={t('dev.perfLogs')} value={formatBytes(snapshot.logs.bytes)} hint={`${snapshot.logs.files} ${t('dev.perfFiles')}`} />
            {rendererMemory !== undefined && <Card label="Renderer heap" value={formatBytes(rendererMemory)} />}
          </div>

          <div className="mt-4 text-xs font-medium" style={{ color: 'var(--color-text)' }}>{t('dev.perfProcesses')}</div>
          {snapshot.app.length === 0 ? (
            <div className="mt-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('dev.perfEmpty')}</div>
          ) : (
            <table className="mt-2 w-full border-collapse text-xs">
              <thead>
                <tr style={{ color: 'var(--color-text-muted)' }}>
                  <th className="py-1.5 text-left font-medium">{t('dev.perfType')}</th>
                  <th className="py-1.5 text-right font-medium">PID</th>
                  <th className="py-1.5 text-right font-medium">{t('dev.perfCpu')}</th>
                  <th className="py-1.5 text-right font-medium">{t('dev.perfMemory')}</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.app.map((metric) => (
                  <tr key={`${metric.type}-${metric.pid}`} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td className="py-1.5" style={{ color: 'var(--color-text-secondary)' }}>{metric.type}</td>
                    <td className="py-1.5 text-right font-mono" style={{ color: 'var(--color-text-muted)' }}>{metric.pid}</td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{metric.cpuPercent.toFixed(1)}%</td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{formatBytes(metric.memoryKB * 1024)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}