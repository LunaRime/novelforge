// @vitest-environment jsdom
/**
 * generate-field 覆盖确认（线③ 产出审查层：单字段补齐与批量同级的覆盖确认）
 *
 * 契约：字段已有内容时先 confirm 确认覆盖；取消则返回空串（不生成、不写 store）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockConfirm = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockSnapshot = vi.hoisted(() => vi.fn())

vi.mock('../../../components/ui/Confirm', () => ({
  confirm: mockConfirm,
}))
vi.mock('../../../components/ui/Toast', () => ({
  toast: { show: vi.fn(), success: vi.fn(), info: vi.fn() },
}))
vi.mock('../../../stores/project-store', () => ({
  useProjectStore: {
    getState: () => ({
      currentProject: {
        novelConfig: {
          genre: '玄幻', subGenre: '', targetAudience: '', totalChapters: 100,
          wordsPerChapter: 3000, plotStructure: 'three_act', narrativePOV: 'third_limited',
          coreOutline: '已有大纲内容',
          worldSetting: '', goldenFinger: '', protagonistProfile: '', globalGuidance: '',
        },
      },
      snapshotNovelConfig: mockSnapshot,
      updateNovelConfig: mockUpdate,
      saveProject: vi.fn(),
      restoreNovelConfigSnapshot: vi.fn(),
    }),
  },
}))

import { GenerateFieldCommand } from './generate-field.command'

const params = {
  step: { id: '', commandId: '', name: '', params: {} },
  context: { data: {}, cancelled: false },
  callbacks: { log: vi.fn(), setProgress: vi.fn(), appendText: vi.fn() },
}

beforeEach(() => {
  mockConfirm.mockReset()
  mockUpdate.mockClear()
  mockSnapshot.mockClear()
})

describe('generate-field 覆盖确认（线③）', () => {
  it('字段已有内容 + 取消覆盖 → 返回空串、不写 store、不生成', async () => {
    mockConfirm.mockResolvedValue(false)
    const cmd = new GenerateFieldCommand('coreOutline')
    const result = await cmd.execute(params)
    expect(result).toBe('')
    expect(mockConfirm).toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockSnapshot).not.toHaveBeenCalled()
  })

  it('字段已有内容 + 确认覆盖 → 走确认（confirm 被调，参数含字段名）', async () => {
    mockConfirm.mockResolvedValue(false)
    const cmd = new GenerateFieldCommand('coreOutline')
    await cmd.execute(params)
    // confirm 的 message 含「coreOutline」的中文标签「核心大纲」
    expect(mockConfirm.mock.calls[0][0]).toContain('核心大纲')
  })
})
