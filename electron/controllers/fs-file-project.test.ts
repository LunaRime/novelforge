import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import { grantDirectory, registerFSController, revokeGrantedPath } from './fs-controller'

const handlers = vi.hoisted(() => new Map<string, (_event: unknown, ...args: unknown[]) => Promise<unknown>>())
vi.mock('electron', () => ({}))
vi.mock('node:os', async importOriginal => {
  const os = await importOriginal<typeof import('node:os')>()
  return { ...os, default: { ...os, homedir: () => join(os.tmpdir(), 'nf-isolated-home') } }
})
vi.mock('../database', () => ({ getCurrentProjectPath: () => null }))
vi.mock('../security/ipc-guard', () => ({
  guardedHandle: (name: string, handler: never) => handlers.set(name, handler),
}))

test('a directory grant allows reading candidate chapters but cannot bypass the file editor for mutations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-fs-candidate-'))
  try {
    const chapter = join(root, 'chapters/0001.md')
    await mkdir(join(root, '.novelforge/vela.db'), { recursive: true })
    await mkdir(join(root, 'chapters'))
    await writeFile(chapter, 'original')
    grantDirectory(root)
    registerFSController()
    const call = (name: string, ...args: unknown[]) => handlers.get(name)!(null, ...args)
    expect(await call('fs:read-file', chapter)).toMatchObject({ success: true, content: 'original' })
    expect(await call('fs:write-file', chapter, 'replacement')).toMatchObject({ success: false })
    expect(await call('fs:write-buffer', chapter, new Uint8Array([1]))).toMatchObject({ success: false })
    expect(await call('fs:write-json', join(root, 'novel.json'), {})).toMatchObject({ success: false })
    expect(await call('fs:mkdir', join(root, 'history/new'))).toMatchObject({ success: false })
    expect(await call('fs:delete-file', chapter)).toMatchObject({ success: false })
    expect(await readFile(chapter, 'utf8')).toBe('original')
    expect(await call('fs:write-file', join(root, 'exports/result.md'), 'copy')).toMatchObject({ success: true })
  } finally {
    revokeGrantedPath(root)
    await rm(root, { recursive: true, force: true })
  }
})
