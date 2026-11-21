import { captureDraftProject, draftIdFromPath } from '../../services/draft-index'
import { ipc } from '../../services/ipc-client'
import { renderLog } from '../../services/render-logger'
import { VELA } from '../../services/vela-protocol'
import { t } from '../../shared/locale'
import { useDraftStore } from '../../stores/draft-store'
import { useEditorStore } from '../../stores/editor-store'
import { useProjectStore } from '../../stores/project-store'
import { toast } from '../ui/Toast'

/** 两个正式稿入口共用格式保存，按同一正文身份同步已打开的别名。 */
export async function saveFinalizedUnderline(filePath: string, projectSession: number, expectedContent: string, content: string): Promise<boolean> {
  const started = Date.now()
  try {
    const state = useProjectStore.getState()
    const project = state.currentProject
    if (!project || state.loading || state.projectSession !== projectSession) throw new Error(t('error.requestCancelled'))
    const assertProject = captureDraftProject(project.path)
    const draftId = draftIdFromPath(filePath)
    const result = await ipc.invoke('db:draft-format-underline', { projectPath: project.path, writeToken: project.writeToken,
      draftId, expectedContent, content })
    assertProject()
    if (!result.success) {
      renderLog('error', 'Save:Draft', `Underline ${draftId}: ${result.error ?? 'conflict'}`)
      toast.error(t('save.failed').replace('{error}', () => t(result.conflict ? 'editor.underlineConflict' : 'status.unknown')))
      return false
    }

    const editor = useEditorStore.getState()
    for (const tab of editor.tabs) {
      if (!tab.dirty && tab.content === expectedContent &&
          (tab.docId === draftId || tab.filePath === `${VELA.DRAFT}${draftId}` || tab.filePath === `${VELA.MANUSCRIPT}${draftId}`)) {
        editor.syncTabContent(tab.id, content)
      }
    }
    void useDraftStore.getState().loadChapterDrafts(result.chapterNumber)
    renderLog('info', 'Save:Draft', `Underline ${draftId} (${Date.now() - started}ms)`)
    toast.success(t('save.success'))
    return true
  } catch (error) {
    renderLog('error', 'Save:Draft', String(error))
    toast.error(t('save.failed').replace('{error}', () => t('status.unknown')))
    return false
  }
}
