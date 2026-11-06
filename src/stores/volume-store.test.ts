import { beforeEach, expect, it, vi } from 'vitest'
import { useVolumeStore } from './volume-store'
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../services/ipc-client', () => ({ ipc: { invoke } }))
vi.mock('../services/render-logger', () => ({ renderLog: vi.fn() }))
vi.mock('../services/memory/memory-invalidation', () => ({ collectAffectedFiles: vi.fn(), invalidateMemoryFiles: vi.fn() }))
const volume = { volumeNumber: 1, title: 'Current', description: '', chapterStart: 1, chapterEnd: 3 }
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
beforeEach(() => { vi.clearAllMocks(); useVolumeStore.getState().reset(); invoke.mockResolvedValue([volume]) })
it('retains default successful load behavior', async () => {
  expect(await useVolumeStore.getState().load()).toBe(true)
  expect(useVolumeStore.getState()).toMatchObject({ volumes: [volume], loaded: true })
})
it('does not issue IO or publish when the scope is already stale', async () => {
  useVolumeStore.setState({ volumes: [volume], loaded: false })
  expect(await useVolumeStore.getState().load(() => false)).toBe(false)
  expect(invoke).not.toHaveBeenCalled(); expect(useVolumeStore.getState()).toMatchObject({ volumes: [volume], loaded: false })
})
it.each(['resolve', 'reject'] as const)('preserves current volumes when scope changes before read %s', async outcome => {
  const pending = deferred<typeof volume[]>(); let current = true; invoke.mockReturnValueOnce(pending.promise)
  const loading = useVolumeStore.getState().load(() => current)
  const replacement = { ...volume, title: 'New project' }; current = false; useVolumeStore.setState({ volumes: [replacement], loaded: false })
  if (outcome === 'resolve') pending.resolve([volume]); else pending.reject(new Error('old read failed'))
  expect(await loading).toBe(false); expect(useVolumeStore.getState()).toMatchObject({ volumes: [replacement], loaded: false })
})
it.each(['resolve', 'reject'] as const)('reset invalidates an unguarded pending read before %s', async outcome => {
  const pending = deferred<typeof volume[]>(); invoke.mockReturnValueOnce(pending.promise)
  const loading = useVolumeStore.getState().load(); useVolumeStore.getState().reset()
  if (outcome === 'resolve') pending.resolve([volume]); else pending.reject(new Error('old read failed'))
  expect(await loading).toBe(false); expect(useVolumeStore.getState()).toMatchObject({ volumes: [], loaded: false })
})
it('retains current-scope failure behavior and latest-request ordering', async () => {
  invoke.mockRejectedValueOnce(new Error('read failed')); expect(await useVolumeStore.getState().load()).toBe(false)
  expect(useVolumeStore.getState()).toMatchObject({ volumes: [], loaded: true })
  const pending = deferred<typeof volume[]>(); invoke.mockReturnValueOnce(pending.promise)
  const old = useVolumeStore.getState().load(); await useVolumeStore.getState().load(); pending.resolve([{ ...volume, title: 'Old' }])
  expect(await old).toBe(false); expect(useVolumeStore.getState().volumes).toEqual([volume])
})
