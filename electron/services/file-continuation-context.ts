import { fileRevision, type ChapterIndexDatabase } from '../../src/core'

const settingFields = {
  genre: 'genre', subGenre: 'sub_genre', narrativePov: 'narrative_pov', globalGuidance: 'global_guidance',
  coreOutline: 'core_outline', worldSetting: 'world_setting', protagonistProfile: 'protagonist_profile', writingStyle: 'writing_style',
}
const blueprintFields = {
  title: 'title', role: 'role', purpose: 'purpose', keyEvents: 'key_events', characters: 'characters',
  suspenseHook: 'suspense_hook', userGuidance: 'user_guidance',
}

function readFields(db: ChapterIndexDatabase, table: 'project_core' | 'blueprints', key: 'id' | 'chapter_number',
  value: string | number, fields: Record<string, string>): Record<string, string> {
  const existing = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(({ name }) => name))
  const available = Object.entries(fields).filter(([, column]) => existing.has(column))
  if (!existing.has(key) || !available.length) return {}

  // 只选择白名单中已有的列，不读取旧库缺省字段、蓝图笔记或其他章节。
  const projection = available.map(([field, column]) => `substr(${column}, 1, 2000) AS ${field}`).join(', ')
  const [row, duplicate] = db.prepare(`SELECT ${projection} FROM ${table} WHERE ${key} = ? LIMIT 2`).all(value) as Array<Record<string, unknown>>
  if (duplicate) throw new Error('Duplicate continuation context row')
  return Object.fromEntries(Object.entries(row ?? {}).flatMap(([field, text]) =>
    typeof text === 'string' && text.trim() ? [[field, text.trim()]] : []))
}

/** 调用方持有 SQLite 读快照或写事务，确保设定和蓝图使用同一批数据。 */
export function readFileContinuationContext(db: ChapterIndexDatabase, number: number) {
  const settings = readFields(db, 'project_core', 'id', 'main', settingFields)
  const blueprint = readFields(db, 'blueprints', 'chapter_number', number, blueprintFields)
  return { settings, blueprint, contextRevision: fileRevision(JSON.stringify([number, settings, blueprint])) }
}
