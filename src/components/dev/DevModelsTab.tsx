import { useCallback, useEffect, useState } from 'react'
import { EmptyState } from '../ui/EmptyState'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Spinner } from '../ui/Spinner'
import { useTranslation } from '../../hooks/useTranslation'
import { ipc } from '../../services/ipc-client'
import type { UsageDashboardData } from '../../shared/ipc-channels'
import { aggregateRecentByModel, formatDuration, successRate, type LlmHistoryRow } from './dev-monitor-utils'

type RangeKey = 'today' | '7' | '30'

interface LlmRow extends LlmHistoryRow {
  id?: number
  purpose?: string
  totalTokens?: number
  cost?: number
  createdAt?: number
}

function rangeStart(key: RangeKey): number {
  if (key === 'today') {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }
  return Date.now() - (key === '7' ? 7 : 30) * 24 * 60 * 60 * 1000
}

function formatCost(cost: number): string {
  return Number.isFinite(cost) ? `$${cost.toFixed(4)}` : '$0.0000'
}

export default function DevModelsTab({ active }: { active: boolean }) {
  const { t } = useTranslation()
  const [range, setRange] = useState<RangeKey>('7')
  const [dashboard, setDashboard] = useState<UsageDashboardData | null>(null)
  const [rows, setRows] = useState<LlmRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const from = rangeStart(range)
      const [nextDashboard, history] = await Promise.all([
        ipc.invoke('db:usage-dashboard', { from, to: Date.now() }),
        ipc.invoke('db:get-llm-history', 200),
      ])
      const typed = (history as LlmRow[]).filter((row) => (row.createdAt ?? 0) >= from)
      setDashboard(nextDashboard)
      setRows(typed)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    if (!active) return
    const kickoff = setTimeout(() => { void load() }, 0)
    const timer = setInterval(() => { void load() }, 5000)
    return () => { clearTimeout(kickoff); clearInterval(timer) }
  }, [active, load])

  const recentByModel = aggregateRecentByModel(rows)
  const recent = rows.slice(0, 50)

  return (
    <div className="h-full overflow-y-auto px-6 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{t('dev.modelsTitle')}</div>
        <SegmentedControl
          size="sm"
          value={range}
          onChange={setRange}
          items={[
            { value: 'today', label: t('dev.modelsRangeToday') },
            { value: '7', label: t('dev.modelsRange7') },
            { value: '30', label: t('dev.modelsRange30') },
          ]}
        />
      </div>

      {error && (
        <div className="mt-3 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 8%, transparent)', color: 'var(--color-error)' }}>
          {error}
        </div>
      )}

      {loading && !dashboard ? (
        <div className="flex h-[240px] items-center justify-center"><Spinner size={18} /></div>
      ) : !dashboard || (dashboard.byModel.length === 0 && rows.length === 0) ? (
        <EmptyState message={t('dev.modelsEmpty')} />
      ) : (
        <>
          <div className="mt-4 text-xs font-medium" style={{ color: 'var(--color-text)' }}>{t('dev.modelsByModel')}</div>
          <table className="mt-1 w-full border-collapse text-xs">
            <thead>
              <tr style={{ color: 'var(--color-text-muted)' }}>
                <th className="py-1.5 text-left font-medium">{t('dev.modelsModel')}</th>
                <th className="py-1.5 text-right font-medium">{t('dev.modelsCalls')}</th>
                <th className="py-1.5 text-right font-medium">{t('dev.modelsSuccess')}</th>
                <th className="py-1.5 text-right font-medium">{t('dev.modelsDuration')}</th>
                <th className="py-1.5 text-right font-medium">{t('dev.modelsTokens')}</th>
                <th className="py-1.5 text-right font-medium">{t('dev.modelsCost')}</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.byModel.map((model) => {
                const recentStats = recentByModel.find((item) => item.model === model.model)
                const success = recentStats ? successRate(recentStats.calls - recentStats.errors, recentStats.calls) : '—'
                const avg = model.calls > 0 ? model.durationMs / model.calls : 0
                return (
                  <tr key={model.model} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td className="max-w-[260px] truncate py-1.5 font-mono" style={{ color: 'var(--color-text)' }}>{model.model}</td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{model.calls}</td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{success}</td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{formatDuration(avg)}</td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{model.tokens.toLocaleString()}</td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{formatCost(model.cost)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div className="mt-4 text-xs font-medium" style={{ color: 'var(--color-text)' }}>{t('dev.modelsRecent')}</div>
          {recent.length === 0 ? (
            <div className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('dev.modelsEmpty')}</div>
          ) : (
            <table className="mt-1 w-full border-collapse text-micro">
              <thead>
                <tr style={{ color: 'var(--color-text-muted)' }}>
                  <th className="py-1.5 text-left font-medium">{t('dev.modelsTime')}</th>
                  <th className="py-1.5 text-left font-medium">{t('dev.modelsModel')}</th>
                  <th className="py-1.5 text-left font-medium">{t('dev.modelsPurpose')}</th>
                  <th className="py-1.5 text-left font-medium">{t('dev.modelsStatus')}</th>
                  <th className="py-1.5 text-right font-medium">{t('dev.modelsDuration')}</th>
                  <th className="py-1.5 text-right font-medium">{t('dev.modelsTokens')}</th>
                  <th className="py-1.5 text-right font-medium">{t('dev.modelsCost')}</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((row, index) => (
                  <tr key={row.id ?? index} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td className="whitespace-nowrap py-1.5 tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                      {row.createdAt ? new Date(row.createdAt).toLocaleTimeString() : '—'}
                    </td>
                    <td className="max-w-[180px] truncate py-1.5 font-mono" style={{ color: 'var(--color-text-secondary)' }}>{row.modelName ?? '—'}</td>
                    <td className="py-1.5" style={{ color: 'var(--color-text-muted)' }}>{row.purpose ?? '—'}</td>
                    <td className="py-1.5" style={{ color: row.success === 1 ? 'var(--color-success)' : 'var(--color-error)' }}>
                      {row.success === 1 ? t('dev.modelsOk') : t('dev.modelsFail')}
                    </td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{formatDuration(row.durationMs ?? 0)}</td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{(row.totalTokens ?? 0).toLocaleString()}</td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{formatCost(row.cost ?? 0)}</td>
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