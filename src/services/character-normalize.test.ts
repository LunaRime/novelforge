import { describe, it, expect } from 'vitest'
import { isNoChangeValue, normalizeCharacterRole, normalizeTagsValue, matchCharacterName, stripNameAlias, parseAliases } from './character-normalize'

/**
 * 角色卡 LLM 输出归一化 — 背景：定稿后处理 update_character_cards 依赖中文哨兵
 * （'无'/'无变化'）判断"无更新"，英文 LLM 输出 'none'/'No new tags'/'not applicable'
 * 等变体绕过精确匹配 → tags/motivation 被垃圾串替换、cs_* 六字段被 'none' 字面量
 * 覆盖真实状态（beta.2 英文用户"定稿后角色卡被重置"残留路径）。
 */
describe('isNoChangeValue', () => {
  it('中文哨兵识别', () => {
    expect(isNoChangeValue('无')).toBe(true)
    expect(isNoChangeValue('无变化')).toBe(true)
    expect(isNoChangeValue('无更新')).toBe(true)
    expect(isNoChangeValue('无新增')).toBe(true)
  })

  it('英文哨兵精确值识别', () => {
    expect(isNoChangeValue('none')).toBe(true)
    expect(isNoChangeValue('na')).toBe(true)
    expect(isNoChangeValue('n/a')).toBe(true)
    expect(isNoChangeValue('no change')).toBe(true)
    expect(isNoChangeValue('no changes')).toBe(true)
    expect(isNoChangeValue('no update')).toBe(true)
    expect(isNoChangeValue('not applicable')).toBe(true)
    expect(isNoChangeValue('unchanged')).toBe(true)
    expect(isNoChangeValue('same')).toBe(true)
    expect(isNoChangeValue('nil')).toBe(true)
    expect(isNoChangeValue('nothing')).toBe(true)
  })

  it('标点变体识别（此前精确匹配漏网）', () => {
    expect(isNoChangeValue('none.')).toBe(true)
    expect(isNoChangeValue('None。')).toBe(true)
    expect(isNoChangeValue('n/a.')).toBe(true)
    expect(isNoChangeValue('no change.')).toBe(true)
    expect(isNoChangeValue('-')).toBe(true)
    expect(isNoChangeValue('—')).toBe(true)
  })

  it('短语变体识别（No new tags 场景）', () => {
    expect(isNoChangeValue('No new tags')).toBe(true)
    expect(isNoChangeValue('no new')).toBe(true)
  })

  it('俄语哨兵识别（P2-2：ru-RU 三语支持漏网修复）', () => {
    expect(isNoChangeValue('нет')).toBe(true)
    expect(isNoChangeValue('нет изменений')).toBe(true)
    expect(isNoChangeValue('без изменений')).toBe(true)
    expect(isNoChangeValue('нет данных')).toBe(true)
    expect(isNoChangeValue('не изменился')).toBe(true)
    expect(isNoChangeValue('ничего нового')).toBe(true)
    // 俄语短语变体（含空格前缀）
    expect(isNoChangeValue('нет изменений по тегам')).toBe(true)
    expect(isNoChangeValue('Нет.')).toBe(true)
  })

  it('俄语普通词不被误判（нет 前缀需带空格或为整词）', () => {
    expect(isNoChangeValue('небо')).toBe(false)
    expect(isNoChangeValue('нетерпимый')).toBe(false)
  })

  it('正常内容不被误判', () => {
    expect(isNoChangeValue('冷面战神')).toBe(false)
    expect(isNoChangeValue('坚定的眼神')).toBe(false)
    expect(isNoChangeValue('plot twist')).toBe(false)
    expect(isNoChangeValue('追求更强力量')).toBe(false)
  })

  it('空值视为无变化', () => {
    expect(isNoChangeValue('')).toBe(true)
    expect(isNoChangeValue(undefined as unknown as string)).toBe(true)
    expect(isNoChangeValue('   ')).toBe(true)
  })
})

describe('normalizeCharacterRole', () => {
  it('小写规范枚举原样通过', () => {
    expect(normalizeCharacterRole('protagonist')).toBe('protagonist')
    expect(normalizeCharacterRole('antagonist')).toBe('antagonist')
    expect(normalizeCharacterRole('supporting')).toBe('supporting')
    expect(normalizeCharacterRole('minor')).toBe('minor')
  })

  it('大小写变体归一化到小写枚举', () => {
    expect(normalizeCharacterRole('Protagonist')).toBe('protagonist')
    expect(normalizeCharacterRole('SUPPORTING')).toBe('supporting')
    expect(normalizeCharacterRole('Minor')).toBe('minor')
  })

  it('非法/空值兜底 supporting', () => {
    expect(normalizeCharacterRole('主角')).toBe('supporting')
    expect(normalizeCharacterRole('hero')).toBe('supporting')
    expect(normalizeCharacterRole('npc')).toBe('supporting')
    expect(normalizeCharacterRole('')).toBe('supporting')
    expect(normalizeCharacterRole(undefined as unknown as string)).toBe('supporting')
  })
})

