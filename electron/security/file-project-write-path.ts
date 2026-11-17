import fs from 'node:fs'
import path from 'node:path'
import { t } from '../../src/shared/locale'

/** Either marker identifies a candidate, even if the other is damaged or missing. */
export function isFileProjectDirectory(projectPath: string): boolean {
  const internal = path.join(projectPath, '.novelforge')
  const descriptor = fs.lstatSync(path.join(internal, 'file-editor.json'), { throwIfNoEntry: false })
  const barrier = fs.lstatSync(path.join(internal, 'vela.db'), { throwIfNoEntry: false })
  return Boolean(descriptor || barrier?.isDirectory())
}

function existingAncestor(candidate: string): string {
  let cursor = candidate
  for (;;) {
    const entry = fs.lstatSync(cursor, { throwIfNoEntry: false })
    if (entry) return cursor
    const parent = path.dirname(cursor)
    if (parent === cursor) return cursor
    cursor = parent
  }
}

const managedEntries = new Set(['chapters', 'history', '.novelforge', 'novel.json', 'legacy.db', 'migration-manifest.json'])

/** Generic filesystem calls must leave candidate state to the revision-aware file editor. */
export function assertFileProjectWritePath(candidate: string, intent: 'write' | 'delete'): void {
  const absolute = path.resolve(candidate)
  const ancestor = existingAncestor(absolute)
  // Resolve existing ancestors as well as the lexical path: a granted junction may point into a candidate.
  const resolved = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, absolute))
  for (const spelling of new Set([absolute, resolved])) {
    let directory = existingAncestor(spelling)
    if (!fs.lstatSync(directory, { throwIfNoEntry: false })?.isDirectory()) directory = path.dirname(directory)
    for (;;) {
      const relative = path.relative(directory, spelling)
      const first = relative.split(path.sep)[0].toLowerCase()
      // Win32 accepts alternate data stream syntax and trims trailing dots and spaces.
      const entry = process.platform === 'win32' ? first.split(':')[0].replace(/[. ]+$/, '') : first
      if ((managedEntries.has(entry) || (!relative && intent === 'delete')) && isFileProjectDirectory(directory)) {
        throw new Error(t('error.fileProjectManagedPath'))
      }
      const parent = path.dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  }
}
