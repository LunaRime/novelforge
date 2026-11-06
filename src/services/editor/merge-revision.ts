import type { RevisionMergeInput, RevisionMergeResult } from '../../core'
import { useEditorStore } from '../../stores/editor-store'
import { useDraftStore } from '../../stores/draft-store'
import { useProjectStore } from '../../stores/project-store'
import { draftIdFromPath } from '../draft-index'
import { ipc } from '../ipc-client'
import { VELA } from '../vela-protocol'
import { computeTextStats } from '../text-stats'
import { t } from '../../shared/locale'

export interface RendererRevisionMerge {
  chapterNumber?: number
  draftPath: string
  revisionPath: string
  content: string
  expectedContent: string | undefined
}
export type RendererRevisionMergeResult = RevisionMergeResult & { refreshError?: string }

/** Commit once; subsequent work updates disposable renderer projections only. */
export async function mergeRendererRevision(request: RendererRevisionMerge): Promise<RendererRevisionMergeResult> {
  const initial = useProjectStore.getState()
  const source = initial.currentProject ? { id: initial.currentProject.id, path: initial.currentProject.path, session: initial.projectSession } : null
  const isCurrent = () => {
    const current = useProjectStore.getState()
    return !!source && current.currentProject?.id === source.id && current.currentProject.path === source.path && current.projectSession === source.session
  }
  let input: RevisionMergeInput
  try {
    if (!source) throw new Error(t('error.noProject'))
    const revision = /^(?:vela:\/\/revision\/)?([1-9]\d*)$/.exec(request.revisionPath)
    const revisionId = revision ? Number(revision[1]) : NaN
    if (!Number.isSafeInteger(revisionId) || typeof request.expectedContent !== 'string') throw new Error(t('error.noBaseDraft'))
    input = { draftId: draftIdFromPath(request.draftPath), revisionId, chapterNumber: request.chapterNumber,
      content: request.content, expectedContent: request.expectedContent, wordCount: computeTextStats(request.content).novelWordCount,
      projectPath: source.path }
  } catch (error) { return { success: false, error: String(error) } }

  const submittedTabs = new Map(useEditorStore.getState().tabs.map(tab => [tab.id, tab]))
  let result: RevisionMergeResult
  try {
    if (!isCurrent()) return { success: false, error: t('error.noProject') }
    result = await ipc.invoke('db:revision-merge', input)
  } catch (error) { return { success: false, error: String(error) } }
  if (!result.success) {
    const invalid = ['draft-not-found', 'revision-not-found', 'revision-not-pending', 'revision-base-mismatch', 'chapter-mismatch', 'invalid-revision-merge']
    const mutationFailed = ['draft-status-update-failed', 'revision-mark-merged-failed', 'draft-write-failed']
    const error = result.conflict ? t('tool.draftConflict')
      : result.error === 'project-scope-changed' || result.error === 'project-db-not-connected' ? t('error.noProject')
        : result.error === 'draft-finalized-readonly' ? t('tool.draftReadonly')
          : invalid.includes(result.error ?? '') ? t('error.noBaseDraft')
            : mutationFailed.includes(result.error ?? '') ? t('save.failed').replace('{error}', t('status.unknown')) : result.error
    return { ...result, error }
  }
  // A successful DB commit stays successful even if its source view has disappeared.
  if (!isCurrent()) return { ...result, refreshError: t('error.noProject') }
  try {
    const editor = useEditorStore.getState()
    for (const tab of editor.tabs) {
      if (tab !== submittedTabs.get(tab.id) || tab.dirty || tab.inlineSession || tab.type === 'diff') continue
      if (tab.filePath === VELA.DRAFT + input.draftId || tab.filePath === VELA.MANUSCRIPT + input.draftId) {
        editor.syncTabContent(tab.id, input.content)
        editor.markTabSaved(tab.id)
      }
    }
    const chapter = result.chapterNumber ?? input.chapterNumber
    if (chapter !== undefined) await useDraftStore.getState().loadChapterDrafts(chapter)
    if (!isCurrent()) return { ...result, refreshError: t('error.noProject') }
    await useProjectStore.getState().refreshFileTree()
    if (!isCurrent()) return { ...result, refreshError: t('error.noProject') }
    return result
  } catch (error) { return { ...result, refreshError: String(error) } }
}
