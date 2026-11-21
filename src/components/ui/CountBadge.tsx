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
  /** 有有效目标时，在计数下方显示迷你进度条。 */
  progress?: boolean
  className?: string
  title?: string
}

/**
 * 侧栏/页头的紧凑计数徽标。
 *
 * 设计意图：把「裸数字」升级成有形状、有语义色、可带进度的统计单元，
 * 进度型徽标将实际计数和进度轨道分开着色，局部状态不会降低分母的可读性。
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
  const progressColor = tone === 'warning' ? 'var(--color-gold)' : color

  return (
    <span
      className={cn(
        'inline-flex flex-shrink-0 flex-col items-end gap-0.5 rounded-sm border border-[var(--color-border)] bg-[var(--color-editor-bg)] px-1.5 py-[3px] text-micro font-medium leading-none tabular-nums',
        showProgress && 'min-w-11',
        className,
      )}
      style={{
        color: showProgress || tone === 'muted' ? 'var(--color-text)' : color,
      }}
      title={title}
    >
      <span className="inline-flex items-baseline gap-0.5 whitespace-nowrap">
        <span className="font-semibold">{value}</span>
        {total !== undefined && <span className="text-[var(--color-text-secondary)]">/{total}</span>}
        {unit && <span className="font-normal text-[var(--color-text-secondary)]">{unit}</span>}
      </span>
      {showProgress && (
        <span
          data-count-progress
          aria-hidden="true"
          className="h-[3px] w-full overflow-hidden rounded-full bg-[var(--color-border)]"
        >
          <span
            className="block h-full rounded-full"
            style={{ width: `${pct}%`, backgroundColor: progressColor }}
          />
        </span>
      )}
    </span>
  )
}
