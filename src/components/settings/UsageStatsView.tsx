import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle, BarChart3, Clock3, Gauge, Layers3, MessageSquare,
  Palette, RefreshCw, Sparkles, Zap,
} from 'lucide-react'
import { Spinner } from '../ui/Spinner'
import { Table } from '../ui/Table'
import { Button } from '../ui/Button'
import CountBadge from '../ui/CountBadge'
import { ipc } from '../../services/ipc-client'
import type {
  GlobalUsageProjectRow,
  GlobalUsageStatsData,
  UsageDashboardData,
} from '../../shared/ipc-channels'
import { useTranslation } from '../../hooks/useTranslation'
import { SegmentedControl } from '../ui/SegmentedControl'
import { useLayoutStore } from '../../stores/layout-store'

type UsageView = 'current' | 'global'
type RangeDays = 1 | 7 | 30 | 0

const RANGE_OPTIONS: Array<{ days: RangeDays; key: 'usage.rangeToday' | 'usage.range7' | 'usage.range30' | 'usage.rangeAll' }> = [
  { days: 1, key: 'usage.rangeToday' },
  { days: 7, key: 'usage.range7' },
  { days: 30, key: 'usage.range30' },
  { days: 0, key: 'usage.rangeAll' },
]

const DONUT_COLORS = [
  'var(--color-accent)',
  'var(--color-info)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-error)',
  'var(--color-text-muted)',
]

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString()
}

function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`
}

function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '0s'
  const seconds = ms / 1000
  if (seconds < 1) return `${Math.round(ms)}ms`
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  if (minutes < 60) return `${minutes}m ${rest}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function formatDay(day: string): string {
  return day.slice(5)
}

function formatDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

let loadSeq = 0

