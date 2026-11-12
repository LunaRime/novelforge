import { CharacterEditConflict, remapCharacterNames } from '../../src/core'
import type { getProjectDb } from '../database'

export function rewriteBlueprintCharacterReferences(
  db: NonNullable<ReturnType<typeof getProjectDb>>,
  names: ReadonlyMap<string, string | null>,
  uids: ReadonlyMap<string, string | null>,
): void {
  const blueprints = db.prepare('SELECT chapter_number, characters, character_uids FROM blueprints').all() as {
    chapter_number: number; characters: string; character_uids: string
  }[]
  const update = db.prepare('UPDATE blueprints SET characters = ?, character_uids = ?, updated_at = unixepoch() * 1000 WHERE chapter_number = ?')
  for (const row of blueprints) {
    const nextNames = remapCharacterNames(row.characters, names)
    const nextUids = remapCharacterNames(row.character_uids, uids)
    if ((nextNames !== row.characters || nextUids !== row.character_uids)
      && update.run(nextNames, nextUids, row.chapter_number).changes !== 1) throw new CharacterEditConflict()
  }
}
