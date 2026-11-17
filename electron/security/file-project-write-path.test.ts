import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { assertFileProjectWritePath } from './file-project-write-path'

test('protects storage paths on disk before opening a candidate and through directory aliases', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-file-write-path-'))
  try {
    const candidate = join(root, 'candidate')
    const internal = join(candidate, '.novelforge')
    await mkdir(join(internal, 'vela.db'), { recursive: true })
    await mkdir(join(candidate, 'chapters'))
    await writeFile(join(candidate, 'chapters/0001.md'), 'chapter')
    await writeFile(join(internal, 'file-editor.json'), 'damaged')
    for (const name of ['chapters/0001.md', 'chapters/new.md', 'history/ch_12345678/1.md',
      '.novelforge/retained.db', 'novel.json', 'legacy.db', 'migration-manifest.json']) {
      expect(() => assertFileProjectWritePath(join(candidate, name), 'write')).toThrow()
      expect(() => assertFileProjectWritePath(join(candidate, name), 'delete')).toThrow()
    }
    expect(() => assertFileProjectWritePath(candidate, 'delete')).toThrow()
    expect(() => assertFileProjectWritePath(candidate, 'write')).not.toThrow()
    expect(() => assertFileProjectWritePath(join(candidate, 'exports', 'chapter.md'), 'write')).not.toThrow()
    expect(() => assertFileProjectWritePath(join(root, 'ordinary', 'chapters', '0001.md'), 'write')).not.toThrow()

    const alias = join(root, 'chapter-alias')
    await symlink(join(candidate, 'chapters'), alias, 'junction')
    expect(() => assertFileProjectWritePath(join(alias, '0001.md'), 'write')).toThrow()
    expect(() => assertFileProjectWritePath(join(alias, 'missing', '0002.md'), 'write')).toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})
