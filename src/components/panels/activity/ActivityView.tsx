/**
 * ActivityView — 每日活动热力图（GitHub Contribution Graph 风格）
 *
 * 跨项目聚合（最近项目列表来自全局配置）：
 * - 写作字数：drafts（source='write'）
 * - 修改量：AI 重写草稿 + 修稿（revisions）
 * - 模型调用：llm_calls（success=1，含费用 cost）
 *
 * 支持项目维度切换：全部项目（按天合并）/ 单个项目（过滤），
 * 统计条恒定显示全局总计 + 当前范围。
 */
import { useEffect, useState } from 'react'
import { Activity, PenLine, RefreshCw, Loader2, Sparkles, BookOpen, Wallet } from 'lucide-react'
import { getCurrentLocale, t } from '../../../shared/locale'
import { getDailyActivity } from '../../../services/stats-service'
import type { DailyActivityData, DailyActivityRow } from '../../../shared/ipc-channels'
import { useProjectStore } from '../../../stores/project-store'
import { useTranslation } from '../../../hooks/useTranslation'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../../ui/Select'

/** 数据拉取天数（全年，前端按所选范围过滤——月度视图需要跨月数据） */
const FETCH_DAYS = 365
/** 热力图格子间距 */
const CELL_GAP = 2
/** 每日粒度可选范围（天） */
const DAILY_RANGES = [15, 30, 90]
/** 每月粒度可选范围（月数） */
const MONTHLY_RANGES = [6, 12]
/** 热力图最大宽度（自适应放大，超过后居中不再膨胀） */
const GRID_MAX_WIDTH = 480

/** 5 级活跃度颜色（accent 透明度渐变，禁止硬编码色值） */
const LEVEL_COLORS = [
  'transparent',
  'color-mix(in srgb, var(--color-accent) 12%, transparent)',
  'color-mix(in srgb, var(--color-accent) 30%, transparent)',
  'color-mix(in srgb, var(--color-accent) 55%, transparent)',
  'color-mix(in srgb, var(--color-accent) 85%, transparent)',
]

