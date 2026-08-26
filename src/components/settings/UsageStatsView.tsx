/**
 * UsageStatsView — 用量统计面板（设置 → 用量）
 *
 * 当前项目维度（llm_calls 在项目库 {project}/.vela/vela.db）：
 * purpose 维度表 + 模型维度表 + 合计，时间区间过滤（全部/近 7/30/90 天）。
 * 跨项目聚合归 P3
 */
import { useCallback, useEffect, useState } from 'react'
import { BarChart3, Loader2, RefreshCw } from 'lucide-react'
import { ipc } from '../../services/ipc-client'
import type { UsageStatsByPurposeRow, UsageStatsByModelRow, UsageStatsData } from '../../shared/ipc-channels'
import { useTranslation } from '../../hooks/useTranslation'
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

export default function UsageStatsView() {
  const { t } = useTranslation()
  const [rangeDays, setRangeDays] = useState(30)
  const [data, setData] = useState<UsageStatsData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (days: number) => {
    setLoading(true)
    try {
      const to = Date.now()
      const from = days === 0 ? 0 : to - days * 86_400_000
      setData(await ipc.invoke('db:usage-stats', { from, to }))
    } catch (e) {
      console.warn('[UsageStatsView] 加载用量统计失败:', e)
      setData(null)
    }
    setLoading(false)
  }, [])

  // 区间切换即重新聚合（SQL 按区间过滤，数据量小无需缓存）
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- load 每次渲染重建，依赖 rangeDays 即覆盖
  useEffect(() => { load(rangeDays) }, [rangeDays])

  const handleRefresh = () => { setLoading(true); load(rangeDays) }

  return (
    <div className="space-y-4">
      {/* 头部：时间区间 + 刷新 */}
      <div className="flex items-center justify-between">
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
        <button
          onClick={handleRefresh}
          className="icon-btn"
          style={{ width: 28, height: 28 }}
          title={t('action.refresh')}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-12 gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          <Loader2 size={14} className="animate-spin" />
          {t('status.loading')}
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
                key: r.purpose,
                cells: [
                  r.purpose,
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
      ) : null}
    </div>
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
