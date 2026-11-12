import type { BlueprintWriteScope } from './insert-missing-blueprints'

export interface DirectorySnapshotRequest {
  mode: 'full' | 'append'
  startChapter?: number
  count?: number
  expectedTotalChapters?: number
}

export interface DirectoryWriteRange {
  mode: 'replace-all' | 'replace-range' | 'append'
  first: number
  last: number
  totalChapters: number
}

export interface GeneratedBlueprintFields {
  chapterNumber: number
  title: string
  role: string
  purpose: string
  keyEvents: string
  characters: string[]
  suspenseHook: string
}

export interface DirectoryWriteSnapshot {
  scope: BlueprintWriteScope
  range: DirectoryWriteRange | null
  digest: string
}

export interface DirectoryWriteInput {
  snapshot: DirectoryWriteSnapshot
  items: GeneratedBlueprintFields[]
}

export interface DirectoryWriteReceipt {
  writtenChapterNumbers: number[]
  deletedChapterNumbers: number[]
}

export type DirectoryWriteResult =
  | ({ success: true } & DirectoryWriteReceipt)
  | { success: false; reason: 'scope' | 'conflict' | 'invalid' | 'storage'; error: string }

export class DirectoryBlueprintValidationError extends Error {}

const invalid = () => new DirectoryBlueprintValidationError('invalid-directory-blueprint-write')
const positive = (value: number) => Number.isSafeInteger(value) && value > 0
const textFields = ['title', 'role', 'purpose', 'keyEvents', 'suspenseHook'] as const

export function resolveDirectoryWriteRange(
  request: DirectorySnapshotRequest, totalChapters: number, highestChapter: number,
): DirectoryWriteRange | null {
  const { mode, count = 0, startChapter } = request ?? {}
  if (!positive(totalChapters) || !Number.isSafeInteger(highestChapter) || highestChapter < 0
    || !Number.isSafeInteger(count) || count < 0) throw invalid()
  if (mode === 'full') {
    if (startChapter !== undefined) throw invalid()
    return count === 0
      ? { mode: 'replace-all', first: 1, last: totalChapters, totalChapters }
      : { mode: 'replace-range', first: 1, last: Math.min(count, totalChapters), totalChapters }
  }
  if (mode !== 'append') throw invalid()
  if (startChapter !== undefined && !positive(startChapter)) throw invalid()
  if (startChapter === undefined && count === 0 && highestChapter >= totalChapters) return null
  const first = startChapter ?? (highestChapter + 1)
  const last = count > 0 ? first + (count - 1) : totalChapters
  if (!positive(first) || !positive(last) || last < first) throw invalid()
  return { mode: startChapter === undefined ? 'append' : 'replace-range', first, last, totalChapters }
}

export function validateDirectoryWriteItems(range: DirectoryWriteRange, items: unknown): GeneratedBlueprintFields[] {
  if (!isDirectoryWriteRange(range) || !Array.isArray(items) || items.length !== range.last - range.first + 1) throw invalid()
  const seen = new Set<number>()
  const validated: GeneratedBlueprintFields[] = []
  for (const item of items as GeneratedBlueprintFields[]) {
    if (!item || !positive(item.chapterNumber) || item.chapterNumber < range.first
      || item.chapterNumber > range.last || seen.has(item.chapterNumber)
      || textFields.some(field => typeof item[field] !== 'string') || !Array.isArray(item.characters)
      || item.characters.some(character => typeof character !== 'string')) throw invalid()
    const { chapterNumber, title, role, purpose, keyEvents, characters, suspenseHook } = item
    seen.add(chapterNumber)
    validated.push({ chapterNumber, title, role, purpose, keyEvents, characters: [...characters], suspenseHook })
  }
  return validated.sort((a, b) => a.chapterNumber - b.chapterNumber)
}

export function isDirectoryWriteRange(value: unknown): value is DirectoryWriteRange {
  if (!value || typeof value !== 'object') return false
  const { mode, first, last, totalChapters } = value as DirectoryWriteRange
  return positive(totalChapters) && positive(first) && positive(last) && last >= first
    && (mode === 'append' || mode === 'replace-range' || (mode === 'replace-all' && first === 1 && last === totalChapters))
}

export function getDirectoryBlueprintDeletions(range: DirectoryWriteRange, existingChapterNumbers: number[]): number[] {
  return range.mode === 'replace-all'
    ? existingChapterNumbers.filter(chapter => chapter < range.first || chapter > range.last)
    : []
}
