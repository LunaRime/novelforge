import { describe, it, expect } from 'vitest'
import { extractRoleContextSegments, hasBlankArchiveFields, parseArchiveJson } from './character-archive'
import { getPromptTemplate } from './prompt-templates'

const mkChapter = (n: number, content: string) => ({ chapterNumber: n, content })

describe('extractRoleContextSegments', () => {
  it('按角色名出现位置抽取上下文段落', () => {
    const chapter = mkChapter(1, '开头。'.repeat(100) + '苏晚推开门。' + '中间。'.repeat(100))
    const segs = extractRoleContextSegments([chapter], '苏晚', 20)
    expect(segs.length).toBe(1)
    expect(segs[0].chapterNumber).toBe(1)
    expect(segs[0].text).toContain('苏晚推开门')
  })

  it('角色未出现 → 空数组', () => {
    expect(extractRoleContextSegments([mkChapter(1, '全是别人的戏。')], '苏晚')).toEqual([])
  })

  it('多次出现按段数预算截断(不合并,上限保证 token 可控)', () => {
    const chapter = mkChapter(1, ('苏晚向前一步。' + '路人。'.repeat(10) + '苏晚抬头。' + '路人。'.repeat(10) + '苏晚落座。'))
    const segs = extractRoleContextSegments([chapter], '苏晚', 30, 2)
    expect(segs.length).toBeLessThanOrEqual(2)
  })

  it('跨章节聚合', () => {
    const chapters = [mkChapter(1, '苏晚在第一章。'), mkChapter(2, '第二章有李雷。')]
    const segs = extractRoleContextSegments(chapters, '苏晚')
    expect(segs.length).toBe(1)
    expect(segs[0].chapterNumber).toBe(1)
  })
})

describe('hasBlankArchiveFields', () => {
  const full = { gender: '女', age: '18', appearance: '黑发', personality: '冷静', background: '家族', abilities: '剑修', motivation: '复仇', relationships: '与李雷敌对', arc: '成长中', notes: '' }
  it('全非空(notes 空也算需要生成?)→ 按设计 notes 为空即需生成', () => {
    expect(hasBlankArchiveFields({ ...full, notes: '补充' })).toBe(false)
    expect(hasBlankArchiveFields({ ...full })).toBe(true)
  })
  it('部分字段为空 → true', () => {
    expect(hasBlankArchiveFields({ ...full, appearance: '' })).toBe(true)
  })
  it('哨兵值视为空白 → true', () => {
    expect(hasBlankArchiveFields({ ...full, motivation: '无' })).toBe(true)
  })
})

describe('parseArchiveJson', () => {
  it('有效 JSON → 归一化字段', () => {
    const out = parseArchiveJson('{"name":"苏晚","appearance":"黑发","tags":["天才","剑修"]}', '苏晚')
    expect(out?.appearance).toBe('黑发')
    expect(out?.tags).toBe('["天才","剑修"]')
  })
  it('字段白名单:非档案字段丢弃', () => {
    const out = parseArchiveJson('{"appearance":"黑发","role":"protagonist","cs_location":"x"}', '苏晚')
    expect(out?.role).toBeUndefined()
  })
  it('非法 JSON → null', () => {
    expect(parseArchiveJson('不是 JSON', '苏晚')).toBeNull()
  })
})

describe('extract_from_finalized 模板', () => {
  it('模板已注册且变量完整', () => {
    const tpl = getPromptTemplate('extract_from_finalized')
    expect(tpl).not.toBeNull()
    expect(tpl?.variables?.character_name).toBeTruthy()
    expect(tpl?.content).toContain('{{chapters_segments}}')
  })
})
