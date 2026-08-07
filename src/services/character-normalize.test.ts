import { describe, it, expect } from 'vitest'
import { isNoChangeValue, normalizeCharacterRole, normalizeTagsValue, matchCharacterName } from './character-normalize'

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
})
