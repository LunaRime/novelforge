import { beforeEach, expect, it, vi } from 'vitest'
import { createRendererBinderApplication } from './binder-adapter'
const { invoke, load, state } = vi.hoisted(() => ({ invoke: vi.fn(), load: vi.fn(), state: { currentProject: { id: 'a', path: '/a' }, projectSession: 1 } }))
vi.mock('../ipc-client', () => ({ ipc: { invoke } }))
vi.mock('../../stores/project-store', () => ({ useProjectStore: { getState: () => state } }))
vi.mock('../../stores/volume-store', () => ({ useVolumeStore: { getState: () => ({ load }) } }))
const item = { chapterNumber: 1, title: 'A', sortOrder: 0, volumeNumber: 2 }
beforeEach(() => { vi.clearAllMocks(); state.projectSession = 1; invoke.mockResolvedValue([item]); load.mockResolvedValue(true) })
it('maps only binder DTO fields and normalizes missing volume membership', async () => {
  invoke.mockResolvedValueOnce([{ ...item, extra: 'ignored' }, { chapterNumber: 2, title: 'B', sortOrder: 10 }])
  expect(await createRendererBinderApplication().load()).toEqual([item, { chapterNumber: 2, title: 'B', sortOrder: 10, volumeNumber: null }])
  expect(invoke).toHaveBeenCalledWith('db:blueprint-get-all')
})
it.each([null, false, {}, [null], [{}], [{ ...item, title: null }], [{ ...item, chapterNumber: 0 }], [{ ...item, chapterNumber: 1.5 }], [{ ...item, volumeNumber: 0 }], [{ ...item, volumeNumber: '2' }], [{ ...item, sortOrder: -1 }], [{ ...item, sortOrder: 1.5 }], [{ ...item, sortOrder: undefined }], [{ ...item, sortOrder: Infinity }], [item, item]])('rejects malformed list or rows %#', async value => {
  invoke.mockResolvedValueOnce(value); await expect(createRendererBinderApplication().load()).rejects.toThrow()
})
it('writes exactly binder-reorder and refreshes volumes after explicit success', async () => {
  invoke.mockResolvedValueOnce({ success: true }); const params = { chapterNumber: 1, toVolumeNumber: null, targetIndex: 0 }
  expect(await createRendererBinderApplication().reorder(params)).toEqual({}); expect(invoke).toHaveBeenCalledWith('db:binder-reorder', params); expect(load).toHaveBeenCalledTimes(1)
})
it.each([{ success: false, error: 'disk' }, { success: 1 }, {}, null])('rejects non-success response %# without refreshing', async value => {
  invoke.mockResolvedValueOnce(value); await expect(createRendererBinderApplication().reorder({ chapterNumber: 1, toVolumeNumber: 2 })).rejects.toThrow(); expect(load).not.toHaveBeenCalled()
})
it('reports a false volume refresh separately after commit', async () => {
  invoke.mockResolvedValueOnce({ success: true }); load.mockResolvedValueOnce(false)
  expect(await createRendererBinderApplication().reorder({ chapterNumber: 1, toVolumeNumber: 2 })).toEqual({ refreshError: expect.any(String) })
})
it('does not refresh after a same-path project reopen during the write', async () => {
  invoke.mockImplementationOnce(async () => { state.projectSession++; return { success: true } })
  await expect(createRendererBinderApplication().reorder({ chapterNumber: 1, toVolumeNumber: 2 })).rejects.toThrow(); expect(load).not.toHaveBeenCalled()
})
it.each(['id', 'path', 'session'] as const)('guards volume publication when project %s changes during refresh', async field => {
  const before = { ...state.currentProject }; const initial = { id: before.id, path: before.path, session: state.projectSession }
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  let guard!: () => boolean
  load.mockImplementationOnce(async (isCurrent: () => boolean) => { guard = isCurrent; await pending; return guard() })
  invoke.mockResolvedValueOnce({ success: true })
  const app = createRendererBinderApplication(initial)
  initial.session = 999
  const writing = app.reorder({ chapterNumber: 1, toVolumeNumber: 2 })
  const cancelled = expect(writing).rejects.toThrow()
  await vi.waitFor(() => expect(guard).toBeTypeOf('function'))
  expect(guard()).toBe(true)
  if (field === 'session') state.projectSession++
  else state.currentProject = { ...before, [field]: 'other' }
  expect(guard()).toBe(false); finish(); await cancelled
  state.currentProject = before
})
