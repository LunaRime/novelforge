import fs from 'node:fs'
import path from 'node:path'
import { t } from '../../src/shared/locale'

function insideRelative(candidate: string, root: string): string | null {
  const relative = path.relative(root, candidate)
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ? null : relative
}

/** Prevent project-local directory links from bypassing renderer chapter/data-path guards.
 * The opened root may itself be an alias; only descendants are required to be link-free.
 * External exports retain the existing explicit-grant policy.
 */
export function assertProjectWriteHasNoLinks(candidate: string, projectRoot: string | null): void {
  if (!projectRoot) return
  let root = path.resolve(projectRoot)
  const absolute = path.resolve(candidate)
  let relative = insideRelative(absolute, root)
  if (relative === null) {
    // Accept either lexical spelling when the project itself was opened via a junction.
    try { root = fs.realpathSync(root) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    relative = insideRelative(absolute, root)
  }
  if (relative === null || !relative) return
  let current = root
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment)
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error(t('error.fsAccessDenied').replace('{path}', () => candidate))
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
