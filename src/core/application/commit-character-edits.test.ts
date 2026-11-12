import { expect, it } from 'vitest'
import { planCharacterEdits, remapCharacterRelations } from './commit-character-edits'
import type { CharacterData } from '../domain/character'

const card = (name: string, more: Partial<CharacterData> = {}): CharacterData => ({
  name, uid: name, role: 'supporting', gender: '', age: '', appearance: '', personality: '',
  background: '', abilities: '', motivation: '', relationships: '', arc: '', notes: '',
  tier: 2, tags: '', appearChapters: '[]', relations: '[]', ...more,
})

it('renames the captured identity and preserves unrelated fields written in the meantime', () => {
  const before = card('A')
  const current = { ...before, background: 'new background' }
  const plan = planCharacterEdits([current, card('Concurrent')], [{ before, after: { ...before, name: 'C', notes: 'manual' } }])
  expect(plan.writes).toEqual([{ previousName: 'A', card: { ...current, name: 'C', notes: 'manual' } }])
  expect(plan.names.get('A')).toBe('C')
})

it('rejects a concurrent edit to the same field, stale identity and new-name collisions', () => {
  const before = card('A')
  expect(() => planCharacterEdits([{ ...before, notes: 'concurrent' }], [{ before, after: { ...before, notes: 'manual' } }])).toThrow()
  expect(() => planCharacterEdits([{ ...before, uid: 'replacement' }], [{ before, after: null }])).toThrow()
  expect(() => planCharacterEdits([before, card('B')], [{ before, after: { ...before, name: 'B' } }])).toThrow()
})

it('rejects deletion if the captured card changed while confirmation was open', () => {
  const before = card('A')
  expect(() => planCharacterEdits([{ ...before, background: 'new' }], [{ before, after: null }])).toThrow()
})

it('rewrites original names exactly once and preserves malformed or unrelated metadata', () => {
  const names = new Map([['A', 'B'], ['B', 'C'], ['X', null]])
  expect(remapCharacterRelations('[{"target":"A","label":"old"},{"target":"B"},{"target":"X"},null]', names))
    .toBe('[{"target":"B","label":"old"},{"target":"C"},null]')
  expect(remapCharacterRelations('malformed', names)).toBe('malformed')
})
