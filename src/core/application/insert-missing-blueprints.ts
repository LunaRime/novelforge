export interface BlueprintWriteScope { projectPath: string; token: string }
export interface MissingBlueprintRow {
  chapterNumber: number; title: string; role: string; purpose: string; keyEvents: string; characters: string[]
  suspenseHook: string; userGuidance: string; notes: string; notesUpdatedAt: number | string
  sortOrder: number; priority: number; volumeNumber?: number | null
}
export interface MissingBlueprintInput<T extends MissingBlueprintRow = MissingBlueprintRow> {
  scope: BlueprintWriteScope
  targetChapterNumbers: number[]
  items: T[]
}
export interface MissingBlueprintReceipt { insertedChapterNumbers: number[]; skippedChapterNumbers: number[] }
export type MissingBlueprintResult = ({ success: true } & MissingBlueprintReceipt) | { success: false; error: string }
export class MissingBlueprintValidationError extends Error {}
export class MissingBlueprintScopeChanged extends Error {}
interface MissingBlueprintPorts<T extends MissingBlueprintRow> {
  scope(): BlueprintWriteScope | null
  atomic<R>(work: () => R): R
  insert(item: T): boolean
}
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const textFields = ['title', 'role', 'purpose', 'keyEvents', 'suspenseHook', 'userGuidance', 'notes'] as const

/** Each target is filled only if it is still absent at the transactional write point. */
export function insertMissingBlueprints<T extends MissingBlueprintRow>(input: MissingBlueprintInput<T>, ports: MissingBlueprintPorts<T>): MissingBlueprintReceipt {
  const invalid = () => { throw new MissingBlueprintValidationError('invalid-blueprint-gap-input') }
  if (!input || !input.scope || typeof input.scope.projectPath !== 'string' || !input.scope.projectPath
    || typeof input.scope.token !== 'string' || !input.scope.token || !Array.isArray(input.targetChapterNumbers)
    || !input.targetChapterNumbers.length || !Array.isArray(input.items)) invalid()
  const targets = new Set<number>()
  for (const chapter of input.targetChapterNumbers) {
    if (!positive(chapter) || targets.has(chapter)) invalid()
    targets.add(chapter)
  }
  const seen = new Set<number>()
  for (const item of input.items) {
    if (!item || !positive(item.chapterNumber) || !targets.has(item.chapterNumber) || seen.has(item.chapterNumber)
      || textFields.some(field => typeof item[field] !== 'string') || !Array.isArray(item.characters)
      || item.characters.some(character => typeof character !== 'string')
      || !(typeof item.notesUpdatedAt === 'string' || (typeof item.notesUpdatedAt === 'number' && Number.isSafeInteger(item.notesUpdatedAt) && item.notesUpdatedAt >= 0))
      || !Number.isSafeInteger(item.sortOrder) || !Number.isSafeInteger(item.priority)
      || (item.volumeNumber != null && !positive(item.volumeNumber))) invalid()
    seen.add(item.chapterNumber)
  }
  const scope = { ...input.scope }
  const items = input.items.map(item => ({ ...item, characters: [...item.characters] }))
  const assertScope = () => {
    const current = ports.scope()
    if (!current || current.projectPath !== scope.projectPath || current.token !== scope.token) throw new MissingBlueprintScopeChanged('blueprint-source-changed')
  }
  assertScope()
  return ports.atomic(() => {
    assertScope()
    const result: MissingBlueprintReceipt = { insertedChapterNumbers: [], skippedChapterNumbers: [] }
    for (const item of items) {
      assertScope()
      const inserted = ports.insert(item)
      const chapters = inserted ? result.insertedChapterNumbers : result.skippedChapterNumbers
      chapters.push(item.chapterNumber)
    }
    assertScope()
    return result
  })
}
