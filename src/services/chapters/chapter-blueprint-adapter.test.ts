import { beforeEach, expect, it, vi } from 'vitest'
import { createRendererChapterBlueprintApplication, readChapterBlueprintSnapshot } from './chapter-blueprint-adapter'

const { invoke, refreshFileTree, state } = vi.hoisted(() => ({ invoke: vi.fn(), refreshFileTree: vi.fn(), state: { currentProject: { id: 'a', path: '/a' }, projectSession: 1 } }))
vi.mock('../ipc-client', () => ({ ipc: { invoke } }))
vi.mock('../../stores/project-store', () => ({ useProjectStore: { getState: () => ({ ...state, refreshFileTree }) } }))
const item = { chapterNumber: 1, title: 'A', role: 'Development', purpose: '', keyEvents: '', characters: ['A'], suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: '', sortOrder: 0, priority: 0 }
beforeEach(() => {
  vi.clearAllMocks(); state.projectSession = 1
  invoke.mockImplementation(async (channel: string) => channel === 'db:draft-get-max-finalized-chapter' ? 3 : channel.startsWith('db:blueprint-get-all') ? [item] : { success: true })
  refreshFileTree.mockResolvedValue(undefined)
})
it('reads strictly with the requested sort, normalizes roles and derives next writable chapter', async () => {
  const app = createRendererChapterBlueprintApplication()
  expect(await app.load()).toMatchObject({ blueprints: [{ role: '发展' }], nextWriteChapter: 4 })
  expect(invoke).toHaveBeenCalledWith('db:blueprint-get-all')
  const sort = { key: 'role' as const, direction: 'desc' as const }; await app.load(sort); expect(invoke).toHaveBeenCalledWith('db:blueprint-get-all-sorted', sort)
  invoke.mockImplementation(async (channel: string) => channel === 'db:draft-get-max-finalized-chapter' ? null : [])
  expect((await app.load()).nextWriteChapter).toBe(1)
  invoke.mockRejectedValueOnce(new Error('read failed')); await expect(app.load()).rejects.toThrow('read failed')
})
it('keeps the default chapter order on the get-all query', async () => {
  await createRendererChapterBlueprintApplication().load({ key: 'chapter_number', direction: 'asc' })
  expect(invoke).toHaveBeenCalledWith('db:blueprint-get-all')
  expect(invoke.mock.calls.some(([channel]) => channel === 'db:blueprint-get-all-sorted')).toBe(false)
})
it.each([null, {}, false])('rejects malformed list %s rather than displaying an empty library', async value => {
  invoke.mockImplementation(async (channel: string) => channel === 'db:draft-get-max-finalized-chapter' ? 0 : value)
  await expect(createRendererChapterBlueprintApplication().load()).rejects.toThrow()
})
it.each([{ value: [{ chapterNumber: 1, characters: [] }] }, { value: [{ ...item, characters: [42] }] }])('rejects malformed blueprint rows', async ({ value }) => {
  invoke.mockImplementation(async (channel: string) => channel === 'db:draft-get-max-finalized-chapter' ? 0 : value)
  await expect(createRendererChapterBlueprintApplication().load()).rejects.toThrow()
})
it.each([-1, 1.5, Number.MAX_SAFE_INTEGER, '3'])('rejects invalid finalized maximum %s', async value => {
  invoke.mockImplementation(async (channel: string) => channel === 'db:draft-get-max-finalized-chapter' ? value : [])
  await expect(createRendererChapterBlueprintApplication().load()).rejects.toThrow()
})
it.each([0, Date.now(), '', new Date().toISOString()])('accepts persisted notes timestamp %s without altering it', async notesUpdatedAt => {
  invoke.mockResolvedValueOnce([{ ...item, notesUpdatedAt }])
  const snapshot = await readChapterBlueprintSnapshot({ id: 'a', path: '/a', session: 1 })
  expect(snapshot[0]).toMatchObject({ role: '发展', notesUpdatedAt })
  expect(invoke.mock.calls).toEqual([['db:blueprint-get-all']])
})
it.each([-1, 1.5, NaN, Infinity, null, {}, false])('rejects malformed notes timestamps %s', async notesUpdatedAt => {
  invoke.mockResolvedValueOnce([{ ...item, notesUpdatedAt }])
  await expect(readChapterBlueprintSnapshot({ id: 'a', path: '/a', session: 1 })).rejects.toThrow()
})
it('uses single IPC writes and requires explicit success before refreshing', async () => {
  const app = createRendererChapterBlueprintApplication(); await app.saveOne(item); await app.saveAll([item])
  expect(invoke).toHaveBeenCalledWith('db:blueprint-upsert', item); expect(invoke).toHaveBeenCalledWith('db:blueprint-upsert-many', [item]); expect(refreshFileTree).toHaveBeenCalledTimes(2)
  for (const value of [{ success: false, error: 'disk full' }, {}, { success: 1 }, null]) {
    invoke.mockResolvedValueOnce(value); await expect(app.saveOne(item)).rejects.toThrow()
  }
  expect(refreshFileTree).toHaveBeenCalledTimes(2)
})
it('keeps refresh failures separate and rejects an old project session', async () => {
  const app = createRendererChapterBlueprintApplication(); refreshFileTree.mockRejectedValueOnce(new Error('tree'))
  expect(await app.saveAll([item])).toEqual({ refreshError: 'tree' }); state.projectSession++
  await expect(app.load()).rejects.toThrow(); expect(invoke).toHaveBeenCalledTimes(1)
})
