import { cn } from '../../lib/utils'

export type CountTone = 'muted' | 'accent' | 'success' | 'warning' | 'error'

const TONE_COLOR: Record<CountTone, string> = {
  muted: 'var(--color-text-muted)',
  accent: 'var(--color-accent)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  error: 'var(--color-error)',
}

interface CountBadgeProps {
  /** 当前值；string 用于「待生成」这类短状态 */
  value: number | string
  /** 总数；传入后渲染为 current/total，并可作为进度条分母 */
  total?: number
  /** 单位：章 / 卷 / 事件… */
  unit?: string
  tone?: CountTone
  /** 显示 2px 迷你进度条（需要 total） */
  progress?: boolean
  className?: string
  title?: string
}

/**
 * 侧栏/页头的紧凑计数徽标。
 *
 * 设计意图：把「裸数字」升级成有形状、有语义色、可带进度的统计单元，
 * 同时保持 11px 字号与 32px 行高内可容纳。数字用 tabular-nums 对齐，
 * 进度条只在有 total 时出现，避免每个计数都变成重型图表。
 */
export default function CountBadge({
  value,
  total,
  unit,
  tone = 'muted',
  progress = false,
  className,
  title,
}: CountBadgeProps) {
  const color = TONE_COLOR[tone]
  const isNumeric = typeof value === 'number'
  const numericValue = isNumeric ? value : 0
  const pct = total && total > 0 && isNumeric
    ? Math.min(100, Math.max(0, (numericValue / total) * 100))
    : 0
  const showProgress = progress && total !== undefined && total > 0 && isNumeric

  return (
    <span
      className={cn(
        'inline-flex flex-shrink-0 flex-col items-end gap-0.5 px-1.5 py-px text-micro font-medium leading-none tabular-nums',
        showProgress ? 'rounded-md' : 'rounded-full',
        className,
      )}
      style={{
        color,
        backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}
      title={title}
    >
      <span className="inline-flex items-baseline gap-0.5 whitespace-nowrap">
        <span>{value}</span>
        {total !== undefined && <span style={{ opacity: 0.55 }}>/{total}</span>}
        {unit && <span className="font-normal" style={{ opacity: 0.72 }}>{unit}</span>}
      </span>
      {showProgress && (
        <span
          data-count-progress
          className="h-[2px] w-6 overflow-hidden rounded-full"
          style={{ backgroundColor: `color-mix(in srgb, ${color} 22%, transparent)` }}
        >
          <span
            className="block h-full rounded-full"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </span>
      )}
    </span>
  )
}
