import type { DraftWriteResult, DraftWriteSnapshot } from './draft-write'

export interface RevisionMergeInput {
  draftId: number
  revisionId: number
  chapterNumber?: number
  content: string
  wordCount: number
  expectedContent: string
  projectPath: string
}
export interface RevisionMergeResult {
  success: boolean
  error?: string
  conflict?: boolean
  chapterNumber?: number
}
export interface RevisionMergePort {
  atomic<T>(operation: () => T): T
  draft(id: number): DraftWriteSnapshot | null
  revision(id: number): { baseDraftId: number; status: string } | null
  write(input: RevisionMergeInput, before: DraftWriteSnapshot): DraftWriteResult
  reviseDraft(id: number, wordCount: number): boolean
  mergeRevision(id: number, targetDraftId: number): boolean
}
