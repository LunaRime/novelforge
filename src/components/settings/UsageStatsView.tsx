/**
 * UsageStatsView — 用量统计面板（设置 → 用量）
 *
 * 双视图：当前项目（llm_calls 在项目库 {project}/.vela/vela.db）purpose/模型维度 + 合计 + 时间区间过滤，
 * 以及全部项目（跨项目聚合：最近项目 + 当前项目逐项目只读，主进程 60s 缓存；旧库缺列降级标记）。
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, BarChart3, Loader2, RefreshCw } from 'lucide-react'
import { ipc } from '../../services/ipc-client'
import type {
  GlobalUsageProjectRow,
  GlobalUsageStatsData,
  UsageStatsByPurposeRow,
  UsageStatsByModelRow,
  UsageStatsData,
} from '../../shared/ipc-channels'
import { useTranslation } from '../../hooks/useTranslation'
import { cn } from '../../lib/utils'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../ui/Select'

/** 时间区间选项（days=0 表示全部时间） */
const RANGE_OPTIONS = [
  { days: 7, key: 'usage.range7' },
  { days: 30, key: 'usage.range30' },
  { days: 90, key: 'usage.range90' },
  { days: 0, key: 'usage.rangeAll' },
] as const

/** 千分位格式化 */
function formatNumber(n: number): string {
  return n.toLocaleString()
}

/** 费用格式化（美元，4 位小数过细——统一 2 位） */
function formatCost(cost: number): string {
  return cost.toFixed(2)
}

let loadSeq = 0 // loadSeq 防竞态（stores 惯例；视图单实例）

type UsageView = 'current' | 'global'

