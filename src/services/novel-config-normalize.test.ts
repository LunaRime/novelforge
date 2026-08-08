import { describe, it, expect } from 'vitest'
import { normalizeGenre, normalizeTargetAudience, normalizePlotStructure, normalizeNarrativePOV, normalizeNovelConfigEnums, getGenreTextKey, getAudienceTextKey } from './novel-config-normalize'
import type { NovelConfig } from '../shared/ipc-channels'

/**
 * novelConfig 枚举归一化 — 背景：英文模板要求 LLM 输出英文枚举
 * （genre: fantasy/urban...，audience: male-channel...），而编辑器下拉 value
 * 为中文规范值（NovelConfigEditor），英文值落库后 Select 找不到匹配 → 显示空白
 * （beta.2 英文用户反馈"某些字段总是空的"——数据在，显示空）。
 */
describe('normalizeGenre', () => {
  it('英文模板枚举映射到中文规范值', () => {
    expect(normalizeGenre('xuanhuan')).toBe('玄幻')
    expect(normalizeGenre('fairy-cultivation')).toBe('仙侠')
    expect(normalizeGenre('urban')).toBe('都市')
    expect(normalizeGenre('sci-fi')).toBe('科幻')
    expect(normalizeGenre('history')).toBe('历史')
    expect(normalizeGenre('mystery')).toBe('悬疑')
    expect(normalizeGenre('game')).toBe('游戏')
    expect(normalizeGenre('military')).toBe('军事')
    expect(normalizeGenre('fantasy')).toBe('奇幻')
    expect(normalizeGenre('wuxia')).toBe('武侠')
  })

  it('中文规范值原样通过（幂等）', () => {
    expect(normalizeGenre('玄幻')).toBe('玄幻')
    expect(normalizeGenre('轻小说')).toBe('轻小说')
    expect(normalizeGenre('职场')).toBe('职场')
  })

  it('未知值保留原样（不兜底覆盖合法数据）', () => {
    expect(normalizeGenre('realistic')).toBe('realistic')
    expect(normalizeGenre('其他')).toBe('其他')
    expect(normalizeGenre('')).toBe('')
  })
})

describe('normalizeTargetAudience', () => {
  it('英文模板枚举映射到中文规范值', () => {
    expect(normalizeTargetAudience('male-channel')).toBe('男频')
    expect(normalizeTargetAudience('female-channel')).toBe('女频')
    expect(normalizeTargetAudience('general')).toBe('全龄')
  })

  it('中文模板值 通用 → 全龄（语义等价）', () => {
    expect(normalizeTargetAudience('通用')).toBe('全龄')
  })

  it('中文规范值原样通过', () => {
    expect(normalizeTargetAudience('双性向')).toBe('双性向')
  })

  it('未知值保留原样', () => {
    expect(normalizeTargetAudience('short-form')).toBe('short-form')
    expect(normalizeTargetAudience('短篇')).toBe('短篇')
  })
})

describe('normalizePlotStructure', () => {
  it('英文描述性变体映射到规范键', () => {
    expect(normalizePlotStructure('three-act')).toBe('three_act')
    expect(normalizePlotStructure('three act structure')).toBe('three_act')
    expect(normalizePlotStructure("hero's journey")).toBe('heros_journey')
    expect(normalizePlotStructure('save the cat')).toBe('save_the_cat')
    expect(normalizePlotStructure('multi-thread')).toBe('multi_thread')
    expect(normalizePlotStructure('free form')).toBe('freeform')
  })

  it('规范键原样通过（幂等）', () => {
    expect(normalizePlotStructure('three_act')).toBe('three_act')
    expect(normalizePlotStructure('kishotenketsu')).toBe('kishotenketsu')
  })

  it('未知值保留原样', () => {
    expect(normalizePlotStructure('linear')).toBe('linear')
  })
})

describe('normalizeNarrativePOV', () => {
  it('英文描述性变体映射到规范键', () => {
    expect(normalizeNarrativePOV('first person')).toBe('first_person')
    expect(normalizeNarrativePOV('third person limited')).toBe('third_limited')
    expect(normalizeNarrativePOV('third-person limited')).toBe('third_limited')
    expect(normalizeNarrativePOV('third person omniscient')).toBe('third_omniscient')
    expect(normalizeNarrativePOV('omniscient')).toBe('third_omniscient')
    expect(normalizeNarrativePOV('multi pov')).toBe('multi_pov')
  })

  it('规范键原样通过（幂等）', () => {
    expect(normalizeNarrativePOV('third_limited')).toBe('third_limited')
    expect(normalizeNarrativePOV('multi_pov')).toBe('multi_pov')
  })

  it('未知值保留原样', () => {
    expect(normalizeNarrativePOV('second person')).toBe('second person')
  })
})

describe('normalizeNovelConfigEnums', () => {
  it('组合应用：枚举字段归一化、缺省字段跳过', () => {
    // 输入为 LLM 可能输出的非法/描述性值（类型上需断言——测试对象即坏数据场景）
    const result = normalizeNovelConfigEnums({
      genre: 'fantasy',
      targetAudience: 'male-channel',
      plotStructure: 'three-act' as NovelConfig['plotStructure'],
      narrativePOV: 'third person limited' as NovelConfig['narrativePOV'],
    })
    expect(result).toEqual({
      genre: '奇幻',
      targetAudience: '男频',
      plotStructure: 'three_act',
      narrativePOV: 'third_limited',
    })
  })

  it('undefined 字段不被添加', () => {
    const result = normalizeNovelConfigEnums({ genre: 'xuanhuan' })
    expect('plotStructure' in result).toBe(false)
  })
})

describe('getGenreTextKey（#33 显示翻译）', () => {
  it('中文规范值映射到 i18n key', () => {
    expect(getGenreTextKey('言情')).toBe('genre.romance')
    expect(getGenreTextKey('玄幻')).toBe('genre.xuanhuan')
    expect(getGenreTextKey('职场')).toBe('genre.workplace')
  })

  it('未知值返回 null（调用方原样显示）', () => {
    expect(getGenreTextKey('realistic')).toBeNull()
    expect(getGenreTextKey('')).toBeNull()
  })
})

describe('getAudienceTextKey（#33 显示翻译）', () => {
  it('中文规范值映射到 i18n key', () => {
    expect(getAudienceTextKey('男频')).toBe('novelConfig.audienceMale')
    expect(getAudienceTextKey('女频')).toBe('novelConfig.audienceFemale')
    expect(getAudienceTextKey('双性向')).toBe('novelConfig.audienceBoth')
    expect(getAudienceTextKey('全龄')).toBe('novelConfig.audienceAll')
  })

  it('未知值返回 null', () => {
    expect(getAudienceTextKey('general')).toBeNull()
    expect(getAudienceTextKey('')).toBeNull()
  })
})
