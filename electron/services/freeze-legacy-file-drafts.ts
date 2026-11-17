import type { ChapterIndexDatabase } from '../../src/core'

/** Install persistent guards only in the retained database used by a file project. */
export function freezeLegacyFileDrafts(db: ChapterIndexDatabase): void {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all()
    .map(row => (row as { name: string }).name))
  const frozenTables = ['drafts', 'draft_snapshots', 'draft_branches'].filter(table => tables.has(table))
  if (!frozenTables.length) return

  const reject = "BEGIN SELECT RAISE(ABORT, 'legacy chapter data is frozen'); END;"
  const triggers = frozenTables.flatMap(table => ['INSERT', 'UPDATE', 'DELETE'].map(operation =>
    `CREATE TRIGGER IF NOT EXISTS file_freeze_${table}_${operation.toLowerCase()} BEFORE ${operation} ON ${table} ${reject}`))

  // The contents table also serves revisions and reviews. Freeze only rows referenced by frozen owners.
  const owners = frozenTables.filter(table => table !== 'draft_branches')
  if (tables.has('contents') && owners.length) {
    const referenced = (row: 'OLD' | 'NEW') => owners.map(table =>
      `EXISTS (SELECT 1 FROM ${table} WHERE content_id = ${row}.id)`).join(' OR ')
    for (const operation of ['INSERT', 'UPDATE', 'DELETE'] as const) {
      // Check NEW on insert/update to catch REPLACE, which can suppress delete triggers in SQLite.
      const conditions = [operation !== 'INSERT' && referenced('OLD'), operation !== 'DELETE' && referenced('NEW')]
      triggers.push(`CREATE TRIGGER IF NOT EXISTS file_freeze_contents_${operation.toLowerCase()}
        BEFORE ${operation} ON contents WHEN ${conditions.filter(Boolean).join(' OR ')} ${reject}`)
    }
  }

  db.exec('SAVEPOINT freeze_legacy_file_drafts')
  try {
    db.exec(triggers.join('\n'))
    db.exec('RELEASE freeze_legacy_file_drafts')
  } catch (error) {
    db.exec('ROLLBACK TO freeze_legacy_file_drafts; RELEASE freeze_legacy_file_drafts')
    throw error
  }
}
