/** Legacy draft identity stays numeric until the storage cutover is verified. */
export interface DraftWriteSnapshot {
  id: number
  chapterNumber: number
  branchId: number | null
  status: string
  content: string
  contentHash: string
  updatedAt: number
  wordCount: number
}
export interface DraftContentWrite {
  draftId: number
  content: string
  wordCount: number
  actor: 'user' | 'agent'
  expectedHash?: string
  expectedUpdatedAt?: number
}
export interface DraftWriteResult {
  success: boolean
  conflict?: boolean
  currentHash?: string
  currentUpdatedAt?: number
  error?: string
}
export interface DraftWritePort {
  atomic<T>(operation: () => T): T
  read(id: number): DraftWriteSnapshot | null
  snapshot(before: DraftWriteSnapshot): void
  replace(command: DraftContentWrite, before: DraftWriteSnapshot): DraftWriteResult
}
