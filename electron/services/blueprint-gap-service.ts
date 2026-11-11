import { randomUUID } from 'node:crypto'
import { insertMissingBlueprints, MissingBlueprintScopeChanged, MissingBlueprintValidationError,
  type BlueprintWriteScope, type MissingBlueprintInput, type MissingBlueprintResult } from '../../src/core'
import { t } from '../../src/shared/locale'
import { getCurrentProjectPath, getProjectDb } from '../database'
import type { BlueprintData } from '../repositories/blueprint-repository'

// A reopened database is a new connection object: even an identical path gets a new token.
const tokens = new WeakMap<object, string>()
export function captureBlueprintWriteScope(): BlueprintWriteScope {
  const db = getProjectDb(); const projectPath = getCurrentProjectPath()
  if (!db || !projectPath) throw new Error(t('error.requestCancelled'))
  let token = tokens.get(db)
  if (!token) { token = randomUUID(); tokens.set(db, token) }
  return { projectPath, token }
}
export function insertDatabaseMissingBlueprints(input: MissingBlueprintInput<BlueprintData>): MissingBlueprintResult {
  const db = getProjectDb()
  if (!db) return { success: false, error: t('error.repoBlueprintCannotSaveBatch').replace('{repo}', '[BlueprintRepository]') }
  try {
    const receipt = insertMissingBlueprints(input, {
      scope: () => getProjectDb() === db ? captureBlueprintWriteScope() : null,
      atomic: operation => db.transaction(operation)(),
      insert: item => db.prepare(`INSERT INTO blueprints (
        chapter_number,title,role,purpose,key_events,characters,suspense_hook,user_guidance,
        notes,notes_updated_at,sort_order,priority,volume_number
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(chapter_number) DO NOTHING`).run(
        item.chapterNumber,item.title,item.role,item.purpose,item.keyEvents,JSON.stringify(item.characters),
        item.suspenseHook,item.userGuidance,item.notes,item.notesUpdatedAt,item.sortOrder,item.priority,item.volumeNumber ?? null,
      ).changes === 1,
    })
    return { success: true, ...receipt }
  } catch (error) {
    return { success: false, error: error instanceof MissingBlueprintScopeChanged ? t('error.requestCancelled')
      : error instanceof MissingBlueprintValidationError ? t('error.prereqNotMet') : String(error) }
  }
}
