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
      <span className="text-muted-foreground flex items-center gap-1">
        <ArrowUpDown className="w-3 h-3" />
        排序:
      </span>
      <select
        value={config.key}
        onChange={(e) => setSortKey(e.target.value as BlueprintSortKey)}
        className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-1.5 py-0.5 text-xs
                   text-[var(--color-text)] cursor-pointer hover:border-[var(--color-accent)]
                   focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
        title="选择排序方式"
      >
        {SORT_OPTIONS.map((key) => (
          <option key={key} value={key}>
            {SORT_KEY_LABELS[key]}
          </option>
        ))}
      </select>
      <button
        onClick={toggleDirection}
        className="p-0.5 rounded hover:bg-accent/10 transition-colors"
        title={`当前: ${SORT_DIRECTION_LABELS[config.direction]}，点击切换`}
        aria-label="切换排序方向"
      >
        {config.direction === 'asc' ? (
          <ArrowUp className="w-3 h-3 text-muted-foreground" />
        ) : (
          <ArrowDown className="w-3 h-3 text-muted-foreground" />
        )}
      </button>
    </div>
  )
}

export default BlueprintSortBar
