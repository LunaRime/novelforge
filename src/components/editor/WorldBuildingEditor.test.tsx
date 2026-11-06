// @vitest-environment jsdom
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorldBuildingEditor from './WorldBuildingEditor'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useEditorStore } from '../../stores/editor-store'
import { globalEventBus } from '../../shared/event-bus'
import { registerWorkflowSource } from '../../services/workflows/workflow-source'

const h = vi.hoisted(() => ({ invoke: vi.fn(), start: vi.fn(), confirm: vi.fn(), error: vi.fn(), log: vi.fn(),
  dialog: {} as { isOpen: boolean; onConfirm(steps: string[], guidance: Record<string, string>): void },
}))
vi.mock('../../services/ipc-client', () => ({ ipc: { invoke: h.invoke } }))
vi.mock('../../services/workflows/start-workflow', () => ({ startWorkflow: h.start }))
vi.mock('../../services/render-logger', () => ({ renderLog: h.log }))
vi.mock('../../hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../stores/project-store', async () => {
  const { create } = await import('zustand')
  return { useProjectStore: create(() => ({ currentProject: { id: 'a', path: '/a', novelConfig: { genre: 'fantasy' } }, projectSession: 1 })) }
})
vi.mock('../../stores/character-store', async () => {
  const { create } = await import('zustand')
  return { useCharacterStore: create(() => ({ characters: [] })) }
})
vi.mock('../../stores/workflow-store', async () => {
  const { create } = await import('zustand')
  return { useWorkflowStore: create(() => ({ activeRuns: [] as unknown[], history: [] as unknown[] })) }
})
vi.mock('../ui/Toast', () => ({ toast: { error: h.error } }))
vi.mock('../ui/Confirm', () => ({ confirm: h.confirm }))
vi.mock('../panels/sidebar/SidebarShared', () => ({ renderIcon: () => null }))
vi.mock('../dialogs/ArchitectureConfirmDialog', () => ({ default: (props: typeof h.dialog) => { h.dialog = props; return null } }))

let host: HTMLDivElement, root: Root
const core = { premise: 'P'.repeat(80), charactersArch: 'C'.repeat(70), worldbuilding: 'W'.repeat(60), synopsis: '' }
let handler: (channel: string, ...args: unknown[]) => unknown
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
async function flush(work: () => void = () => {}) { await act(async () => { work(); await Promise.resolve() }) }
async function mount(strict = false) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await flush(() => root.render(strict ? <StrictMode><WorldBuildingEditor /></StrictMode> : <WorldBuildingEditor />))
}
function card(description: string) {
  const found = [...host.querySelectorAll<HTMLElement>('[title]')].find(node => node.title.endsWith(description))
  expect(found, description).toBeDefined(); return found!
}
async function click(title: string) {
  const button = host.querySelector<HTMLButtonElement>(`button[title="${title}"]`)
  expect(button, title).not.toBeNull(); await flush(() => button!.click())
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks(); h.confirm.mockResolvedValue(true)
  useProjectStore.setState({ currentProject: { id: 'a', path: '/a', novelConfig: { genre: 'fantasy' } } as never, projectSession: 1 })
  useWorkflowStore.setState({ activeRuns: [], history: [] }); useEditorStore.getState().clearTabs()
  handler = channel => {
    if (channel === 'db:project-core-get') return { ...core }
    if (channel === 'db:post-process-get-latest-run') return { id: 'post', allCriticalPassed: false }
    if (channel === 'db:character-get-all' || channel === 'db:post-process-get-steps') return []
    return { success: true }
  }
  h.invoke.mockImplementation((channel, ...args) => Promise.resolve().then(() => handler(channel, ...args)))
  h.start.mockImplementation(async request => {
    useWorkflowStore.setState({ activeRuns: [{ id: 'run-a', status: 'running', type: request.workflow === 'generate_architecture' ? 'architecture_generation' : 'post_process' } as never] })
    const state = useProjectStore.getState()
    registerWorkflowSource('run-a', { id: state.currentProject!.id, path: state.currentProject!.path, session: state.projectSession }, ['run-a'])
    return { runId: 'run-a', displayName: '', chapterTag: '' }
  })
})
afterEach(async () => { if (root) await flush(() => root.unmount()); host?.remove() })

