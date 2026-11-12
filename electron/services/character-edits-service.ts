import {
  CharacterEditConflict, CharacterNameConflict, planCharacterEdits, remapCharacterNames, remapCharacterRelations,
  type CharacterEditsInput, type CharacterEditsResult, type CharacterEditSnapshot,
} from '../../src/core'
import { getProjectDb } from '../database'
import { CharacterRepository } from '../repositories/character-repository'
import { t } from '../../src/shared/locale'
import { captureProjectWriteScope } from './project-write-scope'
import { matchGeneratedCard, mergeCardRows, type CharacterMergeIdentity } from '../../src/services/character-card-merge-plan'
import { parseAliases } from '../../src/services/character-normalize'
import type { CharacterData, CharacterFieldWrite, CharacterWriteScope } from '../../src/core'

export function readCharacterEditSnapshot(): CharacterEditSnapshot {
  const scope = captureProjectWriteScope()
  return { scope, cards: CharacterRepository.getAll() }
}

export function resolveCharacterFieldTarget(name: string, target: CharacterFieldWrite): string {
  const current = captureProjectWriteScope()
  if (target.scope?.projectPath !== current.projectPath || target.scope.token !== current.token) {
    throw new Error(t('error.requestCancelled'))
  }
  const card = target.uid ? CharacterRepository.getByUid(target.uid) : CharacterRepository.getByName(name)
  if (!card || card.uid !== target.uid) throw new Error(t('error.characterEditConflict'))
  return card.name
}

export function mergeDatabaseCharacterCards(input: { scope: CharacterWriteScope; cards: Array<Record<string, unknown>>; known: CharacterMergeIdentity[] }) {
  const db = getProjectDb()
  if (!db) return { success: false as const, error: t('error.requestCancelled') }
  try {
    return db.transaction(() => {
      const scope = captureProjectWriteScope()
      if (input?.scope?.projectPath !== scope.projectPath || input.scope.token !== scope.token) {
        return { success: false as const, error: t('error.requestCancelled') }
      }
      if (!Array.isArray(input.cards) || !Array.isArray(input.known)) throw new CharacterEditConflict()
      const existing = CharacterRepository.getAll()
      const cards = input.cards.flatMap(card => {
        const known = matchGeneratedCard(input.known, String(card?.name ?? '').trim())
        if (!known) return [card]
        const current = existing.find(row => known.uid ? row.uid === known.uid : row.name === known.name)
        return current ? [{ ...card, name: current.name }] : []
      })
      const { rows, stats } = mergeCardRows(existing as unknown as Array<Record<string, unknown>>, cards)
      for (const row of rows) {
        if (CharacterRepository.upsert(row as unknown as CharacterData) !== 1) throw new CharacterEditConflict()
      }
      return { success: true as const, stats }
    })()
  } catch (error) {
    return { success: false as const, error: String(error) }
  }
}

export function commitDatabaseCharacterEdits(input: CharacterEditsInput): CharacterEditsResult {
  const db = getProjectDb()
  if (!db) return { success: false, error: t('error.requestCancelled') }
  try {
    return db.transaction((): CharacterEditsResult => {
      const scope = captureProjectWriteScope()
      if (!input?.scope || input.scope.projectPath !== scope.projectPath || input.scope.token !== scope.token) {
        return { success: false, error: t('error.requestCancelled') }
      }
      if (!Array.isArray(input.edits)) throw new CharacterEditConflict()
      const existing = CharacterRepository.getAll()
      if (input.relationTargets?.some(target => !existing.some(card => card.name === target.name && card.uid === target.uid))) {
        throw new CharacterEditConflict()
      }
      const plan = planCharacterEdits(existing, input.edits)
      const rename = db.prepare('UPDATE characters SET name = ? WHERE name = ?')
      for (const { previousName, card } of plan.writes) {
        let write = card
        if (previousName !== undefined && previousName !== card.name) {
          if (rename.run(card.name, previousName).changes !== 1) throw new CharacterEditConflict(previousName)
          const aliases = new Set(parseAliases(card.aliases).filter(alias => alias !== card.name))
          aliases.add(previousName)
          write = { ...card, aliases: JSON.stringify([...aliases]) }
        }
        if (CharacterRepository.upsert(write) !== 1) throw new CharacterEditConflict(card.name)
      }
      const remove = db.prepare('DELETE FROM characters WHERE name = ?')
      for (const card of plan.removed) {
        if (remove.run(card.name).changes !== 1) throw new CharacterEditConflict(card.name)
      }

      if (plan.names.size) {
        const related = db.prepare('SELECT name, relations FROM characters').all() as { name: string; relations: string }[]
        const updateRelations = db.prepare('UPDATE characters SET relations = ?, updated_at = unixepoch() * 1000 WHERE name = ?')
        for (const row of related) {
          const relations = remapCharacterRelations(row.relations, plan.names)
          if (relations !== row.relations && updateRelations.run(relations, row.name).changes !== 1) throw new CharacterEditConflict(row.name)
        }

        const removedUids = new Map(plan.removed.flatMap(card => card.uid ? [[card.uid, null] as const] : []))
        const blueprints = db.prepare('SELECT chapter_number, characters, character_uids FROM blueprints').all() as {
          chapter_number: number; characters: string; character_uids: string
        }[]
        const updateBlueprint = db.prepare('UPDATE blueprints SET characters = ?, character_uids = ?, updated_at = unixepoch() * 1000 WHERE chapter_number = ?')
        for (const row of blueprints) {
          const names = remapCharacterNames(row.characters, plan.names)
          const uids = remapCharacterNames(row.character_uids, removedUids)
          if ((names !== row.characters || uids !== row.character_uids)
            && updateBlueprint.run(names, uids, row.chapter_number).changes !== 1) throw new CharacterEditConflict()
        }
      }
      return { success: true, cards: CharacterRepository.getAll() }
    })()
  } catch (error) {
    if (error instanceof CharacterNameConflict) {
      return { success: false, error: t('error.characterDuplicateName').replace('{name}', () => error.message) }
    }
    if (error instanceof CharacterEditConflict) return { success: false, error: t('error.characterEditConflict') }
    return { success: false, error: String(error) }
  }
}
