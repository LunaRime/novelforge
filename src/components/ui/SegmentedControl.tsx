import React from 'react'
import { cn } from '../../lib/utils'

export interface SegmentedItem<T extends string | number> {
  value: T
  /** 标签。给 ReactNode 以便调用方组合多段文字（如导出的「.md / Markdown」双行） */
  label: React.ReactNode
  /** 可选前置图标（图标档位切换等场景） */
  icon?: React.ReactNode
  /** 原生 title 提示——标签短到不足以自解释时用 */
  title?: string
}

interface Props<T extends string | number> {
  items: Array<SegmentedItem<T>>
  value: T
  onChange: (value: T) => void
  /** sm = 11px 次级文字档（底部面板等窄处）；md（默认）= 12px 正文档 */
  size?: 'sm' | 'md'
  /** 等宽铺满：容器 w-full、各项等分（弹层里的值选择器用） */
  fill?: boolean
  className?: string
}

const SIZE_CLASS = {
  sm: 'px-1.5 py-0.5 text-micro',
  md: 'px-2.5 py-1 text-xs',
} as const

/**
 * 分段切换控件（Segmented Control）—— 在 N 个互斥值之间切换。
 *
 * 形态（2026-09-25 拍板）：**描边分段条**——1px 描边容器 + 激活块 accent 实底白字，
 * 激活块贴边、圆角由容器 `overflow-hidden` 裁出。它是 5 处既有实现里的多数派
 * （ActivityView / LogsView / LogFileDialog 三处本就如此），且不引入任何非令牌值——
 * 被替换掉的「浮起白药丸」用的是硬编码 `boxShadow: 0 1px 3px rgba(0,0,0,.12)`。
 *
 * 只管「选哪个值」，不管业务：不做受控与否的双形态，一律受控（value + onChange）。
 *
 * ⚠️ 与 `ui/MenuItem` 的分工：Menu 是**执行一个命令**（点完就关），
 * Segmented 是**选一个值**（选完留在原地，当前档常驻可见）。
 */
export function SegmentedControl<T extends string | number>({
  items,
  value,
  onChange,
  size = 'md',
  fill = false,
  className,
}: Props<T>) {
  return (
    <div
      className={cn(
        'flex items-center rounded-lg border border-[var(--color-border)] overflow-hidden',
        fill && 'w-full',
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            title={item.title}
            aria-pressed={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'flex items-center justify-center gap-1 transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)]',
              SIZE_CLASS[size],
              fill && 'flex-1',
              active
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]',
            )}
          >
            {item.icon}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
