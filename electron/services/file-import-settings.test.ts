import { DatabaseSync } from 'node:sqlite'
import { expect, test } from 'vitest'
import { applyFileImportSettings, installFileImportSettingVersions, readFileImportSettingBaseline } from './file-import-settings'

test('keeps old retained schemas usable and fills only columns they provide', () => {
  const db = new DatabaseSync(':memory:')
  try {
    installFileImportSettingVersions(db)
    expect(readFileImportSettingBaseline(db)).toEqual({})
    db.exec(`CREATE TABLE project_core (id TEXT PRIMARY KEY, writing_style TEXT, other TEXT, updated_at INTEGER);
      INSERT INTO project_core VALUES ('main', '', 'original', 0)`)
    installFileImportSettingVersions(db)
    const baseline = readFileImportSettingBaseline(db)
    expect(baseline).toEqual({ writingStyle: { occupied: false, version: 0 } })
    db.exec("UPDATE project_core SET other = 'manual edit' WHERE id = 'main'")
    expect(applyFileImportSettings(db, baseline, { worldSetting: 'Unavailable', writingStyle: 'Concise' }))
      .toEqual({ applied: ['writingStyle'] })
    expect(db.prepare('SELECT writing_style, other FROM project_core').get()).toEqual({ writing_style: 'Concise', other: 'manual edit' })
    installFileImportSettingVersions(db)
    expect(readFileImportSettingBaseline(db)).toEqual({ writingStyle: { occupied: true, version: 1 } })
  } finally { db.close() }
})
