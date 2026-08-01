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
  const { t } = useTranslation()
  const currentProject = useProjectStore(s => s.currentProject)
  const [data, setData] = useState<DailyActivityData | null>(null)
  const [loading, setLoading] = useState(true)
  /** '' = 全部项目；否则为项目路径 */
  const [selectedPath, setSelectedPath] = useState('')

  // 打开项目时默认选中该项目（总数据仍在下拉可切回）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 项目切换同步选择是同步副作用
    if (currentProject?.path) setSelectedPath(currentProject.path)
  }, [currentProject?.path])

  const loadActivity = async () => {
    try {
      // currentProjectPath：当前项目始终纳入聚合（即使尚未写入最近项目列表）
      const result = await getDailyActivity(DAYS, undefined, currentProject?.path)
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
  const scopeRows = selectedPath
    ? allRows.filter(r => r.projectPath === selectedPath)
    : mergeDaysByDay(allRows)

  // 统计
  const totalStats = calcStats(allRows)          // 全局总计（恒定显示）
  const scopeStats = calcStats(scopeRows)        // 当前范围

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      {/* 顶部：标题 + 项目选择 + 刷新 */}
      <div
        className="flex items-center justify-between px-4 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Activity size={13} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
          <span className="text-xs font-semibold flex-shrink-0" style={{ color: 'var(--color-text)' }}>
            {t('panel.activity')}
          </span>
          <span className="text-[0.68rem] flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
            {t('activity.lastDays').replace('{n}', String(DAYS))}
          </span>
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
          {/* 统计条：全局总计 + 当前范围 */}
          <div className="space-y-2">
            {/* 当前范围 */}
            <div className="flex items-center gap-5 flex-wrap">
              <StatItem icon={<PenLine size={11} />} label={t('activity.totalWritten')} value={formatNumber(scopeStats.writtenWords)} />
              <StatItem icon={<RefreshCw size={11} />} label={t('activity.totalRevised')} value={formatNumber(scopeStats.revisedWords)} />
              <StatItem icon={<Sparkles size={11} />} label={t('activity.totalCalls')} value={formatNumber(scopeStats.llmCalls)} />
              <StatItem icon={<Activity size={11} />} label={t('activity.totalTokens')} value={`${(scopeStats.llmTokens / 1000).toFixed(1)}K`} />
              <StatItem icon={<Wallet size={11} />} label={t('activity.totalCost')} value={`$${scopeStats.llmCost.toFixed(2)}`} accent />
            </div>
            {/* 全局总计（所有项目，恒定显示） */}
            {selectedPath && (
              <div className="flex items-center gap-4 text-[0.68rem]" style={{ color: 'var(--color-text-muted)' }}>
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

          {/* GitHub 风格热力图 */}
          <div className="select-none">
            <ContributionGrid rows={scopeRows} />
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
function StatItem({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-[0.7rem]" style={{ color: 'var(--color-text-muted)' }}>
      <span style={{ color: accent ? 'var(--color-accent)' : 'var(--color-accent)' }}>{icon}</span>
      <span>{label}</span>
      <span className={`font-bold text-xs ${accent ? '' : ''}`} style={{ color: accent ? 'var(--color-accent)' : 'var(--color-text)' }}>{value}</span>
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

function ContributionGrid({ rows }: { rows: DailyActivityRow[] }) {
  // 构建最近 90 天的日期序列（向前对齐到周日）
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(start.getDate() - (DAYS - 1) - start.getDay())

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
