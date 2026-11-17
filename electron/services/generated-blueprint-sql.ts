import type { GeneratedBlueprintFields } from '../../src/core'

export const generatedBlueprintInsertSql = `INSERT INTO blueprints (chapter_number,title,role,purpose,key_events,characters,suspense_hook)
  VALUES (?,?,?,?,?,?,?)`

export function generatedBlueprintValues(item: GeneratedBlueprintFields) {
  return [item.chapterNumber, item.title, item.role, item.purpose, item.keyEvents, JSON.stringify(item.characters), item.suspenseHook]
}
