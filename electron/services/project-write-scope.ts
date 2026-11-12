import { randomUUID } from 'node:crypto'
import { getCurrentProjectPath, getProjectDb } from '../database'
import { t } from '../../src/shared/locale'

// A reopened database receives a new token even when it has the same project path.
const tokens = new WeakMap<object, string>()

export function captureProjectWriteScope() {
  const db = getProjectDb()
  const projectPath = getCurrentProjectPath()
  if (!db || !projectPath) throw new Error(t('error.requestCancelled'))
  let token = tokens.get(db)
  if (!token) {
    token = randomUUID()
    tokens.set(db, token)
  }
  return { projectPath, token }
}
