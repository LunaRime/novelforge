/**
 * StateDot — 全站统一状态点（线② · dsh 照搬）
 *
 * 语义五态（spec §2.9）：
 * - done     绿   —— 已完成（--color-success）
 * - warning  琥珀 —— 需用户注意 / 等待确认（--color-warning）
 * - ongoing  灰   —— 加载中（--color-text-muted，旋转环）
 * - error    红   —— 出错（--color-error）
 * - idle     中性 —— 无进行中事项（--color-text-muted，实心淡）
 *
 * 对照 dsh `StateDot`（`ui-primitives/src/StateDot.tsx`）：solid 态 = 10px 槽位画 6px 核心，
 * ongoing = 14px 旋转环（轨道 + 呼吸弧）。用 NF 语义令牌，遵循 color-token-standard。
 *
 * @param props.state   五态之一
 * @param props.size    外径 px；默认 ongoing=14、solid=10
 * @param props.className 布局用附加类
 * @param props.appearance 'dot'（默认，纯圆点）| 'step'（步骤号/勾，工作流面板用）
 */
import { Check } from 'lucide-react'

export type StateDotState = 'done' | 'warning' | 'ongoing' | 'error' | 'idle'

export function StateDot({
  state,
  size,
  className,
  appearance = 'dot',
}: {
  state: StateDotState
  size?: number
  className?: string
  appearance?: 'dot' | 'step'
}) {
  const edge = size ?? (state === 'ongoing' ? 14 : 10)

  if (state === 'ongoing') {
    // 旋转环：轨道（淡）+ 呼吸弧（同色）。CSS 动画见下方内联 keyframes。
    return (
      <svg
        className={className}
        data-state="ongoing"
        width={edge}
        height={edge}
        viewBox="0 0 24 24"
        aria-hidden="true"
        style={{ flexShrink: 0, color: 'var(--color-text-muted)' }}
      >
        <g style={{ transformOrigin: 'center', animation: 'state-dot-spin 1.5s linear infinite' }}>
          <circle
            cx="12"
            cy="12"
            r="9.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            opacity={0.25}
          />
          <circle
            cx="12"
            cy="12"
            r="9.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            style={{ animation: 'state-dot-dash 1.5s ease-in-out infinite' }}
          />
        </g>
      </svg>
    )
  }

  const color =
    state === 'done'
      ? 'var(--color-success)'
      : state === 'warning'
        ? 'var(--color-warning)'
        : state === 'error'
          ? 'var(--color-error)'
          : 'var(--color-text-muted)' // idle

  if (appearance === 'step') {
    // 步骤形态：描边圆 + done 时填充 + 对勾
    return (
      <span
        className={className}
        data-state={state}
        aria-hidden="true"
        style={{
          width: edge,
          height: edge,
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxSizing: 'border-box',
          borderRadius: '50%',
          border: `1.5px solid ${state === 'done' || state === 'error' ? color : 'var(--color-text-muted)'}`,
          background: state === 'done' || state === 'error' ? color : 'transparent',
          color: 'var(--color-text)',
        }}
      >
        {state === 'done' && <Check size={edge - 2} strokeWidth={3} />}
      </span>
    )
  }

  // dot：10px 槽位画 6px 核心（inset 20%）
  return (
    <span
      className={className}
      data-state={state}
      aria-hidden="true"
      style={{
        position: 'relative',
        display: 'inline-block',
        width: edge,
        height: edge,
        flexShrink: 0,
        color,
      }}
    >
      <span
        style={{
          position: 'absolute',
          inset: '20%',
          borderRadius: '50%',
          background: 'currentColor',
        }}
      />
    </span>
  )
}
