import { cn } from '../../lib/utils'
import { SortDirectionIcon } from './ActionIcons'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './Select'

interface Props<T extends string> {
  value: T
  label: string
  className?: string
  items: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}

/** 排序选择统一使用有标签的触发器、键盘导航和选中标记。 */
export function SortSelect<T extends string>({ value, label, items, onChange, className }: Props<T>) {
  return <Select value={value} onValueChange={next => {
    const option = items.find(item => item.value === next)
    if (option) onChange(option.value)
  }}>
    <SelectTrigger aria-label={label} title={label} className={cn("w-auto max-w-full bg-[var(--color-editor-bg)]", className)}>
      <span className="flex min-w-0 items-center gap-1.5"><SortDirectionIcon direction="desc" size={14} /><SelectValue /></span>
    </SelectTrigger>
    <SelectContent align="end">
      {items.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
    </SelectContent>
  </Select>
}
