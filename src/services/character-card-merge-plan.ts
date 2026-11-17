import { stripNameAlias, matchCharacterName, normalizeCharacterRole, parseAliases, isNoChangeValue } from './character-normalize'

const textFields = ['gender', 'age', 'appearance', 'personality', 'background', 'abilities', 'motivation', 'relationships', 'arc', 'notes'] as const
const stateFields = ['location', 'powerLevel', 'physicalState', 'mentalState', 'keyItems', 'recentEvents'] as const
const listFields = ['tags', 'appearChapters', 'relations'] as const

export interface MergeStats { saved: number; merged: number; created: number }
export interface CharacterMergeIdentity { name: string; uid?: string; aliases?: string }

export function matchGeneratedCard<T extends { name: unknown }>(cards: T[], rawName: string): T | undefined {
  const name = stripNameAlias(rawName)
  return cards.find(card => card.name === rawName)
    ?? cards.find(card => card.name === name)
    ?? cards.find(card => stripNameAlias(String(card.name)) === name)
    ?? matchCharacterName(cards, rawName)
}

const empty = (value: unknown) => value == null || String(value).trim() === ''
const emptyList = (value: unknown) => empty(value) || String(value).trim() === '[]'
const objectFields = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {}

/** Fill gaps in the current database card with the model's usable fields. */
export function mergeCardRows(
  existing: Array<Record<string, unknown>>,
  cards: Array<Record<string, unknown>>,
): { rows: Array<Record<string, unknown>>; stats: MergeStats } {
  const current = new Map(existing.map(card => [String(card.name), card]))
  const writes = new Map<string, Record<string, unknown>>()
  const createdNames = new Set<string>()

  for (const card of cards) {
    const rawName = String(card?.name ?? '').trim()
    const name = stripNameAlias(rawName)
    if (!name) continue
    const previous = matchGeneratedCard([...current.values()] as Array<Record<string, unknown> & { name: unknown }>, rawName)
    const actualName = previous ? String(previous.name) : name
    const role = normalizeCharacterRole(String(card.role ?? ''))
    const next: Record<string, unknown> = previous ? { ...previous } : {
      name, role, tier: role === 'protagonist' || role === 'antagonist' ? 1 : role === 'minor' ? 3 : 2,
      tags: '', appearChapters: '[]', relations: '[]', aliases: JSON.stringify(parseAliases(card.aliases)),
    }
    if (!previous) createdNames.add(name)
    if (empty(next.role) && !isNoChangeValue(String(card.role ?? ''))) next.role = role
    for (const field of textFields) {
      if (empty(next[field]) && !isNoChangeValue(String(card[field] ?? ''))) next[field] = String(card[field])
      if (!previous && next[field] === undefined) next[field] = ''
    }
    for (const field of listFields) {
      const value = Array.isArray(card[field]) ? JSON.stringify(card[field]) : String(card[field] ?? '').trim()
      if (emptyList(next[field]) && !emptyList(value) && !isNoChangeValue(value)) next[field] = value
    }
    const state = { ...objectFields(previous?.currentState) }
    const incomingState = objectFields(card.currentState)
    let filledState = false
    for (const field of stateFields) {
      const value = incomingState[field]
      if (empty(state[field]) && typeof value === 'string' && !isNoChangeValue(value)) {
        state[field] = value
        filledState = true
      }
    }
    if (filledState) {
      const chapter = incomingState.updatedAtChapter
      if (!state.updatedAtChapter && typeof chapter === 'number' && Number.isSafeInteger(chapter) && chapter >= 0) state.updatedAtChapter = chapter
      next.currentState = state
    }
    current.set(actualName, next)
    writes.set(actualName, next)
  }

  return {
    rows: [...writes.values()],
    stats: { saved: writes.size, created: createdNames.size, merged: writes.size - createdNames.size },
  }
}
