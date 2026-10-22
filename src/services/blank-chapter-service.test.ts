import { describe, it, expect, vi, beforeEach } from 'vitest'

const { invoke, emit } = vi.hoisted(() => ({ invoke: vi.fn(), emit: vi.fn() }))
vi.mock('./ipc-client', () => ({ ipc: { invoke } }))
vi.mock('../shared/event-bus', () => ({ globalEventBus: { emit } }))

import { createBlankChapter } from './blank-chapter-service'

describe('createBlankChapter', () => {
  beforeEach(() => { invoke.mockReset(); emit.mockReset() })

  it('无草稿时创建蓝图与 v1 空草稿', async () => {
    invoke.mockImplementation(async (ch: string) => {
      if (ch === 'db:draft-list') return []
      if (ch === 'db:blueprint-get') return null
      if (ch === 'db:blueprint-upsert') return { success: true }
      if (ch === 'db:draft-create') return { success: true, id: 42 }
      throw new Error('unexpected ' + ch)
    })
    const r = await createBlankChapter({ chapterNumber: 3, title: '雨夜' })
    expect(r).toEqual({ kind: 'created', chapterNumber: 3, draftId: 42, version: 1, title: '雨夜' })
    expect(invoke).toHaveBeenCalledWith('db:draft-create', {
      chapterNumber: 3, version: 1, source: 'write', content: '', wordCount: 0,
    })
    expect(emit).toHaveBeenCalledWith('REFRESH_RESOURCE', { resources: ['drafts', 'blueprints'] })
  })

  it('已有非归档草稿时直接返回最新版本，不创建', async () => {
    invoke.mockImplementation(async (ch: string) => {
      if (ch === 'db:draft-list') return [
        { id: 7, version: 2, status: 'draft' },
        { id: 6, version: 1, status: 'archived' },
      ]
      throw new Error('unexpected ' + ch)
    })
    const r = await createBlankChapter({ chapterNumber: 2 })
    expect(r).toEqual({ kind: 'existing', chapterNumber: 2, draftId: 7, version: 2, title: '' })
    expect(invoke).not.toHaveBeenCalledWith('db:draft-create', expect.anything())
  })

  it('已有蓝图时不覆盖标题', async () => {
    invoke.mockImplementation(async (ch: string) => {
      if (ch === 'db:draft-list') return []
      if (ch === 'db:blueprint-get') return { chapterNumber: 1, title: '旧标题' }
      if (ch === 'db:draft-create') return { success: true, id: 9 }
      throw new Error('unexpected ' + ch)
    })
    await createBlankChapter({ chapterNumber: 1, title: '新标题' })
    expect(invoke).not.toHaveBeenCalledWith('db:blueprint-upsert', expect.anything())
  })

  it('章号非法时抛错且不写库', async () => {
    await expect(createBlankChapter({ chapterNumber: 0 })).rejects.toThrow()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('draft-create 失败时把错误抛出', async () => {
    invoke.mockImplementation(async (ch: string) => {
      if (ch === 'db:draft-list') return []
      if (ch === 'db:blueprint-get') return { chapterNumber: 1, title: 'x' }
      if (ch === 'db:draft-create') return { success: false, error: 'disk full' }
      throw new Error('unexpected ' + ch)
    })
    await expect(createBlankChapter({ chapterNumber: 1 })).rejects.toThrow('disk full')
  })
})