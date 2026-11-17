// @vitest-environment jsdom
import { StrictMode, act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import KnowledgeOverview from './KnowledgeOverview'
import { useProjectStore } from '../../stores/project-store'
import { globalEventBus } from '../../shared/event-bus'

const h = vi.hoisted(() => ({ invoke: vi.fn(), success: vi.fn(), error: vi.fn(), log: vi.fn(),
  inputs: {} as Record<string, ComponentProps<'input'>>,
  exported: undefined as undefined | { open: boolean; chapterNumbers: number[]; chapterTitles: Record<number, string> },
}))
vi.mock('../../services/ipc-client', () => ({ ipc: { invoke: h.invoke } }))
vi.mock('../../stores/project-store', async () => {
  const { create } = await import('zustand')
  return { useProjectStore: create(() => ({ currentProject: { id: 'a', path: '/a' }, projectSession: 1 })) }
})
vi.mock('../../stores/llm-store', () => ({ useLLMStore: { getState: () => ({}) } }))
vi.mock('../../hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../services/render-logger', () => ({ renderLog: h.log }))
vi.mock('../ui/Toast', () => ({ toast: { success: h.success, error: h.error } }))
vi.mock('../ui/Input', () => ({ Input: (props: ComponentProps<'input'>) => {
  h.inputs[props.type === 'number' ? 'topK' : 'query'] = props
  return <input {...props} />
} }))
vi.mock('../dialogs/ChapterExportDialog', () => ({ default: (props: NonNullable<typeof h.exported>) => { h.exported = props; return null } }))

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
let host: HTMLDivElement, root: Root
let handler: (channel: string, ...args: unknown[]) => unknown
const doc = { id: 'd', fileName: 'chapter_1.md', filePath: '/a/chapter_1.md', chunkCount: 1, importedAt: '' }
async function flush(work: () => void = () => {}) { await act(async () => { work(); await Promise.resolve() }) }
async function mount(strict = false) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await flush(() => root.render(strict ? <StrictMode><KnowledgeOverview /></StrictMode> : <KnowledgeOverview />))
}
async function click(key: string) {
  const button = [...host.querySelectorAll('button')].find(button => button.textContent?.includes(key))
  expect(button, key).toBeDefined(); await flush(() => button!.click())
}
async function input(value: string) {
  await flush(() => h.inputs.query.onChange!({ target: { value } } as never))
}
async function search(value: string) { await input(value); await flush(() => h.inputs.query.onKeyDown!({ key: 'Enter' } as never)) }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks(); h.exported = undefined; h.inputs = {}
  useProjectStore.setState({ currentProject: { id: 'a', path: '/a' } as never, projectSession: 1 })
  handler = channel => {
    if (channel === 'kb:list-documents') return [doc]
    if (channel === 'kb:stats') return { documentCount: 1, totalChunks: 1, vectorDimension: 0 }
    if (channel === 'kb:get-vectorless-count') return { count: 2 }
    if (channel === 'kb:search') return []
    if (channel === 'db:blueprint-get') return { title: 'Chapter title' }
    return { success: true, processed: 1, failed: 0 }
  }
  h.invoke.mockImplementation((channel, ...args) => Promise.resolve(handler(channel, ...args)))
})
afterEach(async () => { if (root) await flush(() => root.unmount()); host?.remove() })

