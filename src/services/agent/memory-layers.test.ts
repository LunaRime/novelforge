import { describe, it, expect } from 'vitest'
import {
  buildMemoryCatalog, buildResidentSection, catalogEntries, matchMentionedManuals,
  residentEntries, scoreMemoryEntry, findLineHint,
  MEMORY_CATALOG_BUDGET_TOKENS, RESIDENT_MEMORY_BUDGET_TOKENS,
  type MemoryLayerEntry,
} from './memory-layers'
import { estimateTokens } from './token-budget'

const e = (file: string, loadMode: MemoryLayerEntry['loadMode'], brief = '摘要', kind: MemoryLayerEntry['kind'] = 'book'): MemoryLayerEntry =>
  ({ file, kind, loadMode, brief })

describe('residentEntries / catalogEntries（分层归属）', () => {
  it('resident 只挑常驻并按文件名排序（前缀稳定：mtime 排序会让每轮前缀漂移）', () => {
    const sorted = residentEntries([e('b.md', 'resident'), e('a.md', 'resident'), e('c.md', 'auto')])
    expect(sorted.map(x => x.file)).toEqual(['a.md', 'b.md'])
  })

  it('目录含 auto + manual，排除 resident 与 unknown（F9 隐式白名单）', () => {
    const list = catalogEntries([e('a.md', 'resident'), e('b.md', 'auto'), e('c.md', 'manual'), e('d.md', 'auto', '摘要', 'unknown')])
    expect(list.map(x => x.file)).toEqual(['b.md', 'c.md'])
  })
})

describe('buildResidentSection（常驻全文段 + 硬上限）', () => {
  it('全文拼接（不做节选），token 数与文本一致', () => {
    const body = '第一章内容'.repeat(50)
    const { text, tokens, overCap } = buildResidentSection([{ file: 'book-state.md', body }])
    expect(overCap).toBe(false)
    expect(text).toContain(body)              // 逐字进上下文（旧 M2 会截断，分层后常驻不再截）
    expect(text).toContain('book-state.md')   // 带来源标注
    expect(tokens).toBe(estimateTokens(text))
  })

  it('超硬上限 → 整段不入上下文（overCap=true，text 为空；由调用方记 warn，绝不静默截断）', () => {
    const { text, tokens, overCap } = buildResidentSection([{ file: 'a.md', body: '详'.repeat(6000) }])
    expect(overCap).toBe(true)
    expect(text).toBe('')
    expect(tokens).toBeGreaterThan(RESIDENT_MEMORY_BUDGET_TOKENS) // 报出真实用量供告警文案
  })

  it('空输入 → 空段（不产生只有标题的空段）', () => {
    expect(buildResidentSection([])).toEqual({ text: '', tokens: 0, overCap: false })
  })
})

describe('buildMemoryCatalog（名字目录 + 三级降级）', () => {
  it('级别 1：brief 完整；manual 带 [manual] 标记、kind 带标签', () => {
    const { text, level } = buildMemoryCatalog([e('a.md', 'manual', '短摘要'), e('b.md', 'auto')])
    expect(level).toBe(1)
    expect(text).toContain('[manual]')
    expect(text).toContain('短摘要')
    expect(estimateTokens(text)).toBeLessThanOrEqual(MEMORY_CATALOG_BUDGET_TOKENS)
  })

  it('级别 2：brief 超预算 → 截 72 字 + 提示（提示里点名 read_memory）', () => {
    const long = e('a.md', 'auto', '详'.repeat(150))
    const { text, level } = buildMemoryCatalog(Array.from({ length: 6 }, (_, i) => ({ ...long, file: `f${i}.md` })))
    expect(level).toBe(2)
    expect(text).toContain('…')
    expect(text).toMatch(/read_memory/)
  })

  it('级别 3：仍超预算 → 只留名字 + 提示 + 「还有 N 条」（模型仍能发现记忆存在）', () => {
    const many = Array.from({ length: 40 }, (_, i) => e(`file-${String(i).padStart(2, '0')}-with-a-long-name.md`, 'auto', '详'.repeat(150)))
    const { text, level } = buildMemoryCatalog(many)
    expect(level).toBe(3)
    expect(text).toContain('file-00-with-a-long-name')
    expect(text).toMatch(/还有|and \d+ more|ещё/)   // 三语文案之一
    expect(estimateTokens(text)).toBeLessThanOrEqual(MEMORY_CATALOG_BUDGET_TOKENS)
  })

  it('无目录条目 → 空串（不注入空标题）', () => {
    expect(buildMemoryCatalog([e('a.md', 'resident')]).text).toBe('')
  })
})

