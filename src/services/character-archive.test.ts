import { describe, it, expect } from 'vitest'
import { extractRoleContextSegments, hasBlankArchiveFields, parseArchiveJson, parseBatchArchiveJson } from './character-archive'
import { getPromptTemplate } from './prompt-templates'

const mkChapter = (n: number, content: string) => ({ chapterNumber: n, content })

describe('extractRoleContextSegments', () => {
  it('按角色名出现位置抽取上下文段落', () => {
    const chapter = mkChapter(1, '开头。'.repeat(100) + '苏晚推开门。' + '中间。'.repeat(100))
    const segs = extractRoleContextSegments([chapter], '苏晚', { windowChars: 20 })
    expect(segs.length).toBe(1)
    expect(segs[0].chapterNumber).toBe(1)
    expect(segs[0].text).toContain('苏晚推开门')
  })

  it('角色未出现 → 空数组', () => {
    expect(extractRoleContextSegments([mkChapter(1, '全是别人的戏。')], '苏晚')).toEqual([])
  })

  it('多次出现按段数预算截断(上限保证 token 可控)', () => {
    const chapter = mkChapter(1, ('苏晚向前一步。' + '路人。'.repeat(10) + '苏晚抬头。' + '路人。'.repeat(10) + '苏晚落座。'))
    const segs = extractRoleContextSegments([chapter], '苏晚', { windowChars: 30, maxSegments: 2 })
    expect(segs.length).toBeLessThanOrEqual(2)
  })

  it('跨章节聚合', () => {
    const chapters = [mkChapter(1, '苏晚在第一章。'), mkChapter(2, '第二章有李雷。')]
    const segs = extractRoleContextSegments(chapters, '苏晚')
    expect(segs.length).toBe(1)
    expect(segs[0].chapterNumber).toBe(1)
  })

  it('P1-1: 章节数超过预算时等距选章——首章与末章必含,后期章节可见', () => {
    const chapters = Array.from({ length: 30 }, (_, i) =>
      mkChapter(i + 1, `第${i + 1}章苏晚登场。`))
    const segs = extractRoleContextSegments(chapters, '苏晚', { maxSegments: 6 })
    expect(segs.length).toBe(6)
    expect(segs[0].chapterNumber).toBe(1)          // 首章必含
    expect(segs[segs.length - 1].chapterNumber).toBe(30) // 末章必含
    // 等距覆盖：round(i*29/5) → 第 1/7/13/18/24/30 章（原实现只取前 8 段,后期章节完全不可见）
    expect(segs.map(s => s.chapterNumber)).toEqual([1, 7, 13, 18, 24, 30])
  })

  it('P1-1: 章节数不超过预算时全部章节各取一段', () => {
    const chapters = [mkChapter(1, '苏晚在第一章。'), mkChapter(2, '苏晚在第二章。'), mkChapter(3, '苏晚在第三章。')]
    const segs = extractRoleContextSegments(chapters, '苏晚', { maxSegments: 8 })
    expect(segs.map(s => s.chapterNumber)).toEqual([1, 2, 3])
  })

  it('P1-4: 句边界对齐——命中所在整句完整保留,窗口不足时向两侧扩展', () => {
    const chapter = mkChapter(1, '前面是铺垫内容。' + '苏晚推开门走了进去。' + '后面是其他内容。')
    const segs = extractRoleContextSegments([chapter], '苏晚', { windowChars: 200 })
    expect(segs[0].text).toContain('苏晚推开门走了进去。')
    // 整句未被腰斩：句尾句号在段内
    expect(segs[0].text).toContain('走了进去。')
  })

  it('P1-4: 同章相邻重叠段合并——相邻命中不重复计费', () => {
    const chapter = mkChapter(1, '苏晚说：「好的。」苏晚又说：「嗯。」')
    const segs = extractRoleContextSegments([chapter], '苏晚', { windowChars: 300 })
    // 两次命中窗口重叠 → 合并为一段
    expect(segs.length).toBe(1)
    expect(segs[0].text).toContain('好的')
    expect(segs[0].text).toContain('嗯')
  })

  it('P0-3: 前缀碰撞过滤——「苏晚」不命中「苏晚晴」的段落', () => {
    const chapter = mkChapter(1, '苏晚晴看着远方的群山与飞鸟，神情专注。' + '路。'.repeat(200) + '苏晚站在她身旁，同样望着天际。')
    const segs = extractRoleContextSegments([chapter], '苏晚', { registryNames: ['苏晚', '苏晚晴'] })
    expect(segs.length).toBe(1)
    // 第一句是苏晚晴的戏份（被更长注册名覆盖）→ 只取第二句
    expect(segs[0].text).toContain('苏晚站在她身旁')
    expect(segs[0].text).not.toContain('苏晚晴看着远方')
  })

  it('P0-2: 别名形态匹配——角色以昵称出现也能取到上下文', () => {
    const chapter = mkChapter(1, '阿晚推开门。远处苏晚点头。')
    const segs = extractRoleContextSegments([chapter], '苏晚', { aliases: ['阿晚'] })
    expect(segs.length).toBeGreaterThanOrEqual(1)
    expect(segs.some(s => s.text.includes('阿晚推开门'))).toBe(true)
  })

  it('P1-2: includeFallback 时无直接命中 → 章节首尾兜底段并标记 fallback', () => {
    const chapters = [mkChapter(1, '开头正文。' + '中段。'.repeat(500) + '结尾正文。')]
    const segs = extractRoleContextSegments(chapters, '从未出现过的角色', { windowChars: 100, includeFallback: true })
    expect(segs.length).toBeGreaterThan(0)
    expect(segs.every(s => s.fallback === true)).toBe(true)
    expect(segs[0].text).toContain('开头正文')
  })

  it('P1-2: 默认不启用兜底——无直接命中返回空（防低置信度内容诱导 LLM 编造）', () => {
    const chapters = [mkChapter(1, '开头正文。' + '中段。'.repeat(500) + '结尾正文。')]
    expect(extractRoleContextSegments(chapters, '从未出现过的角色', { windowChars: 100 })).toEqual([])
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
  it('tags 数组输入 → 输出 JSON 数组字符串,元素含逗号不拆分', () => {
    // Array.isArray 分支:元素 '天才,剑修' 含逗号——String() 展开后会被 split 拆碎,
    // join('、') 保证元素完整性(与 architecture-workflow createCharacterExtractSteps 对齐)
    const out = parseArchiveJson('{"tags":["天才,剑修","冷静"]}', '苏晚')
    expect(out?.tags).toBe('["天才,剑修","冷静"]')
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

describe('parseBatchArchiveJson（P1-3 批量提取解析）', () => {
  const chars = [{ name: '苏晚', aliases: '["阿晚"]' }, { name: '李雷' }]

  it('主形态：JSON 对象按角色名键匹配', () => {
    const out = parseBatchArchiveJson('{"苏晚": {"appearance": "黑发", "tags": ["天才"]}, "李雷": {"personality": "豪爽"}}', chars)
    expect(out).toHaveLength(2)
    expect(out[0].archive?.appearance).toBe('黑发')
    expect(out[0].archive?.tags).toBe('["天才"]')
    expect(out[1].archive?.personality).toBe('豪爽')
  })

  it('别名键匹配（LLM 用昵称/称号作键）', () => {
    const out = parseBatchArchiveJson('{"阿晚": {"appearance": "黑发"}}', chars)
    expect(out[0].archive?.appearance).toBe('黑发')
    expect(out[1].archive).toBeNull()
  })

  it('括号形态键匹配（「苏晚（苏夜）」→ 苏晚）', () => {
    const out = parseBatchArchiveJson('{"苏晚（苏夜）": {"appearance": "黑发"}}', chars)
    expect(out[0].archive?.appearance).toBe('黑发')
  })

  it('兜底形态：JSON 数组逐卡匹配', () => {
    const out = parseBatchArchiveJson('[{"name": "李雷", "personality": "豪爽"}]', chars)
    expect(out[1].archive?.personality).toBe('豪爽')
    expect(out[0].archive).toBeNull()
  })

  it('非法输出 → 全部 null（触发批次重试）', () => {
    const out = parseBatchArchiveJson('不是 JSON', chars)
    expect(out.every(o => o.archive === null)).toBe(true)
  })

  it('字段白名单：非档案字段丢弃', () => {
    const out = parseBatchArchiveJson('{"苏晚": {"appearance": "黑发", "cs_location": "x", "role": "protagonist"}}', chars)
    expect(out[0].archive?.appearance).toBe('黑发')
    expect(out[0].archive?.cs_location).toBeUndefined()
    expect(out[0].archive?.role).toBeUndefined()
  })

  it('extract_from_finalized_batch 模板已注册且变量完整', () => {
    const tpl = getPromptTemplate('extract_from_finalized_batch')
    expect(tpl).not.toBeNull()
    expect(tpl?.variables?.characters_segments).toBeTruthy()
    expect(tpl?.content).toContain('{{characters_segments}}')
  })
})
