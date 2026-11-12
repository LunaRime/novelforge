import type { CharacterData, CharacterStateData } from '../domain/character'
import type { CharacterEdit } from '../ports/character-edits'

export class CharacterEditConflict extends Error {}
export class CharacterNameConflict extends Error {}

const fields = [
  'role', 'gender', 'age', 'appearance', 'personality', 'background', 'abilities',
  'motivation', 'relationships', 'arc', 'notes', 'tier', 'tags', 'appearChapters',
  'relations', 'aliases', 'appearCount', 'firstChapter', 'lastChapter', 'status',
] as const satisfies readonly (keyof CharacterData)[]
const stateDefaults: CharacterStateData = {
  location: '', powerLevel: '', physicalState: '', mentalState: '', keyItems: '', recentEvents: '', updatedAtChapter: 0,
}
const stateFields = Object.keys(stateDefaults) as (keyof CharacterStateData)[]

function copyChange<T, K extends keyof T>(before: T, after: T, current: T, result: T, key: K, onConflict?: () => never) {
  if (Object.is(before[key], after[key])) return
  if (!Object.is(before[key], current[key]) && !Object.is(after[key], current[key])) onConflict?.()
  result[key] = after[key]
}

/** Reapply explicitly changed fields over a newer snapshot. */
export function applyCharacterDelta(before: CharacterData, after: CharacterData, current: CharacterData, onConflict?: () => never): CharacterData {
  const result = { ...current }
  for (const key of fields) copyChange(before, after, current, result, key, onConflict)
  copyChange(before, after, current, result, 'name', onConflict)
  const baseState = { ...stateDefaults, ...before.currentState }
  const nextState = { ...stateDefaults, ...after.currentState }
  const storedState = { ...stateDefaults, ...current.currentState }
  const state = { ...storedState }
  for (const key of stateFields) copyChange(baseState, nextState, storedState, state, key, onConflict)
  if (stateFields.some(key => !Object.is(state[key], storedState[key]))) result.currentState = state
  return result
}

export function hasCharacterChanges(before: CharacterData, after: CharacterData): boolean {
  return before.name !== after.name || fields.some(key => !Object.is(before[key], after[key]))
    || stateFields.some(key => !Object.is(before.currentState?.[key] ?? stateDefaults[key], after.currentState?.[key] ?? stateDefaults[key]))
}

export function planCharacterEdits(existing: CharacterData[], edits: CharacterEdit[]) {
  const byName = new Map(existing.map(card => [card.name, card]))
  const existingUids = new Set(existing.map(card => card.uid).filter(Boolean))
  const submittedNames = new Set<string>()
  const submittedUids = new Set<string>()
  const touched = new Set<string>()
  const writes: { previousName?: string; card: CharacterData }[] = []
  const removed: CharacterData[] = []
  const names = new Map<string, string | null>()
  for (const { before, after } of edits) {
    if (!before && !after) throw new CharacterEditConflict()
    if (after) {
      if (typeof after.name !== 'string' || !after.name.trim()) throw new CharacterEditConflict()
      if (submittedNames.has(after.name) || (after.name !== before?.name && byName.has(after.name))) throw new CharacterNameConflict(after.name)
      submittedNames.add(after.name)
    }
    if (!before) {
      if (after!.uid && (existingUids.has(after!.uid) || submittedUids.has(after!.uid))) throw new CharacterEditConflict(after!.name)
      if (after!.uid) submittedUids.add(after!.uid)
      writes.push({ card: after! })
      continue
    }
    const current = byName.get(before.name)
    if (!current || current.uid !== before.uid || touched.has(before.name)) throw new CharacterEditConflict(before.name)
    touched.add(before.name)
    if (!after) {
      if (hasCharacterChanges(before, current)) throw new CharacterEditConflict(before.name)
      removed.push(current)
      names.set(before.name, null)
      continue
    }
    const card = applyCharacterDelta(before, after, current, () => { throw new CharacterEditConflict(before.name) })
    if (card.name !== before.name) names.set(before.name, card.name)
    writes.push({ previousName: before.name, card })
  }
  return { writes, removed, names }
}

function remapJsonList(raw: string, map: (entry: unknown) => unknown): string {
  let values: unknown
  try { values = JSON.parse(raw) } catch { return raw }
  if (!Array.isArray(values)) return raw
  const mapped = values.map(map)
  if (mapped.every((entry, index) => entry === values[index])) return raw
  return JSON.stringify(mapped.filter(entry => entry !== removedReference))
}

const removedReference = Symbol()

export function remapCharacterRelations(raw: string, names: ReadonlyMap<string, string | null>): string {
  return remapJsonList(raw, entry => {
    if (!entry || typeof entry !== 'object' || !('target' in entry) || typeof entry.target !== 'string') return entry
    const target = names.get(entry.target)
    if (target === null) return removedReference
    return target === undefined || target === entry.target ? entry : { ...entry, target }
  })
}

export function remapCharacterNames(raw: string, names: ReadonlyMap<string, string | null>): string {
  let values: unknown
  try { values = JSON.parse(raw) } catch { return raw }
  if (!Array.isArray(values)) return raw
  const remapped = remapCharacterNameList(values, names)
  return remapped === values ? raw : JSON.stringify(remapped)
}

export function remapCharacterNameList(values: string[], names: ReadonlyMap<string, string | null>): string[] {
  const replacements = new Set<string>()
  const seen = new Set<string>()
  let changed = false
  for (const value of values) {
    if (typeof value !== 'string') continue
    const next = names.get(value)
    if (next === undefined || next === value) continue
    changed = true
    if (next !== null) replacements.add(next)
  }
  if (!changed) return values
  return values.flatMap(value => {
    if (typeof value !== 'string') return [value]
    const next = names.get(value)
    if (next === null) return []
    const name = next ?? value
    if (replacements.has(name)) {
      if (seen.has(name)) return []
      seen.add(name)
    }
    return [name]
  })
}

export function redirectCharacterMergeRelations(raw: string, sourceName: string, targetName: string): string {
  let relations: unknown
  try { relations = JSON.parse(raw) } catch { return raw }
  if (!Array.isArray(relations)) return raw
  const isTarget = (entry: unknown, name: string): entry is Record<string, unknown> =>
    !!entry && typeof entry === 'object' && 'target' in entry && entry.target === name
  const source = relations.find(relation => isTarget(relation, sourceName))
  if (!source) return raw
  const existing = relations.find(relation => isTarget(relation, targetName))
  const merged: Record<string, unknown> = { ...(existing ?? source), target: targetName }
  if (existing && !existing.sinceChapter && source.sinceChapter) merged.sinceChapter = source.sinceChapter
  let replaced = false
  return JSON.stringify(relations.flatMap(relation => {
    if (!isTarget(relation, targetName) && !isTarget(relation, sourceName)) return [relation]
    if (replaced) return []
    replaced = true
    return [merged]
  }))
}
