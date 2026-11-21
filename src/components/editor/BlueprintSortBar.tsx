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
import { SortDirectionIcon } from '../ui/ActionIcons'
import { Button } from '../ui/Button'
import { t, type TextKey } from '../../shared/locale'
import { SortSelect } from '../ui/SortSelect'

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
      <SortSelect label={t('sort.chooseMethod')} value={config.key} onChange={setSortKey}
        items={SORT_OPTIONS.map(value => ({ value, label: t(SORT_KEY_LABELS[value] as TextKey) }))} />
      <Button type="button" variant="outline" size="icon" className="size-8"
        onClick={toggleDirection}
        title={t('sort.current').replace('{label}', t(SORT_DIRECTION_LABELS[config.direction] as TextKey))}
        aria-label={t('sort.toggleDirection')}
      >
        <SortDirectionIcon direction={config.direction} />
      </Button>
    </div>
  )
}

export default BlueprintSortBar
