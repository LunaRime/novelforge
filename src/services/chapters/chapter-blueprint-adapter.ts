import { createChapterBlueprintApplication, ChapterBlueprintRequestCancelled, type ChapterBlueprintScope, type ChapterBlueprintSort, type MissingBlueprintReceipt } from '../../core'
import type { BlueprintData } from '../../../electron/repositories/blueprint-repository'
import { t } from '../../shared/locale'
import { useProjectStore } from '../../stores/project-store'
import { ipc } from '../ipc-client'
import { normalizeBlueprintRole } from '../blueprint-role'

export function captureChapterBlueprintScope(): ChapterBlueprintScope | null {
  const { currentProject, projectSession } = useProjectStore.getState()
  return currentProject ? { id: currentProject.id, path: currentProject.path, session: projectSession } : null
}
export function assertChapterBlueprintScope(source: ChapterBlueprintScope): void {
  const current = captureChapterBlueprintScope()
  if (!current || current.id !== source.id || current.path !== source.path || current.session !== source.session) {
    throw new ChapterBlueprintRequestCancelled()
  }
}
const readFailure = () => new Error(t('log.render.blueprintLoadFailed'))
const textFields = ['title', 'role', 'purpose', 'keyEvents', 'suspenseHook', 'userGuidance', 'notes'] as const

export async function readStrictChapterBlueprints(sort?: ChapterBlueprintSort): Promise<BlueprintData[]> {
  const rows = sort && (sort.key !== 'chapter_number' || sort.direction !== 'asc')
    ? await ipc.invoke('db:blueprint-get-all-sorted', sort)
    : await ipc.invoke('db:blueprint-get-all')
  if (!Array.isArray(rows)) throw readFailure()
  return rows.map(row => {
    if (!row || !Number.isSafeInteger(row.chapterNumber) || row.chapterNumber <= 0 || !Array.isArray(row.characters)
      || row.characters.some(character => typeof character !== 'string') || textFields.some(field => typeof row[field] !== 'string')
      || !(typeof row.notesUpdatedAt === 'string' || (typeof row.notesUpdatedAt === 'number' && Number.isSafeInteger(row.notesUpdatedAt) && row.notesUpdatedAt >= 0))) throw readFailure()
    return { ...row, role: normalizeBlueprintRole(row.role) }
  })
}

export async function readChapterBlueprintSnapshot(source: ChapterBlueprintScope): Promise<BlueprintData[]> {
  assertChapterBlueprintScope(source)
  try { return await readStrictChapterBlueprints() }
  finally { assertChapterBlueprintScope(source) }
}

/** Capture a connection token before model IO; never reacquire it at the write point. */
export async function createMissingBlueprintWriter(source: ChapterBlueprintScope) {
  const capturedSource = { ...source }
  assertChapterBlueprintScope(capturedSource)
  const scope = await ipc.invoke('db:blueprint-write-scope')
  assertChapterBlueprintScope(capturedSource)
  if (!scope || scope.projectPath !== capturedSource.path || typeof scope.token !== 'string' || !scope.token) throw readFailure()
  const capturedScope = { ...scope }
  return {
    insert: async (targetChapterNumbers: number[], items: BlueprintData[]): Promise<MissingBlueprintReceipt> => {
      assertChapterBlueprintScope(capturedSource)
      const input = structuredClone({ scope: capturedScope, targetChapterNumbers, items })
      const result = await ipc.invoke('db:blueprint-insert-missing', input)
      assertChapterBlueprintScope(capturedSource)
      if (result?.success !== true) throw new Error(result?.error || t('error.prereqNotMet'))
      if (!Array.isArray(result.insertedChapterNumbers) || !Array.isArray(result.skippedChapterNumbers)) throw readFailure()
      const accounted = [...result.insertedChapterNumbers, ...result.skippedChapterNumbers]
      const expected = new Set(input.items.map(item => item.chapterNumber))
      if (accounted.length !== expected.size || new Set(accounted).size !== expected.size
        || accounted.some(chapter => !expected.has(chapter))) throw readFailure()
      return { insertedChapterNumbers: [...result.insertedChapterNumbers], skippedChapterNumbers: [...result.skippedChapterNumbers] }
    },
  }
}

export function createRendererChapterBlueprintApplication(source = captureChapterBlueprintScope()) {
  return createChapterBlueprintApplication<BlueprintData>({
    scope: captureChapterBlueprintScope,
    readList: readStrictChapterBlueprints,
    readNextWriteChapter: async () => {
      const max = await ipc.invoke('db:draft-get-max-finalized-chapter')
      if (max == null) return 1
      if (!Number.isSafeInteger(max) || max < 0 || max >= Number.MAX_SAFE_INTEGER) throw readFailure()
      return max + 1
    },
    saveOne: async item => {
      const result = await ipc.invoke('db:blueprint-upsert', item)
      if (result?.success !== true) throw new Error(t('error.blueprintSaveFailed').replace('{n}', String(item.chapterNumber)).replace('{error}', result?.error || t('status.unknown')))
      return true
    },
    saveAll: async items => {
      const result = await ipc.invoke('db:blueprint-upsert-many', items)
      if (result?.success !== true) throw new Error(t('error.blueprintsSaveBatchFailed').replace('{error}', result?.error || t('status.unknown')))
      return true
    },
    deleteOne: async chapterNumber => {
      const result = await ipc.invoke('db:blueprint-delete', chapterNumber)
      if (result?.success !== true) throw new Error(result?.error || t('status.unknown'))
      return true
    },
    refreshFileTree: async () => { await useProjectStore.getState().refreshFileTree() },
  }, source)
}
