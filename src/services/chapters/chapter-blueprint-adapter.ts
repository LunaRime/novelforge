import { createChapterBlueprintApplication, type ChapterBlueprintScope } from '../../core'
import type { BlueprintData } from '../../../electron/repositories/blueprint-repository'
import { t } from '../../shared/locale'
import { useProjectStore } from '../../stores/project-store'
import { ipc } from '../ipc-client'
import { normalizeBlueprintRole } from '../blueprint-role'

const currentScope = (): ChapterBlueprintScope | null => {
  const { currentProject, projectSession } = useProjectStore.getState()
  return currentProject ? { id: currentProject.id, path: currentProject.path, session: projectSession } : null
}
const readFailure = () => new Error(t('log.render.blueprintLoadFailed'))
const textFields = ['title', 'role', 'purpose', 'keyEvents', 'suspenseHook', 'userGuidance', 'notes', 'notesUpdatedAt'] as const

/** Strict editor IO; legacy workflow helpers retain their separate behavior. */
export function createRendererChapterBlueprintApplication(source = currentScope()) {
  return createChapterBlueprintApplication<BlueprintData>({
    scope: currentScope,
    readList: async sort => {
      const rows = sort && (sort.key !== 'chapter_number' || sort.direction !== 'asc')
        ? await ipc.invoke('db:blueprint-get-all-sorted', sort)
        : await ipc.invoke('db:blueprint-get-all')
      if (!Array.isArray(rows)) throw readFailure()
      return rows.map(row => {
        if (!row || !Number.isSafeInteger(row.chapterNumber) || row.chapterNumber <= 0 || !Array.isArray(row.characters)
          || row.characters.some(character => typeof character !== 'string') || textFields.some(field => typeof row[field] !== 'string')) throw readFailure()
        return { ...row, role: normalizeBlueprintRole(row.role) }
      })
    },
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
