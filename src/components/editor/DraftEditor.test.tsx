// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useEditorStore } from '../../stores/editor-store'
import DraftEditor from './DraftEditor'
const state = vi.hoisted(() => ({
  editor: {} as { onSave(text: string): Promise<void>; onChange(text: string): void },
  save: vi.fn(), success: vi.fn(), error: vi.fn(),
  application: {} as Record<string, unknown>,
  toolbar: {} as { onOpenRevision(revision: { id: number }): Promise<void> },
  mergeView: {} as { onComplete(text: string): Promise<void> },
}))
vi.mock('../../services/editor/draft-editor-adapter', () => ({
  createRendererDraftEditorApplication: () => state.application,
  getDraftFinalizeScope: () => 'scope',
}))
vi.mock('../../stores/project-store', () => ({ useProjectStore: (select: (value: unknown) => unknown) => select({ currentProject: { path: '/a' }, projectSession: 1 }) }))
vi.mock('../../stores/workflow-store', () => ({ useWorkflowStore: (select: (value: unknown) => unknown) => select({ activeRuns: [] }) }))
vi.mock('../../hooks/useAutoSave', () => ({ useAutoSave: () => {} }))
vi.mock('../../hooks/useDirtyCheck', () => ({ useDirtyCheck: () => true }))
vi.mock('../../services/render-logger', () => ({ renderLog: vi.fn() }))
vi.mock('../ui/Toast', () => ({ toast: { success: state.success, error: state.error } }))
vi.mock('./CodeMirrorEditor', () => ({ default: (props: typeof state.editor) => { state.editor = props; return null } }))
vi.mock('./ThreeWayMerge', () => ({ default: (props: typeof state.mergeView) => { state.mergeView = props; return null } }))
vi.mock('./EditorToolbar', () => ({ default: (props: typeof state.toolbar) => { state.toolbar = props; return null } }))
vi.mock('./AIActionDialog', () => ({ default: () => null, getReviewDims: () => [] }))
vi.mock('../ui/PostProcessStatusPanel', () => ({ PostProcessStatusPanel: () => null }))
beforeEach(() => {
  vi.clearAllMocks()
  state.application = { assertCurrent: vi.fn(), save: state.save, load: async () => ({ meta: { id: 7, chapterNumber: 2, version: 1, status: 'draft', createdAt: 1 }, pending: [], reviewCount: 0 }) }
  useEditorStore.setState({ tabs: [{ id: 'doc:7', docId: 7, type: 'chapter', name: 'Draft', filePath: 'vela://draft/7', content: 'submitted', dirty: true }], activeTabId: 'doc:7' })
})
async function mount() {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  await act(async () => { root.render(<DraftEditor tabId="doc:7" filePath="vela://draft/7" content="submitted" />) })
  return () => { act(() => root.unmount()); host.remove() }
}
describe('DraftEditor application boundary', () => {
  it('forwards the initial revision body to merge and retains the dialog on rejected commit', async () => {
    const revision = vi.fn(async () => ({ originalContent: 'initial base', modifiedContent: 'revision', revisionPath: 'vela://revision/9' }))
    const merge = vi.fn(async () => ({ success: false, error: 'conflict' }))
    state.application.revision = revision; state.application.merge = merge
    const cleanup = await mount()
    await act(async () => { await state.toolbar.onOpenRevision({ id: 9 }) })
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => { await state.mergeView.onComplete('merged') })
    expect(merge).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 'vela://draft/7', 'vela://revision/9', 'merged', 'initial base')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(state.success).not.toHaveBeenCalled()
    expect(state.error).toHaveBeenCalledOnce()
    expect(useEditorStore.getState().tabs[0].dirty).toBe(true)
    cleanup()
  })
  it('does not publish save success or clear a tab after the source session becomes stale', async () => {
    let resolve!: () => void
    state.save.mockImplementation(() => new Promise<void>(done => { resolve = done }))
    const cleanup = await mount()
    let pending!: Promise<void>
    act(() => { pending = state.editor.onSave('submitted') })
    vi.mocked(state.application.assertCurrent as () => void).mockImplementation(() => { throw new Error('changed') })
    await act(async () => { resolve(); await pending })
    expect(useEditorStore.getState().tabs[0].dirty).toBe(true)
    expect(state.success).not.toHaveBeenCalled()
    expect(state.error).toHaveBeenCalledOnce()
    cleanup()
  })
  it('does not clear newer input when an earlier save completes', async () => {
    let resolve!: () => void
    state.save.mockImplementation(() => new Promise<void>(done => { resolve = done }))
    const cleanup = await mount()
    let pending!: Promise<void>
    act(() => { pending = state.editor.onSave('submitted') })
    act(() => state.editor.onChange('new input'))
    await act(async () => { resolve(); await pending })
    expect(state.save).toHaveBeenCalledWith('vela://draft/7', 'submitted')
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'new input', dirty: true })
    expect(state.success).toHaveBeenCalledOnce()
    cleanup()
  })
  it('retains dirty state and shows failure when the application rejects saving', async () => {
    state.save.mockRejectedValue(new Error('disk full'))
    const cleanup = await mount()
    await act(async () => { await state.editor.onSave('submitted') })
    expect(useEditorStore.getState().tabs[0].dirty).toBe(true)
    expect(state.success).not.toHaveBeenCalled()
    expect(state.error).toHaveBeenCalledOnce()
    cleanup()
  })
})
