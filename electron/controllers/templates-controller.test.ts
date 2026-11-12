import path from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
import { registerTemplatesController } from './templates-controller'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  fs: { mkdir: vi.fn(), readdir: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), rename: vi.fn(), rm: vi.fn() },
}))
vi.mock('node:fs', () => ({ promises: h.fs }))
vi.mock('../utils/config-utils', () => ({ NOVELFORGE_HOME: '/test-home' }))
vi.mock('../security/ipc-guard', () => ({
  guardedHandle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => h.handlers.set(channel, handler),
}))

const call = (channel: string, input?: unknown) => h.handlers.get(channel)!(null, input)

beforeEach(() => {
  vi.resetAllMocks()
  h.fs.rm.mockResolvedValue(undefined)
  registerTemplatesController()
})

it('loads a copied legacy template by its catalogue file and keeps corrupt files out of the list', async () => {
  const data = { notes: 'Original' }
  h.fs.readdir.mockResolvedValue(['copy.json', 'corrupt.json'])
  h.fs.readFile.mockImplementation(async (file: string) => path.basename(file) === 'copy.json'
    ? JSON.stringify({ schema: 'character', name: 'Original name', data })
    : '{')
  expect(await call('templates:list')).toEqual([{ file: 'copy.json', name: 'Original name', description: '' }])
  expect(await call('templates:get', 'copy.json')).toEqual(data)
  expect(await call('templates:get', '../copy.json')).toBeNull()
  expect(h.fs.readFile).toHaveBeenCalledTimes(3)
})

it('returns a directory failure to the catalogue caller', async () => {
  h.fs.readdir.mockRejectedValue(new Error('catalogue unavailable'))
  await expect(call('templates:list')).rejects.toThrow('catalogue unavailable')
})

it('keeps concurrent writes isolated and cleans only the failed temporary file', async () => {
  h.fs.rename.mockRejectedValueOnce(new Error('rename failed')).mockResolvedValueOnce(undefined)
  const input = { name: 'Template', data: { notes: 'Text' } }
  const results = await Promise.all([call('templates:save', input), call('templates:save', input)])
  const [failedTemp, successfulTemp] = h.fs.writeFile.mock.calls.map(([file]) => file)
  expect(failedTemp).not.toBe(successfulTemp)
  expect(results).toEqual([{ success: false, error: 'rename failed' }, { success: true }])
  expect(h.fs.rm).toHaveBeenCalledExactlyOnceWith(failedTemp, { force: true })
})
