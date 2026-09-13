// @vitest-environment jsdom
/**
 * update_config 工具测试（真机 bug 修复回归，2026-09-13）
 *
 * 症状：Agent 连续调用 update_config 改 genre → subGenre → writingStyle，回读发现
 * writingStyle 是新值而 genre/subGenre 退回旧值，于是反复重提，最终撞上工具调用次数上限。
 *
 * 根因：工具把**渲染层缓存里的整份 novelConfig** 一起发回（`{...project.novelConfig, [field]: value}`），
 * 而主进程 `project:update-config` 是逐字段判 `!== undefined` 合并 —— 收到整份就等于所有列都写；
 * 缓存不随上一次调用刷新 → 后一次覆盖前一次。
 *
 * 本测试锁死契约：**载荷里只允许出现被改的那一个字段**。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import { updateConfigTool } from './update-config.tool'

vi.mock('../../ipc-client', () => ({
  ipc: { invoke: vi.fn() },
}))

const mockInvoke = vi.mocked(ipc.invoke)

beforeEach(() => {
  mockInvoke.mockClear()
  mockInvoke.mockResolvedValue({ success: true } as never)
  useProjectStore.setState({
    currentProject: {
      id: 'test-project',
      name: '穿越80后',
      path: '/tmp/test-project',
      novelConfig: {
        genre: '仙侠',
        subGenre: '穿越修仙',
        targetAudience: '女频',
        totalChapters: 100,
        wordsPerChapter: 3000,
        plotStructure: 'three_act',
        narrativePOV: 'third_limited',
        coreOutline: '',
        worldSetting: '',
        goldenFinger: '',
        protagonistProfile: '',
        globalGuidance: '',
        writingStyle: '仙侠风',
      },
    } as never,
  })
})

/** 取出最后一次 project:update-config 的载荷 */
function lastPayload(): { novelConfig: Record<string, unknown> } {
  const call = mockInvoke.mock.calls.filter(c => c[0] === 'project:update-config').pop()
  expect(call, '未调用 project:update-config').toBeTruthy()
  return call![2] as { novelConfig: Record<string, unknown> }
}

describe('update_config（丢更新回归）', () => {
  it('载荷只含被改字段（不得回带整份缓存配置）', async () => {
    const res = await updateConfigTool.execute({ field: 'genre', value: '年代' })
    expect(res.success).toBe(true)

    const payload = lastPayload()
    expect(Object.keys(payload.novelConfig)).toEqual(['genre'])
    expect(payload.novelConfig.genre).toBe('年代')
  })

  it('连续改多个字段时，每次载荷都只有自己那一个字段（这才是主进程逐字段合并的前提）', async () => {
    await updateConfigTool.execute({ field: 'genre', value: '年代' })
    await updateConfigTool.execute({ field: 'subGenre', value: '穿越、年代文、种田' })
    await updateConfigTool.execute({ field: 'writingStyle', value: '年代文风' })

    const payloads = mockInvoke.mock.calls
      .filter(c => c[0] === 'project:update-config')
      .map(c => Object.keys((c[2] as { novelConfig: Record<string, unknown> }).novelConfig))

    expect(payloads).toEqual([['genre'], ['subGenre'], ['writingStyle']])
    // 关键：后一次**不得**夹带上一次改过的字段（否则主进程会把旧值写回去）
    expect(payloads[1]).not.toContain('genre')
    expect(payloads[2]).not.toContain('genre')
    expect(payloads[2]).not.toContain('subGenre')
  })

  it('数字字段仍归一化为 number，且同样只发该字段', async () => {
    await updateConfigTool.execute({ field: 'totalChapters', value: '120' })
    const payload = lastPayload()
    expect(Object.keys(payload.novelConfig)).toEqual(['totalChapters'])
    expect(payload.novelConfig.totalChapters).toBe(120)
    expect(typeof payload.novelConfig.totalChapters).toBe('number')
  })

  it('非法字段 / 非法数字被拒（不发 IPC）', async () => {
    expect((await updateConfigTool.execute({ field: 'notAField', value: 'x' })).success).toBe(false)
    expect((await updateConfigTool.execute({ field: 'totalChapters', value: 'abc' })).success).toBe(false)
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
