import { describe, it, expect } from 'vitest'
import { isReadOnlySql } from './sql-guard'

describe('isReadOnlySql', () => {
  it('允许 SELECT / WITH / 只读 PRAGMA', () => {
    expect(isReadOnlySql('SELECT * FROM drafts').ok).toBe(true)
    expect(isReadOnlySql('WITH x AS (SELECT 1) SELECT * FROM x').ok).toBe(true)
    expect(isReadOnlySql('PRAGMA table_info(drafts)').ok).toBe(true)
    expect(isReadOnlySql('PRAGMA user_version').ok).toBe(true)
    expect(isReadOnlySql('SELECT 1;').ok).toBe(true)
  })

  it.each([
    'DELETE FROM drafts',
    'UPDATE drafts SET version=2',
    'INSERT INTO drafts VALUES (1)',
    'DROP TABLE drafts',
    'ALTER TABLE drafts ADD COLUMN x TEXT',
    'ATTACH DATABASE "x" AS y',
    'PRAGMA writable_schema=ON',
    'SELECT 1; DELETE FROM drafts',
    'WITH x AS (SELECT 1) DELETE FROM drafts',
    '',
  ])('拒绝 %s', (sql) => {
    expect(isReadOnlySql(sql).ok).toBe(false)
  })

  it('拒绝注释中夹带写操作', () => {
    expect(isReadOnlySql('SELECT 1 -- ok\n; DELETE FROM drafts').ok).toBe(false)
    expect(isReadOnlySql('/* x */ DELETE FROM drafts').ok).toBe(false)
  })
})