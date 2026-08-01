/**
 * ActivityView — 每日活动热力图（GitHub Contribution Graph 风格）
 *
 * 三条数据链按天聚合（本地时区）：
 * - 写作字数：drafts（source='write'）
 * - 修改量：AI 重写草稿 + 修稿（revisions）
 * - 模型调用：llm_calls（success=1）
 *
 * 数据来源：ipc 'db:get-daily-activity' → ActivityRepository（按天 SQL 聚合）
 */
import { useEffect, useState } from 'react'
import { Activity, PenLine, RefreshCw, Loader2, Sparkles, BookOpen } from 'lucide-react'
import { DEFAULT_LOCALE, t } from '../../../shared/locale'
import { getDailyActivity } from '../../../services/stats-service'
import type { DailyActivityData } from '../../../shared/ipc-channels'

/** 最近天数（13 周 ≈ 90 天） */
const DAYS = 90
/** 热力图列数 = 7 天/列（列 = 周） */
const CELL_SIZE = 10
const CELL_GAP = 2

/** 5 级活跃度颜色（accent 透明度渐变，禁止硬编码色值） */
const LEVEL_COLORS = [
  'transparent',
  'color-mix(in srgb, var(--color-accent) 12%, transparent)',
  'color-mix(in srgb, var(--color-accent) 30%, transparent)',
  'color-mix(in srgb, var(--color-accent) 55%, transparent)',
  'color-mix(in srgb, var(--color-accent) 85%, transparent)',
]

export default function ActivityView() {
  const [data, setData] = useState<DailyActivityData | null>(null)
  const [loading, setLoading] = useState(true)

  // 异步加载（与 ModelsView 相同模式：effect 内仅触发异步任务，无同步 setState）
  const loadActivity = async () => {
    try {
      const result = await getDailyActivity(DAYS)
      setData(result)
    } catch (e) {
      console.warn('[ActivityView] 加载每日活动数据失败:', e)
      setData(null)
    }
    setLoading(false)
  }

  // 数据加载模式：effect 仅触发异步任务，setState 全部发生在 promise 回调中
  // （react-hooks v7 新规则对 async 数据加载误报，与 ModelsView 同模式，显式豁免）
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadActivity() }, [])

  // 手动刷新：事件处理器内 setState 合法
  // eslint-disable-next-line react-hooks/set-state-in-effect
  const handleRefresh = () => { setLoading(true); loadActivity() }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
        <Loader2 size={14} className="animate-spin" />
        {t('status.loading')}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      {/* 顶部：标题 + 刷新 */}
      <div
        className="flex items-center justify-between px-4 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-2">
          <Activity size={13} style={{ color: 'var(--color-accent)' }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
            {t('panel.activity')}
          </span>
          <span className="text-[0.68rem]" style={{ color: 'var(--color-text-muted)' }}>
            {t('activity.lastDays').replace('{n}', String(DAYS))}
          </span>
        </div>
        <button onClick={handleRefresh} className="icon-btn" style={{ width: 20, height: 20 }} title={t('action.refresh')}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {!data || data.dayCount === 0 ? (
        <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: 'var(--color-text-muted)' }}>
          <BookOpen size={22} style={{ opacity: 0.4 }} />
          <span className="text-xs">{t('activity.noData')}</span>
        </div>
      ) : (
        <div className="px-4 py-3 space-y-4">
          {/* 统计条 */}
          <div className="flex items-center gap-5 flex-wrap">
            <StatItem icon={<PenLine size={11} />} label={t('activity.totalWritten')} value={formatNumber(totalOf(data, 'writtenWords'))} />
            <StatItem icon={<RefreshCw size={11} />} label={t('activity.totalRevised')} value={formatNumber(totalOf(data, 'revisedWords'))} />
            <StatItem icon={<Sparkles size={11} />} label={t('activity.totalCalls')} value={formatNumber(totalOf(data, 'llmCalls'))} />
            <StatItem icon={<Activity size={11} />} label={t('activity.totalTokens')} value={`${(totalOf(data, 'llmTokens') / 1000).toFixed(1)}K`} />
          </div>

          {/* GitHub 风格热力图 */}
          <div className="select-none">
            <ContributionGrid data={data} />
          </div>

          {/* 图例 */}
          <div className="flex items-center justify-end gap-1.5 text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>
            <span>{t('activity.less')}</span>
            {LEVEL_COLORS.map((c, i) => (
              <span
                key={i}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  backgroundColor: c,
                  border: i === 0 ? '1px solid var(--color-border)' : 'none',
                }}
              />
            ))}
            <span>{t('activity.more')}</span>
          </div>
        </div>
      )}
    </div>
  )
}

/** 统计项 */
function StatItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[0.7rem]" style={{ color: 'var(--color-text-muted)' }}>
      <span style={{ color: 'var(--color-accent)' }}>{icon}</span>
      <span>{label}</span>
      <span className="font-bold text-xs" style={{ color: 'var(--color-text)' }}>{value}</span>
    </div>
  )
}

