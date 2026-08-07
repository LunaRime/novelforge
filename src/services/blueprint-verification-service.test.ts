import { describe, it, expect } from 'vitest'
import { detectInconsistentRoles } from './blueprint-verification-service'
import type { ChapterBlueprint } from './workflows/directory-workflow'

function bp(chapterNumber: number, role: string): ChapterBlueprint {
  return {
    chapterNumber,
    title: '',
    role,
    purpose: '',
    keyEvents: '',
    characters: [],
    suspenseHook: '',
    userGuidance: '',
    notes: '',
    notesUpdatedAt: '',
    sortOrder: chapterNumber,
    priority: 0,
  }
}

/** 第 N 章（全书 100 章） */
const ch = (n: number, role: string) => bp(n, role)

/**
 * 角色定位校验 — 7 值阈值（建置/铺垫/发展/冲突/高潮/转折/收尾）：
 * ≤0.1 建置、≤0.2 铺垫、≤0.35 发展、≤0.5 冲突、≤0.65 高潮、≤0.85 转折、>0.85 收尾
 */
describe('detectInconsistentRoles', () => {
  it('位置匹配时不报（7 段阈值）', () => {
    expect(detectInconsistentRoles([
      ch(5, '建置'),   // 0.05 → 建置
      ch(15, '铺垫'),  // 0.15 → 铺垫
      ch(30, '发展'),  // 0.30 → 发展
      ch(45, '冲突'),  // 0.45 → 冲突
      ch(60, '高潮'),  // 0.60 → 高潮
      ch(75, '转折'),  // 0.75 → 转折
      ch(95, '收尾'),  // 0.95 → 收尾
    ], 100)).toEqual([])
  })

  it('位置不匹配时报错且给出 7 值 expected', () => {
    const result = detectInconsistentRoles([ch(15, '建置')], 100) // 0.15 → 铺垫
    expect(result).toHaveLength(1)
    expect(result[0].expectedRole).toBe('铺垫')
    expect(result[0].role).toBe('建置')
  })

  it('发展 默认值跳过（未设置定位不算不一致）', () => {
    expect(detectInconsistentRoles([ch(15, '发展')], 100)).toEqual([])
  })

  it('英文 role 归一化后参与比较（旧数据兼容：Development → 发展 相等不报）', () => {
    expect(detectInconsistentRoles([ch(30, 'Development')], 100)).toEqual([])
  })

  it('英文 role 不匹配时 role 归一化为规范值', () => {
    const result = detectInconsistentRoles([ch(15, 'Setup')], 100) // Setup→建置，0.15 期望铺垫
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('建置')
  })
})
