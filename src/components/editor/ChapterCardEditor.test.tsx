// @vitest-environment jsdom
import { StrictMode, act, type ComponentProps, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import ChapterCardEditor from './ChapterCardEditor'
import { useProjectStore } from '../../stores/project-store'

const h = vi.hoisted(() => ({ invoke: vi.fn(), confirm: vi.fn(), success: vi.fn(), error: vi.fn(), log: vi.fn(), tree: vi.fn(), volumes: vi.fn(), start: vi.fn(),
  inputs: {} as Record<string, ComponentProps<'input'>>,
}))
const translate = (key: string) => key
vi.mock('../../hooks/useTranslation', () => ({ useTranslation: () => ({ t: translate }) }))
vi.mock('../../services/ipc-client', () => ({ ipc: { invoke: h.invoke } }))
vi.mock('../../services/render-logger', () => ({ renderLog: h.log }))
vi.mock('../../stores/project-store', async () => {
  const { create } = await import('zustand')
  return { useProjectStore: create(() => ({ currentProject: { id: 'a', path: '/a', novelConfig: { totalChapters: 2 } }, projectSession: 1, refreshFileTree: h.tree })) }
})
vi.mock('../../stores/workflow-store', () => ({ useWorkflowStore: { getState: () => ({ addLog: h.log, activeRuns: [], history: [], isTypeRunning: () => false }) } }))
vi.mock('../../stores/volume-store', () => ({ useVolumeStore: (select: (s: unknown) => unknown) => select({ volumes: [], load: h.volumes }) }))
vi.mock('../../stores/layout-store', () => ({ useLayoutStore: { getState: () => ({ openChapterCreation: vi.fn() }) } }))
vi.mock('../../services/workflows/start-workflow', () => ({ startWorkflow: h.start }))
vi.mock('../../services/workflows/workflow-guards', () => ({ guardDirectoryGeneration: vi.fn() }))
vi.mock('../../services/blueprint-verification-service', () => ({ generateVerificationReport: vi.fn() }))
vi.mock('../dialogs/DirectoryConfigDialog', () => ({ default: () => null }))
vi.mock('./BlueprintSortBar', () => ({ default: () => null }))
vi.mock('../ui/Toast', () => ({ toast: { success: h.success, error: h.error, warning: vi.fn() } }))
vi.mock('../ui/Confirm', () => ({ confirm: h.confirm }))
vi.mock('../ui/Input', () => ({ Input: (props: ComponentProps<'input'>) => { h.inputs[props.placeholder ?? 'number'] = props; return <input {...props} /> } }))
vi.mock('../ui/Select', () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return { Select: Part, SelectTrigger: Part, SelectValue: Part, SelectContent: Part, SelectItem: Part }
})
const row = (chapterNumber: number, title: string) => ({ chapterNumber, title, role: '发展', purpose: '', keyEvents: '', characters: ['Hero'], suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: '', sortOrder: chapterNumber, priority: 0 })
let root: Root, host: HTMLDivElement
let handler: (channel: string, ...args: unknown[]) => unknown
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
async function flush(work: () => void = () => {}) { await act(async () => { work(); await Promise.resolve() }) }
async function mount(strict = false) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await flush(() => root.render(strict ? <StrictMode><ChapterCardEditor /></StrictMode> : <ChapterCardEditor />))
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === text || b.title === text)
  expect(button, text).toBeDefined(); await flush(() => button!.click())
}
async function edit(title: string) { await flush(() => h.inputs['chapter.placeholderTitle'].onChange!({ target: { value: title } } as never)) }
async function select(title: string) {
  const entry = [...host.querySelectorAll<HTMLElement>('.group')].find(e => e.textContent?.includes(title))
  expect(entry, title).toBeDefined(); await flush(() => entry!.click())
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks(); h.inputs = {}; h.tree.mockResolvedValue(undefined); h.volumes.mockResolvedValue(undefined); h.confirm.mockResolvedValue(true)
  useProjectStore.setState({ currentProject: { id: 'a', path: '/a', novelConfig: { totalChapters: 2 } } as never, projectSession: 1 })
  handler = channel => {
    if (channel === 'db:blueprint-get-all' || channel === 'db:blueprint-get-all-sorted') return [row(1, 'First'), row(2, 'Second')]
    if (channel === 'db:draft-get-max-finalized-chapter') return null
    return { success: true }
  }
  h.invoke.mockImplementation((channel, ...args) => Promise.resolve().then(() => handler(channel, ...args)))
})
afterEach(async () => { if (root) await flush(() => root.unmount()); host?.remove() })