describe('knowledge overview application', () => {
  it.each(['edited', ''])('editing input to %j invalidates a pending search', async value => {
    const pending = deferred<unknown[]>()
    const base = handler; handler = channel => channel === 'kb:search' ? pending.promise : base(channel)
    await mount(true); await search('old'); await input(value)
    await flush(() => pending.resolve([{ text: 'STALE RESULT', fileName: 'old', score: 1 }]))
    expect(host.textContent).not.toContain('STALE RESULT')
  })
  it('new refresh results survive a late older load failure', async () => {
    await mount(); const old = deferred<unknown[]>(); const latest = deferred<unknown[]>()
    const base = handler; let count = 0
    handler = channel => channel === 'kb:list-documents' ? (++count === 1 ? old.promise : latest.promise) : base(channel)
    await flush(() => globalEventBus.emit('REFRESH_RESOURCE', { resources: ['all'] }))
    await flush(() => globalEventBus.emit('FINALIZE_COMPLETE', {} as never))
    await flush(() => latest.resolve([doc]))
    await flush(() => old.reject(new Error('obsolete load failure')))
    expect(host.textContent).not.toContain('common.loadFailed')
    expect(h.log).not.toHaveBeenCalled()
  })
  it('keeps local token maintenance reachable with complete vectors and constrains topK', async () => {
    const base = handler; handler = channel => channel === 'kb:get-vectorless-count' ? { count: 0 } : base(channel)
    await mount(); await click('knowledge.tokenBackfill')
    expect(h.success).toHaveBeenCalledWith('knowledge.tokenBackfillSuccess')
    expect(host.textContent).not.toContain('knowledge.rebuildBtn')
    await flush(() => h.inputs.topK.onChange!({ target: { value: '100' } } as never))
    await search('query'); expect(h.invoke).toHaveBeenCalledWith('kb:search', 'query', 50)
    await flush(() => h.inputs.topK.onChange!({ target: { value: '-5' } } as never))
    await search('query'); expect(h.invoke).toHaveBeenCalledWith('kb:search', 'query', 1)
  })
  it('late old rejection cannot end the latest loading or report an error', async () => {
    const old = deferred<unknown[]>(), latest = deferred<unknown[]>()
    const base = handler; let count = 0
    handler = channel => channel === 'kb:search' ? (++count === 1 ? old.promise : latest.promise) : base(channel)
    await mount(); await search('old'); await search('new')
    await flush(() => old.reject(new Error('old failure')))
    expect([...host.querySelectorAll('button')].find(b => b.textContent?.includes('knowledge.searchBtn'))?.disabled).toBe(true)
    await flush(() => latest.resolve([{ text: 'LATEST RESULT', fileName: 'new', score: 1 }]))
    expect(host.textContent).toContain('LATEST RESULT'); expect(h.error).not.toHaveBeenCalled()
  })
  it('same-path reopen resets old results and drops late maintenance effects', async () => {
    const pending = deferred<{ success: boolean; processed: number; failed: number }>()
    const base = handler; handler = channel => channel === 'kb:backfill-vectors' ? pending.promise : base(channel)
    await mount(); await click('knowledge.rebuildBtn')
    const event = vi.spyOn(globalEventBus, 'emit')
    await flush(() => useProjectStore.setState({ projectSession: 2 }))
    await flush(() => pending.resolve({ success: true, processed: 2, failed: 0 }))
    expect(event).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled(); expect(h.error).not.toHaveBeenCalled()
    event.mockRestore()
  })
  it('serializes conflicting maintenance and releases the buttons after a failure', async () => {
    const pending = deferred<never>(); const base = handler
    handler = channel => channel === 'kb:backfill-vectors' ? pending.promise : base(channel)
    await mount(); await click('knowledge.rebuildBtn')
    expect([...host.querySelectorAll('button')].find(b => b.textContent?.includes('knowledge.tokenBackfill'))?.disabled).toBe(true)
    await flush(() => pending.reject(new Error('write failed')))
    expect(h.error).toHaveBeenCalledOnce()
    expect([...host.querySelectorAll('button')].find(b => b.textContent?.includes('knowledge.tokenBackfill'))?.disabled).toBe(false)
  })
  it('keeps committed maintenance successful when statistics refresh fails', async () => {
    await mount(); const base = handler
    handler = channel => { if (channel === 'kb:get-vectorless-count') throw new Error('refresh failed'); return base(channel) }
    await click('knowledge.rebuildBtn')
    expect(h.success).toHaveBeenCalledOnce(); expect(h.log).toHaveBeenCalledWith('error', 'Refresh:Knowledge', expect.stringContaining('refresh failed'))
  })
  it('does not publish export metadata after changing project during title reads', async () => {
    const pending = deferred<{ title: string }>(); const base = handler
    handler = channel => channel === 'db:blueprint-get' ? pending.promise : base(channel)
    await mount(); await click('action.export')
    await flush(() => useProjectStore.setState({ projectSession: 2 }))
    await flush(() => pending.resolve({ title: 'OLD TITLE' }))
    expect(h.exported?.open).toBe(false)
  })
  it('preserves partial success feedback and never retries a dimension mismatch', async () => {
    await mount(); const base = handler
    handler = channel => channel === 'kb:backfill-vectors' ? { success: true, processed: 1, failed: 2 } : base(channel)
    await click('knowledge.rebuildBtn'); expect(h.success).toHaveBeenCalledWith('knowledge.rebuildPartialSuccess')
    h.invoke.mockClear()
    handler = channel => channel === 'kb:backfill-vectors' ? { success: false, processed: 0, failed: 2, errorCode: 'dim-mismatch', error: 'rebuild required' } : base(channel)
    await click('knowledge.rebuildBtn'); expect(h.error).toHaveBeenCalledWith('rebuild required')
    expect(h.invoke.mock.calls.filter(([channel]) => channel === 'kb:backfill-vectors')).toHaveLength(1)
    expect(h.invoke.mock.calls.some(([channel]) => channel === 'kb:backfill-tokens')).toBe(false)
  })
})
