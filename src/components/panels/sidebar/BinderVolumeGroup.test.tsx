// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import BinderVolumeGroup from './BinderVolumeGroup'
import { useProjectStore } from '../../../stores/project-store'
import { globalEventBus } from '../../../shared/event-bus'

const h = vi.hoisted(() => ({ invoke: vi.fn(), load: vi.fn(), success: vi.fn(), error: vi.fn(), log: vi.fn(), props: {} as Record<string, unknown> }))
vi.mock('../../../services/ipc-client', () => ({ ipc: { invoke: h.invoke } }))
vi.mock('../../../services/render-logger', () => ({ renderLog: h.log }))
vi.mock('../../../stores/project-store', async () => {
  const { create } = await import('zustand')
  return { useProjectStore: create(() => ({ currentProject: { id: 'a', path: '/a' }, projectSession: 1 })) }
})
vi.mock('../../../stores/volume-store', () => ({ useVolumeStore: { getState: () => ({ load: h.load, volumes: [{ volumeNumber: 1, chapterStart: 1, chapterEnd: 4 }, { volumeNumber: 2, chapterStart: 1, chapterEnd: 4 }] }) } }))
vi.mock('../../ui/Toast', () => ({ toast: { success: h.success, error: h.error } }))
vi.mock('./VolumeGroup', () => ({ default: (props: Record<string, unknown>) => { h.props = props; return <div>volumes</div> } }))
let host: HTMLDivElement, root: Root
const row = (chapterNumber: number, volumeNumber: number | null, sortOrder: number) => ({ chapterNumber, title: `Ch${chapterNumber}`, volumeNumber, sortOrder })
const drafts = { 1: [{ status: 'finalized' }], 2: [{ status: 'draft' }], 3: [{ status: 'draft' }], 4: [{ status: 'finalized' }] }
const volume = (volumeNumber: number) => ({ volumeNumber, chapterStart: 1, chapterEnd: 4 })
type Chapter = { chapterNumber: number; hasFinalized: boolean; chapterTitle?: string }
const chapters = (n: number) => (h.props.chaptersForVolume as (v: unknown) => Chapter[])(volume(n))
const reorder = () => (h.props.onReorderChapter as (n: number, v: number, i?: number) => Promise<void>)(1, 2, 0)
async function flush(work: () => void = () => {}) { await act(async () => { work(); await Promise.resolve() }) }
async function mount(strict = false) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  const view = <BinderVolumeGroup projectPath="/a" totalChapters={4} draftsByChapter={drafts} onOpenDraft={vi.fn()} />
  await flush(() => root.render(strict ? <StrictMode>{view}</StrictMode> : view))
}
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  useProjectStore.setState({ currentProject: { id: 'a', path: '/a' }, projectSession: 1 } as never)
  h.load.mockResolvedValue(true)
  h.invoke.mockImplementation(async (channel: string) => channel === 'db:blueprint-get-all' ? [row(1, 2, 20), row(2, 2, 10), row(3, null, 30)] : { success: true })
})
afterEach(async () => { if (root) await flush(() => root.unmount()); host?.remove() })
it('uses explicit membership and custom order, preserving legacy draft-only range fallback', async () => {
  await mount(true)
  expect(chapters(2).map(c => c.chapterNumber)).toEqual([2, 1, 4])
  expect(chapters(1).map(c => c.chapterNumber)).toEqual([4])
  expect(chapters(2).find(c => c.chapterNumber === 1)).toMatchObject({ chapterTitle: 'Ch1', hasFinalized: true })
})
it('keeps projection and offers retry when blueprint reload after a character merge fails', async () => {
  await mount(); h.invoke.mockRejectedValueOnce(new Error('read'))
  await flush(() => globalEventBus.emit('REFRESH_RESOURCE', {
    resources: ['blueprints'], characterMerge: { sourceName: 'Old', targetName: 'Hero' },
  }))
  expect(chapters(2).map(c => c.chapterNumber)).toEqual([2, 1, 4])
  expect(host.querySelector('[role="alert"]')).toBeTruthy()
  expect(h.log).toHaveBeenCalledWith('error', 'Refresh:Blueprint', expect.stringContaining('read'))
  expect(h.props.onReorderChapter).toBeUndefined()
  await flush(() => host.querySelector('button')!.click())
  expect(host.querySelector('[role="alert"]')).toBeNull()
})
it('does not offer reorder after first read failure', async () => {
  h.invoke.mockRejectedValueOnce(new Error('read')); await mount()
  expect(h.props.onReorderChapter).toBeUndefined()
  expect(host.querySelector('[role="alert"]')).toBeTruthy()
})
it('reports rejected writes without success or refresh', async () => {
  await mount(); h.invoke.mockResolvedValueOnce({ success: false, error: 'disk' })
  await flush(() => { void reorder() })
  expect(h.error).toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled(); expect(h.load).not.toHaveBeenCalled()
  expect(chapters(2).map(c => c.chapterNumber)).toEqual([2, 1, 4])
})
it('serializes callbacks and reloads committed membership before success feedback', async () => {
  await mount(); const pending = deferred<{ success: boolean }>(); h.invoke.mockReturnValueOnce(pending.promise)
  const callback = h.props.onReorderChapter as (n: number, v: number, i?: number) => Promise<void>
  await flush(() => { void callback(1, 2, 0); void callback(1, 2, 0) })
  expect(h.invoke.mock.calls.filter(([c]) => c === 'db:binder-reorder')).toHaveLength(1)
  h.invoke.mockResolvedValue([row(1, 2, 10), row(2, 2, 20)])
  await flush(() => pending.resolve({ success: true }))
  expect(h.load).toHaveBeenCalledTimes(1); expect(h.success).toHaveBeenCalledTimes(1)
  expect(h.error).not.toHaveBeenCalled()
  expect(chapters(2).slice(0, 2).map(c => c.chapterNumber)).toEqual([1, 2])
})
it('suppresses old-session refresh and notifications after reopening same path', async () => {
  await mount(); const pending = deferred<{ success: boolean }>(); h.invoke.mockReturnValueOnce(pending.promise)
  await flush(() => { void reorder() })
  await flush(() => useProjectStore.setState({ projectSession: 2 }))
  await flush(() => pending.resolve({ success: true }))
  expect(h.load).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled(); expect(h.error).not.toHaveBeenCalled()
})
it('separates refresh failure from a committed write', async () => {
  await mount(); h.load.mockRejectedValueOnce(new Error('volumes'))
  await flush(() => { void reorder() })
  expect(h.success).toHaveBeenCalledTimes(1); expect(h.error).toHaveBeenCalledTimes(1)
  expect(h.log).toHaveBeenCalledWith('error', 'Refresh:Blueprint', expect.any(String))
})
it('translates visible drop indexes across hidden blueprint-only members', async () => {
  h.invoke.mockResolvedValueOnce([row(5, 2, 10), row(1, 2, 20), row(2, 2, 30)])
  await mount()
  const callback = h.props.onReorderChapter as (n: number, v: number, i?: number) => Promise<void>
  await flush(() => { void callback(1, 2, 1) })
  expect(h.invoke).toHaveBeenCalledWith('db:binder-reorder', { chapterNumber: 1, toVolumeNumber: 2, targetIndex: 2 })
})