describe('matchMentionedManuals（manual 硬门控的判定）', () => {
  const entries = [e('book-state.md', 'manual'), e('chapters-001-015.md', 'manual'), e('shared.md', 'auto')]

  it('@文件名 与 @文件名去后缀 都能命中；返回文件名', () => {
    expect(matchMentionedManuals('帮我看看 @book-state 的设定', entries)).toEqual(['book-state.md'])
    expect(matchMentionedManuals('@book-state.md 呢', entries)).toEqual(['book-state.md'])
  })

  it('中文行文中的提及（@ 后紧跟名字、后接空格/中文标点）', () => {
    expect(matchMentionedManuals('@chapters-001-015，对比一下', entries)).toEqual(['chapters-001-015.md'])
  })

  it('未提及 / 非 manual 条目提及 → 不注入（auto 本来就在目录里）', () => {
    expect(matchMentionedManuals('随便聊聊', entries)).toEqual([])
    expect(matchMentionedManuals('@shared 呢', entries)).toEqual([])
  })

  it('大小写不敏感；前缀不同的名字不误命中', () => {
    expect(matchMentionedManuals('@BOOK-STATE', entries)).toEqual(['book-state.md'])
    expect(matchMentionedManuals('@book 呢', entries)).toEqual([])
  })

  it('@ 后紧跟 ASCII 标点也能命中（英文/俄文行文的自然写法；评审 I3）', () => {
    expect(matchMentionedManuals('Summarize @book-state, then continue', entries)).toEqual(['book-state.md'])
    expect(matchMentionedManuals('see (@book-state)', entries)).toEqual(['book-state.md'])
    expect(matchMentionedManuals('@book-state: 补充一下', entries)).toEqual(['book-state.md'])
    expect(matchMentionedManuals('Summarize @book-state.', entries)).toEqual(['book-state.md'])
    expect(matchMentionedManuals('"@book-state" 对比', entries)).toEqual(['book-state.md'])
  })

  it('带 .md 的引用剥标点后命中；名字里的连字符与点是内容、不剥', () => {
    expect(matchMentionedManuals('@chapters-001-015.md, please', entries)).toEqual(['chapters-001-015.md'])
    expect(matchMentionedManuals('@book-state-x', entries)).toEqual([])   // 前缀不同仍不误命中
  })
})

describe('scoreMemoryEntry / findLineHint（关键词检索）', () => {
  it('name > kind > brief > 正文命中次数', () => {
    expect(scoreMemoryEntry(e('fog.md', 'auto', '无关'), '', 'fog')).toBeGreaterThan(scoreMemoryEntry(e('a.md', 'auto', '无关'), '', 'fog'))
    expect(scoreMemoryEntry(e('a.md', 'auto', '本章伏笔回收'), '', '伏笔')).toBeGreaterThan(scoreMemoryEntry(e('a.md', 'auto', '无关'), '正文提到伏笔', '伏笔'))
    expect(scoreMemoryEntry(e('a.md', 'auto', '无关'), '正文提到伏笔', '伏笔')).toBeGreaterThan(0)
    expect(scoreMemoryEntry(e('a.md', 'auto', '无关'), '毫不相关', '伏笔')).toBe(0)
  })

  it('正则元字符不抛错（实现走 indexOf/includes，不构造 RegExp）', () => {
    expect(() => scoreMemoryEntry(e('a.md', 'auto', 'x'), '第1章(上)', '第1章(')).not.toThrow()
    expect(scoreMemoryEntry(e('a.md', 'auto', 'x'), '第1章(上)', '第1章(')).toBeGreaterThan(0)
  })

  it('findLineHint 给出首批命中行、超长截断、无命中为空串', () => {
    expect(findLineHint('第一行\n伏笔：玉佩是关键\n第三行', '玉佩')).toBe('伏笔：玉佩是关键')
    expect(findLineHint('短', '不存在')).toBe('')
    expect(findLineHint(`x${'详'.repeat(200)}`, 'x')).toHaveLength(81) // 80 + 省略号
  })
})