/** 求和 */
function totalOf(data: DailyActivityData, key: 'writtenWords' | 'revisedWords' | 'llmCalls' | 'llmTokens'): number {
  return data.days.reduce((sum, d) => sum + d[key], 0)
}

/** 千分位格式化 */
function formatNumber(n: number): string {
  return n.toLocaleString()
}

// ===== 热力图网格 =====

function ContributionGrid({ data }: { data: DailyActivityData }) {
  // 构建最近 90 天的日期序列（向前对齐到周日）
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(start.getDate() - (DAYS - 1) - start.getDay()) // 对齐周日（getDay()=0）

  const totalDays = Math.floor((today.getTime() - start.getTime()) / 86400000) + 1
  const columns = Math.ceil(totalDays / 7)

  // day → row 映射
  const byDay = new Map(data.days.map(d => [d.day, d]))

  // 各维度最大值（归一化基准，防除零）
  const maxWritten = Math.max(1, ...data.days.map(d => d.writtenWords))
  const maxRevised = Math.max(1, ...data.days.map(d => d.revisedWords))
  const maxCalls = Math.max(1, ...data.days.map(d => d.llmCalls))

  // 列集合：{ date, monthLabel }[]
  const colStarts: Array<{ date: Date; monthLabel: string | null }> = []
  for (let c = 0; c < columns; c++) {
    const colDate = new Date(start)
    colDate.setDate(start.getDate() + c * 7)
    const prevDate = c > 0 ? new Date(start) : null
    if (prevDate) prevDate.setDate(start.getDate() + (c - 1) * 7)
    const monthLabel = colDate.getMonth() !== prevDate?.getMonth()
      ? colDate.toLocaleString(DEFAULT_LOCALE, { month: 'short' })
      : null
    colStarts.push({ date: colDate, monthLabel })
  }

  return (
    <div>
      {/* 月份标签行（与列对齐） */}
      <div className="flex" style={{ gap: CELL_GAP, paddingLeft: 0, marginBottom: 2 }}>
        {colStarts.map((col, c) => (
          <span
            key={c}
            className="text-[0.6rem] leading-none"
            style={{
              width: CELL_SIZE,
              color: 'var(--color-text-muted)',
              overflow: 'visible',
              whiteSpace: 'nowrap',
            }}
          >
            {col.monthLabel ?? ''}
          </span>
        ))}
      </div>

      {/* 网格：列 = 周（7 天），行 = 星期 */}
      <div className="flex" style={{ gap: CELL_GAP }}>
        {colStarts.map((col, c) => (
          <div key={c} className="flex flex-col" style={{ gap: CELL_GAP }}>
            {Array.from({ length: 7 }, (_, row) => {
              const date = new Date(col.date)
              date.setDate(col.date.getDate() + row)
              // 超过今天的天不渲染（占位保持对齐）
              if (date > today) return <span key={row} style={{ width: CELL_SIZE, height: CELL_SIZE }} />
              const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
              const d = byDay.get(key)
              return <Cell key={row} dayKey={key} d={d} maxes={{ maxWritten, maxRevised, maxCalls }} isToday={date.getTime() === today.getTime()} />
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

/** 单个格子 */
function Cell({
  dayKey, d, maxes, isToday,
}: {
  dayKey: string
  d?: { writtenWords: number; writtenCount: number; revisedWords: number; revisedCount: number; llmCalls: number; llmTokens: number }
  maxes: { maxWritten: number; maxRevised: number; maxCalls: number }
  isToday: boolean
}) {
  // 综合活跃度 = 各维度归一化后取最大（任一活动都有颜色）
  const strength = d
    ? Math.max(
        d.writtenWords / maxes.maxWritten,
        d.revisedWords / maxes.maxRevised,
        d.llmCalls / maxes.maxCalls,
      )
    : 0
  // 5 级：0（无活动）~ 4（最高）
  const level = strength === 0 ? 0 : Math.min(4, 1 + Math.floor(strength * 4))

  // tooltip 明细
  const tooltip = d
    ? `${dayKey} · ${t('activity.writing')} ${formatNumber(d.writtenWords)} ${t('unit.chars')} · ${t('activity.revised')} ${d.revisedCount} ${t('activity.times')} · ${t('activity.calls')} ${d.llmCalls} ${t('activity.times')} / ${(d.llmTokens / 1000).toFixed(1)}K`
    : dayKey

  return (
    <span
      title={tooltip}
      style={{
        width: CELL_SIZE,
        height: CELL_SIZE,
        borderRadius: 2,
        backgroundColor: LEVEL_COLORS[level],
        border: '1px solid var(--color-border)',
        // 今日高亮描边
        boxShadow: isToday ? 'inset 0 0 0 1px var(--color-accent)' : 'none',
        cursor: 'default',
      }}
    />
  )
}
