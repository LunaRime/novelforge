// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipc } from './ipc-client'

vi.mock('./ipc-client', () => ({
  ipc: { invoke: vi.fn() },
}))

const mockInvoke = vi.mocked(ipc.invoke)

beforeEach(() => {
  mockInvoke.mockClear()
})

/** 用给定 characterStates 模拟 db:project-core-get */
function mockCore(characterStates: string) {
  // as never：mock 返回值与 invoke 重载联合不兼容（ProjectCoreData 结构庞大），测试 mock 常规断言
  mockInvoke.mockImplementation((async (channel: string) => {
    if (channel === 'db:project-core-get') return { characterStates }
    if (channel === 'db:project-core-update') return { success: true }
    return null
  }) as never)
}

describe('loadAllForeshadowing 归一化（Issue: undefined.replace 崩溃回归）', () => {
  it('旧格式（字符串 content 数组）→ 归一化为合法对象', async () => {
    mockCore(JSON.stringify({ pendingForeshadowing: ['第1章: 神秘戒指', '第2章: 预言'] }))
    const { loadAllForeshadowing } = await import('./foreshadowing-manager')
    const all = await loadAllForeshadowing()
    expect(all).toHaveLength(2)
    expect(all[0].content).toBe('第1章: 神秘戒指')
    expect(all[0].setChapter).toBe(0)
    expect(all[0].type).toBe('mystery')
    expect(typeof all[0].content).toBe('string')
  })

  it('新格式（对象数组）→ 保留完整字段', async () => {
    mockCore(JSON.stringify({ pendingForeshadowing: [
      { id: 'fs_1', content: '第1章: 戒指', setChapter: 1, resolvedChapter: 0, type: 'item', resolved: false, createdAt: '2026-08-05' },
    ] }))
    const { loadAllForeshadowing } = await import('./foreshadowing-manager')
    const all = await loadAllForeshadowing()
    expect(all[0]).toMatchObject({ id: 'fs_1', setChapter: 1, type: 'item', createdAt: '2026-08-05' })
  })

  it('混合/非法项（null、无 content）→ 丢弃，不崩溃', async () => {
    mockCore(JSON.stringify({ pendingForeshadowing: [null, '旧字符串', { content: '对象项' }, 42] }))
    const { loadAllForeshadowing } = await import('./foreshadowing-manager')
    const all = await loadAllForeshadowing()
    expect(all).toHaveLength(2) // '旧字符串' + 对象项；null/42 丢弃
    expect(all.every(i => typeof i.content === 'string')).toBe(true)
  })

  it('pendingForeshadowing 缺失 → 空数组', async () => {
    mockCore(JSON.stringify({}))
    const { loadAllForeshadowing } = await import('./foreshadowing-manager')
    expect(await loadAllForeshadowing()).toEqual([])
  })
})

describe('detectResolvedForeshadowing 防御（崩溃回归）', () => {
  it('旧格式字符串数组直接传入 → 不再抛 undefined.replace', async () => {
    const { detectResolvedForeshadowing } = await import('./foreshadowing-manager')
    // 模拟修复前：loadAll 返回字符串数组（旧数据）直接传入
    const legacy = ['第1章: 神秘戒指'] as unknown as Array<{ content: string }>
    expect(() => detectResolvedForeshadowing('他找到了神秘戒指', legacy as never, 3)).not.toThrow()
  })

  it('null 项跳过，合法项正常回收', async () => {
    const { detectResolvedForeshadowing } = await import('./foreshadowing-manager')
    const items = [
      null,
      { id: 'a', content: '第1章: 神秘戒指', setChapter: 1, resolvedChapter: 0, type: 'item', resolved: false, createdAt: '' },
    ] as never[]
    const resolved = detectResolvedForeshadowing('他找到了神秘戒指', items, 3)
    expect(resolved).toHaveLength(1)
    expect(resolved[0].resolved).toBe(true)
    expect(resolved[0].resolvedChapter).toBe(3)
  })
})

describe('saveForeshadowing 新格式（对象数组）', () => {
  it('写入完整对象（保留 setChapter/type/resolved），过滤已回收与非法项', async () => {
    let written = ''
    mockInvoke.mockImplementation((async (channel: string, ...args: unknown[]) => {
      if (channel === 'db:project-core-get') return { characterStates: '{}' }
      if (channel === 'db:project-core-update') { written = JSON.stringify(args[0]) ; return { success: true } }
      return null
    }) as never)
    const { saveForeshadowing } = await import('./foreshadowing-manager')
    await saveForeshadowing([
      { id: 'fs_1', content: '第1章: 戒指', setChapter: 1, resolvedChapter: 0, type: 'item', resolved: false, createdAt: '' },
      { id: 'fs_2', content: '已回收', setChapter: 2, resolvedChapter: 5, type: 'mystery', resolved: true, createdAt: '' },
    ])
    const saved = JSON.parse(written)
    const pending = JSON.parse(saved.characterStates).pendingForeshadowing
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ id: 'fs_1', setChapter: 1, type: 'item' })
  })
})

describe('formatPendingForPrompt 防御', () => {
  it('旧格式字符串项不再显示 [第undefined章]（被过滤）', async () => {
    const { formatPendingForPrompt } = await import('./foreshadowing-manager')
    const out = formatPendingForPrompt([
      '旧字符串项',
      { id: 'fs_1', content: '第1章: 戒指', setChapter: 1, resolvedChapter: 0, type: 'item', resolved: false, createdAt: '' },
    ] as never[])
    expect(out).toContain('[第1章]')
    expect(out).not.toContain('undefined')
  })
})