export default function UsageStatsView() {
  const { t } = useTranslation()
  const [view, setView] = useState<UsageView>('current')
  const [rangeDays, setRangeDays] = useState(30)
  const [data, setData] = useState<UsageStatsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [globalData, setGlobalData] = useState<GlobalUsageStatsData | null>(null)
  const [globalLoading, setGlobalLoading] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)

  const load = useCallback(async (days: number) => {
    const seq = ++loadSeq // loadSeq 防竞态（项目惯例）：区间快速切换时丢弃旧响应
    setLoading(true)
    setError(null)
    try {
      const to = Date.now()
      const from = days === 0 ? 0 : to - days * 86_400_000
      const res = await ipc.invoke('db:usage-stats', { from, to })
      if (seq !== loadSeq) return // 已被更新请求取代——旧响应不覆盖新区间数据
      setData(res)
    } catch (e) {
      if (seq !== loadSeq) return
      console.warn('[UsageStatsView] 加载用量统计失败:', e)
      setData(null)
      setError(String(e))
    } finally {
      if (seq === loadSeq) setLoading(false)
    }
  }, [])

  const loadGlobal = useCallback(async () => {
    const seq = ++loadSeq // 共用 loadSeq：视图快速切换时丢弃旧响应
    setGlobalLoading(true)
    setGlobalError(null)
    try {
      const res = await ipc.invoke('db:usage-stats-global')
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

  // 区间切换即重新聚合（SQL 按区间过滤，数据量小无需缓存）；load 为 useCallback([]) 稳定引用，仅 rangeDays 变化触发
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- load 稳定引用（[]），依赖 rangeDays 覆盖切换
  useEffect(() => { void load(rangeDays) }, [rangeDays])

  // 切到「全部项目」视图时加载全局聚合（主进程 60s 缓存——无需防抖）
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- loadGlobal 稳定引用（[]），依赖 view 覆盖切换
  useEffect(() => { if (view === 'global') void loadGlobal() }, [view])

  const handleRefresh = () => {
    if (view === 'current') void load(rangeDays)
    else void loadGlobal()
  }

  return (
    <div className="space-y-4">
      {/* 头部：视图切换（当前项目/全部项目）+ 时间区间（仅当前项目视图）+ 刷新 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ backgroundColor: 'var(--color-hover)' }}>
          <TabButton active={view === 'current'} onClick={() => setView('current')}>{t('usage.tabCurrent')}</TabButton>
          <TabButton active={view === 'global'} onClick={() => setView('global')}>{t('usage.tabGlobal')}</TabButton>
        </div>
        <div className="flex items-center gap-2">
          {view === 'current' && (
            <Select
              value={String(rangeDays)}
              onValueChange={(v) => setRangeDays(parseInt(v, 10))}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder={t('usage.rangeLabel')} />
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.days} value={String(opt.days)}>
                    {t(opt.key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <button
            onClick={handleRefresh}
            className="icon-btn"
            style={{ width: 28, height: 28 }}
            title={t('action.refresh')}
          >
            <RefreshCw size={14} className={(loading || globalLoading) ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {view === 'current' ? (loading && !data && !error ? (
        <div className="flex items-center justify-center py-12 gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          <Loader2 size={14} className="animate-spin" />
          {t('status.loading')}
        </div>
      ) : error ? (
        <div
          className="flex flex-col items-center justify-center py-12 gap-2 rounded-xl"
          style={{ border: '1px dashed var(--color-border)' }}
        >
          <AlertTriangle size={22} style={{ color: 'var(--color-warning)', opacity: 0.7 }} />
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('usage.loadFailed')}
          </span>
          <button
            type="button"
            onClick={handleRefresh}
            className="icon-btn"
            style={{ width: 28, height: 28 }}
            title={t('action.retry')}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      ) : data && (data.byPurpose.length === 0 && data.byModel.length === 0) ? (
        <div
          className="flex flex-col items-center justify-center py-12 gap-2 rounded-xl"
          style={{ border: '1px dashed var(--color-border)' }}
        >
          <BarChart3 size={22} style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('usage.noData')}
          </span>
        </div>
      ) : data ? (
        <>
          {/* 合计 */}
          <div className="flex items-stretch gap-2">
            <SummaryCard label={t('usage.totalCalls')} value={formatNumber(data.total.calls)} />
            <SummaryCard label={t('usage.totalCost')} value={`$${formatCost(data.total.cost)}`} />
          </div>

          {/* 按用途 */}
          <div>
            <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>
              {t('usage.purposeTitle')}
            </p>
            <StatsTable
              headers={[
                t('usage.purpose'),
                t('usage.calls'),
                t('usage.promptTokens'),
                t('usage.completionTokens'),
                t('usage.cachedTokens'),
                t('usage.cost'),
              ]}
              rows={data.byPurpose.map((r: UsageStatsByPurposeRow) => ({
                key: r.purpose || '—',
                cells: [
                  r.purpose || '—', // M3：purpose DEFAULT '' 历史行显示占位（与 byModel 行同形态）
                  formatNumber(r.calls),
                  formatNumber(r.promptTokens),
                  formatNumber(r.completionTokens),
                  formatNumber(r.cachedTokens),
                  `$${formatCost(r.cost)}`,
                ],
              }))}
            />
          </div>

          {/* 按模型 */}
          <div>
            <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>
              {t('usage.byModelTitle')}
            </p>
            <StatsTable
              headers={[
                t('usage.model'),
                t('usage.calls'),
                t('usage.cost'),
              ]}
              rows={data.byModel.map((r: UsageStatsByModelRow) => ({
                key: r.model,
                cells: [
                  r.model || '—',
                  formatNumber(r.calls),
                  `$${formatCost(r.cost)}`,
                ],
              }))}
            />
          </div>
        </>
      ) : null) : globalLoading && !globalData && !globalError ? (
        <div className="flex items-center justify-center py-12 gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          <Loader2 size={14} className="animate-spin" />
          {t('status.loading')}
        </div>
      ) : globalError ? (
        <div
          className="flex flex-col items-center justify-center py-12 gap-2 rounded-xl"
          style={{ border: '1px dashed var(--color-border)' }}
        >
          <AlertTriangle size={22} style={{ color: 'var(--color-warning)', opacity: 0.7 }} />
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('usage.loadFailed')}
          </span>
          <button
            type="button"
            onClick={handleRefresh}
            className="icon-btn"
            style={{ width: 28, height: 28 }}
            title={t('action.retry')}
          >
            <RefreshCw size={14} className={globalLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      ) : globalData && globalData.projects.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-12 gap-2 rounded-xl"
          style={{ border: '1px dashed var(--color-border)' }}
        >
          <BarChart3 size={22} style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('usage.globalNoProjects')}
          </span>
        </div>
      ) : globalData ? (
        <>
          {/* 合计（跨项目） */}
          <div className="flex items-stretch gap-2">
            <SummaryCard label={t('usage.totalCalls')} value={formatNumber(globalData.total.calls)} />
            <SummaryCard label={t('usage.totalCost')} value={`$${formatCost(globalData.total.cost)}`} />
            <SummaryCard label={t('usage.cachedTokens')} value={formatNumber(globalData.total.cachedTokens)} />
          </div>

          {/* 降级提示（旧库缺 cached_tokens 列的项目按 0 统计） */}
          {globalData.degradedProjects.length > 0 && (
            <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-warning)' }}>
              <AlertTriangle size={12} />
              {t('usage.degradedNotice')}
            </p>
          )}

          {/* 项目维度表 */}
          <div>
            <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>
              {t('usage.globalProjectsTitle')}
            </p>
            <StatsTable
              headers={[
                t('usage.project'),
                t('usage.calls'),
                t('usage.promptTokens'),
                t('usage.completionTokens'),
                t('usage.cachedTokens'),
                t('usage.cost'),
                t('usage.status'),
              ]}
              rows={globalData.projects.map((r: GlobalUsageProjectRow) => ({
                key: r.path,
                cells: [
                  r.name || '—',
                  formatNumber(r.calls),
                  formatNumber(r.promptTokens),
                  formatNumber(r.completionTokens),
                  formatNumber(r.cachedTokens),
                  `$${formatCost(r.cost)}`,
                  r.degraded ? t('usage.degraded') : '—', // degraded=旧库缺 cached_tokens 列（该行按 0 统计）
                ],
              }))}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}

