import { createBinderApplication, type BinderScope } from '../../core'
import { t } from '../../shared/locale'
import { useProjectStore } from '../../stores/project-store'
import { useVolumeStore } from '../../stores/volume-store'
import { ipc } from '../ipc-client'

const currentScope = (): BinderScope | null => {
  const { currentProject, projectSession } = useProjectStore.getState()
  return currentProject ? { id: currentProject.id, path: currentProject.path, session: projectSession } : null
}
const readFailure = () => new Error(t('log.render.blueprintLoadFailed'))

export function createRendererBinderApplication(source = currentScope()) {
  const captured = source ? { ...source } : null
  const isCurrent = () => {
    const current = currentScope()
    return captured !== null && current !== null && captured.id === current.id && captured.path === current.path && captured.session === current.session
  }
  return createBinderApplication({
    scope: currentScope,
    readList: async () => {
      const rows = await ipc.invoke('db:blueprint-get-all')
      if (!Array.isArray(rows)) throw readFailure()
      const numbers = new Set<number>()
      return rows.map(row => {
        if (!row || !Number.isSafeInteger(row.chapterNumber) || row.chapterNumber <= 0 || numbers.has(row.chapterNumber)
          || typeof row.title !== 'string' || !Number.isSafeInteger(row.sortOrder) || row.sortOrder < 0
          || (row.volumeNumber != null && (!Number.isSafeInteger(row.volumeNumber) || row.volumeNumber <= 0))) throw readFailure()
        numbers.add(row.chapterNumber)
        return { chapterNumber: row.chapterNumber, title: row.title, sortOrder: row.sortOrder, volumeNumber: row.volumeNumber ?? null }
      })
    },
    reorder: async params => {
      const result = await ipc.invoke('db:binder-reorder', params)
      if (result?.success !== true) throw new Error(result?.error || t('prompt.saveFailed'))
      return true
    },
    refresh: async () => { if (await useVolumeStore.getState().load(isCurrent) !== true) throw readFailure() },
  }, captured)
}
