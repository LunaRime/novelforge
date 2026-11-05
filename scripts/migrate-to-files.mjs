#!/usr/bin/env node
// Offline verification export. This command does not switch application storage.
import { DatabaseSync, backup } from 'node:sqlite'
import { readFile, realpath, lstat } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'
import ts from 'typescript'
import { createHash } from 'node:crypto'

const [sourceArg, destinationArg, projectId, ...extra] = process.argv.slice(2)
if (!sourceArg || !destinationArg || !projectId || extra.length) {
  console.error('Usage: node scripts/migrate-to-files.mjs <offline-vela.db-copy> <new-export-directory> <project-id>')
  process.exitCode = 1
} else {
  let db
  try {
    const sourcePath = await realpath(sourceArg)
    const destination = resolve(destinationArg)
    const inside = relative(destination, sourcePath)
    if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))) throw new Error('source database must be outside export directory')
    // Require an offline copy: WAL would indicate that copying only the database may have lost committed rows.
    try { await lstat(`${sourcePath}-wal`); throw new Error('source has WAL sidecar; provide a consistent offline database copy') }
    catch (e) { if (e.code !== 'ENOENT') throw e }
    db = new DatabaseSync(sourcePath, { readOnly: true })
    // Every content-pool owner in database.ts must remain reconstructable from the backup.
    // scene_cards.content_id is nullable by design; the other tables require a body.
    for (const table of ['draft_snapshots', 'revisions', 'reviews', 'scene_cards']) {
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) continue
      const hasHash = table === 'draft_snapshots'
      const associated = db.prepare(`SELECT owner.id, c.body ${hasHash ? ', owner.content_hash AS contentHash' : ''}
        FROM ${table} owner LEFT JOIN contents c ON c.id = owner.content_id
        ${table === 'scene_cards' ? 'WHERE owner.content_id IS NOT NULL' : ''}`).all()
      for (const row of associated) {
        if (typeof row.body !== 'string') throw new Error(`missing content: ${table} row ${row.id}`)
        if (hasHash && (typeof row.contentHash !== 'string' ||
            createHash('sha256').update(row.body).digest('hex') !== row.contentHash)) {
          throw new Error(`content hash mismatch: ${table} row ${row.id}`)
        }
      }
    }
    const moduleText = await readFile(new URL('../src/core/migration/export-legacy-project.ts', import.meta.url), 'utf8')
    const javascript = ts.transpileModule(moduleText, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    const { exportLegacyProject } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`)
    const listDrafts = async () => db.prepare(`
      SELECT d.id, d.chapter_number AS chapterNumber, d.version, d.branch_id AS branchId,
             d.status, c.body AS content, COALESCE(b.title, '') AS title,
             COALESCE(d.content_hash, '') AS contentHash, d.created_at AS createdAt, d.updated_at AS updatedAt
      FROM drafts d LEFT JOIN contents c ON c.id = d.content_id
      LEFT JOIN blueprints b ON b.chapter_number = d.chapter_number
      ORDER BY d.id
    `).all()
    const fingerprint = async () => createHash('sha256').update(await readFile(sourcePath)).digest('hex')
    const report = await exportLegacyProject({ source: { listDrafts, backup: p => backup(db, p), fingerprint }, destination, projectId })
    console.log(JSON.stringify({ ...report, destination, applicationStorageChanged: false }, null, 2))
  } catch (e) {
    console.error(`Export failed: ${e.message}`)
    process.exitCode = 1
  } finally { db?.close() }
}
