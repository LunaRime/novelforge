import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import type { ProjectIssue } from '../ports/project-inspection'

interface Reference {
  table: string
  field: string
  target: string
  optional?: boolean
  match?: string
}

const bodyOwners = ['drafts', 'draft_snapshots', 'revisions', 'reviews', 'scene_cards']
const references: Reference[] = [
  { table: 'drafts', field: 'branch_id', target: 'draft_branches', optional: true, match: 'ref.chapter_number = owner.chapter_number' },
  { table: 'draft_branches', field: 'head_draft_id', target: 'drafts', optional: true,
    match: 'ref.chapter_number = owner.chapter_number AND ref.branch_id = owner.id' },
  { table: 'draft_branches', field: 'base_snapshot_id', target: 'draft_snapshots', optional: true,
    match: "ref.chapter_number = owner.chapter_number AND ref.branch_id = owner.id AND ref.kind = 'branch-base'" },
  { table: 'draft_snapshots', field: 'draft_id', target: 'drafts', match: 'ref.chapter_number = owner.chapter_number' },
  { table: 'draft_snapshots', field: 'branch_id', target: 'draft_branches', optional: true, match: 'ref.chapter_number = owner.chapter_number' },
  { table: 'revisions', field: 'base_draft_id', target: 'drafts' },
  { table: 'revisions', field: 'review_source_id', target: 'reviews', optional: true },
  { table: 'revisions', field: 'merged_to_draft_id', target: 'drafts', optional: true },
  { table: 'reviews', field: 'base_draft_id', target: 'drafts' },
]

export function inspectLegacyDatabase(path: string): ProjectIssue[] {
  // SQLite immutable URI skips locking and recovery, even if a sidecar appears after preflight.
  const uri = pathToFileURL(path)
  uri.searchParams.set('immutable', '1')
  const db = new DatabaseSync(uri.href, { readOnly: true })
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map(row => row.name))
    const issues: ProjectIssue[] = []
    const file = 'legacy.db'
    for (const table of ['contents', 'drafts']) {
      if (!tables.has(table)) issues.push({ code: 'database-schema', path: file, table })
    }

    const findRows = (table: string, field: string, code: 'missing-body' | 'orphan-reference', where: string) => {
      if (!tables.has(table)) return
      try {
        const rows = db.prepare(`SELECT owner.id FROM ${table} owner WHERE ${where} ORDER BY owner.id`)
        rows.setReadBigInts(true)
        for (const row of rows.iterate()) {
          const id = row.id
          const rowId = typeof id === 'bigint' && !Number.isSafeInteger(Number(id)) ? String(id) : Number(id)
          issues.push({ code, path: file, table, field, rowId })
        }
      } catch {
        issues.push({ code: 'database-schema', path: file, table, field })
      }
    }

    for (const table of bodyOwners) {
      const absent = tables.has('contents') ? `NOT EXISTS (
        SELECT 1 FROM contents ref WHERE ref.id = owner.content_id AND typeof(ref.body) = 'text'
      )` : '1'
      const required = table === 'scene_cards' ? 'owner.content_id IS NOT NULL AND ' : ''
      findRows(table, 'content_id', 'missing-body', required + absent)
    }
    // Table names and predicates come only from the schema descriptors above.
    for (const { table, field, target, optional, match } of references) {
      const absent = tables.has(target) ? `NOT EXISTS (
        SELECT 1 FROM ${target} ref WHERE ref.id = owner.${field} ${match ? `AND ${match}` : ''}
      )` : '1'
      const required = optional ? `owner.${field} IS NOT NULL AND ` : ''
      findRows(table, field, 'orphan-reference', required + absent)
    }
    const chapterExists = ['drafts', 'blueprints'].filter(table => tables.has(table)).map(table =>
      `EXISTS (SELECT 1 FROM ${table} ref WHERE ref.chapter_number = owner.chapter_number)`)
    findRows('scene_cards', 'chapter_number', 'orphan-reference',
      chapterExists.length ? `NOT (${chapterExists.join(' OR ')})` : '1')
    return issues
  } finally {
    db.close()
  }
}
