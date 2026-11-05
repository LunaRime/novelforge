import { beforeEach, describe, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({ project: { path: '/a' } as { path: string } | null, projectSession: 0, invoke: vi.fn() }))
vi.mock('./ipc-client', () => ({ ipc: { invoke: state.invoke } }))
vi.mock('../stores/project-store', () => ({ useProjectStore: { getState: () => ({ currentProject: state.project, projectSession: state.projectSession, refreshFileTree: vi.fn() }) } }))
import { getPendingRevisions, getLatestReview, getNextDraftVersion, saveDraftContent, updateDraftStatus } from './draft-index'
import { useDraftStore, readDraftBody } from '../stores/draft-store'
import { parseDraftMeta } from './workflows/chapter-workflow'
import { useEditorStore } from '../stores/editor-store'

beforeEach(() => {
  state.project = { path: '/a' }
  state.projectSession = 0
  state.invoke.mockReset()
  useDraftStore.getState().reset()
  useEditorStore.setState({ tabs: [], activeTabId: null })
})

describe('draft identity bridge', () => {
  test('metadata and cached draft lists contain identity without projected file fields', async () => {
    state.invoke.mockResolvedValue({ id: 42, chapterNumber: 7, version: 2, status: 'draft', source: 'write' })
    const meta = await parseDraftMeta('vela://draft/42')
    expect(meta).not.toHaveProperty('filePath')
    expect(meta).not.toHaveProperty('fileName')
    state.invoke.mockResolvedValue([meta])
    await useDraftStore.getState().loadChapterDrafts(7)
    expect(useDraftStore.getState().draftsByChapter[7][0]).not.toHaveProperty('filePath')
  })
  test.each(['body', 'meta'])('%s helper dispatches into the initiating project and rejects stale results', async kind => {
    let readProject: string | undefined
    state.invoke.mockImplementation(async () => { readProject = state.project?.path; return { id: 42, content: 'body' } })
    const pending = kind === 'body' ? readDraftBody('vela://draft/42') : parseDraftMeta('vela://draft/42')
    state.project = { path: '/b' }
    await expect(pending).rejects.toThrow()
    expect(readProject).toBe('/a')
  })
  test('invalid draft URI never falls back to file writing', async () => {
    await expect(saveDraftContent('vela://draft/ch7/v3', 'body', '/a')).rejects.toThrow()
    expect(state.invoke).not.toHaveBeenCalled()
  })
  test('save response after project switch is rejected before caller can mark a new tab saved', async () => {
    state.invoke.mockImplementation(async () => { state.project = { path: '/b' }; return { success: true } })
    await expect(saveDraftContent('vela://draft/42', 'body', '/a')).rejects.toThrow()
    expect(state.invoke).toHaveBeenCalledTimes(1)
  })
  test('same project identity after A-B-A switching still rejects the old session response', async () => {
    state.invoke.mockImplementation(async () => { ++state.projectSession; return { success: true } })
    await expect(saveDraftContent('vela://draft/42', 'body', '/a')).rejects.toThrow()
  })
  test('revision/review lookup uses the exact draft id even when branches share a version', async () => {
    state.invoke.mockImplementation(async (channel: string) => channel === 'db:review-get-latest' ? null : [])
    expect(await getPendingRevisions(42, 3)).toEqual([])
    expect(await getLatestReview(42, 3)).toBeNull()
    expect(state.invoke.mock.calls).toEqual([['db:revision-get-pending', 42], ['db:review-get-latest', 42]])
  })
  test('next version uses an explicit chapter number', async () => {
    state.invoke.mockResolvedValue(8)
    expect(await getNextDraftVersion(7)).toBe(8)
    expect(state.invoke).toHaveBeenCalledWith('db:draft-next-version', 7)
  })
  test('finalizing a draft archives only the same branch and never substitutes same-version identity', async () => {
    const target = { id: 42, chapterNumber: 7, version: 3, branchId: 2 }
    state.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db:draft-get-meta') return target
      if (channel === 'db:draft-list') return [target,
        { id: 43, version: 3, branchId: 8, status: 'draft' },
        { id: 44, version: 2, branchId: 2, status: 'draft' }]
      return { success: true }
    })
    await updateDraftStatus(42, 'finalized')
    expect(state.invoke).toHaveBeenCalledWith('db:draft-update-status', 42, 'finalized', undefined)
    expect(state.invoke).toHaveBeenCalledWith('db:draft-update-status', 44, 'archived')
    expect(state.invoke.mock.calls.some(([channel, id]) => channel === 'db:draft-update-status' && id === 43)).toBe(false)
  })
  test('successful merge persists and links exact revision id before clearing dirty state', async () => {
    useEditorStore.getState().openFile({ id: 'draft-42', name: 'draft', type: 'chapter', filePath: 'vela://draft/42', content: 'old', dirty: false })
    state.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db:draft-get-meta') return { id: 42, chapterNumber: 7 }
      if (channel === 'db:revision-get-full') return { id: 9, baseDraftId: 42, status: 'pending' }
      if (channel === 'db:draft-list') return []
      return { success: true }
    })
    expect(await useDraftStore.getState().applyMergedRevision(7, 'vela://draft/42', 'vela://revision/9', 'merged')).toEqual({ success: true })
    expect(state.invoke).toHaveBeenCalledWith('db:revision-mark-merged', 9, 42)
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'merged', dirty: false })
  })
  test.each(['already dirty', 'edited during IPC'])('merge preserves %s aliases of the same database draft', async mode => {
    useEditorStore.getState().openFile({ id: 'alias', name: 'alias', type: 'chapter', filePath: 'vela://manuscript/42', content: 'unsaved', dirty: mode === 'already dirty' })
    state.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db:draft-get-meta') return { id: 42, chapterNumber: 7 }
      if (channel === 'db:revision-get-full') return { id: 9, baseDraftId: 42, status: 'pending' }
      if (channel === 'db:draft-update-content' && mode === 'edited during IPC') useEditorStore.getState().updateTabContent('alias', 'new input')
      if (channel === 'db:draft-list') return []
      return { success: true }
    })
    expect((await useDraftStore.getState().applyMergedRevision(7, 'vela://draft/42', '9', 'merged')).success).toBe(true)
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: mode === 'already dirty' ? 'unsaved' : 'new input', dirty: true })
  })
  test('a failed content IPC preserves dirty state and does not mark revision merged', async () => {
    useEditorStore.getState().openFile({ id: 'draft-42', name: 'draft', type: 'chapter', filePath: 'vela://draft/42', content: 'old', dirty: true })
    state.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db:draft-get-meta') return { id: 42, chapterNumber: 7 }
      if (channel === 'db:revision-get-full') return { id: 9, baseDraftId: 42, status: 'pending' }
      if (channel === 'db:draft-update-content') return { success: false, error: 'write failed' }
      return { success: true }
    })
    const result = await useDraftStore.getState().applyMergedRevision(7, 'vela://draft/42', 'vela://revision/9', 'merged')
    expect(result.success).toBe(false)
    expect(state.invoke).toHaveBeenCalledWith('db:draft-update-content', 42, 'merged', expect.any(Number))
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'old', dirty: true })
    expect(state.invoke.mock.calls.some(([channel]) => channel === 'db:revision-mark-merged')).toBe(false)
  })
  test('project switch while reading merge context prevents all writes to the next project', async () => {
    state.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db:draft-get-meta') { state.project = { path: '/b' }; return { id: 42, chapterNumber: 7 } }
      return { success: true }
    })
    const result = await useDraftStore.getState().applyMergedRevision(7, 'vela://draft/42', '9', 'merged')
    expect(result.success).toBe(false)
    expect(state.invoke).toHaveBeenCalledWith('db:draft-get-meta', 42)
    expect(state.invoke.mock.calls.some(([channel]) => String(channel).includes('update') || channel === 'db:revision-mark-merged')).toBe(false)
  })
})
