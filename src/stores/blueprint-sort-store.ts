/**
 * NovelForge 蓝图排序 Store — 章节蓝图排序偏好管理
 *
 * 管理排序方式和方向，提供排序变更和持久化。
 */

import { create } from 'zustand'

/** 蓝图排序键 */
export type BlueprintSortKey = 'chapter_number' | 'priority' | 'role' | 'custom'

/** 排序方向 */
export type SortDirection = 'asc' | 'desc'

/** 排序配置 */
export interface BlueprintSortConfig {
  key: BlueprintSortKey
  direction: SortDirection
}

interface BlueprintSortState {
  /** 当前排序配置 */
  config: BlueprintSortConfig

  /** 设置排序键 */
  setSortKey: (key: BlueprintSortKey) => void
  /** 切换排序方向 */
  toggleDirection: () => void
  /** 设置完整排序配置 */
  setConfig: (config: Partial<BlueprintSortConfig>) => void
  /** 重置为默认（按章节号升序） */
  reset: () => void
}

const DEFAULT_CONFIG: BlueprintSortConfig = {
  key: 'chapter_number',
  direction: 'asc',
}

export const useBlueprintSortStore = create<BlueprintSortState>()((set) => ({
  config: { ...DEFAULT_CONFIG },

  setSortKey: (key) => {
    set((s) => ({ config: { ...s.config, key } }))
  },

  toggleDirection: () => {
    set((s) => ({
      config: {
        ...s.config,
        direction: s.config.direction === 'asc' ? 'desc' : 'asc',
      },
    }))
  },

  setConfig: (partial) => {
    set((s) => ({ config: { ...s.config, ...partial } }))
  },

  reset: () => {
    set({ config: { ...DEFAULT_CONFIG } })
  },
}))

/** 排序键的显示标签 */
export const SORT_KEY_LABELS: Record<BlueprintSortKey, string> = {
  chapter_number: '按章节号',
  priority: '按优先级',
  role: '按章节定位',
  custom: '自定义顺序',
}

/** 排序方向的显示标签 */
export const SORT_DIRECTION_LABELS: Record<SortDirection, string> = {
  asc: '升序',
  desc: '降序',
}