describe('blueprint load/save application view', () => {
  it('initial read failure is not presented as an empty successful list', async () => {
    handler = () => { throw new Error('offline') }
    await mount(true)
    expect(host.textContent).toContain('common.loadFailed'); expect(host.textContent).not.toContain('blueprint.emptyHint')
  })
  it('saving a submitted row keeps edits typed while the write was pending dirty', async () => {
    await mount(); await edit('snapshot')
    const pending = deferred<{ success: boolean }>(); const base = handler
    handler = channel => channel === 'db:blueprint-upsert' ? pending.promise : base(channel)
    await click('chapter.save'); await edit('new input')
    await flush(() => pending.resolve({ success: true }))
    expect(h.inputs['chapter.placeholderTitle'].value).toBe('new input')
    expect(host.textContent).toContain('blueprint.unsaved')
  })
  it('saving only the selected row cannot clear another row dirty flag', async () => {
    await mount(); await edit('first edit'); await select('Second'); await edit('second edit'); await click('chapter.save')
    expect(host.textContent).toContain('blueprint.unsaved')
    await select('first edit'); expect(h.inputs['chapter.placeholderTitle'].value).toBe('first edit')
    await click('chapter.saveAll'); expect(host.textContent).not.toContain('blueprint.unsaved')
  })
  it('a false write leaves inputs and dirty state intact without success feedback', async () => {
    await mount(); await edit('unsaved'); const base = handler
    handler = channel => channel === 'db:blueprint-upsert' ? { success: false, error: 'denied' } : base(channel)
    await click('chapter.save')
    expect(h.success).not.toHaveBeenCalled(); expect(h.error).toHaveBeenCalledOnce(); expect(host.textContent).toContain('blueprint.unsaved')
  })
  it('tree refresh failure after a commit remains a save success and is reported separately', async () => {
    await mount(); await edit('saved'); h.tree.mockRejectedValueOnce(new Error('tree failure'))
    await click('chapter.save')
    expect(h.success).toHaveBeenCalledOnce(); expect(h.log).toHaveBeenCalledWith('error', 'Refresh:Blueprint', expect.stringContaining('tree failure'))
    expect(host.textContent).not.toContain('blueprint.unsaved')
  })
  it('same-path reopen blocks late save feedback and tree refresh', async () => {
    await mount(); await edit('old edit'); const pending = deferred<{ success: boolean }>(); const base = handler
    handler = channel => channel === 'db:blueprint-upsert' ? pending.promise : base(channel)
    await click('chapter.save'); await flush(() => useProjectStore.setState({ projectSession: 2 }))
    await flush(() => pending.resolve({ success: true }))
    expect(h.success).not.toHaveBeenCalled(); expect(h.tree).not.toHaveBeenCalled()
    expect(h.inputs['chapter.placeholderTitle'].value).toBe('First')
  })
  it('manual reload of dirty rows requires confirmation and preserves input on cancel', async () => {
    await mount(); await edit('keep me'); h.confirm.mockResolvedValueOnce(false); h.invoke.mockClear()
    await click('chapter.reload')
    expect(h.confirm).toHaveBeenCalledOnce(); expect(h.invoke).not.toHaveBeenCalled()
    expect(h.inputs['chapter.placeholderTitle'].value).toBe('keep me'); expect(host.textContent).toContain('blueprint.unsaved')
  })
  it('input entered during reload invalidates the incoming list', async () => {
    await mount(); const pending = deferred<ReturnType<typeof row>[]>(); const base = handler
    handler = channel => channel === 'db:blueprint-get-all' ? pending.promise : base(channel)
    await click('chapter.reload'); await edit('new while loading')
    await flush(() => pending.resolve([row(1, 'stale disk')]))
    expect(h.inputs['chapter.placeholderTitle'].value).toBe('new while loading'); expect(host.textContent).toContain('blueprint.unsaved')
  })
  it('pending deletion cannot leave a locally edited row that resurrects the deleted chapter', async () => {
    await mount(); const pending = deferred<{ success: boolean }>(); const base = handler
    handler = channel => channel === 'db:blueprint-delete' ? pending.promise : base(channel)
    await click('chapter.deleteChapter'); await edit('resurrection')
    await flush(() => pending.resolve({ success: true }))
    expect(host.textContent).not.toContain('resurrection')
    expect(h.inputs['chapter.placeholderTitle'].value).toBe('Second')
  })
  it('failed deletion preserves the selected dirty row', async () => {
    await mount(); await edit('keep selected'); const base = handler
    handler = channel => channel === 'db:blueprint-delete' ? { success: false, error: 'denied' } : base(channel)
    await click('chapter.deleteChapter')
    expect(h.inputs['chapter.placeholderTitle'].value).toBe('keep selected')
    expect(host.textContent).toContain('blueprint.unsaved')
  })
})
