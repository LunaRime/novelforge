import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from '../../lib/utils'
import './choice-controls.css'

interface Choice<T extends string | number> {
  value: T
  label: ReactNode
  icon?: ReactNode
  title?: string
}

interface Props<T extends string | number> {
  items: Array<Choice<T>>
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  fill?: boolean
  disabled?: boolean
  className?: string
}

type Appearance = 'tabs' | 'cards' | 'filters'

/** 视图导航、设置值和就地筛选共用受控选择语义，各自保留独立的视觉层级。 */
function ChoiceGroup<T extends string | number>({
  items, value, onChange, size = 'md', fill, disabled, className, appearance,
}: Props<T> & { appearance: Appearance }) {
  return (
    <div className={cn('nf-choices', fill && 'w-full', className)} data-appearance={appearance} data-size={size}>
      {items.map(item => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            data-tooltip={item.title}
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(item.value)}
            className={fill ? 'flex-1' : undefined}
          >
            {item.icon}
            {item.label}
            {appearance === 'cards' && (
              <span className="nf-choice-check" aria-hidden="true">{active && <Check size={11} />}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function ViewTabs<T extends string | number>(props: Props<T>) {
  return <ChoiceGroup {...props} appearance="tabs" />
}

export function OptionCards<T extends string | number>(props: Props<T>) {
  return <ChoiceGroup {...props} appearance="cards" />
}

export function FilterButtons<T extends string | number>(props: Props<T>) {
  return <ChoiceGroup {...props} appearance="filters" />
}
