import { describe, it, expect } from 'vitest'
import { normalizeBlueprintRole } from './blueprint-role'

/**
 * 蓝图 role 值归一化 — 背景：英文模板要求 LLM 输出英文枚举（Setup/Development...），
 * 而 UI/排序/校验期望中文规范值（建置/发展...），解析层零归一化导致英文值落库后
 * 下拉空白、目录显示英文原样（beta.2 英文用户反馈）。
 */
describe('normalizeBlueprintRole', () => {
  it('中文规范值原样通过', () => {
    expect(normalizeBlueprintRole('建置')).toBe('建置')
    expect(normalizeBlueprintRole('铺垫')).toBe('铺垫')
    expect(normalizeBlueprintRole('发展')).toBe('发展')
    expect(normalizeBlueprintRole('冲突')).toBe('冲突')
    expect(normalizeBlueprintRole('高潮')).toBe('高潮')
    expect(normalizeBlueprintRole('转折')).toBe('转折')
    expect(normalizeBlueprintRole('收尾')).toBe('收尾')
  })

  it('英文模板枚举映射到中文规范值', () => {
    expect(normalizeBlueprintRole('Setup')).toBe('建置')
    expect(normalizeBlueprintRole('Teaser')).toBe('铺垫')
    expect(normalizeBlueprintRole('Development')).toBe('发展')
    expect(normalizeBlueprintRole('Conflict')).toBe('冲突')
    expect(normalizeBlueprintRole('Climax')).toBe('高潮')
    expect(normalizeBlueprintRole('Twist')).toBe('转折')
    expect(normalizeBlueprintRole('Wrap-up')).toBe('收尾')
  })

  it('英文 i18n label 变体映射', () => {
    expect(normalizeBlueprintRole('Opening')).toBe('建置')
    expect(normalizeBlueprintRole('Buildup')).toBe('铺垫')
    expect(normalizeBlueprintRole('Ending')).toBe('收尾')
  })

  it('中文历史变体映射（开篇/开端→建置，结局/结尾→收尾）', () => {
    expect(normalizeBlueprintRole('开篇')).toBe('建置')
    expect(normalizeBlueprintRole('开端')).toBe('建置')
    expect(normalizeBlueprintRole('结局')).toBe('收尾')
    expect(normalizeBlueprintRole('结尾')).toBe('收尾')
  })

  it('大小写不敏感', () => {
    expect(normalizeBlueprintRole('development')).toBe('发展')
    expect(normalizeBlueprintRole('DEVELOPMENT')).toBe('发展')
    expect(normalizeBlueprintRole('wRaP-Up')).toBe('收尾')
  })

  it('非法/空值兜底为 发展（与解析层既有默认一致）', () => {
    expect(normalizeBlueprintRole('过渡')).toBe('发展')
    expect(normalizeBlueprintRole('x')).toBe('发展')
    expect(normalizeBlueprintRole('')).toBe('发展')
    expect(normalizeBlueprintRole(undefined as unknown as string)).toBe('发展')
  })
})
