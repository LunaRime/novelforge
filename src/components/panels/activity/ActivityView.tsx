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
import { ipc } from '../../../services/ipc-client'
import { toast } from '../../ui/Toast'
import { buildYearlySummary, buildYearlyReportHTML } from '../../../services/yearly-report'

/** 数据拉取天数（10 年等效全量——月度视图按年切换需要多年历史；聚合 SQL 按天分组数据量极小） */
const FETCH_DAYS = 3650
/** 热力图格子尺寸（固定，比原 10px 适度放大） */
const CELL_SIZE = 12
/** 热力图格子间距 */
const CELL_GAP = 2
/** 热力图横向滚动兜底最小宽度（全年 53 周列 × 12px + 星期列） */
const GRID_MIN_WIDTH = 742

/** 5 级活跃度颜色（accent 透明度渐变，禁止硬编码色值）
 * 0 级 = 无数据日：5% 文字色浅底——与面板背景区分（弱于最低数据级 12% accent，层次正确） */
const LEVEL_COLORS = [
  'color-mix(in srgb, var(--color-text) 5%, transparent)',
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
  /** 查看年份（每日/每月共用，默认今年，◀▶ 切换往期） */
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear())

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

  /** 生成年度报告分享卡（当前查看年份）：先弹保存对话框（用户手势立即响应）→ 截图 → 写入 */
  const handleGenerateReport = async () => {
    if (!data) return
    try {
      const outPath = await ipc.invoke('dialog:save-file', { defaultName: `NovelForge-Yearly-Report-${viewYear}.png` })
      if (!outPath) return
      const summary = buildYearlySummary(data.days, viewYear)
      const html = buildYearlyReportHTML(summary, getCurrentLocale())
      const res = await ipc.invoke('report:render-html', html)
      if (!res.success || !res.png) throw new Error(res.error || 'render failed')
      const saved = await ipc.invoke('fs:write-buffer', outPath, res.png)
      if (!saved.success) throw new Error(saved.error || 'write failed')
      toast.success(t('report.saveSuccess').replace('{path}', outPath))
    } catch (e) {
      toast.error(t('report.saveFailed').replace('{error}', String(e)))
    }
  }

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

  // 范围 = 所选年份全年（每日热力图 / 每月柱状图共用 viewYear）
  const scopeRows = projectRows.filter(r => r.day.startsWith(String(viewYear)))

  // 年份选择区间：数据最早年份 → 今年（连续，中间无数据年份也保留——连续性）
  // ⚠️ 双保险：过滤异常年份（<2000 的脏数据时间戳——旧库字符串时间戳可逃过主进程数字过滤）
  const currentYear = new Date().getFullYear()
  const validYears = allRows
    .map(r => parseInt(r.day.slice(0, 4), 10))
    .filter(y => Number.isFinite(y) && y >= 2000 && y <= currentYear)
  const minYear = validYears.length > 0 ? Math.min(...validYears) : currentYear
  const yearOptions = Array.from({ length: currentYear - minYear + 1 }, (_, i) => currentYear - i)

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

          {/* 年份选择（每日/每月共用；连续区间含无数据年份——从数据最早年至今） */}
          <Select value={String(viewYear)} onValueChange={(v) => setViewYear(parseInt(v, 10))}>
            <SelectTrigger
              className="h-6 w-auto min-w-[4.5rem] rounded-[var(--radius-sm)] text-[0.68rem]"
              title={t('activity.selectYear')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>

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
        {/* 报告 + 刷新：紧邻的右侧操作组（报告按钮带文字标签，明确功能入口） */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={handleGenerateReport}
            className="flex items-center gap-1 px-1.5 h-5 rounded text-[0.65rem] transition-colors cursor-pointer hover:opacity-80"
            style={{ color: 'var(--color-accent)' }}
            title={t('report.generate')}
            disabled={!data}
          >
            <Sparkles size={11} />
            {t('report.generateShort')}
          </button>
          <button onClick={handleRefresh} className="icon-btn flex-shrink-0" style={{ width: 20, height: 20 }} title={t('action.refresh')}>
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
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
              <ContributionGrid rows={scopeRows} year={viewYear} />
            ) : (
              <MonthlyChart rows={scopeRows} year={viewYear} />
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

/** 按月聚合（月 key 'YYYY-MM' → 统计求和） */
function aggregateByMonth(rows: DailyActivityRow[]): Map<string, ReturnType<typeof calcStats>> {
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
  return map
}

function ContributionGrid({ rows, year }: { rows: DailyActivityRow[]; year: number }) {
  // 全年日期序列：1 月 1 日（向前对齐到周日）→ 12 月 31 日——未来天数也显示（空格子）
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const start = new Date(year, 0, 1)
  start.setDate(start.getDate() - start.getDay())
  const end = new Date(year, 11, 31)

  const totalDays = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1
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
    <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
      <div style={{ minWidth: GRID_MIN_WIDTH }}>
        {/* 月份标签行（与列对齐，星期列宽内缩） */}
        <div className="flex" style={{ gap: CELL_GAP, paddingLeft: WEEK_LABEL_WIDTH + CELL_GAP, marginBottom: 2 }}>
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

        {/* 网格：星期标签列 + 周列（7 天） */}
        <div className="flex" style={{ gap: CELL_GAP }}>
          {/* 星期标签列 */}
          <div className="flex flex-col" style={{ gap: CELL_GAP, width: WEEK_LABEL_WIDTH, flexShrink: 0 }}>
            {weekLabels.map((label, row) => (
              <span
                key={row}
                className="text-[0.6rem] leading-none flex items-center"
                style={{ height: CELL_SIZE, color: 'var(--color-text-muted)' }}
              >
                {label}
              </span>
            ))}
          </div>

          {colStarts.map((col, c) => (
            <div key={c} className="flex flex-col" style={{ gap: CELL_GAP }}>
              {Array.from({ length: 7 }, (_, row) => {
                const date = new Date(col.date)
                date.setDate(col.date.getDate() + row)
                if (date > end) return <span key={row} style={{ width: CELL_SIZE, height: CELL_SIZE }} />
                const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
                const d = byDay.get(key)
                return <Cell key={row} dayKey={key} d={d} maxes={{ maxWritten, maxRevised, maxCalls }} isToday={date.getTime() === today.getTime()} />
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 单个格子（固定 CELL_SIZE 方形） */
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
    <span
      title={tooltip}
      style={{
        width: CELL_SIZE,
        height: CELL_SIZE,
        borderRadius: 2,
        backgroundColor: LEVEL_COLORS[level],
        border: '1px solid var(--color-border)',
        boxShadow: isToday ? 'inset 0 0 0 1px var(--color-accent)' : 'none',
        cursor: 'default',
      }}
    />
  )
}

/** 月度柱状图：全年 12 个月写作字数（accent 渐变柱），无数据月份空柱，悬停查看当月完整统计 */
function MonthlyChart({ rows, year }: { rows: DailyActivityRow[]; year: number }) {
  const byMonth = aggregateByMonth(rows)
  const maxWritten = Math.max(1, ...Array.from(byMonth.values()).map(s => s.writtenWords))

  return (
    <div className="w-full" style={{ maxWidth: 360 }}>
      {/* 柱体区：固定 1-12 月全年序列 */}
      <div className="flex items-end gap-1" style={{ height: 96 }}>
        {Array.from({ length: 12 }, (_, i) => {
          const month = i + 1
          const monthKey = `${year}-${String(month).padStart(2, '0')}`
          const stats = byMonth.get(monthKey)
          const heightPct = stats && stats.writtenWords > 0
            ? Math.max(4, (stats.writtenWords / maxWritten) * 100)
            : 0
          const monthLabel = new Date(`${monthKey}-01T00:00:00`).toLocaleString(getCurrentLocale(), { month: 'short' })
          const tooltip = stats
            ? `${monthKey} · ${t('activity.writing')} ${formatNumber(stats.writtenWords)} ${t('unit.chars')} · ${t('activity.totalRevised')} ${formatNumber(stats.revisedWords)} · ${t('activity.totalCalls')} ${formatNumber(stats.llmCalls)} · ${(stats.llmTokens / 1000).toFixed(1)}K · $${stats.llmCost.toFixed(2)}`
            : `${monthKey} · —`
          return (
            <div key={monthKey} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={tooltip}>
              <div className="w-full flex items-end justify-center" style={{ height: 84 }}>
                {heightPct > 0 && (
                  <div
                    className="w-full max-w-[18px] rounded-t-sm"
                    style={{
                      height: `${heightPct}%`,
                      backgroundColor: 'color-mix(in srgb, var(--color-accent) 70%, transparent)',
                    }}
                  />
                )}
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
