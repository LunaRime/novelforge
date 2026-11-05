import { afterEach, expect, test } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { exportLegacyProject, FileChapterStore, SQLiteChapterIndex } from '../core'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))) })

test('离线导出可被文件仓储读取，SQLite 索引丢失后可完整重建', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-core-integration-'))
  roots.push(root)
  const destination = join(root, 'export')
  await exportLegacyProject({ projectId: 'integrated', destination, source: {
    listDrafts: async () => [{ id: 3, chapterNumber: 2, version: 1, branchId: null,
      status: 'finalized', content: '雨夜正文\n', title: '雨夜', contentHash: '', createdAt: 1, updatedAt: 2 }],
    backup: async p => { await writeFile(p, 'backup fixture') },
  } })
  const db = new DatabaseSync(':memory:')
  try {
    const index = new SQLiteChapterIndex(db)
    const repo = await FileChapterStore.open({ projectPath: destination, projectId: 'integrated', index })
    const [meta] = await repo.list()
    const stored = await repo.byId(meta.id)
    expect(stored?.chapter.content).toBe('雨夜正文\n')
    expect(stored?.chapter.metadata?.legacyDraftId).toBe(3)
    db.exec('DROP TABLE chapter_index')
    const rebuilt = await FileChapterStore.open({ projectPath: destination, projectId: 'integrated', index: new SQLiteChapterIndex(db) })
    expect(await rebuilt.list()).toEqual([meta])
    const edited = await rebuilt.save({ ...stored!.chapter, title: '新标题' }, { expectedRevision: stored!.revision })
    expect(edited.chapter.metadata?.legacyDraftId).toBe(3)
    expect((await rebuilt.byId(meta.id))?.chapter.title).toBe('新标题')
  } finally { db.close() }
})
