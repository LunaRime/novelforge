import * as React from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * 通用 Input 组件
 *
 * type="number" 时自动启用步进箭头（隐藏原生 spinner）：
 * - 编辑中允许清空输入框（不会阻止删除操作）
 * - 失焦时若为空值，自动恢复为 min 属性值（若设置）或 "0"
 * - 右侧 +/- 步进按钮，遵循 min/max/step 约束
 */
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, onBlur, onChange, onFocus, disabled, min, max, step, value, style, ...props }, ref) => {
    const isNumber = type === 'number'
    const inputRef = React.useRef<HTMLInputElement>(null)

    // 合并外部 ref
    React.useImperativeHandle(ref, () => inputRef.current!, [])

    const dispatch = (newVal: string) => {
      const el = inputRef.current
      if (!el) return
      const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      nativeSet?.call(el, newVal)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }

    const handleBlur: React.FocusEventHandler<HTMLInputElement> = (e) => {
      if (isNumber && e.target.value === '') {
        const fallback = min != null ? String(min) : '0'
        dispatch(fallback)
      }
      onBlur?.(e)
    }

    const stepVal = typeof step === 'number' ? step : 1
    const maxNum = max != null ? Number(max) : null
    const minNum = min != null ? Number(min) : null
    const increment = () => {
      if (disabled || !isNumber) return
      const current = Number(inputRef.current?.value) || 0
      const next = current + stepVal
      if (maxNum != null && next > maxNum) return
      dispatch(String(next))
    }
    const decrement = () => {
      if (disabled || !isNumber) return
      const current = Number(inputRef.current?.value) || 0
      const next = current - stepVal
      if (minNum != null && next < minNum) return
      dispatch(String(next))
    }

    const inputCls = cn(
      'flex h-7 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-2.5 py-1 text-xs text-[var(--color-text)]',
      'placeholder:text-[var(--color-text-muted)]',
      'transition-all duration-200 ease-out',
      'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-1 focus:ring-offset-[var(--color-bg)]',
      'focus:border-[var(--color-accent)]',
      'hover:border-[var(--color-text-muted)]',
      'disabled:cursor-not-allowed disabled:opacity-50',
    )

    if (!isNumber) {
      return (
        <input
          type={type}
          ref={inputRef}
          value={value}
          onChange={onChange}
          onBlur={handleBlur}
          onFocus={onFocus}
          disabled={disabled}
          className={cn(inputCls, className)}
          style={style}
          {...props}
        />
      )
    }

    // number 类型
    return (
      <div className={cn('relative flex items-center', className)} style={style}>
        <input
          type="number"
          ref={inputRef}
          value={value}
          onChange={onChange}
          onBlur={handleBlur}
          onFocus={onFocus}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          className={cn(
            inputCls,
            '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
            'pr-7',
          )}
          {...props}
        />
        <div className="absolute right-0.5 inset-y-0.5 flex flex-col" style={{ width: 18 }}>
          <button
            type="button"
            className={cn(
              'flex items-center justify-center flex-1 flex-shrink-0 rounded-tr-[var(--radius-sm)] cursor-pointer transition-colors',
              'hover:bg-[var(--color-hover)]',
              disabled && 'opacity-50 pointer-events-none',
            )}
            onClick={increment}
            tabIndex={-1}
            aria-label="增加"
          >
            <ChevronUp size={10} style={{ color: 'var(--color-text-muted)' }} strokeWidth={2} />
          </button>
          <button
            type="button"
            className={cn(
              'flex items-center justify-center flex-1 flex-shrink-0 rounded-br-[var(--radius-sm)] cursor-pointer transition-colors',
              'hover:bg-[var(--color-hover)]',
              disabled && 'opacity-50 pointer-events-none',
            )}
            onClick={decrement}
            tabIndex={-1}
            aria-label="减少"
          >
            <ChevronDown size={10} style={{ color: 'var(--color-text-muted)' }} strokeWidth={2} />
          </button>
        </div>
      </div>
    )
  }
)
Input.displayName = 'Input'

export { Input }
