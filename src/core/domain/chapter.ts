export type ChapterStatus = 'draft' | 'revised' | 'reviewed' | 'finalized' | 'archived'

export interface Chapter {
  projectId: string
  id: string
  number: number
  title: string
  status: ChapterStatus
  content: string
  createdAt: string
  updatedAt: string
  /** Preserve additional frontmatter through edits and history snapshots. */
  metadata?: Record<string, unknown>
}

export interface ChapterMeta {
  id: string
  number: number
  title: string
  status: ChapterStatus
  path: string
  revision: string
  wordCount: number
}

export interface StoredChapter {
  chapter: Chapter
  /** SHA-256 of the entire file, including frontmatter. */
  revision: string
  indexed: boolean
}

export class ChapterError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'ChapterError'
  }
}

export function assertChapterId(id: string): void {
  if (!/^ch_[a-f0-9]{8,64}$/.test(id)) throw new ChapterError('invalid-chapter', 'Invalid chapter id')
}

export function assertChapter(ch: Chapter): void {
  assertChapterId(ch.id)
  if (typeof ch.projectId !== 'string' || !ch.projectId.trim() || !Number.isSafeInteger(ch.number) || ch.number < 1 ||
      typeof ch.title !== 'string' || typeof ch.content !== 'string' ||
      !['draft', 'revised', 'reviewed', 'finalized', 'archived'].includes(ch.status) ||
      typeof ch.createdAt !== 'string' || !Number.isFinite(Date.parse(ch.createdAt)) ||
      typeof ch.updatedAt !== 'string' || !Number.isFinite(Date.parse(ch.updatedAt))) {
    throw new ChapterError('invalid-chapter', 'Invalid chapter metadata')
  }
}
