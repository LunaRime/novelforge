import { ArrowDownWideNarrow, ArrowUpNarrowWide, SquarePlus } from 'lucide-react'

/** 创建与排序共用相同的线宽，区分创建入口、列表排序和位置跳转。 */
export function CreateIcon({ size = 15 }: { size?: number }) {
  return <SquarePlus size={size} strokeWidth={1.7} className="shrink-0" aria-hidden="true" />
}

export function SortDirectionIcon({ direction, size = 15 }: { direction: 'asc' | 'desc'; size?: number }) {
  const Icon = direction === 'asc' ? ArrowUpNarrowWide : ArrowDownWideNarrow
  return <Icon size={size} strokeWidth={1.7} className="shrink-0" aria-hidden="true" />
}
