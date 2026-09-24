/**
 * 统一的进度条（2026-09-25）。
 *
 * 审计实测此前 4 处自绘（另 2 处随死文件在批次 3 删除），各自定义高度（1/2/3px）、
 * 轨道色、填充色与"不确定态"表现，同一应用里长得都不一样。收敛为一个组件。
 *
 * 用法：
 * ```tsx
 * <ProgressBar value={42} />                          // 确定态
 * <ProgressBar indeterminate height={1} />            // 不确定态（脉冲）
 * <ProgressBar value={n} color="var(--color-warning)" />
 * ```
 */
export function ProgressBar({ value, height = 2, color = 'var(--color-accent)', indeterminate = false, className }: {
  /** 0–100；`indeterminate` 为真时忽略 */
  value?: number
  /** 高度（px）。默认 2 —— 面板内嵌进度条；3 用于独立卡片 */
  height?: number
  /** 填充色，传 CSS 变量（禁止硬编码色） */
  color?: string
  /** 不确定态：满宽 + 脉冲，表示"总量未知"（如正在重建索引） */
  indeterminate?: boolean
  className?: string
}) {
  const pct = Math.min(100, Math.max(0, value ?? 0))
  return (
    <div
      className={className ? `w-full rounded-full overflow-hidden ${className}` : 'w-full rounded-full overflow-hidden'}
      style={{ height, backgroundColor: 'var(--color-border)' }}
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={indeterminate ? 'h-full rounded-full animate-pulse' : 'h-full rounded-full transition-all duration-500'}
        style={{
          width: indeterminate ? '100%' : `${pct}%`,
          backgroundColor: color,
          opacity: indeterminate ? 0.4 : 1,
        }}
      />
    </div>
  )
}
