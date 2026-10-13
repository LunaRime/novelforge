/**
 * DisclosureRow — 24px 流程行（线② · dsh 照搬）
 *
 * dsh 所有「流程行」（工具 / 思考 / 命令 / 工作流成员）的骨架：
 * [16px 前导] gap 6 [标题 13/24] + [可选折叠摘要（点分隔 + 单行省略）]。
 *
 * 行前导置换（spec §1 · 已拍板 D2「按照 dsh」）：
 * - 收起态不悬停：显示语义图标；
 * - 悬停 / 聚焦：100ms 交叉渐隐为 chevron（⌄，收起态指向下，暗示"可展开"）；
 * - 展开态：固定为静态上折角（⌃），不参与置换。
 *
 * 对照 dsh `DisclosureRow`（`ui-primitives/src/DisclosureRow.tsx` + `.module.css`）。
 * 用 NF 语义令牌（--color-text-muted / --color-text-secondary），遵循 color-token-standard
 * 与 ui-interaction-standard §3.1（两图层交叉渐隐 + group-hover/group-focus-within 双触发）。
 */
import { useCallback, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { TextShimmer } from './TextShimmer'

interface DisclosureRowProps {
  /** 语义图标（收起态显示；14px 档） */
  icon: ReactNode
  /** 标题（13px，secondary tier） */
  title: string
  open: boolean
  /** 是否可展开（不可展开时前导是纯图标，无置换、无点击） */
  expandable: boolean
  onToggle: () => void
  /** 运行中：标题与摘要走 shimmer 高亮（TextShimmer 由父级包裹时可省略） */
  running?: boolean
  /** 整行是否承载展开点击（否则仅前导按钮） */
  expandOnRowClick?: boolean
  /** 展开态保留折叠摘要（工具行的 diff 计数等需常显） */
  keepContentWhenOpen?: boolean
  /** 折叠摘要内容（标题右侧，点分隔 + 单行省略） */
  collapsedContent?: ReactNode
  /** 展开体 */
  children?: ReactNode
  className?: string
}

/**
 * 24px 单行折叠头 + 受控展开体。
 * 前导按钮独立承载折叠（键盘可达）；`expandOnRowClick` 时整行也可点。
 */
export function DisclosureRow({
  icon,
  title,
  open,
  expandable,
  onToggle,
  running = false,
  expandOnRowClick = false,
  keepContentWhenOpen = false,
  collapsedContent,
  children,
  className,
}: DisclosureRowProps) {
  const rowExpands = expandable && expandOnRowClick

  const toggleFromLeading = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    onToggle()
  }, [onToggle])

  const toggleFromKeyboard = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (!rowExpands || (e.key !== 'Enter' && e.key !== ' ')) return
    e.preventDefault()
    onToggle()
  }, [rowExpands, onToggle])

  // 前导内容：展开 → 静态上折角；收起 → 语义图标（悬停置换为下折角）
  const leading = open ? (
    <ChevronUp size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
  ) : (
    <>
      <span
        className="inline-flex transition-opacity duration-100 motion-reduce:transition-none group-hover:opacity-0 group-focus-within:opacity-0"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {icon}
      </span>
      <ChevronDown
        size={14}
        className="absolute inset-0 m-auto opacity-0 transition-opacity duration-100 motion-reduce:transition-none group-hover:opacity-100 group-focus-within:opacity-100"
        style={{ color: 'var(--color-text-muted)' }}
      />
    </>
  )

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', width: '100%', minWidth: 0 }}>
      <div
        className="group"
        role={rowExpands ? 'button' : undefined}
        tabIndex={rowExpands ? 0 : undefined}
        aria-expanded={rowExpands ? open : undefined}
        onClick={rowExpands ? onToggle : undefined}
        onKeyDown={rowExpands ? toggleFromKeyboard : undefined}
        style={{
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          height: 24,
          minWidth: 0,
          cursor: rowExpands ? 'pointer' : undefined,
          color: 'var(--color-text-muted)',
        }}
      >
        {expandable && !rowExpands ? (
          <button
            type="button"
            onClick={toggleFromLeading}
            aria-label={title}
            aria-expanded={open}
            style={{
              position: 'relative',
              flex: 'none',
              width: 16,
              height: 16,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 6,
              padding: 0,
              border: 'none',
              background: 'none',
              color: 'inherit',
              cursor: 'pointer',
            }}
          >
            {leading}
          </button>
        ) : (
          <span
            style={{
              position: 'relative',
              flex: 'none',
              width: 16,
              height: 16,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 6,
              color: 'inherit',
            }}
          >
            {leading}
          </span>
        )}

        {/* 标题 + 折叠摘要（同一行，摘要单行省略）；running 时标题扫光 */}
        <span style={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: '1 1 auto', gap: 8 }}>
          <span
            style={{
              flex: 'none',
              fontSize: 13,
              lineHeight: '24px',
              fontWeight: 400,
              color: 'inherit',
            }}
          >
            <TextShimmer active={running}>{title}</TextShimmer>
          </span>
          {(keepContentWhenOpen || !open) && collapsedContent}
        </span>
      </div>

      {open && children}
    </div>
  )
}
