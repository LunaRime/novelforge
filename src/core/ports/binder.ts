import type { ChapterBlueprintScope } from './chapter-blueprints'

export type BinderScope = ChapterBlueprintScope
export interface BinderChapter { chapterNumber: number; title: string; volumeNumber: number | null; sortOrder: number }
export interface BinderReorderParams { chapterNumber: number; toVolumeNumber: number | null; targetIndex?: number }
export interface BinderReorderReceipt { refreshError?: string }
export interface BinderPorts {
  scope(): BinderScope | null
  readList(): Promise<BinderChapter[]>
  reorder(params: BinderReorderParams): Promise<boolean>
  refresh(): Promise<void>
}
