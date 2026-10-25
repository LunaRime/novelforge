import { describe, it, expect, vi, beforeEach } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('./ipc-client', () => ({ ipc: { invoke } }))

import { useEditorStore } from '../stores/editor-store'
import { refreshOpenDraftVersion } from './draft-version-refresh'
import type { EditorTab } from '../stores/editor-store'

const draftTab = (id: number, chapterNumber: number, dirty = false, name = `第${chapterNumber}章 v1`): EditorTab => ({
  id: `vela://draft/${id}`,
  name,
  type: 'chapter',
  filePath: `vela://draft/${id}`,
  content: '旧',
  dirty,
  chapterNumber,
})

describe('refreshOpenDraftVersion', () => {
  beforeEach(() => {
    invoke.mockReset()
    useEditorStore.setState({ tabs: [], activeTabId: null })
  })

  it('干净 Tab 原位切到新版本并清 dirty', async () => {
    useEditorStore.setState({ tabs: [draftTab(1, 3)], activeTabId: 'vela://draft/1' })
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db:draft-get-full') return { content: '新正文' }
      if (channel === 'db:draft-get-meta') return { id: 2, chapterNumber: 3, version: 2 }
      throw new Error('unexpected ' + channel)
    })

    const result = await refreshOpenDraftVersion({ chapterNumber: 3, draftId: 2, version: 2 })

    expect(result.action).toBe('retargeted')
    const tab = useEditorStore.getState().tabs[0]
    expect(tab.id).toBe('vela://draft/2')
    expect(tab.filePath).toBe('vela://draft/2')
    expect(tab.content).toBe('新正文')
    expect(tab.dirty).toBe(false)
    expect(tab.name).toContain('v2')
    expect(tab.name).toContain('第3章')
  })

  it('脏 Tab 只报告，不覆盖', async () => {
    useEditorStore.setState({ tabs: [draftTab(1, 3, true)], activeTabId: 'vela://draft/1' })
    const result = await refreshOpenDraftVersion({ chapterNumber: 3, draftId: 2, version: 2 })
    expect(result.action).toBe('dirty')
    expect(useEditorStore.getState().tabs[0].content).toBe('旧')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('没有打开的章节 Tab 时 no-tab', async () => {
    const result = await refreshOpenDraftVersion({ chapterNumber: 9, draftId: 2, version: 2 })
    expect(result).toEqual({ action: 'no-tab' })
  })

  it('新版本正文读取失败时 missing', async () => {
    useEditorStore.setState({ tabs: [draftTab(1, 3)], activeTabId: 'vela://draft/1' })
    invoke.mockResolvedValue(null)
    const result = await refreshOpenDraftVersion({ chapterNumber: 3, draftId: 2, version: 2 })
    expect(result.action).toBe('missing')
    expect(useEditorStore.getState().tabs[0].content).toBe('旧')
  })

  it('旧 Tab 没有 chapterNumber 时通过 draft meta 匹配', async () => {
    useEditorStore.setState({
      tabs: [{ ...draftTab(1, 1), chapterNumber: undefined }],
      activeTabId: 'vela://draft/1',
    })
    invoke.mockImplementation(async (channel: string, id: number) => {
      if (channel === 'db:draft-get-meta' && id === 1) return { id: 1, chapterNumber: 3, version: 1 }
      if (channel === 'db:draft-get-full') return { content: '新正文' }
      if (channel === 'db:draft-get-meta' && id === 2) return { id: 2, chapterNumber: 3, version: 2 }
      throw new Error('unexpected ' + channel + ' ' + id)
    })
    const result = await refreshOpenDraftVersion({ chapterNumber: 3, draftId: 2, version: 2 })
    expect(result.action).toBe('retargeted')
  })
})