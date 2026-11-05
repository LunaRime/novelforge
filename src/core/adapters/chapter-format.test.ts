import { describe, expect, test } from 'vitest'
import { parseChapter, serializeChapter } from './chapter-format'
import type { Chapter } from '../domain/chapter'

const chapter: Chapter = { id: 'ch_12345678', projectId: 'a', number: 1, title: '章: 一\n"二"',
  status: 'draft', content: '正文\n---\n', createdAt: '2026-11-05T00:00:00Z', updatedAt: '2026-11-05T00:00:00Z' }
describe('chapter frontmatter', () => {
  test('preserves extra fields even when their names match public properties', () => {
    const value = { ...chapter, metadata: { content: 'meta content', metadata: { custom: true }, legacyDraftId: 42 } }
    expect(parseChapter(serializeChapter(value))).toEqual(value)
  })
  test('rejects metadata overriding identity instead of dropping it', () => {
    expect(() => serializeChapter({ ...chapter, metadata: { id: 'ch_87654321' } })).toThrow()
  })
  test('rejects duplicate and malformed fields', () => {
    const text = serializeChapter(chapter)
    expect(() => parseChapter(text.replace('number: 1', 'number: 1\nnumber: 2'))).toThrow()
    expect(() => parseChapter(text.replace('number: 1', 'number: "1"'))).toThrow()
    expect(() => parseChapter(text.replace('projectId: "a"', 'projectId: 1'))).toThrow()
  })
})
