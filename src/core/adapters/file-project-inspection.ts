import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { ProjectInspectionReader } from '../ports/project-inspection'

export async function openProjectInspection(projectPath: string): Promise<ProjectInspectionReader> {
  const requested = resolve(projectPath)
  const stat = await lstat(requested)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Expected a regular project directory')
  const root = await realpath(requested)

  async function kind(relative: string): ReturnType<ProjectInspectionReader['kind']> {
    let path = root
    const parts = relative.split('/')
    if (parts.some(part => !part || part === '.' || part === '..' || /[\\:\0]/.test(part))) return 'unsafe'
    try {
      for (const [index, part] of parts.entries()) {
        path = join(path, part)
        const entry = await lstat(path)
        if (entry.isSymbolicLink()) return 'unsafe'
        if (entry.isDirectory()) continue
        return index === parts.length - 1 && entry.isFile() ? 'file' : 'unsafe'
      }
      return 'directory'
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
      throw error
    }
  }

  async function checkedPath(relative: string, expected: 'directory' | 'file') {
    if (await kind(relative) !== expected) throw new Error('Project entry changed during inspection')
    const path = join(root, relative)
    if (await realpath(path) !== path) throw new Error('Project entry resolves outside its recorded path')
    return path
  }

  return {
    kind,
    list: async path => readdir(await checkedPath(path, 'directory')),
    readText: async path => readFile(await checkedPath(path, 'file'), 'utf8'),
    inspectLegacyDatabase: async () => {
      const { inspectLegacyDatabase } = await import('./legacy-database-inspection')
      return inspectLegacyDatabase(await checkedPath('legacy.db', 'file'))
    },
  }
}
