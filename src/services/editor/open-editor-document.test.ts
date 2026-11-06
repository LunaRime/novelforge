import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openRendererEditorDocument } from './open-editor-document'
import { EditorOpenScopeChanged } from '../../core'
import { useEditorStore } from '../../stores/editor-store'

const { invoke, state } = vi.hoisted(() => ({
  invoke: vi.fn(),
  state: { currentProject: { id: 'a', path: '/a' } as { id: string; path: string } | null, projectSession: 1 },
}))
vi.mock('../ipc-client', () => ({ ipc: { invoke } }))
vi.mock('../../stores/project-store', () => ({ useProjectStore: { getState: () => state } }))

beforeEach(() => {
  invoke.mockReset()
  state.currentProject = { id: 'a', path: '/a' }
  state.projectSession = 1
  useEditorStore.getState().clearTabs()
})

describe('renderer document opening adapter', () => {
  it('stops before a second database read when the source project session changes', async () => {
    invoke.mockImplementation(async () => {
      state.projectSession++
      return { id: 7 }
    })
    await expect(openRendererEditorDocument({ kind: 'latest-draft', chapterNumber: 2 })).rejects.toBeInstanceOf(EditorOpenScopeChanged)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(useEditorStore.getState().tabs).toEqual([])
  })

  it('does not publish a late filesystem read into another project', async () => {
    invoke.mockImplementation(async () => {
      await Promise.resolve()
      state.currentProject = { id: 'b', path: '/b' }
      return { success: true, content: 'project a' }
    })
    await expect(openRendererEditorDocument({ kind: 'path', locator: '/a/ch.md', name: 'Chapter', documentKind: 'chapter' })).rejects.toBeInstanceOf(EditorOpenScopeChanged)
    expect(useEditorStore.getState().tabs).toEqual([])
  })

  it('rejects failed file reads instead of opening empty successful tabs', async () => {
    invoke.mockResolvedValue({ success: false, error: 'disk failed' })
    await expect(openRendererEditorDocument({ kind: 'path', locator: '/a/ch.md', name: 'Chapter', documentKind: 'chapter' })).rejects.toThrow('disk failed')
    expect(useEditorStore.getState().tabs).toEqual([])
  })

  it('only a missing latest draft is a missing outcome; missing full content is failure', async () => {
    invoke.mockResolvedValueOnce(null)
    expect(await openRendererEditorDocument({ kind: 'latest-draft', chapterNumber: 2 })).toEqual({ status: 'missing' })
    invoke.mockResolvedValueOnce({ id: 7 }).mockResolvedValueOnce(null)
    await expect(openRendererEditorDocument({ kind: 'latest-draft', chapterNumber: 2 })).rejects.toThrow()
    expect(useEditorStore.getState().tabs).toEqual([])
  })

  it('reopens a canonical draft without overwriting dirty text or inline state', async () => {
    useEditorStore.getState().openFile({ id: 'doc:7', docId: 7, filePath: 'vela://draft/7', type: 'chapter', name: 'Old', content: 'initial' })
    useEditorStore.getState().updateTabContent('doc:7', 'local unsaved')
    useEditorStore.getState().beginInlineSession('doc:7', { sessionId: 'inline', sourceKind: 'selection', baseDocSnapshot: 'initial', hunks: [], decisions: {} })
    const before = useEditorStore.getState().tabs[0]
    invoke.mockResolvedValueOnce({ id: 7 }).mockResolvedValueOnce({ content: 'database text' })
    await openRendererEditorDocument({ kind: 'latest-draft', chapterNumber: 2 })
    expect(useEditorStore.getState().tabs).toHaveLength(1)
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ id: 'doc:7', content: 'local unsaved', dirty: true, inlineSession: before.inlineSession })
  })

  it('architecture reopening also preserves unsaved text', async () => {
    useEditorStore.getState().openFile({ id: 'vela://core/premise', filePath: 'vela://core/premise', type: 'arch-file', name: 'Premise', content: 'old' })
    useEditorStore.getState().updateTabContent('vela://core/premise', 'local')
    invoke.mockResolvedValue({ premise: 'database' })
    await openRendererEditorDocument({ kind: 'path', locator: 'vela://core/premise', name: 'Premise', documentKind: 'arch-file' })
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'local', dirty: true })
  })

  it('keeps manuscript locators separate from editable draft identities', async () => {
    invoke.mockResolvedValue({ content: 'final' })
    await openRendererEditorDocument({ kind: 'path', locator: 'vela://manuscript/7', name: 'Final', documentKind: 'chapter' })
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ id: 'vela://manuscript/7', filePath: 'vela://manuscript/7' })
    expect(useEditorStore.getState().tabs[0].docId).toBeUndefined()
  })

  it('rejects project-scoped URI reads without an active project', async () => {
    state.currentProject = null
    await expect(openRendererEditorDocument({ kind: 'path', locator: 'vela://draft/7', name: 'Draft', documentKind: 'chapter' })).rejects.toThrow()
    expect(invoke).not.toHaveBeenCalled()
  })
})
