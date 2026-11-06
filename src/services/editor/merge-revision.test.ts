import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mergeRendererRevision } from './merge-revision'
import { useEditorStore } from '../../stores/editor-store'
import { useDraftStore } from '../../stores/draft-store'
import { t } from '../../shared/locale'

const { invoke, reload, refresh, state } = vi.hoisted(() => ({
  invoke: vi.fn(), reload: vi.fn(), refresh: vi.fn(),
  state: { currentProject: { id: 'a', path: '/a' } as { id: string; path: string } | null, projectSession: 1 },
}))
vi.mock('../ipc-client', () => ({ ipc: { invoke } }))
vi.mock('../../stores/project-store', () => ({ useProjectStore: { getState: () => ({ ...state, refreshFileTree: refresh }) } }))
const input = { chapterNumber: 7, draftPath: 'vela://draft/42', revisionPath: 'vela://revision/9', content: 'merged', expectedContent: 'original' }
beforeEach(() => {
  vi.clearAllMocks(); invoke.mockResolvedValue({ success: true, chapterNumber: 7 })
  reload.mockResolvedValue(undefined); refresh.mockResolvedValue(undefined)
  state.currentProject = { id: 'a', path: '/a' }; state.projectSession = 1
  useEditorStore.getState().clearTabs()
  useDraftStore.setState({ loadChapterDrafts: reload })
})
function open(content = 'original', dirty = false) {
  useEditorStore.getState().openFile({ id: 'doc:42', docId: 42, type: 'chapter', name: 'Draft', filePath: input.draftPath, content, dirty })
}
describe('renderer revision merge', () => {
  it('sends the initial merge source in one atomic IPC and syncs a clean unchanged tab', async () => {
    open()
    expect(await mergeRendererRevision(input)).toMatchObject({ success: true })
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('db:revision-merge', expect.objectContaining({
      draftId: 42, revisionId: 9, chapterNumber: 7, content: 'merged', expectedContent: 'original', projectPath: '/a',
    }))
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'merged', dirty: false })
    expect(reload).toHaveBeenCalledWith(7); expect(refresh).toHaveBeenCalledOnce()
  })
  it.each([undefined, 3])('rejects missing or invalid merge base %s before any IPC', async expectedContent => {
    const result = await mergeRendererRevision({ ...input, expectedContent: expectedContent as string | undefined })
    expect(result.success).toBe(false); expect(invoke).not.toHaveBeenCalled()
  })
  it('accepts a legitimately empty initial body as the expected base', async () => {
    expect((await mergeRendererRevision({ ...input, expectedContent: '' })).success).toBe(true)
    expect(invoke).toHaveBeenCalledWith('db:revision-merge', expect.objectContaining({ expectedContent: '' }))
  })
  it('does not update projections or clear dirty state on failed commit', async () => {
    open('unsaved', true); invoke.mockResolvedValue({ success: false, error: 'write failed' })
    expect((await mergeRendererRevision(input)).success).toBe(false)
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'unsaved', dirty: true })
    expect(reload).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled()
  })
  it.each(['draft-not-found', 'revision-not-pending', 'invalid-revision-merge'])('localizes rejected identity %s', async error => {
    invoke.mockResolvedValue({ success: false, error })
    expect(await mergeRendererRevision(input)).toMatchObject({ success: false, error: t('error.noBaseDraft') })
  })
  it('localizes stale content conflicts and keeps the merge pending in UI', async () => {
    open('newer', true)
    invoke.mockResolvedValue({ success: false, conflict: true, error: 'draft-content-conflict' })
    expect(await mergeRendererRevision(input)).toMatchObject({ success: false, conflict: true, error: t('tool.draftConflict') })
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'newer', dirty: true })
    expect(reload).not.toHaveBeenCalled()
  })
  it.each(['dirty', 'edited during IPC', 'inline', 'closed and reopened'])('preserves %s tabs', async mode => {
    open('original', mode === 'dirty')
    if (mode === 'inline') useEditorStore.getState().beginInlineSession('doc:42', { sessionId: 's', sourceKind: 'selection', baseDocSnapshot: 'original', hunks: [], decisions: {} })
    invoke.mockImplementation(async () => {
      if (mode === 'edited during IPC') useEditorStore.getState().updateTabContent('doc:42', 'new input')
      if (mode === 'closed and reopened') { useEditorStore.getState().closeTab('doc:42'); open() }
      return { success: true, chapterNumber: 7 }
    })
    expect((await mergeRendererRevision(input)).success).toBe(true)
    expect(useEditorStore.getState().tabs[0].content).toBe(mode === 'edited during IPC' ? 'new input' : 'original')
  })
  it.each(['different project', 'same path reopened'])('does not publish after switching to %s during commit', async mode => {
    open()
    invoke.mockImplementation(async () => {
      if (mode === 'different project') state.currentProject = { id: 'b', path: '/b' }
      state.projectSession++
      return { success: true, chapterNumber: 7 }
    })
    expect((await mergeRendererRevision(input)).success).toBe(true)
    expect(useEditorStore.getState().tabs[0].content).toBe('original')
    expect(reload).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled()
  })
  it('keeps committed success when refreshing the projection fails', async () => {
    reload.mockRejectedValue(new Error('reload failed'))
    expect(await mergeRendererRevision(input)).toMatchObject({ success: true, refreshError: expect.stringContaining('reload failed') })
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})
