/**
 * audit-context 单元测试 — mock ipc-client 验证上下文收集的降级与组装
 *
 * 覆盖：各数据段失败降级（不抛错）、正常路径组装（基线/锚点/豁免词/白名单）、auditText 集成。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { collectAuditContext, auditText } from './audit-context'
import { ipc } from '../ipc-client'

vi.mock('../ipc-client', () => ({
  ipc: { invoke: vi.fn() },
}))

// 白名单段动态 import project-store——mock 提供当前项目路径
vi.mock('../../stores/project-store', () => ({
  useProjectStore: { getState: () => ({ currentProject: { path: 'E:\\test\\project' } }) },
}))

const mockedInvoke = vi.mocked(ipc.invoke)

beforeEach(() => {
  mockedInvoke.mockReset()
})

describe('collectAuditContext 降级', () => {
  it('全部数据段失败时返回默认值（不抛错）', async () => {
    mockedInvoke.mockRejectedValue(new Error('IPC 失败'))
    const ctx = await collectAuditContext(3)
    expect(ctx.prevEnding).toBe('')
    expect(ctx.keyEvents).toEqual([])
    expect(ctx.terms).toEqual([])
    expect(ctx.baselineFreqs).toEqual({})
    expect(ctx.whitelist).toBeUndefined()
  })

  it('数据库为空/无数据时返回默认值', async () => {
    mockedInvoke.mockResolvedValue(null)
    const ctx = await collectAuditContext(1)
    expect(ctx.prevEnding).toBe('')
    expect(ctx.keyEvents).toEqual([])
    expect(ctx.terms).toEqual([])
    expect(ctx.baselineFreqs).toEqual({})
  })
})

describe('collectAuditContext 正常路径', () => {
  it('组装基线/上章结尾/细纲锚点/豁免词/白名单', async () => {
    mockedInvoke.mockImplementation((async (channel: string, ...args: unknown[]) => {
      if (channel === 'db:draft-get-finalized') {
        const n = args[0] as number
        if (n === 2) return { id: 101 }
        if (n === 1) return { id: 100 }
        return null
      }
      if (channel === 'db:draft-get-full') {
        const id = args[0] as number
        if (id === 101) return { content: '上一章定稿内容，苏晚在魂殿修炼。苏晚稳步突破。' }
        if (id === 100) return { content: '更早一章，苏晚初见老乞。' }
        return null
      }
      if (channel === 'db:blueprint-get-all') {
        return [{ chapterNumber: 3, keyEvents: '必须发生：与王老板见面；必须交代：玉佩下落' }]
      }
      if (channel === 'db:character-get-all') {
        return [{ name: '苏晚' }, { name: '老乞' }]
      }
      if (channel === 'db:project-core-get') {
        return { worldbuilding: '「武魂」是核心力量体系。「魂殿」掌控武魂秘辛。' }
      }
      if (channel === 'fs:read-external-file') {
        return { success: true, content: JSON.stringify({ words: ['缓缓'], patterns: ['只见'] }) }
      }
      return null
    }) as typeof ipc.invoke)

    const ctx = await collectAuditContext(3)
    // 上章结尾（最近一章尾 200 字）
    expect(ctx.prevEnding).toContain('上一章定稿内容')
    // 细纲锚点（蓝图 key_events 按 ；\n 拆分为独立强制点）
    expect(ctx.keyEvents).toEqual(['必须发生：与王老板见面', '必须交代：玉佩下落'])
    // 豁免词（角色名 + 世界观引号内专名）
    expect(ctx.terms).toContain('苏晚')
    expect(ctx.terms).toContain('老乞')
    expect(ctx.terms).toContain('武魂')
    expect(ctx.terms).toContain('魂殿')
    // 跨章基线（2 章定稿 → 苏晚稳定高频入基线）
    expect(ctx.baselineFreqs['苏晚']).toBeGreaterThan(0)
    // 白名单
    expect(ctx.whitelist?.words).toEqual(['缓缓'])
    expect(ctx.whitelist?.patterns).toEqual(['只见'])
  })
})

describe('auditText 集成', () => {
  it('上下文驱动的全量审计：细纲锚点未体现 + 基线词豁免', () => {
    const ctx = {
      prevEnding: '',
      keyEvents: ['必须发生：与王老板见面'],
      terms: ['苏晚'],
      baselineFreqs: { 苏晚: 3 },
      whitelist: undefined,
    }
    // 正文未提"王老板见面"→ 蓝图未体现报警；苏晚 2 次（基线 3 → 阈值 max(8,6)=8）不报
    const result = auditText(ctx, '苏晚走过长街。苏晚推门入店。')
    const blueprintIssue = result.issues.find(i => i.kind === 'blueprint')
    expect(blueprintIssue).toBeDefined()
    expect(blueprintIssue?.message).toContain('与王老板见面')
    expect(result.issues.some(i => i.kind === 'repetition')).toBe(false)
  })
})