export default function UsageStatsView() {
  const { t } = useTranslation()
  const [view, setView] = useState<UsageView>('current')
  const [rangeDays, setRangeDays] = useState<RangeDays>(30)
  const [data, setData] = useState<UsageDashboardData | null>(null)
  const [sessions, setSessions] = useState<Array<{ id: string; title: string; updatedAt: number }>>([])
  const [rangeEnd, setRangeEnd] = useState(() => Date.now())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [globalData, setGlobalData] = useState<GlobalUsageStatsData | null>(null)
  const [globalLoading, setGlobalLoading] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)

  const load = useCallback(async (days: RangeDays) => {
    const seq = ++loadSeq
    setLoading(true)
    setError(null)
    try {
      const to = Date.now()
      setRangeEnd(to)
      const from = days === 0 ? 0 : to - days * 86_400_000
      const [res, archives] = await Promise.all([
        ipc.invoke('db:usage-dashboard', { from, to }) as Promise<UsageDashboardData>,
        ipc.invoke('fs:agent-archive-list') as Promise<Array<{ id: string; title: string; updatedAt: number }>>,
      ])
      if (seq !== loadSeq) return
      setData(res)
      setSessions(archives.filter(s => days === 0 || s.updatedAt >= from))
    } catch (e) {
      if (seq !== loadSeq) return
      console.warn('[UsageStatsView] 加载用量仪表盘失败:', e)
      setData(null)
      setError(String(e))
    } finally {
      if (seq === loadSeq) setLoading(false)
    }
  }, [])

  const loadGlobal = useCallback(async () => {
    const seq = ++loadSeq
    setGlobalLoading(true)
    setGlobalError(null)
    try {
      const res = await ipc.invoke('db:usage-stats-global') as GlobalUsageStatsData
      if (seq !== loadSeq) return
      setGlobalData(res)
    } catch (e) {
      if (seq !== loadSeq) return
      console.warn('[UsageStatsView] 加载全局用量统计失败:', e)
      setGlobalData(null)
      setGlobalError(String(e))
    } finally {
      if (seq === loadSeq) setGlobalLoading(false)
    }
  }, [])

  useEffect(() => {
    Promise.resolve().then(() => { void load(rangeDays) })
  }, [rangeDays, load])

  useEffect(() => {
    if (view === 'global') Promise.resolve().then(() => { void loadGlobal() })
  }, [view, loadGlobal])

  const handleRefresh = () => {
    if (view === 'current') void load(rangeDays)
    else void loadGlobal()
  }

  const totals = data?.totals
  const cacheRate = totals && totals.promptTokens > 0 ? (totals.cachedTokens / totals.promptTokens) * 100 : 0
  const outputSpeed = totals && totals.durationMs > 0 ? totals.completionTokens / (totals.durationMs / 1000) : 0
  const now = rangeEnd
  const fromMs = rangeDays === 0 ? 0 : now - rangeDays * 86_400_000
  const rangeText = rangeDays === 0 ? t('usage.rangeAll') : `${formatDate(fromMs)} → ${formatDate(now)}`

  const tokenSegments = useMemo(() => {
    if (!totals) return []
    const input = Math.max(0, totals.promptTokens - totals.cachedTokens)
    return [
      { label: t('usage.promptTokens'), value: input, color: DONUT_COLORS[0] },
      { label: t('usage.cachedTokens'), value: totals.cachedTokens, color: DONUT_COLORS[1] },
      { label: t('usage.completionTokens'), value: totals.completionTokens, color: DONUT_COLORS[2] },
    ].filter(segment => segment.value > 0)
  }, [totals, t])

  const durationSegments = useMemo(() => {
    const rows = [...(data?.byPurpose ?? [])]
      .filter(row => row.durationMs > 0)
      .sort((a, b) => b.durationMs - a.durationMs)
    const top = rows.slice(0, 5)
    const other = rows.slice(5).reduce((sum, row) => sum + row.durationMs, 0)
    return [
      ...top.map((row, i) => ({
        label: row.purpose || t('usage.purpose'),
        value: row.durationMs,
        color: DONUT_COLORS[i % DONUT_COLORS.length],
      })),
      ...(other > 0 ? [{ label: t('usage.other'), value: other, color: DONUT_COLORS[5] }] : []),
    ]
  }, [data?.byPurpose, t])

  const daily7 = data?.daily.slice(-7) ?? []
  const maxDailyTokens = Math.max(1, ...daily7.map(row => row.tokens))
  const maxDailyCost = Math.max(0.0001, ...daily7.map(row => row.cost))
  const heatmap = useMemo(() => {
    const byDay = new Map((data?.daily ?? []).map(row => [row.day, row.calls]))
    const result: Array<{ day: string; calls: number }> = []
    const start = new Date()
    start.setHours(12, 0, 0, 0)
    start.setDate(start.getDate() - 83)
    for (let i = 0; i < 84; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      const key = dayKey(d)
      result.push({ day: key, calls: byDay.get(key) ?? 0 })
    }
    return result
  }, [data?.daily])
  const maxHeat = Math.max(1, ...heatmap.map(day => day.calls))

  return (
    <div className="space-y-4">
      {/* 页头 */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>{t('usage.insightsTitle')}</h2>
          <p className="mt-0.5 text-micro" style={{ color: 'var(--color-text-muted)' }}>{t('usage.insightsDesc')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => useLayoutStore.getState().openSettings('editor')}
          >
            <Palette size={12} /> {t('usage.styleSettings')}
          </Button>
          <SegmentedControl<UsageView>
            size="sm"
            value={view}
            onChange={setView}
            items={[
              { value: 'current', label: t('usage.tabCurrent') },
              { value: 'global', label: t('usage.tabGlobal') },
            ]}
          />
          <Button variant="ghost" size="icon" onClick={handleRefresh} title={t('action.refresh')}>
            <RefreshCw size={14} className={(loading || globalLoading) ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>

      {view === 'current' && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-micro tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{rangeText}</span>
          <SegmentedControl<`${RangeDays}`>
            size="sm"
            value={String(rangeDays) as `${RangeDays}`}
            onChange={(value) => setRangeDays(Number(value) as RangeDays)}
            items={RANGE_OPTIONS.map(option => ({
              value: String(option.days) as `${RangeDays}`,
              label: t(option.key),
            }))}
          />
        </div>
      )}

      {view === 'global' ? (
        <GlobalUsageView
          data={globalData}
          loading={globalLoading}
          error={globalError}
          onRetry={handleRefresh}
        />
      ) : loading && !data ? (
        <LoadingState />
      ) : error ? (
        <ErrorState onRetry={handleRefresh} />
      ) : data && totals && totals.calls === 0 ? (
        <EmptyState onRetry={handleRefresh} />
      ) : data && totals ? (
        <>
          {/* 六个概要卡 */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <StatCard icon={<MessageSquare size={14} />} label={t('usage.activeSessions')} value={formatNumber(sessions.length)} sub={t('usage.recentSessions')} />
            <StatCard icon={<Zap size={14} />} label={t('usage.totalTokens')} value={formatCompact(totals.tokens)} sub={`${formatNumber(totals.tokens)} tokens`} />
            <StatCard icon={<Gauge size={14} />} label={t('usage.totalCost')} value={formatCost(totals.cost)} sub={`${t('usage.totalCalls')} ${formatNumber(totals.calls)}`} />
            <StatCard icon={<Layers3 size={14} />} label={t('usage.cacheHit')} value={`${cacheRate.toFixed(1)}%`} sub={`${formatCompact(totals.cachedTokens)} tokens`} tone={cacheRate > 0 ? 'success' : 'muted'} />
            <StatCard icon={<Sparkles size={14} />} label={t('usage.modelCalls')} value={formatNumber(totals.calls)} sub={`${data.byModel.length} ${t('usage.model')}`} />
            <StatCard icon={<Clock3 size={14} />} label={t('usage.activeTime')} value={formatDuration(totals.durationMs)} sub={t('usage.perCall').replace('{n}', formatDuration(totals.calls > 0 ? totals.durationMs / totals.calls : 0))} />
          </div>

          {/* 近 7 天 */}
          <SectionCard
            title={t('usage.last7Days')}
            action={<span className="text-micro" style={{ color: 'var(--color-text-muted)' }}>{t('usage.outputSpeed').replace('{n}', outputSpeed.toFixed(1))}</span>}
          >
            <div className="flex h-[148px] items-end gap-2">
              {daily7.length === 0 ? (
                <div className="flex h-full w-full items-center justify-center text-micro" style={{ color: 'var(--color-text-muted)' }}>{t('usage.noData')}</div>
              ) : daily7.map(row => (
                <div key={row.day} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <div className="flex h-[118px] items-end justify-center gap-0.5">
                    <div
                      className="w-2 rounded-t"
                      title={`${formatNumber(row.tokens)} tokens`}
                      style={{ height: `${Math.max(row.tokens > 0 ? 3 : 0, (row.tokens / maxDailyTokens) * 100)}%`, backgroundColor: 'var(--color-accent)' }}
                    />
                    <div
                      className="w-1.5 rounded-t"
                      title={formatCost(row.cost)}
                      style={{ height: `${Math.max(row.cost > 0 ? 3 : 0, (row.cost / maxDailyCost) * 100)}%`, backgroundColor: 'var(--color-success)' }}
                    />
                  </div>
                  <span className="text-micro tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{formatDay(row.day)}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-3 text-micro" style={{ color: 'var(--color-text-muted)' }}>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: 'var(--color-accent)' }} />tokens</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: 'var(--color-success)' }} />USD</span>
            </div>
          </SectionCard>

          {/* Token / 耗时 */}
          <div className="grid gap-3 xl:grid-cols-2">
            <SectionCard title={t('usage.tokenStats')}>
              <DonutPanel
                segments={tokenSegments}
                centerValue={formatCompact(totals.tokens)}
                centerLabel="tokens"
              />
            </SectionCard>
            <SectionCard
              title={t('usage.durationStats')}
              action={<span className="text-micro" style={{ color: 'var(--color-text-muted)' }}>{formatDuration(totals.durationMs)}</span>}
            >
              <DonutPanel
                segments={durationSegments}
                centerValue={formatDuration(totals.durationMs)}
                centerLabel={t('usage.activeTime')}
              />
            </SectionCard>
          </div>

          {/* 活跃度热力图 */}
          <SectionCard title={t('usage.activityTitle')} action={<CountBadge value={sessions.length} unit={t('unit.items')} />}>
            <div className="overflow-x-auto pb-1">
              <div
                className="grid gap-1"
                style={{ gridTemplateRows: 'repeat(7, 10px)', gridAutoFlow: 'column', gridAutoColumns: '10px' }}
              >
                {heatmap.map(cell => {
                  const intensity = cell.calls / maxHeat
                  return (
                    <div
                      key={cell.day}
                      title={`${cell.day}: ${cell.calls} ${t('usage.calls')}`}
                      className="h-[10px] w-[10px] rounded-[2px]"
                      style={{
                        backgroundColor: cell.calls > 0
                          ? `color-mix(in srgb, var(--color-accent) ${Math.round(18 + intensity * 82)}%, transparent)`
                          : 'var(--color-hover)',
                      }}
                    />
                  )
                })}
              </div>
            </div>
            <div className="mt-2 flex items-center justify-end gap-1 text-micro" style={{ color: 'var(--color-text-muted)' }}>
              <span>{t('usage.calls')}</span>
              {[0, 0.25, 0.5, 0.75, 1].map(level => (
                <span key={level} className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: level === 0 ? 'var(--color-hover)' : `color-mix(in srgb, var(--color-accent) ${Math.round(18 + level * 82)}%, transparent)` }} />
              ))}
            </div>
          </SectionCard>

          {/* 会话 / 用途 / 模型 */}
          <div className="grid gap-3 xl:grid-cols-3">
            <SectionCard
              title={t('usage.recentSessions')}
              action={<Button variant="ghost" size="sm" onClick={() => useLayoutStore.getState().openRightPanel('agent')}>{t('agent.aiPanel')}</Button>}
            >
              {sessions.length === 0 ? (
                <p className="py-4 text-center text-micro" style={{ color: 'var(--color-text-muted)' }}>{t('usage.noSessions')}</p>
              ) : (
                <div className="space-y-1">
                  {sessions.slice(0, 6).map(session => (
                    <div key={session.id} className="flex items-center gap-2 rounded-md px-1.5 py-1.5" style={{ backgroundColor: 'var(--color-hover)' }}>
                      <MessageSquare size={12} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
                      <span className="min-w-0 flex-1 truncate text-xs" style={{ color: 'var(--color-text)' }} title={session.title}>{session.title}</span>
                      <span className="flex-shrink-0 text-micro tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{formatDate(session.updatedAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            <DistributionCard title={t('usage.purposeDistribution')} rows={data.byPurpose.map(row => ({ key: row.purpose || '—', label: row.purpose || '—', value: row.tokens, cost: row.cost, calls: row.calls }))} />
            <DistributionCard title={t('usage.modelDistribution')} rows={data.byModel.map(row => ({ key: row.model || '—', label: row.model || '—', value: row.tokens, cost: row.cost, calls: row.calls }))} />
          </div>
        </>
      ) : null}
    </div>
  )
}

function GlobalUsageView({ data, loading, error, onRetry }: {
  data: GlobalUsageStatsData | null
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  const { t } = useTranslation()
  if (loading && !data) return <LoadingState />
  if (error) return <ErrorState onRetry={onRetry} />
  if (!data) return null
  if (data.projects.length === 0) return <EmptyState onRetry={onRetry} message={t('usage.globalNoProjects')} />
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <StatCard icon={<Sparkles size={14} />} label={t('usage.totalCalls')} value={formatNumber(data.total.calls)} sub={t('usage.tabGlobal')} />
        <StatCard icon={<Gauge size={14} />} label={t('usage.totalCost')} value={formatCost(data.total.cost)} sub={t('usage.tabGlobal')} />
        <StatCard icon={<Layers3 size={14} />} label={t('usage.cachedTokens')} value={formatCompact(data.total.cachedTokens)} sub="tokens" tone="success" />
      </div>
      {data.degradedProjects.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-warning)' }}>
          <AlertTriangle size={12} /> {t('usage.degradedNotice')}
        </p>
      )}
      <SectionCard title={t('usage.globalProjectsTitle')}>
        <Table
          nowrapCells
          headers={[t('usage.project'), t('usage.calls'), t('usage.promptTokens'), t('usage.completionTokens'), t('usage.cachedTokens'), t('usage.cost'), t('usage.status')]}
          rows={data.projects.map((r: GlobalUsageProjectRow) => ({
            key: r.path,
            cells: [r.name || '—', formatNumber(r.calls), formatNumber(r.promptTokens), formatNumber(r.completionTokens), formatNumber(r.cachedTokens), formatCost(r.cost), r.degraded ? t('usage.degraded') : '—'],
          }))}
        />
      </SectionCard>
    </div>
  )
}

function StatCard({ icon, label, value, sub, tone = 'accent' }: {
  icon: ReactNode
  label: string
  value: string
  sub: string
  tone?: 'accent' | 'success' | 'muted'
}) {
  const color = tone === 'success' ? 'var(--color-success)' : tone === 'muted' ? 'var(--color-text-muted)' : 'var(--color-accent)'
  return (
    <div className="rounded-lg p-3" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
      <div className="flex items-center gap-1.5 text-micro" style={{ color: 'var(--color-text-muted)' }}>
        <span style={{ color }}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{value}</div>
      <div className="mt-0.5 truncate text-micro" style={{ color: 'var(--color-text-muted)' }}>{sub}</div>
    </div>
  )
}

function SectionCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg p-3" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

interface DonutSegment { label: string; value: number; color: string }

function DonutPanel({ segments, centerValue, centerLabel }: { segments: DonutSegment[]; centerValue: string; centerLabel: string }) {
  return (
    <div className="flex items-center gap-4">
      <Donut segments={segments} centerValue={centerValue} centerLabel={centerLabel} />
      <div className="min-w-0 flex-1 space-y-1.5">
        {segments.length === 0 ? null : segments.map(segment => (
          <div key={segment.label} className="flex items-center gap-1.5 text-micro">
            <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: segment.color }} />
            <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--color-text-secondary)' }}>{segment.label}</span>
            <span className="flex-shrink-0 tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{formatCompact(segment.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Donut({ segments, centerValue, centerLabel }: { segments: DonutSegment[]; centerValue: string; centerLabel: string }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  const radius = 42
  const circumference = 2 * Math.PI * radius
  let offset = 0
  return (
    <div className="relative h-[116px] w-[116px] flex-shrink-0">
      <svg viewBox="0 0 116 116" className="h-full w-full -rotate-90">
        <circle cx="58" cy="58" r={radius} fill="none" stroke="var(--color-hover)" strokeWidth="14" />
        {total > 0 && segments.map(segment => {
          const length = (segment.value / total) * circumference
          const el = (
            <circle
              key={segment.label}
              cx="58" cy="58" r={radius} fill="none"
              stroke={segment.color}
              strokeWidth="14"
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
            />
          )
          offset += length
          return el
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{centerValue}</span>
        <span className="text-micro" style={{ color: 'var(--color-text-muted)' }}>{centerLabel}</span>
      </div>
    </div>
  )
}

function DistributionCard({ title, rows }: {
  title: string
  rows: Array<{ key: string; label: string; value: number; cost: number; calls: number }>
}) {
  const { t } = useTranslation()
  const sorted = [...rows].sort((a, b) => b.value - a.value).slice(0, 6)
  const max = Math.max(1, ...sorted.map(row => row.value))
  return (
    <SectionCard title={title}>
      {sorted.length === 0 ? (
        <p className="py-4 text-center text-micro" style={{ color: 'var(--color-text-muted)' }}>{t('usage.noData')}</p>
      ) : (
        <div className="space-y-2">
          {sorted.map(row => (
            <div key={row.key}>
              <div className="flex items-center gap-2 text-micro">
                <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--color-text-secondary)' }} title={row.label}>{row.label}</span>
                <span className="flex-shrink-0 tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{formatCompact(row.value)} tokens</span>
                <span className="w-14 flex-shrink-0 text-right tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{formatCost(row.cost)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--color-hover)' }}>
                <div className="h-full rounded-full" style={{ width: `${(row.value / max) * 100}%`, backgroundColor: 'var(--color-accent)' }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

function LoadingState() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-center py-16 gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
      <Spinner size={14} /> <span>{t('status.loading')}</span>
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl py-12" style={{ border: '1px dashed var(--color-border)' }}>
      <AlertTriangle size={36} style={{ color: 'var(--color-warning)', opacity: 0.7 }} />
      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('usage.loadFailed')}</span>
      <Button variant="outline" size="sm" onClick={onRetry}><RefreshCw size={12} /> {t('action.retry')}</Button>
    </div>
  )
}

function EmptyState({ onRetry, message }: { onRetry: () => void; message?: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl py-12" style={{ border: '1px dashed var(--color-border)' }}>
      <BarChart3 size={36} style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{message ?? t('usage.noData')}</span>
      <Button variant="outline" size="sm" onClick={onRetry}><RefreshCw size={12} /> {t('action.refresh')}</Button>
    </div>
  )
}
