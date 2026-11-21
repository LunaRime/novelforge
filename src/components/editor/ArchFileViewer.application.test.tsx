// @vitest-environment jsdom
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ArchFileViewer from './ArchFileViewer'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { globalEventBus } from '../../shared/event-bus'
import { registerWorkflowSource } from '../../services/workflows/workflow-source'

const h = vi.hoisted(() => ({ invoke: vi.fn(), confirm: vi.fn(), success: vi.fn(), error: vi.fn(), log: vi.fn(),
  saved: vi.fn(), sync: vi.fn(), update: vi.fn(), start: vi.fn(),
  editor: {} as { content: string; onChange(s: string): void; onSave(s: string): void },
  dialog: {} as { isOpen: boolean; onConfirm(steps: string[], guidance: Record<string, string>): void },
}))
vi.mock('../../services/ipc-client', () => ({ ipc: { invoke: h.invoke } }))
vi.mock('../../services/workflows/start-workflow', () => ({ startWorkflow: h.start }))
vi.mock('../../stores/project-store', async () => {
  const { create } = await import('zustand')
  return { useProjectStore: create(() => ({ currentProject: { id: 'a', path: '/a', novelConfig: { genre: 'fantasy' } }, projectSession: 1 })) }
})
vi.mock('../../stores/editor-store', () => ({ useEditorStore: { getState: () => ({ updateTabContent: h.update, syncTabContent: h.sync, markTabSaved: h.saved }) } }))
vi.mock('../../stores/character-store', () => ({ useCharacterStore: (selector: (s: unknown) => unknown) => selector({ characters: [] }) }))
vi.mock('../../stores/workflow-store', async () => {
  const { create } = await import('zustand')
  return { useWorkflowStore: create(() => ({ isTypeRunning: () => false, activeRuns: [] as unknown[], history: [] as unknown[] })) }
})
vi.mock('../../services/workflows/architecture-workflow', () => ({ runArchCharacterExtract: vi.fn() }))
vi.mock('../../services/render-logger', () => ({ renderLog: h.log }))
vi.mock('../../hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../panels/sidebar/SidebarShared', () => ({ renderIcon: () => null }))
vi.mock('../ui/Confirm', () => ({ confirm: h.confirm }))
vi.mock('../ui/Toast', () => ({ toast: { success: h.success, error: h.error } }))
vi.mock('./CodeMirrorEditor', () => ({ default: (props: typeof h.editor) => { h.editor = props; return <div data-editor>{props.content}</div> } }))
vi.mock('../dialogs/ArchitectureConfirmDialog', () => ({ default: (props: typeof h.dialog) => { h.dialog = props; return null } }))

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
let root: Root, host: HTMLDivElement
const locator = 'vela://core/worldbuilding'
async function flush(work: () => void = () => {}) { await act(async () => { work(); await Promise.resolve() }) }
async function mount(content = 'original', strict = false, filePath = locator) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await flush(() => root.render(strict ? <StrictMode><ArchFileViewer filePath={filePath} content={content} /></StrictMode> : <ArchFileViewer filePath={filePath} content={content} />))
}
async function click(title: string) {
  const button = host.querySelector<HTMLButtonElement>(`button[title="${title}"]`)
  expect(button, title).not.toBeNull(); await flush(() => button!.click())
}
async function edit(content: string) { await flush(() => h.editor.onChange(content)) }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks(); h.confirm.mockResolvedValue(true)
  useWorkflowStore.setState({ activeRuns: [], history: [] })
  useProjectStore.setState({ currentProject: { id: 'a', path: '/a', novelConfig: { genre: 'fantasy' } } as never, projectSession: 1 })
  h.invoke.mockImplementation(async channel => channel === 'db:project-core-get' ? { worldbuilding: 'disk', charactersArch: 'C'.repeat(70) } : channel === 'db:character-get-all' ? [] : { success: true })
  h.start.mockImplementation(async request => {
    useWorkflowStore.setState({ activeRuns: [{ id: 'run-a', status: 'running', type: request.workflow === 'generate_architecture' ? 'architecture_generation' : 'post_process' } as never] })
    const state = useProjectStore.getState()
    registerWorkflowSource('run-a', { id: state.currentProject!.id, path: state.currentProject!.path, session: state.projectSession }, ['run-a'])
    return { runId: 'run-a', displayName: 'run', chapterTag: '' }
  })
})
afterEach(async () => { if (root) await flush(() => root.unmount()); host?.remove() })