describe('normalizeTagsValue', () => {
  it('中文哨兵 → 空（不覆盖旧标签）', () => {
    expect(normalizeTagsValue('无')).toBe('')
    expect(normalizeTagsValue('无变化')).toBe('')
  })

  it('英文哨兵变体 → 空', () => {
    expect(normalizeTagsValue('none')).toBe('')
    expect(normalizeTagsValue('No new tags')).toBe('')
    expect(normalizeTagsValue('no changes')).toBe('')
  })

  it('正常标签列表 → JSON 数组字符串', () => {
    expect(normalizeTagsValue('冷面战神, 铁血')).toBe('["冷面战神","铁血"]')
  })

  it('混合列表剔除哨兵项', () => {
    expect(normalizeTagsValue('none, 冷面战神')).toBe('["冷面战神"]')
    expect(normalizeTagsValue('无, 铁血')).toBe('["铁血"]')
  })

  it('空值 → 空', () => {
    expect(normalizeTagsValue('')).toBe('')
    expect(normalizeTagsValue(undefined as unknown as string)).toBe('')
  })

  it('数组输入 → 元素逐个归一化(含逗号元素不拆分,剔除哨兵项)', () => {
    expect(normalizeTagsValue(['天才,剑修', '冷静'])).toBe('["天才,剑修","冷静"]')
    expect(normalizeTagsValue(['无', '铁血'])).toBe('["铁血"]')
    expect(normalizeTagsValue(['无'])).toBe('')
  })
})

describe('matchCharacterName', () => {
  const chars = [{ name: '苏晚晴' }, { name: '李雷' }]

  it('精确匹配优先', () => {
    expect(matchCharacterName(chars, '苏晚晴')?.name).toBe('苏晚晴')
  })

  it('别名格式「名（别名）」→ 匹配括号外名称', () => {
    expect(matchCharacterName(chars, '苏晚晴（苏夜）')?.name).toBe('苏晚晴')
  })

  it('别名格式半角括号 → 匹配括号内名称（DB 存别名）', () => {
    const aliasOnly = [{ name: '苏夜' }]
    expect(matchCharacterName(aliasOnly, '苏晚晴(苏夜)')?.name).toBe('苏夜')
  })

  it('不存在的名称 → undefined', () => {
    expect(matchCharacterName(chars, '王五')).toBeUndefined()
  })

  it('带别名的未知角色 → undefined', () => {
    expect(matchCharacterName(chars, '王五（阿五）')).toBeUndefined()
  })

  it('P0-2: 别名注册表匹配——LLM 输出昵称/称号 → 命中 aliases 含该形态的角色', () => {
    const withAliases = [
      { name: '苏晚晴', aliases: JSON.stringify(['阿晚', '苏仙子']) },
      { name: '李雷' },
    ]
    expect(matchCharacterName(withAliases, '阿晚')?.name).toBe('苏晚晴')
    expect(matchCharacterName(withAliases, '苏仙子')?.name).toBe('苏晚晴')
    expect(matchCharacterName(withAliases, '晚晴')).toBeUndefined()
  })

  it('P0-2: 存量旧数据——DB 名带括号 ← LLM 输出无括号形态', () => {
    const legacy = [{ name: '无名老乞丐（前魂师）' }, { name: '李雷' }]
    expect(matchCharacterName(legacy, '无名老乞丐')?.name).toBe('无名老乞丐（前魂师）')
  })

  it('P0-2: 别名优先于括号形态——昵称命中不依赖括号解析', () => {
    const withAliases = [
      { name: '苏晚晴', aliases: JSON.stringify(['苏夜']) },
      { name: '苏夜' },
    ]
    // 「苏夜」同时是 苏晚晴 的别名与独立角色名 → 精确匹配优先
    expect(matchCharacterName(withAliases, '苏夜')?.name).toBe('苏夜')
  })
})

describe('parseAliases（别名注册表解析）', () => {
  it('JSON 数组字符串 → string[]', () => {
    expect(parseAliases('["阿晚","苏仙子"]')).toEqual(['阿晚', '苏仙子'])
  })

  it('数组输入 → 元素 trim 去空', () => {
    expect(parseAliases([' 阿晚 ', '', '苏仙子'])).toEqual(['阿晚', '苏仙子'])
  })

  it('分隔符字符串（非 JSON）→ 按逗号/顿号拆分', () => {
    expect(parseAliases('阿晚、苏仙子')).toEqual(['阿晚', '苏仙子'])
    expect(parseAliases('阿晚,苏仙子')).toEqual(['阿晚', '苏仙子'])
  })

  it('空/占位/非法输入 → 空数组', () => {
    expect(parseAliases(undefined)).toEqual([])
    expect(parseAliases(null)).toEqual([])
    expect(parseAliases('')).toEqual([])
    expect(parseAliases('[]')).toEqual([])
    expect(parseAliases('{broken json')).toEqual([])
  })
})

describe('stripNameAlias（#34 写入端归一化）', () => {
  it('剥离尾部中文括号别名', () => {
    expect(stripNameAlias('无名老乞丐（前魂师）')).toBe('无名老乞丐')
    expect(stripNameAlias('苏晚晴（苏夜）')).toBe('苏晚晴')
  })

  it('剥离尾部半角括号别名', () => {
    expect(stripNameAlias('无名老乞丐(前魂师)')).toBe('无名老乞丐')
  })

  it('无括号原样返回（幂等）', () => {
    expect(stripNameAlias('无名老乞丐')).toBe('无名老乞丐')
    expect(stripNameAlias('')).toBe('')
  })

  it('剥离前后空格', () => {
    expect(stripNameAlias(' 无名老乞丐（前魂师） ')).toBe('无名老乞丐')
  })

  it('全括号名 → 空串（调用方空名保护兜底）', () => {
    expect(stripNameAlias('（前魂师）')).toBe('')
  })

  it('名字中段的括号不剥离（仅尾部形态）', () => {
    expect(stripNameAlias('老乞丐（前魂师）归来')).toBe('老乞丐（前魂师）归来')
  })

  it('P0-2: 嵌套括号迭代剥离（「苏晚（苏夜（少主）」→「苏晚」）', () => {
    expect(stripNameAlias('苏晚（苏夜（少主））')).toBe('苏晚')
  })
})
