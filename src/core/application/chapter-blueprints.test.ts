import { describe, expect, it, vi } from 'vitest'
import { ChapterBlueprintBusy, ChapterBlueprintRequestCancelled, createChapterBlueprintApplication } from './chapter-blueprints'

const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const row = () => ({ chapterNumber: 1, title: 'old', characters: ['A'] })
function fixture() {
  let scope = { id: 'a', path: '/a', session: 1 }
  const ports = { scope: () => scope, readList: vi.fn(async () => [row()]), readNextWriteChapter: vi.fn(async () => 2), saveOne: vi.fn<(item: ReturnType<typeof row>) => Promise<boolean>>().mockResolvedValue(true), saveAll: vi.fn<(items: ReturnType<typeof row>[]) => Promise<boolean>>().mockResolvedValue(true), refreshFileTree: vi.fn(async () => {}) }
  return { ports, app: createChapterBlueprintApplication(ports), change: (patch: Partial<typeof scope>) => { scope = { ...scope, ...patch } } }
}
describe('chapter blueprint application', () => {
  it('loads the chosen sort and next writable chapter without swallowing failures', async () => {
    const { app, ports } = fixture(); const sort = { key: 'priority' as const, direction: 'desc' as const }
    expect(await app.load(sort)).toEqual({ blueprints: [row()], nextWriteChapter: 2 }); expect(ports.readList).toHaveBeenCalledWith(sort)
    ports.readList.mockRejectedValueOnce(new Error('read failed')); await expect(app.load()).rejects.toThrow('read failed')
  })
  it('cancels older reads including their failures', async () => {
    const { app, ports } = fixture(); const pending = deferred<ReturnType<typeof row>[]>()
    ports.readList.mockReturnValueOnce(pending.promise); const old = app.load(); const result = expect(old).rejects.toBeInstanceOf(ChapterBlueprintRequestCancelled)
    await app.load(); pending.reject(new Error('old error')); await result
  })
  it('captures sorting by value and only returns the newest successful read', async () => {
    const { app, ports } = fixture(); const pending = deferred<ReturnType<typeof row>[]>()
    ports.readList.mockReturnValueOnce(pending.promise)
    const sort = { key: 'priority' as const, direction: 'desc' as 'asc' | 'desc' }
    const old = app.load(sort); const cancelled = expect(old).rejects.toBeInstanceOf(ChapterBlueprintRequestCancelled)
    sort.direction = 'asc'; expect(ports.readList.mock.calls[0]).toEqual([{ key: 'priority', direction: 'desc' }])
    expect((await app.load()).blueprints).toEqual([row()]); pending.resolve([{ ...row(), title: 'obsolete' }]); await cancelled
  })
  it('releases the write mutex after refresh failure and keeps instances independent', async () => {
    const { app, ports } = fixture(); const pending = deferred<boolean>(); ports.saveOne.mockReturnValueOnce(pending.promise)
    const writing = app.saveOne(row()); const other = createChapterBlueprintApplication(ports)
    await other.saveAll([row()]); ports.refreshFileTree.mockRejectedValueOnce(new Error('tree')); pending.resolve(true)
    expect(await writing).toEqual({ refreshError: 'tree' }); await app.saveOne(row())
  })
  it.each(['id', 'path', 'session'] as const)('rejects results after changing %s', async field => {
    const { app, ports, change } = fixture(); const pending = deferred<boolean>(); ports.saveOne.mockReturnValueOnce(pending.promise)
    const saving = app.saveOne(row()); const result = expect(saving).rejects.toBeInstanceOf(ChapterBlueprintRequestCancelled)
    change(field === 'session' ? { session: 2 } : { [field]: 'other' }); pending.resolve(true); await result; expect(ports.refreshFileTree).not.toHaveBeenCalled()
  })
  it('captures nested save values, rejects reentry and releases the mutex after failure', async () => {
    const { app, ports } = fixture(); const pending = deferred<boolean>(); ports.saveAll.mockReturnValueOnce(pending.promise)
    const item = row(); const items = [item]; const saving = app.saveAll(items); item.title = 'changed'; item.characters.push('B'); items.push(row())
    await expect(app.saveOne(row())).rejects.toBeInstanceOf(ChapterBlueprintBusy)
    expect(ports.saveAll).toHaveBeenCalledWith([{ chapterNumber: 1, title: 'old', characters: ['A'] }])
    pending.reject(new Error('disk')); await expect(saving).rejects.toThrow('disk'); await app.saveOne(row())
    ports.saveOne.mockResolvedValueOnce(false); await expect(app.saveOne(row())).rejects.toThrow(); await app.saveAll([row()])
  })
  it('invalidates a pending read before writing and separates refresh failure from commit', async () => {
    const { app, ports } = fixture(); const pending = deferred<ReturnType<typeof row>[]>()
    ports.readList.mockReturnValueOnce(pending.promise); const loading = app.load(); const result = expect(loading).rejects.toBeInstanceOf(ChapterBlueprintRequestCancelled)
    ports.refreshFileTree.mockRejectedValueOnce(new Error('tree')); expect(await app.saveOne(row())).toEqual({ refreshError: 'tree' })
    pending.resolve([row()]); await result
  })
  it('rejects invalid and duplicate chapter numbers before IO', async () => {
    const { app, ports } = fixture()
    for (const chapterNumber of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) await expect(app.saveOne({ ...row(), chapterNumber })).rejects.toThrow()
    await expect(app.saveAll([row(), row()])).rejects.toThrow(); expect(ports.saveOne).not.toHaveBeenCalled(); expect(ports.saveAll).not.toHaveBeenCalled()
  })
  it('captures source by value and cancels disposed sessions', async () => {
    const { ports } = fixture(); const source = { ...ports.scope() }; const app = createChapterBlueprintApplication(ports, source); source.session++
    await app.load(); app.dispose(); expect(() => app.assertCurrent()).toThrow(ChapterBlueprintRequestCancelled); await expect(app.saveOne(row())).rejects.toThrow(ChapterBlueprintRequestCancelled)
  })
})