describe('architecture overview application view', () => {
  it('a failed refresh preserves the last successful fields and exits loading with an error', async () => {
    await mount(true); const base = handler
    handler = channel => { if (channel === 'db:project-core-get') throw new Error('offline'); return base(channel) }
    await click('tip.refreshStatus')
    expect(card('arch.premiseFileDesc').textContent).toContain('80')
    expect(card('arch.premiseFileDesc').style.opacity).toBe('1')
    expect(host.textContent).toContain('common.loadFailed')
  })
  it('partial field failures preserve only their prior projection while other fields refresh', async () => {
    await mount(); const base = handler
    handler = channel => channel === 'db:project-core-get' ? { ...core, premise: 123, worldbuilding: 'N'.repeat(95) } : base(channel)
    await click('tip.refreshStatus')
    expect(card('arch.premiseFileDesc').textContent).toContain('80')
    expect(card('arch.worldBuildingFileDesc').textContent).toContain('95')
    expect(host.textContent).toContain('common.loadFailed')
  })
  it('does not erase known failed extraction status when its next read fails', async () => {
    await mount(); const before = card('arch.characterFileDesc').style.borderColor; const base = handler
    handler = channel => { if (channel === 'db:post-process-get-latest-run') throw new Error('post failure'); return base(channel) }
    await flush(() => globalEventBus.emit('ARCH_POSTPROCESS_UPDATED', {}))
    expect(card('arch.characterFileDesc').style.borderColor).toBe(before)
    expect(host.textContent).toContain('common.loadFailed')
  })
  it('reopened same-path session never publishes an old delayed load', async () => {
    const pending = deferred<typeof core>(); const base = handler
    handler = channel => channel === 'db:project-core-get' ? pending.promise : base(channel)
    await mount()
    handler = channel => channel === 'db:project-core-get' ? { ...core, premise: '' } : base(channel)
    await flush(() => useProjectStore.setState({ projectSession: 2 }))
    await flush(() => pending.resolve(core))
    expect(card('arch.premiseFileDesc').textContent).not.toContain('80')
  })
  it('new refresh wins against an older success and error', async () => {
    await mount(); const pending = deferred<typeof core>(); const base = handler
    handler = channel => channel === 'db:project-core-get' ? pending.promise : base(channel)
    await click('tip.refreshStatus')
    handler = channel => channel === 'db:project-core-get' ? { ...core, premise: 'N'.repeat(99) } : base(channel)
    await click('tip.refreshStatus')
    await flush(() => pending.reject(new Error('old refresh')))
    expect(card('arch.premiseFileDesc').textContent).toContain('99')
    expect(host.textContent).not.toContain('common.loadFailed')
  })
  it('opening an existing dirty architecture tab preserves unsaved content', async () => {
    const filePath = 'vela://core/premise'
    useEditorStore.getState().openFile({ id: filePath, filePath, type: 'arch-file', name: 'Premise', content: 'unsaved', dirty: true })
    await mount()
    const navigation = card('arch.premiseFileDesc').querySelector<HTMLButtonElement>('button[aria-label]')
    expect(navigation).not.toBeNull(); await flush(() => navigation!.click())
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'unsaved', dirty: true })
    expect(useEditorStore.getState().activeTabId).toBe(filePath)
  })
  it('failed character-count check cannot bypass overwrite confirmation and start extraction', async () => {
    await mount(); const base = handler
    handler = channel => { if (channel === 'db:character-get-all') throw new Error('lookup failed'); return base(channel) }
    await click('arch.charArchiveEmptyRetry')
    expect(h.start).not.toHaveBeenCalled(); expect(h.error).toHaveBeenCalledOnce()
  })
  it('extraction cancellation releases busy without requiring an unscoped event', async () => {
    await mount(); await click('arch.charArchiveEmptyRetry')
    expect(host.querySelector<HTMLButtonElement>('[title="arch.charArchiveEmptyRetry"]')?.disabled).toBe(true)
    await flush(() => useWorkflowStore.setState({ activeRuns: [], history: [{ id: 'run-a', status: 'failed' } as never] }))
    expect(host.querySelector<HTMLButtonElement>('[title="arch.charArchiveEmptyRetry"]')?.disabled).toBe(false)
  })
  it('generation dialog confirmation cannot start a workflow in a reopened project', async () => {
    await mount(); await click('tip.regenerateArch'); const staleConfirm = h.dialog.onConfirm
    await flush(() => useProjectStore.setState({ projectSession: 2 }))
    await flush(() => staleConfirm(['premise'], {}))
    expect(h.start).not.toHaveBeenCalled()
  })
  it('legacy unscoped postprocess hints cannot release a running extraction', async () => {
    await mount(); await click('arch.charArchiveEmptyRetry')
    await flush(() => globalEventBus.emit('ARCH_POSTPROCESS_UPDATED', {}))
    expect(host.querySelector<HTMLButtonElement>('[title="arch.charArchiveEmptyRetry"]')?.disabled).toBe(true)
    await flush(() => globalEventBus.emit('CHARACTER_EXTRACT_FAILED', { error: 'another task' }))
    expect(host.querySelector<HTMLButtonElement>('[title="arch.charArchiveEmptyRetry"]')?.disabled).toBe(true)
  })
  it('source change during extraction confirmation cannot start against the new project', async () => {
    await mount(); const base = handler; const confirmation = deferred<boolean>()
    handler = channel => channel === 'db:character-get-all' ? [{}] : base(channel)
    h.confirm.mockReturnValueOnce(confirmation.promise)
    await click('arch.charArchiveEmptyRetry')
    await flush(() => useProjectStore.setState({ projectSession: 2 }))
    await flush(() => confirmation.resolve(true))
    expect(h.start).not.toHaveBeenCalled(); expect(h.error).not.toHaveBeenCalled()
  })
  it('failed extraction startup releases busy so a retry is possible', async () => {
    await mount(); h.start.mockRejectedValueOnce(new Error('startup failed'))
    await click('arch.charArchiveEmptyRetry')
    expect(h.error).toHaveBeenCalledOnce()
    expect(host.querySelector<HTMLButtonElement>('[title="arch.charArchiveEmptyRetry"]')?.disabled).toBe(false)
    await click('arch.charArchiveEmptyRetry'); expect(h.start).toHaveBeenCalledTimes(2)
  })
})