describe('architecture document edit session', () => {
  it('saving an old snapshot preserves newer edits and the dirty tab', async () => {
    const pending = deferred<{ success: boolean }>(); h.invoke.mockReturnValueOnce(pending.promise)
    await mount(); await edit('saved snapshot'); await click('tip.saveShortcut'); await edit('new input')
    await flush(() => pending.resolve({ success: true }))
    expect(host.querySelector('[title="arch.unsavedChanges"]')).not.toBeNull()
    expect(h.saved).not.toHaveBeenCalled(); expect(h.update).toHaveBeenLastCalledWith(locator, 'new input')
    await click('tip.saveShortcut'); expect(h.invoke).toHaveBeenLastCalledWith('db:project-core-update', { worldbuilding: 'new input' })
  })
  it.each(['false', 'reject'])('failed write %s keeps dirty and reports failure', async mode => {
    if (mode === 'false') h.invoke.mockResolvedValueOnce({ success: false })
    else h.invoke.mockRejectedValueOnce(new Error('disk failure'))
    await mount(); await edit('unsaved'); await click('tip.saveShortcut')
    expect(host.querySelector('[title="arch.unsavedChanges"]')).not.toBeNull()
    expect(h.error).toHaveBeenCalledOnce(); expect(h.success).not.toHaveBeenCalled(); expect(h.saved).not.toHaveBeenCalled()
  })
  it('same-path reopen prevents an old save from marking the new tab saved', async () => {
    const pending = deferred<{ success: boolean }>(); h.invoke.mockReturnValueOnce(pending.promise)
    await mount(); await edit('old edit'); await click('tip.saveShortcut')
    await flush(() => useProjectStore.setState({ projectSession: 2 }))
    await flush(() => pending.resolve({ success: true }))
    expect(h.saved).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled(); expect(h.error).not.toHaveBeenCalled()
  })
  it('dirty reload is confirmed and cancellation performs no read', async () => {
    h.confirm.mockResolvedValue(false)
    await mount(); await edit('mine'); await click('arch.reloadFromDisk')
    expect(h.confirm).toHaveBeenCalledOnce(); expect(h.invoke).not.toHaveBeenCalled()
    expect(host.querySelector('[title="arch.unsavedChanges"]')).not.toBeNull()
  })
  it('reload does not discard input typed while its read was pending', async () => {
    const pending = deferred<{ worldbuilding: string }>(); h.invoke.mockReturnValueOnce(pending.promise)
    await mount(); await click('arch.reloadFromDisk'); await edit('typed while reading')
    await flush(() => pending.resolve({ worldbuilding: 'old disk value' }))
    expect(h.editor.content).not.toBe('old disk value')
    expect(host.querySelector('[title="arch.unsavedChanges"]')).not.toBeNull(); expect(h.saved).not.toHaveBeenCalled()
  })
  it('saving supersedes a pending reload without leaving the reload button stuck', async () => {
    const pending = deferred<{ worldbuilding: string }>(); h.invoke.mockReturnValueOnce(pending.promise)
    await mount(); await click('arch.reloadFromDisk'); await edit('newer'); await click('tip.saveShortcut')
    await flush(() => pending.resolve({ worldbuilding: 'obsolete disk' }))
    expect(host.querySelector<HTMLButtonElement>('[title="arch.reloadFromDisk"]')?.disabled).toBe(false)
    expect(h.editor.content).not.toBe('obsolete disk')
  })
  it('unmounted editor callbacks cannot dirty the reopened project tab', async () => {
    await mount(); const staleChange = h.editor.onChange
    await flush(() => useProjectStore.setState({ projectSession: 2 }))
    await flush(() => staleChange('old editor callback'))
    expect(h.update).not.toHaveBeenCalled(); expect(h.sync).not.toHaveBeenCalled()
  })
  it('read failure preserves content and resets reload loading', async () => {
    h.invoke.mockRejectedValueOnce(new Error('read failure'))
    await mount(); await click('arch.reloadFromDisk')
    expect(h.editor.content).toBe('original'); expect(h.error).toHaveBeenCalledOnce()
    expect(host.querySelector<HTMLButtonElement>('[title="arch.reloadFromDisk"]')?.disabled).toBe(false)
  })
  it('external content and automatic workflow refresh preserve dirty input', async () => {
    await mount(); await edit('mine')
    await flush(() => root.render(<ArchFileViewer filePath={locator} content="external update" />))
    expect(h.editor.content).not.toBe('external update')
    expect(host.querySelector('[title="arch.unsavedChanges"]')).not.toBeNull()
    await flush(() => globalEventBus.emit('WORKFLOW_COMPLETE', { type: 'architecture_generation', runId: 'other-run' }))
    expect(h.invoke).not.toHaveBeenCalled(); expect(h.confirm).not.toHaveBeenCalled()
  })
  it('does not start generation when the source changed while the dialog was open', async () => {
    await mount('X'.repeat(70), true)
    const generate = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('arch.aiRegenerate'))!
    await flush(() => generate.click()); expect(h.dialog.isOpen).toBe(true)
    const staleConfirm = h.dialog.onConfirm
    await flush(() => useProjectStore.setState({ projectSession: 2 }))
    await flush(() => staleConfirm(['worldbuilding'], {}))
    expect(h.start).not.toHaveBeenCalled()
  })
  it('failed role-count lookup does not bypass overwrite confirmation and extract', async () => {
    h.invoke.mockRejectedValueOnce(new Error('cannot check characters'))
    await mount('C'.repeat(70), false, 'vela://core/characters'); await click('arch.charExtractFailed')
    expect(h.start).not.toHaveBeenCalled(); expect(h.invoke).toHaveBeenCalledTimes(1); expect(h.error).toHaveBeenCalledOnce()
  })
  it('reloads only its own completed generation', async () => {
    await mount('X'.repeat(70))
    const generate = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('arch.aiRegenerate'))!
    await flush(() => generate.click()); await flush(() => h.dialog.onConfirm(['worldbuilding'], { worldbuilding: 'guidance' }))
    expect(h.start).toHaveBeenCalledWith({ workflow: 'generate_architecture', architecture: { selectedSteps: ['worldbuilding'], stepGuidance: { worldbuilding: 'guidance' } } })
    h.invoke.mockClear()
    await flush(() => globalEventBus.emit('WORKFLOW_COMPLETE', { type: 'architecture_generation', runId: 'unrelated' }))
    expect(h.invoke).not.toHaveBeenCalled()
    await flush(() => globalEventBus.emit('WORKFLOW_COMPLETE', { type: 'architecture_generation', runId: 'run-a', status: 'success' }))
    expect(h.editor.content).toBe('disk')
  })
  it('refreshes a same-session generation after switching away from the tab and returning', async () => {
    await mount('X'.repeat(70))
    const generate = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('arch.aiRegenerate'))!
    await flush(() => generate.click()); await flush(() => h.dialog.onConfirm(['worldbuilding'], {}))
    await flush(() => root.render(<div>another tab</div>))
    await flush(() => root.render(<ArchFileViewer filePath={locator} content="old tab content" />))
    h.invoke.mockClear()
    await flush(() => globalEventBus.emit('WORKFLOW_COMPLETE', { type: 'architecture_generation', runId: 'run-a', status: 'success' }))
    expect(h.editor.content).toBe('disk')
  })
  it('ignores a generation registered in an older same-path project session', async () => {
    registerWorkflowSource('old-session', { id: 'a', path: '/a', session: 0 }, ['old-session'])
    await mount()
    await flush(() => globalEventBus.emit('WORKFLOW_COMPLETE', { type: 'architecture_generation', runId: 'old-session', status: 'success' }))
    expect(h.invoke).not.toHaveBeenCalled(); expect(h.editor.content).toBe('original')
  })
  it('releases extraction only for its own run and handles startup rejection', async () => {
    await mount('C'.repeat(70), false, 'vela://core/characters'); await click('arch.charExtractFailed')
    expect(h.start).toHaveBeenCalledWith({ workflow: 'extract_arch_characters', projectPath: '/a', characterDynamicsContent: 'C'.repeat(70), genre: 'fantasy' })
    expect(host.querySelector<HTMLButtonElement>('[title="arch.charExtractFailed"]')?.disabled).toBe(true)
    await flush(() => globalEventBus.emit('WORKFLOW_COMPLETE', { type: 'post_process', runId: 'unrelated' }))
    expect(host.querySelector<HTMLButtonElement>('[title="arch.charExtractFailed"]')?.disabled).toBe(true)
    await flush(() => globalEventBus.emit('WORKFLOW_COMPLETE', { type: 'post_process', runId: 'run-a', status: 'failed' }))
    expect(host.querySelector<HTMLButtonElement>('[title="arch.charExtractFailed"]')?.disabled).toBe(false)
    h.start.mockRejectedValueOnce(new Error('startup failed'))
    await click('arch.charExtractFailed')
    expect(host.querySelector<HTMLButtonElement>('[title="arch.charExtractFailed"]')?.disabled).toBe(false)
    expect(h.error).toHaveBeenCalledTimes(2)
  })
  it('releases the extraction button when its run is cancelled without a completion event', async () => {
    await mount('C'.repeat(70), false, 'vela://core/characters'); await click('arch.charExtractFailed')
    expect(host.querySelector<HTMLButtonElement>('[title="arch.charExtractFailed"]')?.disabled).toBe(true)
    await flush(() => useWorkflowStore.setState({ activeRuns: [], history: [{ id: 'run-a', status: 'failed' } as never] }))
    expect(host.querySelector<HTMLButtonElement>('[title="arch.charExtractFailed"]')?.disabled).toBe(false)
  })
})
