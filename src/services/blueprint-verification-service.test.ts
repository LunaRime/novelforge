import { describe, it, expect, vi } from 'vitest'
import { detectInconsistentRoles, generateVerificationReport } from './blueprint-verification-service'
import { getCurrentLocale, setCurrentLocale } from '../shared/locale'
import type { ChapterBlueprint } from './workflows/directory-workflow'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(async () => []) }))
vi.mock('./ipc-client', () => ({ ipc: { invoke } }))

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

describe('generateVerificationReport', () => {
  it('uses the supplied snapshot for contiguous gaps and preserves the Chinese prompt context', async () => {
    const before = { ...bp(1, 'Setup'), title: 'Departure', keyEvents: 'Find the letter' }
    const after = { ...bp(4, 'Development'), title: 'Arrival', keyEvents: 'Meet the witness' }
    const originalLocale = getCurrentLocale()
    setCurrentLocale('en-US')
    try {
      const report = await generateVerificationReport(4, [after, before])
      expect(invoke).not.toHaveBeenCalled()
      expect(report).toMatchObject({
        totalChapters: 4,
        existingChapters: 2,
        gaps: [{
          missingChapterNumbers: [2, 3],
          precedingChapter: before,
          followingChapter: after,
          gapSize: 2,
          context: '[前一章 第1章 Departure] Find the letter\n[后一章 第4章 Arrival] Meet the witness',
        }],
        inconsistentRoles: [{
          chapter: 1, role: '建置', expectedRole: '发展',
          reason: 'Ch.1 sits at 25% of the story, usually the "Development" stage',
        }],
        missingTitles: [],
        severity: 'critical',
      })
      expect(report.summary).toContain('1 gaps found, 2 chapters missing')
      expect(new Date(report.generatedAt).toISOString()).toBe(report.generatedAt)
    } finally {
      setCurrentLocale(originalLocale)
    }
  })
})
