import { insertMissingBlueprints, type BlueprintWriteScope, type ChapterIndexDatabase, type GeneratedBlueprintFields } from '../../src/core'
import { generatedBlueprintInsertSql, generatedBlueprintValues } from './generated-blueprint-sql'

export function readImportBlueprintTargets(db: ChapterIndexDatabase, chapterNumbers: number[]) {
  const columns = new Set((db.prepare('PRAGMA table_info(blueprints)').all() as Array<{ name: string }>).map(column => column.name))
  const available = ['chapter_number', 'title', 'role', 'purpose', 'key_events', 'characters', 'suspense_hook'].every(column => columns.has(column))
  const existingChapterNumbers = columns.has('chapter_number')
    ? (db.prepare(`SELECT chapter_number FROM blueprints WHERE chapter_number IN (SELECT value FROM json_each(?)) ORDER BY chapter_number`)
      .all(JSON.stringify(chapterNumbers)) as Array<{ chapter_number: number }>).map(row => row.chapter_number)
    : []
  return { available, existingChapterNumbers }
}

export function applyImportBlueprints(db: ChapterIndexDatabase, scope: BlueprintWriteScope, assertCurrent: () => void,
  targetChapterNumbers: number[], items: GeneratedBlueprintFields[]) {
  if (!Array.isArray(items) || !items.length) throw new Error('No imported blueprints to apply')
  return insertMissingBlueprints({ scope, targetChapterNumbers, items: items.map(item => ({ ...item,
    userGuidance: '', notes: '', notesUpdatedAt: 0, sortOrder: 0, priority: 0,
  })) }, {
    scope: () => { assertCurrent(); return scope },
    atomic: work => {
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = work()
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    // 只填缺失的章号，生成期间新增的蓝图和人工字段均由库内现有行保留。
    insert: item => (db.prepare(`${generatedBlueprintInsertSql} ON CONFLICT(chapter_number) DO NOTHING`)
      .run(...generatedBlueprintValues(item)) as { changes: number }).changes === 1,
  })
}
