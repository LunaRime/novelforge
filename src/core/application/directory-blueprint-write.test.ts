import { expect, test } from 'vitest'
import {
  getDirectoryBlueprintDeletions,
  resolveDirectoryWriteRange,
  validateDirectoryWriteItems,
  type GeneratedBlueprintFields,
} from './directory-blueprint-write'

const row = (chapterNumber: number): GeneratedBlueprintFields => ({
  chapterNumber, title: 'Chapter', role: '发展', purpose: '', keyEvents: '', characters: ['Hero'], suspenseHook: '',
})

test('resolves full, prefix and explicit ranges independently of the existing row count', () => {
  expect(resolveDirectoryWriteRange({ mode: 'full', count: 0 }, 6, 9))
    .toEqual({ mode: 'replace-all', first: 1, last: 6, totalChapters: 6 })
  expect(resolveDirectoryWriteRange({ mode: 'full', count: 9 }, 6, 9))
    .toEqual({ mode: 'replace-range', first: 1, last: 6, totalChapters: 6 })
  expect(resolveDirectoryWriteRange({ mode: 'append', startChapter: 3, count: 2 }, 6, 9))
    .toEqual({ mode: 'replace-range', first: 3, last: 4, totalChapters: 6 })
})

test('continues after the highest chapter and permits an empty default append', () => {
  expect(resolveDirectoryWriteRange({ mode: 'append' }, 6, 4))
    .toEqual({ mode: 'append', first: 5, last: 6, totalChapters: 6 })
  expect(resolveDirectoryWriteRange({ mode: 'append', count: 4 }, 6, 4)?.last).toBe(8)
  expect(resolveDirectoryWriteRange({ mode: 'append' }, 6, 9)).toBeNull()
})

test('rejects invalid and overflowing generation ranges', () => {
  expect(() => resolveDirectoryWriteRange({ mode: 'full', count: -1 }, 6, 4)).toThrow()
  expect(() => resolveDirectoryWriteRange({ mode: 'append', startChapter: 0 }, 6, 4)).toThrow()
  expect(() => resolveDirectoryWriteRange({ mode: 'append', startChapter: 7 }, 6, 4)).toThrow()
  expect(() => resolveDirectoryWriteRange({ mode: 'append', startChapter: Number.MAX_SAFE_INTEGER, count: 2 }, 6, 4)).toThrow()
  expect(() => resolveDirectoryWriteRange({ mode: 'full' }, 0, 0)).toThrow()
})

test('requires complete, unique, well-formed coverage and returns sorted copies', () => {
  const range = resolveDirectoryWriteRange({ mode: 'append', startChapter: 2, count: 3 }, 8, 0)!
  const first = row(2)
  const sorted = validateDirectoryWriteItems(range, [row(4), first, row(3)])
  expect(sorted.map(item => item.chapterNumber)).toEqual([2, 3, 4])
  expect(sorted[0].characters).not.toBe(first.characters)
  for (const invalid of [
    [row(3), row(4)], [row(2), row(4)], [row(2), row(3)],
    [row(2), row(2), row(4)], [row(2), row(3), row(5)],
    [row(2), row(3), { ...row(4), characters: [4] }],
  ]) {
    expect(() => validateDirectoryWriteItems(range, invalid)).toThrow()
  }
})

test('only whole-book replacement can remove chapters outside its target range', () => {
  const whole = resolveDirectoryWriteRange({ mode: 'full' }, 3, 8)!
  const prefix = resolveDirectoryWriteRange({ mode: 'full', count: 3 }, 3, 8)!
  expect(getDirectoryBlueprintDeletions(whole, [1, 2, 3, 8])).toEqual([8])
  expect(getDirectoryBlueprintDeletions(prefix, [1, 2, 3, 8])).toEqual([])
})
