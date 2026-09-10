import { describe, it, expect } from 'vitest'
import { tokenize, tokenizeToSpaceSeparated } from './chinese-tokenizer'

describe('chinese-tokenizer（L3 中文分词）', () => {
  it('中文分词：句子切为多词，含「主角」', () => {
    const words = tokenize('主角的剑在月光下')
    expect(words.length).toBeGreaterThan(1)   // 不应整句一个 token
    expect(words).toContain('主角')
  })
  it('tokenizeToSpaceSeparated：空格分隔，可存 tokens 字段', () => {
    const s = tokenizeToSpaceSeparated('搜索知识库')
    expect(s).toContain(' ')
    expect(s.split(' ').filter(Boolean).length).toBeGreaterThan(0)
  })
  it('空文本/纯空白 → 空数组 / 空串', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenizeToSpaceSeparated('   ')).toBe('')
  })
  it('英文混排：英文词与中文词都保留', () => {
    const words = tokenize('hero 的剑')
    expect(words.some(w => w === 'hero')).toBe(true)
  })
})
