import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test, vi } from 'vitest'
import { FileChapterStore, MemoryChapterIndex } from '../core'
import { SQLiteFileCommitJournal } from '../core/adapters/sqlite-file-commit-journal'
import { commitFileChapter, type FileChapterCommit } from '../core/application/commit-file-chapter'

test('resumes after file publication and rolls back partial metadata without writing the file twice', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-file-commit-'))
  const path = join(root, 'retained.db')
  const openRepo = () => FileChapterStore.open({ projectPath: root, projectId: 'fixture', index: new MemoryChapterIndex() })
  const db = new DatabaseSync(path)
  let restarted: DatabaseSync | undefined
  try {
    db.exec('CREATE TABLE feedback (id INTEGER PRIMARY KEY, applications INTEGER NOT NULL); INSERT INTO feedback VALUES (1, 0)')
    const repo = await openRepo()
    const before = await repo.save({
      projectId: 'fixture', id: 'ch_12345678', number: 1, title: 'Chapter', status: 'draft', content: 'old',
      createdAt: '2001-01-01T00:00:00Z', updatedAt: '2001-01-01T00:00:00Z',
    }, { expectedRevision: null })
    const intent: FileChapterCommit = { operationId: 'merge-1', kind: 'merge', recordId: 1, expectedRevision: before.revision,
      chapter: { ...before.chapter, status: 'revised', content: 'new' } }
    const apply = (connection: DatabaseSync) => connection.exec('UPDATE feedback SET applications = applications + 1')
    const initialJournal = new SQLiteFileCommitJournal(db, 'fixture')
    // A persisted intent can be resumed even if the process exits before touching the file.
    expect(initialJournal.prepare(intent)).toBeNull()
    expect((await repo.byId(intent.chapter.id))?.chapter.content).toBe('old')
    const lockedWrite = vi.fn()
    await repo.withCommitLock(async () => {
      await expect(commitFileChapter(intent, repo, initialJournal, lockedWrite)).rejects.toMatchObject({ code: 'locked' })
    })
    expect(lockedWrite).not.toHaveBeenCalled()
    await expect(commitFileChapter(intent, repo, new SQLiteFileCommitJournal(db, 'fixture'), () => {
      apply(db)
      throw new Error('interrupted metadata commit')
    })).rejects.toThrow('interrupted metadata commit')
    expect(db.prepare('SELECT applications FROM feedback').get()?.applications).toBe(0)
    expect((await repo.byId(intent.chapter.id))?.chapter.content).toBe('new')
    restarted = new DatabaseSync(path)
    const journal = new SQLiteFileCommitJournal(restarted, 'fixture')
    const recovered = await commitFileChapter(journal.pending()!, await openRepo(), journal, () => apply(restarted!))
    expect(recovered).toMatchObject({ status: 'committed' })
    expect(await commitFileChapter(intent, await openRepo(), journal, () => apply(restarted!))).toEqual(recovered)
    expect(restarted.prepare('SELECT applications FROM feedback').get()?.applications).toBe(1)
    expect(journal.pending()).toBeNull()
    expect(restarted.prepare('SELECT payload FROM file_chapter_commits').get()?.payload).toBeNull()
    await expect(commitFileChapter({ ...intent, recordId: 2 }, repo, journal, () => apply(restarted!)))
      .rejects.toMatchObject({ code: 'conflict' })

    const next = { ...intent, operationId: 'merge-2', expectedRevision: recovered.revision,
      chapter: { ...intent.chapter, content: 'next' } }
    journal.prepare(next)
    expect(() => journal.prepare({ ...next, operationId: 'merge-3' })).toThrow('awaiting recovery')
    const current = (await repo.byId(intent.chapter.id))!
    await repo.save({ ...current.chapter, content: 'external' }, { expectedRevision: current.revision })
    await expect(commitFileChapter(next, repo, journal, () => apply(restarted!))).rejects.toMatchObject({ code: 'conflict' })
    expect(journal.pending()).toEqual(next)
    expect((await repo.byId(intent.chapter.id))?.chapter.content).toBe('external')
    expect(restarted.prepare('SELECT applications FROM feedback').get()?.applications).toBe(1)
  } finally {
    restarted?.close()
    db.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('recovers first chapter publication and keeps occupied chapter numbers out of the journal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-file-create-'))
  const path = join(root, 'retained.db')
  const openRepo = () => FileChapterStore.open({ projectPath: root, projectId: 'fixture', index: new MemoryChapterIndex() })
  const db = new DatabaseSync(path)
  let restarted: DatabaseSync | undefined
  try {
    const repo = await openRepo()
    const journal = new SQLiteFileCommitJournal(db, 'fixture')
    const intent: FileChapterCommit = {
      operationId: 'import-1', kind: 'create', recordId: 1, expectedRevision: null,
      chapter: {
        projectId: 'fixture', id: 'ch_12345678', number: 1, title: 'Chapter', status: 'draft', content: 'imported',
        createdAt: '2001-01-01T00:00:00Z', updatedAt: '2001-01-01T00:00:00Z',
      },
    }
    // Preparation survives a stop before file publication, and metadata failure leaves it recoverable.
    expect(journal.prepare(intent)).toBeNull()
    expect(await repo.byId(intent.chapter.id)).toBeNull()
    await expect(commitFileChapter(intent, repo, journal, () => {
      throw new Error('interrupted metadata commit')
    })).rejects.toThrow('interrupted metadata commit')
    expect((await repo.byId(intent.chapter.id))?.chapter).toEqual(intent.chapter)
    restarted = new DatabaseSync(path)
    const reopened = new SQLiteFileCommitJournal(restarted, 'fixture')
    const restartedRepo = await openRepo()
    const apply = vi.fn()
    const receipt = await commitFileChapter(reopened.pending()!, restartedRepo, reopened, apply)
    expect(await commitFileChapter(intent, restartedRepo, reopened, apply)).toEqual(receipt)
    expect(apply).toHaveBeenCalledTimes(1)

    const occupied = { ...intent, operationId: 'import-2', chapter: { ...intent.chapter, id: 'ch_87654321' } }
    await expect(commitFileChapter(occupied, restartedRepo, reopened, apply)).rejects.toMatchObject({ code: 'conflict' })
    expect(reopened.pending()).toBeNull()
    expect(await restartedRepo.byId(occupied.chapter.id)).toBeNull()
  } finally {
    restarted?.close()
    db.close()
    await rm(root, { recursive: true, force: true })
  }
})
