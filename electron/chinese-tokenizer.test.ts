import { describe, it, expect } from 'vitest'
import {
  tokenize, tokenizeToSpaceSeparated, loadJiebaModule, setJiebaLoaderForTest,
} from './chinese-tokenizer'

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

// ===== L3 final review / IMP-3：惰性加载 + 加载失败降级（静态 import 曾让降级不可达）=====

describe('chinese-tokenizer 惰性加载与降级（IMP-3）', () => {
  it('惰性加载：导入模块本身不加载 jieba，首次调用才加载且只加载一次（缓存）', () => {
    let loadCalls = 0
    setJiebaLoaderForTest(() => {
      loadCalls++
      return { cut: () => ['主角', '的', '剑'] }
    })
    try {
      expect(loadCalls).toBe(0) // 注入后模块仍未加载 → 加载发生在首次调用，不在模块求值期
      expect(tokenize('主角的剑')).toEqual(['主角', '的', '剑'])
      expect(loadCalls).toBe(1)
      expect(tokenize('主角的剑')).toEqual(['主角', '的', '剑'])
      expect(loadCalls).toBe(1) // 命中缓存，不重复加载
    } finally {
      setJiebaLoaderForTest(null)
    }
  })

  it('加载失败（.wasm 读盘失败）→ 返回空而非抛：降级不崩溃，且失败被缓存不反复重试', () => {
    let loadCalls = 0
    setJiebaLoaderForTest(() => {
      loadCalls++
      throw new Error("ENOENT: jieba_rs_wasm_bg.wasm")
    })
    try {
      expect(() => tokenize('主角的剑在月光下')).not.toThrow()
      expect(tokenize('主角的剑在月光下')).toEqual([])
      expect(tokenizeToSpaceSeparated('搜索知识库')).toBe('')
      expect(loadJiebaModule()).toBeNull()
      expect(loadCalls).toBe(1) // 失败缓存：不每次分词都重试磁盘 IO
    } finally {
      setJiebaLoaderForTest(null)
    }
  })

  it('加载器返回形态不符（无 cut）→ 同样降级为空，不抛', () => {
    setJiebaLoaderForTest(() => ({ cut: undefined }) as unknown as { cut: (t: string) => string[] })
    try {
      expect(tokenize('主角')).toEqual([])
      expect(tokenizeToSpaceSeparated('主角')).toBe('')
    } finally {
      setJiebaLoaderForTest(null)
    }
  })

  it('分词运行期抛错 → 返回空而非抛（导入/回填/检索不因单次分词异常中断）', () => {
    setJiebaLoaderForTest(() => ({ cut: () => { throw new Error('wasm aborted') } }))
    try {
      expect(() => tokenize('主角的剑')).not.toThrow()
      expect(tokenize('主角的剑')).toEqual([])
      expect(tokenizeToSpaceSeparated('主角的剑')).toBe('')
    } finally {
      setJiebaLoaderForTest(null)
    }
  })

  it('空白输入不进加载器：纯空白/空串直接返回空（不触发加载）', () => {
    let loadCalls = 0
    setJiebaLoaderForTest(() => {
      loadCalls++
      return { cut: () => ['x'] }
    })
    try {
      expect(tokenize('   ')).toEqual([])
      expect(tokenize('')).toEqual([])
      expect(tokenizeToSpaceSeparated('  ')).toBe('')
      expect(loadCalls).toBe(0)
    } finally {
      setJiebaLoaderForTest(null)
    }
  })

  it('恢复真实加载器后分词回到正常（缓存可重置）', () => {
    expect(tokenize('主角的剑在月光下')).toContain('主角')
    expect(tokenizeToSpaceSeparated('搜索知识库')).toContain(' ')
  })
})
