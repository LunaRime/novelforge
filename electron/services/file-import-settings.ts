import type { ChapterIndexDatabase } from '../../src/core'
import type { FileImportSettingField, FileImportSettings } from '../../src/shared/ipc-channels'

const columns = {
  worldSetting: 'world_setting', coreOutline: 'core_outline',
  protagonistProfile: 'protagonist_profile', writingStyle: 'writing_style',
} as const satisfies Record<FileImportSettingField, string>
const fields = Object.keys(columns) as FileImportSettingField[]

export type SettingBaseline = Partial<Record<FileImportSettingField, { version: number; occupied: boolean }>>

function availableFields(db: ChapterIndexDatabase): FileImportSettingField[] {
  const names = new Set((db.prepare('PRAGMA table_info(project_core)').all() as Array<{ name: string }>).map(column => column.name))
  return names.has('id') && names.has('updated_at') ? fields.filter(field => names.has(columns[field])) : []
}

export function installFileImportSettingVersions(db: ChapterIndexDatabase): void {
  const available = availableFields(db)
  if (!available.length) return
  db.exec('SAVEPOINT install_file_import_setting_versions')
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS file_import_setting_versions (field TEXT PRIMARY KEY, version INTEGER NOT NULL)`)
    const initialize = db.prepare('INSERT OR IGNORE INTO file_import_setting_versions (field, version) VALUES (?, 0)')
    // 跟踪每个实际变化的字段。即使字段被编辑后又清空，旧预览仍会失效。
    for (const field of available) {
      const column = columns[field]
      initialize.run(field)
      db.exec(`CREATE TRIGGER IF NOT EXISTS file_import_setting_${column} AFTER UPDATE OF ${column} ON project_core
        WHEN OLD.id = 'main' AND NEW.id = 'main' AND OLD.${column} IS NOT NEW.${column}
        BEGIN UPDATE file_import_setting_versions SET version = version + 1 WHERE field = '${field}'; END`)
    }
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS file_import_settings_insert AFTER INSERT ON project_core WHEN NEW.id = 'main'
        BEGIN UPDATE file_import_setting_versions SET version = version + 1; END;
      CREATE TRIGGER IF NOT EXISTS file_import_settings_delete AFTER DELETE ON project_core WHEN OLD.id = 'main'
        BEGIN UPDATE file_import_setting_versions SET version = version + 1; END;
      CREATE TRIGGER IF NOT EXISTS file_import_settings_move AFTER UPDATE OF id ON project_core
        WHEN OLD.id IS NOT NEW.id AND (OLD.id = 'main' OR NEW.id = 'main')
        BEGIN UPDATE file_import_setting_versions SET version = version + 1; END;
    `)
    db.exec('RELEASE install_file_import_setting_versions')
  } catch (error) {
    db.exec('ROLLBACK TO install_file_import_setting_versions; RELEASE install_file_import_setting_versions')
    throw error
  }
}

export function readFileImportSettingBaseline(db: ChapterIndexDatabase): SettingBaseline {
  const available = availableFields(db)
  if (!available.length || !db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'file_import_setting_versions'").all().length) return {}
  // 在同一个 SQLite 读快照中取字段值和版本，避免并发保存时读到不同步的状态。
  const cases = available.map(field => `WHEN '${field}' THEN p.${columns[field]}`).join(' ')
  const rows = db.prepare(`SELECT v.field, v.version, CASE v.field ${cases} END AS value
    FROM file_import_setting_versions v JOIN project_core p ON p.id = 'main'`).all() as Array<{
      field: FileImportSettingField; version: number; value: unknown
    }>
  const result: SettingBaseline = {}
  for (const { field, version, value } of rows) {
    if (available.includes(field) && Number.isSafeInteger(version) && version >= 0) {
      result[field] = { version, occupied: value !== null && (typeof value !== 'string' || value.trim() !== '') }
    }
  }
  return result
}

export function applyFileImportSettings(db: ChapterIndexDatabase, baseline: SettingBaseline, settings: FileImportSettings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
      Object.entries(settings).some(([field, value]) => !Object.hasOwn(columns, field) || typeof value !== 'string')) {
    throw new Error('Invalid imported settings')
  }
  const applied: FileImportSettingField[] = []
  const values: string[] = []
  db.exec('BEGIN IMMEDIATE')
  try {
    const current = readFileImportSettingBaseline(db)
    for (const field of fields) {
      if (!Object.hasOwn(settings, field)) continue
      const value = settings[field]?.trim()
      const previous = baseline[field]
      if (!value || !previous || previous.occupied) continue
      const target = current[field]
      if (!target || target.occupied || target.version !== previous.version) throw new Error('Imported settings changed since preview')
      applied.push(field)
      values.push(value)
    }
    if (applied.length) {
      // 只写确认时仍符合预览版本的空白字段，所有变更和版本递增一起提交。
      const result = db.prepare(`UPDATE project_core SET ${applied.map(field => `${columns[field]} = ?`).join(', ')}, updated_at = ?
        WHERE id = 'main'`).run(...values, Date.now()) as { changes: number }
      if (result.changes !== 1) throw new Error('Imported settings target is unavailable')
    }
    db.exec('COMMIT')
    return { applied }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
