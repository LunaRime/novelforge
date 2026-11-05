import { afterEach, describe, expect, test } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { SQLiteChapterIndex } from './sqlite-chapter-index'

const databases: DatabaseSync[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

function setup() {
  const db = new DatabaseSync(':memory:')
  databases.push(db)
  return { db, index: new SQLiteChapterIndex(db) }
}

const first = { id: 'chapter-a', number: 1, title: 'First', status: 'draft' as const, path: 'chapters/0001.md', revision: 'hash-a', wordCount: 10 }
const second = { id: 'chapter-b', number: 2, title: 'Second', status: 'revised' as const, path: 'chapters/0002.md', revision: 'hash-b', wordCount: 20 }

describe('SQLiteChapterIndex', () => {
  test('round trips chapter metadata ordered by number and survives adapter recreation', async () => {
    const { db, index } = setup()
    await index.replace([second, first])
    expect(await new SQLiteChapterIndex(db).list()).toEqual([first, second])
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 0 })
  })

  test('replaces the complete index including rebuilding it as empty', async () => {
    const { index } = setup()
    await index.replace([first, second])
    await index.replace([second])
    expect(await index.list()).toEqual([second])
    await index.replace([])
    expect(await index.list()).toEqual([])
  })

  test.each([
    { ...second, id: first.id },
    { ...second, number: first.number },
  ])('rejects duplicate identity or chapter number and preserves old index (%o)', async duplicate => {
    const { index } = setup()
    await index.replace([second])
    await expect(index.replace([first, duplicate])).rejects.toThrow()
    expect(await index.list()).toEqual([second])
  })

  test('rolls back deletion and partial inserts when SQLite rejects a write', async () => {
    const { db, index } = setup()
    await index.replace([second])
    db.exec(`CREATE TRIGGER fail_index_insert BEFORE INSERT ON chapter_index
      WHEN NEW.id = 'chapter-b' BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END`)
    await expect(index.replace([first, second])).rejects.toThrow('simulated write failure')
    expect(await index.list()).toEqual([second])
    db.exec('DROP TRIGGER fail_index_insert')
    await index.replace([first])
    expect(await index.list()).toEqual([first])
  })
})
