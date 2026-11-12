import { createHash } from 'node:crypto'
import {
  DirectoryBlueprintValidationError, getDirectoryBlueprintDeletions, resolveDirectoryWriteRange, validateDirectoryWriteItems,
  type DirectorySnapshotRequest, type DirectoryWriteInput, type DirectoryWriteRange, type DirectoryWriteResult,
} from '../../src/core'
import type { DirectorySnapshotRead } from '../../src/shared/ipc-channels'
import { t } from '../../src/shared/locale'
import { getProjectDb } from '../database'
import { blueprintRowToData, type BlueprintRow } from '../repositories/blueprint-repository'
import { captureBlueprintWriteScope } from './blueprint-gap-service'

type ProjectDatabase = NonNullable<ReturnType<typeof getProjectDb>>

function readTotalChapters(db: ProjectDatabase): number {
  const config = db.prepare("SELECT total_chapters FROM project_core WHERE id = 'main'").get() as { total_chapters: number } | undefined
  if (!config) throw new Error(t('error.coreNotInitialized'))
  return config.total_chapters
}

function snapshotDigest(range: DirectoryWriteRange | null, rows: BlueprintRow[]): string {
  // Include all stored fields, including legacy columns and user-owned metadata.
  const identity = range && [range.mode, range.first, range.last, range.totalChapters]
  const values = rows.map(row => Object.keys(row).sort().map(key => [key, row[key as keyof BlueprintRow]]))
  return createHash('sha256').update(JSON.stringify([identity, values])).digest('hex')
}

export function readDirectoryBlueprintSnapshot(request: DirectorySnapshotRequest): DirectorySnapshotRead {
  const db = getProjectDb()
  if (!db) throw new Error(t('error.requestCancelled'))
  return db.transaction(() => {
    const scope = captureBlueprintWriteScope()
    const totalChapters = readTotalChapters(db)
    if (request?.expectedTotalChapters !== undefined && request.expectedTotalChapters !== totalChapters) {
      throw new Error(t('error.directorySnapshotConflict'))
    }
    const rows = db.prepare('SELECT * FROM blueprints ORDER BY chapter_number').all() as BlueprintRow[]
    let range: DirectoryWriteRange | null
    try {
      range = resolveDirectoryWriteRange(request, totalChapters, rows.at(-1)?.chapter_number ?? 0)
    } catch (error) {
      if (error instanceof DirectoryBlueprintValidationError) throw new Error(t('error.prereqNotMet'))
      throw error
    }
    const affected = range?.mode === 'replace-all' ? rows
      : rows.filter(row => range && row.chapter_number >= range.first && row.chapter_number <= range.last)
    return { snapshot: { scope, range, digest: snapshotDigest(range, affected) }, existingBlueprints: rows.map(blueprintRowToData) }
  })()
}

export function commitDirectoryBlueprints(input: DirectoryWriteInput): DirectoryWriteResult {
  const db = getProjectDb()
  if (!db) return { success: false, reason: 'scope', error: t('error.directorySnapshotExpired') }
  try {
    const { scope, range, digest } = input?.snapshot ?? {}
    if (!scope || !range || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) {
      throw new DirectoryBlueprintValidationError()
    }
    const items = validateDirectoryWriteItems(range, input.items)
    return db.transaction((): DirectoryWriteResult => {
      const current = captureBlueprintWriteScope()
      if (current.projectPath !== scope.projectPath || current.token !== scope.token) {
        return { success: false, reason: 'scope', error: t('error.directorySnapshotExpired') }
      }
      const rows = (range.mode === 'replace-all'
        ? db.prepare('SELECT * FROM blueprints ORDER BY chapter_number').all()
        : db.prepare('SELECT * FROM blueprints WHERE chapter_number BETWEEN ? AND ? ORDER BY chapter_number').all(range.first, range.last)
      ) as BlueprintRow[]
      if (readTotalChapters(db) !== range.totalChapters || snapshotDigest(range, rows) !== digest
        || (range.mode === 'append' && rows.length > 0)) {
        return { success: false, reason: 'conflict', error: t('error.directorySnapshotConflict') }
      }

      const insert = `INSERT INTO blueprints (chapter_number,title,role,purpose,key_events,characters,suspense_hook)
        VALUES (?,?,?,?,?,?,?)`
      const write = db.prepare(range.mode === 'append' ? insert : `${insert}
        ON CONFLICT(chapter_number) DO UPDATE SET
          title = excluded.title, role = excluded.role, purpose = excluded.purpose, key_events = excluded.key_events,
          characters = excluded.characters, suspense_hook = excluded.suspense_hook, updated_at = unixepoch() * 1000`)
      const writtenChapterNumbers: number[] = []
      for (const item of items) {
        const result = write.run(item.chapterNumber, item.title, item.role, item.purpose,
          item.keyEvents, JSON.stringify(item.characters), item.suspenseHook)
        if (result.changes !== 1) throw new Error(t('status.unknown'))
        writtenChapterNumbers.push(item.chapterNumber)
      }
      const deletions = getDirectoryBlueprintDeletions(range, rows.map(row => row.chapter_number))
      const remove = db.prepare('DELETE FROM blueprints WHERE chapter_number = ?')
      for (const chapter of deletions) {
        if (remove.run(chapter).changes !== 1) throw new Error(t('status.unknown'))
      }
      return { success: true, writtenChapterNumbers, deletedChapterNumbers: deletions }
    })()
  } catch (error) {
    if (error instanceof DirectoryBlueprintValidationError) {
      return { success: false, reason: 'invalid', error: t('error.prereqNotMet') }
    }
    return { success: false, reason: 'storage', error: t('error.blueprintsSaveBatchFailed').replace('{error}', () => String(error)) }
  }
}
