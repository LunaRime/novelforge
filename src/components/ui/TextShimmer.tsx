/**
 * TextShimmer — 流式活动文字高亮（线② · dsh 照搬）
 *
 * 运行中的流程行标题 / 摘要的文字扫光效果。对照 dsh `TextShimmer`
 * （`ui-primitives/src/TextShimmer.tsx` + `.module.css`）：
 * 真实内容保持可选中，running 时叠一层 inert 装饰副本做 105° 扫光。
 *
 * 用 NF 语义令牌（--color-accent 作扫光色），遵循 color-token-standard。
 * prefers-reduced-motion 下降级为不显示扫光。
 */
import { createContext, memo, useContext, type ReactNode } from 'react'

const DecorativeCopy = createContext<boolean | undefined>(undefined)

interface TextShimmerProps {
  children: ReactNode
  /** 是否扫光；嵌套实例继承外层动画 */
  active?: boolean
  className?: string
}

/**
 * 流式文字扫光。active 时在原文之上叠一层 inert 装饰副本做扫光，
 * 原文保持可选、可读（读屏只读原文）。
 */
export const TextShimmer = memo(function TextShimmer({ children, active = false, className }: TextShimmerProps) {
  const decorative = useContext(DecorativeCopy)
  if (decorative !== undefined) {
    return <span className={className}>{children}</span>
  }
  const content = typeof children === 'string' ? <span>{children}</span> : children
  return (
    <span
      className={className}
      data-shimmer={active || undefined}
      style={{ position: 'relative', display: 'inline-block', verticalAlign: 'top', color: 'inherit' }}
    >
      <DecorativeCopy.Provider value={false}>
        <span style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>{content}</span>
      </DecorativeCopy.Provider>
      {active && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            overflow: 'clip',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          <span
            style={{
              position: 'absolute',
              inset: 0,
              overflow: 'hidden',
              color: 'var(--color-accent)',
              maskImage: 'linear-gradient(105deg, transparent 0%, black 40% 60%, transparent 100%)',
              transform: 'translateX(-100%)',
              animation: 'text-shimmer-sweep 1.5s steps(48, end) 0.3s infinite',
            }}
          >
            <DecorativeCopy.Provider value>
              <span style={{ display: 'flex', alignItems: 'center', minWidth: 0, transform: 'translateX(100%)', animation: 'text-shimmer-highlight 1.5s steps(48, end) 0.3s infinite' }}>
                {content}
              </span>
            </DecorativeCopy.Provider>
          </span>
        </span>
      )}
    </span>
  )
})
