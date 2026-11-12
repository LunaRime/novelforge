import { beforeEach, expect, it, vi } from 'vitest'
import { registerProjectController } from './project-controller'

const h = vi.hoisted(() => ({
  currentPath: '/original' as string | null,
  connection: {},
  handlers: new Map<string, (_event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  readCore: vi.fn(),
  writeCore: vi.fn(),
  writeRecent: vi.fn(),
}))
vi.mock('electron', () => ({}))
vi.mock('node:fs', () => ({ default: { existsSync: () => true, mkdirSync: vi.fn() } }))
vi.mock('../security/ipc-guard', () => ({
  guardedHandle: (channel: string, handler: (_event: unknown, ...args: unknown[]) => Promise<unknown>) => h.handlers.set(channel, handler),
}))
vi.mock('../database', () => ({
  getCurrentProjectPath: () => h.currentPath,
  getProjectDb: () => h.currentPath ? h.connection : null,
  initProjectDatabase: (path: string) => { h.currentPath = path; h.connection = {} },
  closeProjectDatabase: () => { h.currentPath = null },
}))
vi.mock('../repositories/project-core-repository', () => ({
  ProjectCoreRepository: { get: h.readCore, init: vi.fn(), update: h.writeCore },
}))
vi.mock('../utils/config-utils', () => ({
  readJsonFile: () => [], writeJsonFile: h.writeRecent, RECENT_PROJECTS_PATH: '/recent', getProjectDataDir: vi.fn(),
}))
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('./fs-controller', () => ({ grantDirectory: vi.fn(), assertPathAllowedForIpc: vi.fn() }))

beforeEach(() => {
  h.currentPath = '/original'
  h.connection = {}
  h.handlers.clear()
  h.readCore.mockReset()
  h.writeCore.mockReset()
  h.writeRecent.mockReset()
  registerProjectController()
})

it.each(['project:save', 'project:update-config'])('rejects a stale project path before writing through %s', async channel => {
  const result = await h.handlers.get(channel)!(null, 'main', { path: '/other', novelConfig: { genre: 'wrong book' } })
  expect(result).toMatchObject({ success: false })
  expect(h.writeCore).not.toHaveBeenCalled()
})

it('acknowledges a committed config when writing the recent list fails', async () => {
  h.writeRecent.mockImplementation(() => { throw new Error('recent list unavailable') })
  const result = await h.handlers.get('project:save')!(null, 'main', { path: '/original', novelConfig: { genre: 'saved' } })
  expect(h.writeCore).toHaveBeenCalledWith({ genre: 'saved' })
  expect(result).toMatchObject({ success: true })
})

it('rejects the old connection token after reopening the same path', async () => {
  h.readCore.mockReturnValue({ projectName: 'Original' })
  const open = h.handlers.get('project:open')!
  const save = h.handlers.get('project:save')!
  const first = await open(null, '/original') as { project: { writeToken: string } }
  const second = await open(null, '/original') as { project: { writeToken: string } }
  const stale = await save(null, 'main', { path: '/original', writeToken: first.project.writeToken })
  expect(stale).toMatchObject({ success: false })
  expect(h.writeCore).not.toHaveBeenCalled()
  const current = await save(null, 'main', { path: '/original', writeToken: second.project.writeToken, novelConfig: { genre: 'saved' } })
  expect(current).toMatchObject({ success: true })
  expect(h.writeCore).toHaveBeenCalledWith({ genre: 'saved' })
})

it('returns the current token when reopening the same path fails after reconnecting', async () => {
  const open = h.handlers.get('project:open')!
  h.readCore.mockReturnValueOnce({ projectName: 'Original' }).mockReturnValueOnce({ projectName: 'Original' })
  const first = await open(null, '/original') as { project: { writeToken: string } }
  h.readCore.mockImplementation(() => { throw new Error('core read failed') })
  const failure = await open(null, '/original') as { success: boolean; restoredWriteToken?: string }
  expect(failure.success).toBe(false)
  expect(failure.restoredWriteToken).toEqual(expect.any(String))
  expect(failure.restoredWriteToken).not.toBe(first.project.writeToken)
  const result = await h.handlers.get('project:save')!(null, 'main', {
    path: '/original', writeToken: failure.restoredWriteToken, novelConfig: { genre: 'saved' },
  })
  expect(result).toMatchObject({ success: true })
})

it('leaves the previous project connected after initializing a different project', async () => {
  h.readCore.mockReturnValue({ projectName: 'New' })
  const result = await h.handlers.get('project:create')!(null, { path: '/books', name: 'New', genre: '', targetAudience: '' })
  expect(result).toMatchObject({ success: true })
  expect(h.currentPath).toBe('/original')
})

it('restores the original connection when opening fails after switching databases', async () => {
  h.readCore.mockImplementation(() => {
    expect(h.currentPath).toBe('/other')
    throw new Error('core read failed')
  })
  const result = await h.handlers.get('project:open')!(null, '/other')
  expect(result).toMatchObject({ success: false })
  expect(h.currentPath).toBe('/original')
})
