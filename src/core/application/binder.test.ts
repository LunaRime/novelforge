import { expect, it, vi } from 'vitest'
import { BinderBusy, BinderRequestCancelled, createBinderApplication } from './binder'
import type { BinderChapter, BinderReorderParams } from '../ports/binder'

const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const row = (): BinderChapter => ({ chapterNumber: 1, title: 'A', volumeNumber: null, sortOrder: 0 })
const params = (): BinderReorderParams => ({ chapterNumber: 1, toVolumeNumber: 2, targetIndex: 0 })
function fixture() {
  let scope = { id: 'a', path: '/a', session: 1 }
  const ports = { scope: () => scope, readList: vi.fn(async () => [row()]), reorder: vi.fn<(value: BinderReorderParams) => Promise<boolean>>().mockResolvedValue(true), refresh: vi.fn(async () => {}) }
  return { ports, app: createBinderApplication(ports), change: (patch: Partial<typeof scope>) => { scope = { ...scope, ...patch } } }
}
it('loads detached chapters and propagates current read failures', async () => {
  const { app, ports } = fixture(); const rows = [row()]; ports.readList.mockResolvedValueOnce(rows)
  const loaded = await app.load(); loaded[0].title = 'changed'; expect(rows[0].title).toBe('A')
  ports.readList.mockRejectedValueOnce(new Error('read')); await expect(app.load()).rejects.toThrow('read')
})
it.each(['resolve', 'reject'] as const)('only publishes newest read after older %s', async outcome => {
  const { app, ports } = fixture(); const pending = deferred<BinderChapter[]>(); ports.readList.mockReturnValueOnce(pending.promise)
  const old = app.load(); const cancelled = expect(old).rejects.toBeInstanceOf(BinderRequestCancelled)
  expect(await app.load()).toEqual([row()]); if (outcome === 'resolve') pending.resolve([row()]); else pending.reject(new Error('old')); await cancelled
})
it('snapshots reorder parameters and rejects reentry until refresh finishes', async () => {
  const { app, ports } = fixture(); const pending = deferred<boolean>(); const refresh = deferred<void>(); ports.reorder.mockReturnValueOnce(pending.promise); ports.refresh.mockReturnValueOnce(refresh.promise)
  const input = params(); const writing = app.reorder(input); input.chapterNumber = 8; input.toVolumeNumber = null
  expect(ports.reorder).toHaveBeenCalledWith(params()); await expect(app.reorder(params())).rejects.toBeInstanceOf(BinderBusy)
  pending.resolve(true); await Promise.resolve(); await expect(app.reorder(params())).rejects.toBeInstanceOf(BinderBusy); refresh.resolve(); expect(await writing).toEqual({})
})
it('releases mutex after false and thrown writes without refreshing', async () => {
  const { app, ports } = fixture(); ports.reorder.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('disk'))
  await expect(app.reorder(params())).rejects.toThrow(); await expect(app.reorder(params())).rejects.toThrow('disk'); expect(ports.refresh).not.toHaveBeenCalled()
  await expect(app.reorder({ chapterNumber: 1, toVolumeNumber: null })).resolves.toEqual({})
})
it('invalidates earlier reads when writing and separates refresh failure from committed write', async () => {
  const { app, ports } = fixture(); const pending = deferred<BinderChapter[]>(); ports.readList.mockReturnValueOnce(pending.promise)
  const loading = app.load(); const cancelled = expect(loading).rejects.toBeInstanceOf(BinderRequestCancelled)
  ports.refresh.mockRejectedValueOnce(new Error('volumes')); expect(await app.reorder(params())).toEqual({ refreshError: 'volumes' }); pending.resolve([row()]); await cancelled
  await expect(app.reorder(params())).resolves.toEqual({})
})
it.each(['id', 'path', 'session'] as const)('cancels changed %s after write before refresh', async field => {
  const { app, ports, change } = fixture(); const pending = deferred<boolean>(); ports.reorder.mockReturnValueOnce(pending.promise)
  const writing = app.reorder(params()); const cancelled = expect(writing).rejects.toBeInstanceOf(BinderRequestCancelled)
  change(field === 'session' ? { session: 2 } : { [field]: 'other' }); pending.resolve(true); await cancelled; expect(ports.refresh).not.toHaveBeenCalled()
})
it.each(['resolve', 'reject'] as const)('cancels old session after refresh %s', async outcome => {
  const { app, ports, change } = fixture(); const pending = deferred<void>(); ports.refresh.mockReturnValueOnce(pending.promise)
  const writing = app.reorder(params()); const cancelled = expect(writing).rejects.toBeInstanceOf(BinderRequestCancelled); await Promise.resolve(); change({ session: 2 })
  if (outcome === 'resolve') pending.resolve(); else pending.reject(new Error('old')); await cancelled
})
it('captures initial scope by value and rejects disposed or missing sources', async () => {
  const { ports } = fixture(); const source = { ...ports.scope() }; const app = createBinderApplication(ports, source); source.session++
  await app.load(); app.dispose(); expect(() => app.assertCurrent()).toThrow(BinderRequestCancelled); await expect(app.reorder(params())).rejects.toBeInstanceOf(BinderRequestCancelled)
  await expect(createBinderApplication(ports, null).load()).rejects.toBeInstanceOf(BinderRequestCancelled)
})
it('validates chapter, volume and index before write IO', async () => {
  const { app, ports } = fixture()
  for (const invalid of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await expect(app.reorder({ ...params(), chapterNumber: invalid })).rejects.toThrow()
    await expect(app.reorder({ ...params(), toVolumeNumber: invalid })).rejects.toThrow()
  }
  for (const invalid of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) await expect(app.reorder({ ...params(), targetIndex: invalid })).rejects.toThrow()
  expect(ports.reorder).not.toHaveBeenCalled()
})