/** 视图切换小 Tab（激活态 accent 底白字，非激活 hover 底——参照 SettingsModal 侧栏惯例） */
function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-1 rounded-md text-xs transition-colors',
        active ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]',
      )}
    >
      {children}
    </button>
  )
}

/** 合计卡片 */
function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex flex-col gap-1 rounded-lg px-3 py-2 min-w-[6rem]"
      style={{ backgroundColor: 'var(--color-hover)' }}
    >
      <span className="text-[0.65rem] truncate" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <span className="text-sm font-bold" style={{ color: 'var(--color-accent)' }}>{value}</span>
    </div>
  )
}

/** 通用统计表（表头 hover 底 + 边框惯例，参照 MarkdownContent 表格样式） */
function StatsTable({ headers, rows }: { headers: string[]; rows: Array<{ key: string; cells: string[] }> }) {
  return (
    <div className="overflow-x-auto rounded-md" style={{ border: '1px solid var(--color-border)' }}>
      <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ backgroundColor: 'var(--color-hover)' }}>
            {headers.map((h) => (
              <th
                key={h}
                className="px-3 py-1.5 text-left font-semibold"
                style={{
                  color: 'var(--color-text)',
                  borderBottom: '1px solid var(--color-border)',
                  whiteSpace: 'nowrap',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={row.key}
              style={{ borderBottom: ri < rows.length - 1 ? '1px solid var(--color-border)' : undefined }}
            >
              {row.cells.map((cell, ci) => (
                <td
                  key={ci}
                  className="px-3 py-1.5"
                  style={{ color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
