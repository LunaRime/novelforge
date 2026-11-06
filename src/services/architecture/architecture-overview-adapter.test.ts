import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as adapter from './architecture-adapter'
import { useEditorStore } from '../../stores/editor-store'
import type { DiffSession } from '../diff/hunk-model'

const { invoke, startWorkflow, scope } = vi.hoisted(() => ({ invoke: vi.fn(), startWorkflow: vi.fn(), scope: { currentProject: { id: 'a', path: '/a' }, projectSession: 1 } }))
vi.mock('../ipc-client', () => ({ ipc: { invoke } }))
vi.mock('../../stores/project-store', () => ({ useProjectStore: { getState: () => scope } }))
vi.mock('../workflows/start-workflow', () => ({ startWorkflow }))
beforeEach(() => { vi.clearAllMocks(); invoke.mockReset(); scope.projectSession = 1; useEditorStore.getState().clearTabs() })

const inlineSession = (): DiffSession => ({
  sessionId: 'architecture-inline', sourceKind: 'selection', baseDocSnapshot: 'inline base', hunks: [], decisions: {},
})

describe('architecture overview renderer composition', () => {
  it('reads one core row, isolates malformed fields and strictly reads only the latest run', async () => {
    invoke.mockResolvedValueOnce({ premise: 'p'.repeat(51), charactersArch: 123, worldbuilding: null }).mockResolvedValueOnce({ allCriticalPassed: false })
    const result = await adapter.createRendererArchitectureOverviewApplication().load()
    expect(result.fields.premise).toEqual({ status: 'ready', generated: true, wordCount: 51 })
    expect(result.fields.characters.status).toBe('failed')
    expect(result.fields.worldbuilding).toEqual({ status: 'ready', generated: false, wordCount: 0 })
    expect(result.fields.synopsis).toEqual({ status: 'ready', generated: false, wordCount: 0 })
    expect(result.postProcess).toEqual({ status: 'ready', allCriticalPassed: false })
    expect(invoke.mock.calls).toEqual([['db:project-core-get'], ['db:post-process-get-latest-run', 'unknown', 'arch_characters']])
  })
  it('distinguishes absent core row, core IO failure and postprocessing IO failure', async () => {
    invoke.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('post failed'))
    const app = adapter.createRendererArchitectureOverviewApplication()
    const result = await app.load()
    expect(Object.values(result.fields)).toEqual(Array(4).fill({ status: 'missing' }))
    expect(result.postProcess).toEqual({ status: 'failed', error: 'post failed' })
    invoke.mockRejectedValueOnce(new Error('db failed')).mockResolvedValueOnce(null)
    expect(Object.values((await app.load()).fields)).toEqual(Array(4).fill({ status: 'failed', error: 'db failed' }))
  })
  it('opens an existing dirty architecture tab without replacing its edits', async () => {
    useEditorStore.getState().openFile({ id: 'vela://core/premise', type: 'arch-file', name: 'Premise', filePath: 'vela://core/premise', content: 'original' })
    useEditorStore.getState().updateTabContent('vela://core/premise', 'unsaved')
    invoke.mockResolvedValueOnce({ premise: 'new DB' })
    await expect(adapter.createRendererArchitectureOverviewApplication().open('premise', 'Premise')).resolves.toMatchObject({ status: 'opened' })
    expect(useEditorStore.getState().tabs).toMatchObject([{ content: 'unsaved', dirty: true }])
  })
  it('activates dirty content even when the database is unavailable without issuing IO', async () => {
    const store = useEditorStore.getState()
    store.openFile({ id: 'existing', type: 'arch-file', name: 'Original name', filePath: 'vela://core/premise', content: 'original' })
    store.updateTabContent('existing', 'unsaved')
    store.openFile({ id: 'other', type: 'arch-file', name: 'Other', filePath: 'vela://core/synopsis', content: '' })
    invoke.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(adapter.createRendererArchitectureOverviewApplication().open('premise', 'New name')).resolves.toMatchObject({ status: 'opened', document: { id: 'existing', content: 'unsaved' } })
    expect(invoke).not.toHaveBeenCalled()
    expect(useEditorStore.getState().activeTabId).toBe('existing')
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'unsaved', name: 'Original name', dirty: true })
  })
  it('activates a clean inline session without replacing content or querying the database', async () => {
    const store = useEditorStore.getState()
    store.openFile({ id: 'existing', type: 'arch-file', name: 'Premise', filePath: 'vela://core/premise', content: 'inline base' })
    const session = inlineSession()
    store.beginInlineSession('existing', session)
    invoke.mockResolvedValueOnce({ premise: 'new database text' })
    await adapter.createRendererArchitectureOverviewApplication().open('premise', 'Premise')
    expect(invoke).not.toHaveBeenCalled()
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'inline base', inlineSession: session })
    expect(useEditorStore.getState().tabs[0].dirty).toBeFalsy()
  })
  it('preserves newer saved content when a protected local projection becomes clean before activation', async () => {
    const store = useEditorStore.getState()
    store.openFile({ id: 'existing', type: 'arch-file', name: 'Premise', filePath: 'vela://core/premise', content: 'original' })
    store.updateTabContent('existing', 'unsaved')
    const pending = adapter.createRendererArchitectureOverviewApplication().open('premise', 'Premise')
    store.syncTabContent('existing', 'newer saved content')
    store.markTabSaved('existing')
    await pending
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'newer saved content', dirty: false })
    expect(invoke).not.toHaveBeenCalled()
  })
  it('does not resurrect a protected local tab closed before activation', async () => {
    const store = useEditorStore.getState()
    store.openFile({ id: 'existing', type: 'arch-file', name: 'Premise', filePath: 'vela://core/premise', content: 'original' })
    store.updateTabContent('existing', 'unsaved')
    const pending = adapter.createRendererArchitectureOverviewApplication().open('premise', 'Premise')
    store.closeTab('existing')
    await expect(pending).rejects.toThrow()
    expect(useEditorStore.getState().tabs).toHaveLength(0)
    expect(invoke).not.toHaveBeenCalled()
  })
  it('rechecks an inline session established while the database read was pending', async () => {
    const store = useEditorStore.getState()
    store.openFile({ id: 'existing', type: 'arch-file', name: 'Premise', filePath: 'vela://core/premise', content: 'inline base' })
    let resolve!: (value: unknown) => void
    invoke.mockReturnValueOnce(new Promise(value => { resolve = value }))
    const pending = adapter.createRendererArchitectureOverviewApplication().open('premise', 'Premise')
    const session = inlineSession()
    store.beginInlineSession('existing', session)
    resolve({ premise: 'new database text' })
    await pending
    expect(useEditorStore.getState().activeTabId).toBe('existing')
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'inline base', inlineSession: session })
  })
  it('returns missing without opening an empty tab for an absent core row', async () => {
    invoke.mockResolvedValueOnce(null)
    await expect(adapter.createRendererArchitectureOverviewApplication().open('premise', 'Premise')).resolves.toEqual({ status: 'missing' })
    expect(useEditorStore.getState().tabs).toHaveLength(0)
  })
  it.each([{ row: 123 }, { row: [] }, { row: { premise: 123 } }])('does not open malformed core data $row', async ({ row }) => {
    invoke.mockResolvedValueOnce(row)
    await expect(adapter.createRendererArchitectureOverviewApplication().open('premise', 'Premise')).rejects.toThrow()
    expect(useEditorStore.getState().tabs).toHaveLength(0)
  })
  it.each(['dispose', 'session'] as const)('blocks pending open publication after %s', async change => {
    let resolve!: (value: unknown) => void
    invoke.mockReturnValueOnce(new Promise(value => { resolve = value }))
    const app = adapter.createRendererArchitectureOverviewApplication()
    const pending = app.open('premise', 'Premise')
    if (change === 'dispose') app.dispose()
    else scope.projectSession++
    resolve({ premise: 'old data' })
    await expect(pending).rejects.toThrow()
    expect(useEditorStore.getState().tabs).toHaveLength(0)
  })
  it('reuses document commands and disposes them with the overview', async () => {
    startWorkflow.mockResolvedValue({ runId: 'run', displayName: 'Architecture', chapterTag: '' })
    const app = adapter.createRendererArchitectureOverviewApplication()
    await expect(app.generate(['premise'], {})).resolves.toMatchObject({ runId: 'run' })
    invoke.mockResolvedValueOnce([{}]).mockResolvedValueOnce({ charactersArch: 'c'.repeat(50) })
    await expect(app.existingCharacterCount()).resolves.toBe(1)
    await expect(app.extract('fantasy')).resolves.toEqual({ status: 'started', runId: 'run' })
    app.dispose()
    await expect(app.generate(['premise'], {})).rejects.toThrow()
    await expect(app.load()).rejects.toThrow()
  })
})
