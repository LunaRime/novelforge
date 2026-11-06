import { createDraftEditorApplication } from '../../core'
import { useProjectStore } from '../../stores/project-store'
import { readDraftBody } from '../../stores/draft-store'
import { mergeRendererRevision } from './merge-revision'
import { useLLMStore } from '../../stores/llm-store'
import { parseDraftMeta } from '../workflows/chapter-workflow'
import { startWorkflow } from '../workflows/start-workflow'
import { guardRepairPostProcess } from '../workflows/workflow-guards'
import { getPendingRevisions, getReviewsForVersion, getLatestReview, getNextDraftVersion, saveDraftContent } from '../draft-index'
import { VELA } from '../vela-protocol'
import { ipc } from '../ipc-client'
import { computeTextStats } from '../text-stats'
import { globalEventBus } from '../../shared/event-bus'
import { t } from '../../shared/locale'
export { getChapterFinalizeScope as getDraftFinalizeScope } from '../workflows/workflow-utils'

/** Renderer composition only: existing DB/CAS operations implement the application's IO ports. */
export function createRendererDraftEditorApplication(project: { path: string } | null, session: number, localize = t) {
  return createDraftEditorApplication({
    project: () => {
      const state = useProjectStore.getState()
      return state.currentProject ? { path: state.currentProject.path, session: state.projectSession } : null
    },
    errors: { changed: localize('error.noProject'), empty: localize('status.unknown'), create: localize('error.noBaseDraft') },
    metadata: parseDraftMeta,
    title: async chapterNumber => {
      const all = await ipc.invoke('db:blueprint-get-all')
      return all.find(item => item.chapterNumber === chapterNumber)?.title
    },
    pending: getPendingRevisions,
    reviewCount: async (id, version) => (await getReviewsForVersion(id, version)).length,
    read: readDraftBody,
    write: async (path, text) => {
      const project = useProjectStore.getState().currentProject
      if (!project) throw new Error(localize('error.noProject'))
      if (path.startsWith(VELA.DRAFT) || path.startsWith(VELA.MANUSCRIPT)) await saveDraftContent(path, text, project.path)
      else {
        const result = await ipc.invoke('fs:write-file', path, text)
        if (!result.success) throw new Error(result.error ?? localize('status.unknown'))
      }
    },
    refresh: () => globalEventBus.emit('REFRESH_RESOURCE', { resources: ['drafts'] }),
    start: startWorkflow,
    repairGuard: guardRepairPostProcess,
    merge: (chapter, path, revision, text, expectedContent) => mergeRendererRevision({ chapterNumber: chapter, draftPath: path, revisionPath: revision, content: text, expectedContent }),
    latestReview: getLatestReview,
    translate: async (prompt, system) => {
      const result = await useLLMStore.getState().generate([{ role: 'system', content: system }, { role: 'user', content: prompt }], undefined, { temperature: 0.3 })
      if (!result.success || !result.content) throw new Error(result.error || localize('status.unknown'))
      return result.content
    },
    nextVersion: getNextDraftVersion,
    createTranslation: async (chapterNumber, version, content) => {
      const result = await ipc.invoke('db:draft-create', { chapterNumber, version, content, source: 'translation', wordCount: computeTextStats(content).novelWordCount })
      if (!result.success || !result.id) throw new Error(result.error || localize('error.noBaseDraft'))
      return result.id
    },
  }, project ? { path: project.path, session } : null)
}
