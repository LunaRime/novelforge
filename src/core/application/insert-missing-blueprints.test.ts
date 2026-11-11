import { expect, test, vi } from 'vitest'
import { insertMissingBlueprints, type MissingBlueprintInput, type MissingBlueprintRow } from './insert-missing-blueprints'

const scope = { projectPath: '/a', token: 'connection-a' }
const row = (chapterNumber: number): MissingBlueprintRow => ({ chapterNumber, title: 'Title', role: '发展', purpose: '', keyEvents: '', characters: [], suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: 0, sortOrder: 0, priority: 0, volumeNumber: null })
const request = (): MissingBlueprintInput => ({ scope, targetChapterNumbers: [1, 2, 3], items: [row(1), row(2)] })
const fixture = () => ({ scope: () => scope, atomic: <T>(work: () => T) => work(), insert: vi.fn((item: MissingBlueprintRow) => item.chapterNumber !== 1) })
test('reports only actual inserts and does not treat occupied targets as overwritten', () => {
  const ports = fixture()
  expect(insertMissingBlueprints(request(), ports)).toEqual({ insertedChapterNumbers: [2], skippedChapterNumbers: [1] })
  expect(ports.insert).toHaveBeenCalledTimes(2)
})
test.each([
  { targetChapterNumbers: [] }, { targetChapterNumbers: [1, 1] }, { targetChapterNumbers: [0] },
  { items: [row(4)] }, { items: [row(1), row(1)] }, { items: [{ ...row(1), title: null }] },
  { items: [{ ...row(1), chapterNumber: 1.5 }] }, { items: [{ ...row(1), characters: [1] }] },
  { items: [{ ...row(1), notesUpdatedAt: -1 }] }, { items: [{ ...row(1), volumeNumber: -1 }] },
])('rejects malformed input before opening a transaction: %o', invalid => {
  const ports = { ...fixture(), atomic: vi.fn() }
  expect(() => insertMissingBlueprints({ ...request(), ...invalid } as MissingBlueprintInput, ports)).toThrow()
  expect(ports.atomic).not.toHaveBeenCalled(); expect(ports.insert).not.toHaveBeenCalled()
})
test('rejects stale source and checks scope inside the transaction before writing', () => {
  const ports = fixture()
  ports.scope = () => ({ ...scope, token: 'reopened' })
  expect(() => insertMissingBlueprints(request(), ports)).toThrow()
  expect(ports.insert).not.toHaveBeenCalled()
  ports.scope = () => scope
  ports.atomic = work => { ports.scope = () => ({ ...scope, token: 'reopened' }); return work() }
  expect(() => insertMissingBlueprints(request(), ports)).toThrow()
  expect(ports.insert).not.toHaveBeenCalled()
})
test('permits empty generated output without claiming filled targets', () => {
  expect(insertMissingBlueprints({ ...request(), items: [] }, fixture())).toEqual({ insertedChapterNumbers: [], skippedChapterNumbers: [] })
})
