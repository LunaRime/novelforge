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
vi.mock('./ThreeWayMerge', () => ({ default: () => null }))
vi.mock('./EditorToolbar', () => ({ default: () => null }))
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
