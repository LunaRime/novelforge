/**
 * BlueprintSortBar — 章节蓝图排序工具栏
 *
 * 提供排序方式和方向的选择，集成到 ChapterCardEditor 中。
 */

import React from 'react'
import {
  useBlueprintSortStore,
  type BlueprintSortKey,
  SORT_KEY_LABELS,
  SORT_DIRECTION_LABELS,
} from '../../stores/blueprint-sort-store'
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { t, type TextKey } from '../../shared/locale'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../ui/Select'

const SORT_OPTIONS: BlueprintSortKey[] = [
  'chapter_number',
  'priority',
  'role',
  'custom',
]

export const BlueprintSortBar: React.FC = () => {
  const config = useBlueprintSortStore((s) => s.config)
  const setSortKey = useBlueprintSortStore((s) => s.setSortKey)
  const toggleDirection = useBlueprintSortStore((s) => s.toggleDirection)

  return (
    <div className="flex items-center gap-2 px-2 py-1 text-xs">
      <span className="flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
        <ArrowUpDown size={12} />
        {t('sort.label')}
      </span>
      <Select
        value={config.key}
        onValueChange={(v) => setSortKey(v as BlueprintSortKey)}
      >
        <SelectTrigger className="h-6 w-auto rounded-[var(--radius-sm)] text-xs" title={t('sort.chooseMethod')}><SelectValue /></SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((key) => (
            <SelectItem key={key} value={key}>
              {t(SORT_KEY_LABELS[key] as TextKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button
        onClick={toggleDirection}
        className="p-0.5 rounded-[var(--radius-sm)] hover:bg-[var(--color-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
        title={t('sort.current').replace('{label}', t(SORT_DIRECTION_LABELS[config.direction] as TextKey))}
        aria-label={t('sort.toggleDirection')}
        style={{ color: 'var(--color-text-muted)' }}
      >
        {config.direction === 'asc' ? (
          <ArrowUp size={12} />
        ) : (
          <ArrowDown size={12} />
        )}
      </button>
    </div>
  )
}

export default BlueprintSortBar