export default function ActivityView() {
  const { t } = useTranslation()
  const currentProject = useProjectStore(s => s.currentProject)
  const [data, setData] = useState<DailyActivityData | null>(null)
  const [loading, setLoading] = useState(true)
  /** '' = 全部项目；否则为项目路径 */
  const [selectedPath, setSelectedPath] = useState('')
  /** 视图粒度：每日（热力图）/ 每月（柱状图） */
  const [granularity, setGranularity] = useState<'daily' | 'monthly'>('daily')
  /** 每日粒度范围（天） */
  const [dailyRange, setDailyRange] = useState(30)
  /** 每月粒度范围（月数） */
  const [monthlyRange, setMonthlyRange] = useState(12)

  // 打开项目时默认选中该项目（总数据仍在下拉可切回）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 项目切换同步选择是同步副作用
    if (currentProject?.path) setSelectedPath(currentProject.path)
  }, [currentProject?.path])

  const loadActivity = async () => {
    try {
      // currentProjectPath：当前项目始终纳入聚合（即使尚未写入最近项目列表）
      // 一次拉取全年数据，前端按粒度/范围过滤切换（月度视图与历史查看无需重新请求）
      const result = await getDailyActivity(FETCH_DAYS, undefined, currentProject?.path)
      setData(result)
    } catch (e) {
      console.warn('[ActivityView] 加载每日活动数据失败:', e)
      setData(null)
    }
    setLoading(false)
  }

  // 打开项目时同步刷新聚合数据（currentProject 纳入/移出聚合范围）
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- loadActivity 每次渲染重建，依赖 currentProject.path 即覆盖其变化
  useEffect(() => { loadActivity() }, [currentProject?.path])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 事件处理器内 setState 合法
  const handleRefresh = () => { setLoading(true); loadActivity() }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
        <Loader2 size={14} className="animate-spin" />
        {t('status.loading')}
      </div>
    )
  }

  // 按选择过滤/合并（一次请求全部数据，前端切换即时）
  const allRows = data?.days ?? []
  const projectRows = selectedPath
    ? allRows.filter(r => r.projectPath === selectedPath)
    : mergeDaysByDay(allRows)

  // 按粒度 + 范围过滤（每日：近 N 天；每月：近 N 个月，前端按月聚合）
  const todayKey = todayDayKey()
  const scopeRows = granularity === 'daily'
    ? filterDaysByRange(projectRows, dailyRange, todayKey)
    : filterDaysByMonths(projectRows, monthlyRange, todayKey)

  // 统计
  const totalStats = calcStats(allRows)          // 全局总计（恒定显示）
  const scopeStats = calcStats(scopeRows)        // 当前范围

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      {/* 顶部：标题 + 粒度/范围切换 + 项目选择 + 刷新 */}
      <div
        className="flex items-center justify-between gap-2 px-4 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Activity size={13} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
          <span className="text-xs font-semibold flex-shrink-0" style={{ color: 'var(--color-text)' }}>
            {t('panel.activity')}
          </span>

          {/* 粒度切换：每日 / 每月 */}
          <div className="flex items-center rounded-md border border-[var(--color-border)] overflow-hidden flex-shrink-0">
            <button
              type="button"
              onClick={() => setGranularity('daily')}
              className={`px-1.5 py-0.5 text-[0.65rem] transition-colors ${
                granularity === 'daily'
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]'
              }`}
            >
              {t('activity.viewDaily')}
            </button>
            <button
              type="button"
              onClick={() => setGranularity('monthly')}
              className={`px-1.5 py-0.5 text-[0.65rem] transition-colors ${
                granularity === 'monthly'
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]'
              }`}
            >
              {t('activity.viewMonthly')}
            </button>
          </div>

          {/* 范围切换（跟随粒度） */}
          <div className="flex items-center rounded-md border border-[var(--color-border)] overflow-hidden flex-shrink-0">
            {granularity === 'daily'
              ? DAILY_RANGES.map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setDailyRange(n)}
                  className={`px-1.5 py-0.5 text-[0.65rem] transition-colors ${
                    dailyRange === n
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]'
                  }`}
                >
                  {t('activity.daysShort').replace('{n}', String(n))}
                </button>
              ))
              : MONTHLY_RANGES.map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMonthlyRange(n)}
                  className={`px-1.5 py-0.5 text-[0.65rem] transition-colors ${
                    monthlyRange === n
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]'
                  }`}
                >
                  {t('activity.monthsShort').replace('{n}', String(n))}
                </button>
              ))}
          </div>

          {/* 项目维度选择（'' = 全部项目，Radix 无空值 → __all__ 映射） */}
          <Select value={selectedPath || '__all__'} onValueChange={(v) => setSelectedPath(v === '__all__' ? '' : v)}>
            <SelectTrigger
              className="h-6 w-auto max-w-[160px] rounded-[var(--radius-sm)] text-[0.68rem]"
              title={t('activity.selectProject')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('activity.allProjects')}</SelectItem>
              {(data?.projects ?? []).map(p => (
                <SelectItem key={p.path} value={p.path}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <button onClick={handleRefresh} className="icon-btn flex-shrink-0" style={{ width: 20, height: 20 }} title={t('action.refresh')}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {allRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: 'var(--color-text-muted)' }}>
          <BookOpen size={22} style={{ opacity: 0.4 }} />
          <span className="text-xs">{t('activity.noData')}</span>
        </div>
      ) : (
        <div className="px-4 py-3 space-y-4">
          {/* 统计区：当前范围卡片 + 全局总计 */}
          <div className="space-y-2.5">
            {/* 当前范围（卡片式统计） */}
            <div className="flex items-stretch gap-2 flex-wrap">
              <StatCard icon={<PenLine size={12} />} label={t('activity.totalWritten')} value={formatNumber(scopeStats.writtenWords)} accent />
              <StatCard icon={<RefreshCw size={12} />} label={t('activity.totalRevised')} value={formatNumber(scopeStats.revisedWords)} />
              <StatCard icon={<Sparkles size={12} />} label={t('activity.totalCalls')} value={formatNumber(scopeStats.llmCalls)} />
              <StatCard icon={<Activity size={12} />} label={t('activity.totalTokens')} value={`${(scopeStats.llmTokens / 1000).toFixed(1)}K`} />
              <StatCard icon={<Wallet size={12} />} label={t('activity.totalCost')} value={`$${scopeStats.llmCost.toFixed(2)}`} accent />
            </div>
            {/* 全局总计（所有项目，恒定显示；选中单项目时展示） */}
            {selectedPath && (
              <div
                className="flex items-center gap-4 pt-2 border-t text-[0.68rem]"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
              >
                <span className="flex items-center gap-1">
                  <GlobeIcon size={10} />
                  {t('activity.globalTotal')}
                </span>
                <span>{t('activity.totalWritten')} {formatNumber(totalStats.writtenWords)}</span>
                <span>{t('activity.totalCalls')} {formatNumber(totalStats.llmCalls)}</span>
                <span>{t('activity.totalCost')} ${totalStats.llmCost.toFixed(2)}</span>
              </div>
            )}
          </div>

          {/* 视图主体：每日热力图 / 每月柱状图（自适应放大，居中） */}
          <div className="flex justify-center select-none">
            {granularity === 'daily' ? (
              <ContributionGrid rows={scopeRows} days={dailyRange} />
            ) : (
              <MonthlyChart rows={scopeRows} months={monthlyRange} />
            )}
          </div>

          {/* 图例 / 视图说明 */}
          {granularity === 'daily' ? (
            <div className="flex items-center justify-center gap-1.5 text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>
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
          ) : (
            <div className="text-center text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>
              {t('activity.monthlyHint')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 统计卡片：label 小字 + value 大字（hover 色块背景，突出数字层级） */
function StatCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 min-w-[5.5rem]" style={{ backgroundColor: 'var(--color-hover)' }}>
      <span className="flex-shrink-0" style={{ color: accent ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>{icon}</span>
      <div className="flex flex-col leading-tight min-w-0">
        <span className="text-[0.62rem] truncate" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
        <span className="text-xs font-bold truncate" style={{ color: accent ? 'var(--color-accent)' : 'var(--color-text)' }}>{value}</span>
      </div>
    </div>
  )
}

function GlobeIcon({ size }: { size: number }) {
  return <span style={{ fontSize: size }}>🌐</span>
}

/** 按天合并跨项目行（求和） */
function mergeDaysByDay(rows: DailyActivityRow[]): DailyActivityRow[] {
  const map = new Map<string, DailyActivityRow>()
  for (const r of rows) {
    const cur = map.get(r.day) ?? {
      day: r.day,
      writtenWords: 0, writtenCount: 0, revisedWords: 0, revisedCount: 0,
      llmCalls: 0, llmTokens: 0, llmCost: 0,
      projectPath: '', projectName: '',
    }
    map.set(r.day, {
      ...cur,
      writtenWords: cur.writtenWords + r.writtenWords,
      writtenCount: cur.writtenCount + r.writtenCount,
      revisedWords: cur.revisedWords + r.revisedWords,
      revisedCount: cur.revisedCount + r.revisedCount,
      llmCalls: cur.llmCalls + r.llmCalls,
      llmTokens: cur.llmTokens + r.llmTokens,
      llmCost: cur.llmCost + r.llmCost,
    })
  }
  return Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day))
}

/** 统计求和 */
function calcStats(rows: DailyActivityRow[]) {
  return rows.reduce((acc, r) => ({
    writtenWords: acc.writtenWords + r.writtenWords,
    revisedWords: acc.revisedWords + r.revisedWords,
    llmCalls: acc.llmCalls + r.llmCalls,
    llmTokens: acc.llmTokens + r.llmTokens,
    llmCost: acc.llmCost + r.llmCost,
  }), { writtenWords: 0, revisedWords: 0, llmCalls: 0, llmTokens: 0, llmCost: 0 })
}

/** 千分位格式化 */
function formatNumber(n: number): string {
  return n.toLocaleString()
}

// ===== 热力图网格 =====

/** 星期标签列宽（容纳 zh 单字 / en 三字母 / ru 双字母） */
const WEEK_LABEL_WIDTH = 14

/** 今天的 'YYYY-MM-DD' key（与 DB 聚合格式一致） */
function todayDayKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** 按天范围过滤（保留最近 range 天） */
function filterDaysByRange(rows: DailyActivityRow[], range: number, todayKey: string): DailyActivityRow[] {
  const cutoff = new Date(todayKey)
  cutoff.setDate(cutoff.getDate() - (range - 1))
  const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`
  return rows.filter(r => r.day >= cutoffKey)
}

/** 按月范围过滤（保留最近 months 个月） */
function filterDaysByMonths(rows: DailyActivityRow[], months: number, todayKey: string): DailyActivityRow[] {
  const cutoff = new Date(todayKey)
  cutoff.setMonth(cutoff.getMonth() - (months - 1))
  cutoff.setDate(1)
  const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`
  return rows.filter(r => r.day.startsWith(cutoffKey) || r.day > cutoffKey)
}

/** 按月聚合（月 key 'YYYY-MM' → 统计求和） */
function aggregateByMonth(rows: DailyActivityRow[]): Array<{ month: string; stats: ReturnType<typeof calcStats> }> {
  const map = new Map<string, ReturnType<typeof calcStats>>()
  for (const r of rows) {
    const month = r.day.slice(0, 7)
    const cur = map.get(month) ?? { writtenWords: 0, revisedWords: 0, llmCalls: 0, llmTokens: 0, llmCost: 0 }
    map.set(month, {
      writtenWords: cur.writtenWords + r.writtenWords,
      revisedWords: cur.revisedWords + r.revisedWords,
      llmCalls: cur.llmCalls + r.llmCalls,
      llmTokens: cur.llmTokens + r.llmTokens,
      llmCost: cur.llmCost + r.llmCost,
    })
  }
  return Array.from(map.entries())
    .map(([month, stats]) => ({ month, stats }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

function ContributionGrid({ rows, days }: { rows: DailyActivityRow[]; days: number }) {
  // 构建日期序列（向前对齐到周日），格子尺寸随容器自适应（max-w 上限内放大）
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(start.getDate() - (days - 1) - start.getDay())

  const totalDays = Math.floor((today.getTime() - start.getTime()) / 86400000) + 1
  const columns = Math.ceil(totalDays / 7)

  const byDay = new Map(rows.map(d => [d.day, d]))

  const maxWritten = Math.max(1, ...rows.map(d => d.writtenWords))
  const maxRevised = Math.max(1, ...rows.map(d => d.revisedWords))
  const maxCalls = Math.max(1, ...rows.map(d => d.llmCalls))

  const colStarts: Array<{ date: Date; monthLabel: string | null }> = []
  for (let c = 0; c < columns; c++) {
    const colDate = new Date(start)
    colDate.setDate(start.getDate() + c * 7)
    const prevDate = c > 0 ? new Date(start) : null
    if (prevDate) prevDate.setDate(start.getDate() + (c - 1) * 7)
    const monthLabel = colDate.getMonth() !== prevDate?.getMonth()
      ? colDate.toLocaleString(getCurrentLocale(), { month: 'short' })
      : null
    colStarts.push({ date: colDate, monthLabel })
  }

  // GitHub 风格星期标签（行 0=周日…6=周六，只标 周一/周三/周五）
  const weekLabels = ['', t('activity.mon'), '', t('activity.wed'), '', t('activity.fri'), '']

  return (
    <div className="w-full" style={{ maxWidth: GRID_MAX_WIDTH }}>
      {/* 月份标签行（与列对齐，星期列宽内缩；列 flex-1 等宽） */}
      <div className="flex" style={{ gap: CELL_GAP, paddingLeft: WEEK_LABEL_WIDTH + CELL_GAP, marginBottom: 2 }}>
        {colStarts.map((col, c) => (
          <span
            key={c}
            className="flex-1 text-[0.6rem] leading-none"
            style={{
              color: 'var(--color-text-muted)',
              overflow: 'visible',
              whiteSpace: 'nowrap',
            }}
          >
            {col.monthLabel ?? ''}
          </span>
        ))}
      </div>

      {/* 网格：星期标签列 + 周列（7 天），列 flex-1 撑开 → 格子随容器放大 */}
      <div className="flex" style={{ gap: CELL_GAP }}>
        {/* 星期标签列 */}
        <div className="flex flex-col" style={{ gap: CELL_GAP, width: WEEK_LABEL_WIDTH, flexShrink: 0 }}>
          {weekLabels.map((label, row) => (
            <span
              key={row}
              className="text-[0.6rem] leading-none flex items-center"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {label}
            </span>
          ))}
        </div>

        {colStarts.map((col, c) => (
          <div key={c} className="flex-1 flex flex-col" style={{ gap: CELL_GAP }}>
            {Array.from({ length: 7 }, (_, row) => {
              const date = new Date(col.date)
              date.setDate(col.date.getDate() + row)
              if (date > today) return <div key={row} className="w-full aspect-square" />
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

/** 单个格子（宽高随列自适应，aspect-square 保持方形） */
function Cell({
  dayKey, d, maxes, isToday,
}: {
  dayKey: string
  d?: DailyActivityRow
  maxes: { maxWritten: number; maxRevised: number; maxCalls: number }
  isToday: boolean
}) {
  const strength = d
    ? Math.max(
        d.writtenWords / maxes.maxWritten,
        d.revisedWords / maxes.maxRevised,
        d.llmCalls / maxes.maxCalls,
      )
    : 0
  const level = strength === 0 ? 0 : Math.min(4, 1 + Math.floor(strength * 4))

  const tooltip = d
    ? `${dayKey} · ${t('activity.writing')} ${formatNumber(d.writtenWords)} ${t('unit.chars')} · ${t('activity.revised')} ${d.revisedCount} ${t('activity.times')} · ${t('activity.calls')} ${d.llmCalls} ${t('activity.times')} / ${(d.llmTokens / 1000).toFixed(1)}K · $${d.llmCost.toFixed(2)}`
    : dayKey

  return (
    <div
      title={tooltip}
      className="w-full aspect-square"
      style={{
        borderRadius: 2,
        backgroundColor: LEVEL_COLORS[level],
        border: '1px solid var(--color-border)',
        boxShadow: isToday ? 'inset 0 0 0 1px var(--color-accent)' : 'none',
        cursor: 'default',
      }}
    />
  )
}

/** 月度柱状图：每月写作字数（accent 渐变柱），悬停查看当月完整统计 */
function MonthlyChart({ rows, months }: { rows: DailyActivityRow[]; months: number }) {
  const monthsData = aggregateByMonth(rows).slice(-months)
  const maxWritten = Math.max(1, ...monthsData.map(m => m.stats.writtenWords))

  return (
    <div className="w-full" style={{ maxWidth: GRID_MAX_WIDTH }}>
      {/* 柱体区 */}
      <div className="flex items-end gap-2" style={{ height: 96 }}>
        {monthsData.map(m => {
          const heightPct = Math.max(4, (m.stats.writtenWords / maxWritten) * 100)
          const monthLabel = new Date(`${m.month}-01T00:00:00`).toLocaleString(getCurrentLocale(), { month: 'short' })
          const tooltip = `${m.month} · ${t('activity.writing')} ${formatNumber(m.stats.writtenWords)} ${t('unit.chars')} · ${t('activity.totalRevised')} ${formatNumber(m.stats.revisedWords)} · ${t('activity.totalCalls')} ${formatNumber(m.stats.llmCalls)} · ${(m.stats.llmTokens / 1000).toFixed(1)}K · $${m.stats.llmCost.toFixed(2)}`
          return (
            <div key={m.month} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={tooltip}>
              <div className="w-full flex items-end justify-center" style={{ height: 84 }}>
                <div
                  className="w-full max-w-[18px] rounded-t-sm"
                  style={{
                    height: `${heightPct}%`,
                    backgroundColor: 'color-mix(in srgb, var(--color-accent) 70%, transparent)',
                  }}
                />
              </div>
              <span className="text-[0.6rem] leading-none truncate" style={{ color: 'var(--color-text-muted)' }}>
                {monthLabel}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
