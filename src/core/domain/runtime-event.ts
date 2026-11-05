/** Facts emitted after successful operations; display fields are optional. */
export interface RuntimeEventPresentation {
  name?: string
  path?: string
  summary?: string
  metadata?: Record<string, unknown>
  timestamp?: number
}
export type RuntimeEvent = RuntimeEventPresentation & (
  | { type: 'document.changed'; id: string }
  | { type: 'chapter.draft_written'; chapterId: string }
  | { type: 'chapter.reviewed'; chapterId: string; score: number }
  | { type: 'workflow.progressed'; runId: string; step: string; pct: number }
)
