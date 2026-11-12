import { beforeEach, expect, it, vi } from 'vitest'
import { registerProjectController } from './project-controller'

const h = vi.hoisted(() => ({
  currentPath: '/original' as string | null,
  handlers: new Map<string, (_event: unknown, input: unknown) => Promise<unknown>>(),
  readCore: vi.fn(),
}))
vi.mock('electron', () => ({}))
vi.mock('node:fs', () => ({ default: { existsSync: () => true, mkdirSync: vi.fn() } }))
vi.mock('../security/ipc-guard', () => ({
  guardedHandle: (channel: string, handler: (_event: unknown, input: unknown) => Promise<unknown>) => h.handlers.set(channel, handler),
}))
vi.mock('../database', () => ({
  getCurrentProjectPath: () => h.currentPath,
  getProjectDb: () => h.currentPath ? {} : null,
  initProjectDatabase: (path: string) => { h.currentPath = path },
  closeProjectDatabase: () => { h.currentPath = null },
}))
vi.mock('../repositories/project-core-repository', () => ({
  ProjectCoreRepository: { get: h.readCore, init: vi.fn(), update: vi.fn() },
}))
vi.mock('../utils/config-utils', () => ({
  readJsonFile: () => [], writeJsonFile: vi.fn(), RECENT_PROJECTS_PATH: '/recent', getProjectDataDir: vi.fn(),
}))
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn() } }))
vi.mock('./fs-controller', () => ({ grantDirectory: vi.fn(), assertPathAllowedForIpc: vi.fn() }))

beforeEach(() => {
  h.currentPath = '/original'
  h.handlers.clear()
  h.readCore.mockReset()
  registerProjectController()
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
