import React from 'react'
import { cn } from '../../lib/utils'

/** 文案字号档：sm = text-sm（默认，带图标的空态用）/ xs = text-xs / 2xs = text-2xs */
const SIZE_CLASS = {
  '2xs': 'text-2xs',
  xs: 'text-xs',
  sm: 'text-sm',
} as const

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  /** 可选。纯文字空态可省略图标，只给 message */
  icon?: React.ReactNode
  message: string
  /** 整体透明度。默认 0.3——所有空态统一用这一档，个案值不再各自定义 */
  opacity?: number
  size?: keyof typeof SIZE_CLASS
}

export function EmptyState({
  icon,
  message,
  opacity = 0.3,
  size = 'sm',
  className,
  style,
  children,
  ...props
}: Props) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center h-full gap-3', className)}
      /* style 必须解构出来单独合并：此前 `style={{...}}` 后接 `{...props}`，调用方一旦传 style
         就会整体覆盖掉 opacity（props.style 里没有 opacity） */
      style={{ opacity, ...style }}
      {...props}
    >
      {icon}
      <span className={SIZE_CLASS[size]}>{message}</span>
      {children}
    </div>
  )
}
