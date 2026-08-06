/**
 * Select — 现代化下拉选择（Radix Select 封装）
 *
 * 替代原生 select 弹层（无法定制样式）：
 * - 弹出面板：圆角 12px / 面板底色 / 边框 / 大阴影 / zoom+fade 入场动画
 * - 选项：hover 高亮、选中 accent 背景 + 对勾指示器
 * - 触发器：自定义下拉（h-8 / rounded-lg / 自定义箭头）
 */
import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils'

/** 触发器 */
const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'group flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-[var(--color-border)]',
      'bg-[var(--color-panel)] px-3 py-1 text-xs text-[var(--color-text)]',
      'transition-all duration-150 cursor-pointer select-none',
      'hover:border-[var(--color-accent)] hover:bg-[color-mix(in_srgb,var(--color-accent)_4%,var(--color-panel))]',
      'focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/25',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[placeholder]:text-[var(--color-text-muted)]',
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown size={12} className="flex-shrink-0 opacity-60 transition-transform duration-150 group-data-[state=open]:rotate-180" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = 'SelectTrigger'

/** 弹出面板（现代化：大圆角 + 阴影 + 动画） */
const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      className={cn(
        // z-index 必须高于 Modal（--z-modal: 1000）——Select 常在对话框/弹窗内打开，
        // 若低于遮罩层级会被盖住导致"打不开"（Portal 渲染在 body，不受父容器层叠约束）
        'relative z-[calc(var(--z-modal)+10)] min-w-[8rem] overflow-hidden rounded-xl border border-[var(--color-border)]',
        'bg-[var(--color-panel)] text-[var(--color-text)] shadow-[var(--shadow-lg)]',
        // 入场动画：缩放 + 淡入
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
        'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
        'data-[state=open]:duration-150 data-[state=closed]:duration-100',
        position === 'popper' && 'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
        className
      )}
      {...props}
    >
      <SelectPrimitive.Viewport
        className={cn(
          'p-1',
          // 长列表滚动：max-h 限制（视口 60% 或 256px），超出内部滚动——防弹窗超出程序窗口
          'max-h-[min(60vh,16rem)] overflow-y-auto',
          position === 'popper' &&
            'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]'
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = 'SelectContent'

/** 选项（hover 高亮 + 选中 accent 背景 + 对勾） */
const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-pointer select-none items-center rounded-lg py-1.5 pl-2.5 pr-8 text-xs outline-none',
      'transition-colors duration-100',
      'focus:bg-[var(--color-hover)] focus:text-[var(--color-text)]',
      'data-[highlighted]:bg-[var(--color-hover)]',
      'data-[state=checked]:bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] data-[state=checked]:text-[var(--color-accent)]',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
      className
    )}
    {...props}
  >
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    <SelectPrimitive.ItemIndicator className="absolute right-2 flex items-center">
      <Check size={12} strokeWidth={2.5} style={{ color: 'var(--color-accent)' }} />
    </SelectPrimitive.ItemIndicator>
  </SelectPrimitive.Item>
))
SelectItem.displayName = 'SelectItem'

/** 分组标签 */
const SelectGroup = SelectPrimitive.Group
const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn('px-2 py-1 text-[0.65rem] font-semibold text-[var(--color-text-muted)]', className)}
    {...props}
  />
))
SelectLabel.displayName = 'SelectLabel'

const Select = SelectPrimitive.Root
const SelectValue = SelectPrimitive.Value

export {
  Select, SelectTrigger, SelectContent, SelectItem, SelectGroup, SelectLabel, SelectValue,
}
