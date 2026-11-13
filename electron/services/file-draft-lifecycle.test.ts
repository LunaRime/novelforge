import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test } from 'vitest'
import { FileChapterStore, MemoryChapterIndex } from '../../src/core'
import { createFileDraftLifecycle } from './file-draft-lifecycle'

test('merges saved revision text, recovers a failed finalization, and archives without mutating the legacy drafts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-file-lifecycle-'))
  const db = new DatabaseSync(join(root, 'retained.db'))
  try {
    await mkdir(join(root, 'chapters'))
    db.exec(`
      CREATE TABLE drafts (id INTEGER PRIMARY KEY, content_id INTEGER);
      CREATE TABLE contents (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE revisions (id INTEGER PRIMARY KEY, base_draft_id INTEGER, content_id INTEGER,
        status TEXT, merged_to_draft_id INTEGER, updated_at INTEGER);
      INSERT INTO contents VALUES (1, 'old'), (2, 'proposal');
      INSERT INTO drafts VALUES (1, 1);
      INSERT INTO revisions VALUES (7, 1, 2, 'pending', NULL, 0), (8, 2, 2, 'pending', NULL, 0);
    `)
    const repo = await FileChapterStore.open({ projectPath: root, projectId: 'fixture', index: new MemoryChapterIndex() })
    const before = await repo.save({ projectId: 'fixture', id: 'ch_12345678', number: 1, title: 'chapter',
      status: 'draft', content: 'old', metadata: { legacyDraftId: 1 },
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }, { expectedRevision: null })
    const identity = [{ draftId: 1, chapterId: before.chapter.id, version: 1, branchId: null,
      target: { kind: 'current' as const, locator: `doc://chapter/${before.chapter.id}` } }]
    const service = () => createFileDraftLifecycle(db, repo, 'fixture', identity)
    const merge = { kind: 'merge' as const, chapterId: before.chapter.id, expectedRevision: before.revision, revisionId: 7 }
    await expect(service().commit({ ...merge, revisionId: 8 })).rejects.toThrow()
    expect((await repo.byId(before.chapter.id))?.chapter.content).toBe('old')
    const merged = await service().commit(merge)
    expect(await service().commit(merge)).toEqual(merged)
    expect(db.prepare('SELECT status, merged_to_draft_id FROM revisions WHERE id = 7').get())
      .toEqual({ status: 'merged', merged_to_draft_id: 1 })
    expect((await repo.byId(before.chapter.id))?.chapter).toMatchObject({ content: 'proposal', status: 'revised' })

    db.exec("CREATE TRIGGER interrupt BEFORE UPDATE ON file_draft_states BEGIN SELECT RAISE(ABORT, 'interrupted'); END")
    await expect(service().commit({ kind: 'finalize', chapterId: before.chapter.id, expectedRevision: merged.revision })).rejects.toThrow('interrupted')
    expect((await repo.byId(before.chapter.id))?.chapter.status).toBe('finalized')
    expect(db.prepare('SELECT status FROM file_draft_states').get()?.status).toBe('revised')
    db.exec('DROP TRIGGER interrupt')
    const recovered = await service().recover()
    expect(recovered?.status).toBe('committed')
    expect(await service().recover()).toBeNull()
    const archived = await service().commit({ kind: 'archive', chapterId: before.chapter.id, expectedRevision: recovered!.revision })
    expect((await repo.byId(before.chapter.id))?.chapter).toMatchObject({ status: 'archived', content: 'proposal' })
    expect(db.prepare('SELECT status, revision FROM file_draft_states').get()).toEqual({ status: 'archived', revision: archived.revision })
    expect(db.prepare('SELECT body FROM drafts JOIN contents ON contents.id = drafts.content_id').get()?.body).toBe('old')
  } finally {
    db.close()
    await rm(root, { recursive: true, force: true })
  }
})
