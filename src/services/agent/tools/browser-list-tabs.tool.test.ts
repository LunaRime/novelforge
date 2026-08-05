// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipc } from '../../ipc-client'

vi.mock('../../ipc-client', () => ({
  ipc: { invoke: vi.fn() },
}))

const mockInvoke = vi.mocked(ipc.invoke)

beforeEach(() => {
  mockInvoke.mockClear()
})

describe('browser_list_tabs 工具', () => {
  it('查询成功 → 格式化标签列表（标题 + URL）', async () => {
    mockInvoke.mockResolvedValue({
      success: true,
      tabs: [
        { id: '1', title: '斗罗大陆 - 搜索', url: 'https://example.com/search?q=斗罗', type: 'page' },
        { id: '2', title: 'NovelForge', url: 'https://github.com/LunaRime/novelforge', type: 'page' },
      ],
    })
    const { browserListTabsTool } = await import('./browser-list-tabs.tool')
    const result = await browserListTabsTool.execute({})
    expect(mockInvoke).toHaveBeenCalledWith('browser:list-tabs')
    expect(result.success).toBe(true)
    expect(result.content).toContain('共 2 个')
    expect(result.content).toContain('斗罗大陆')
    expect(result.content).toContain('github.com')
  })

  it('空标签列表 → 提示无页面', async () => {
    mockInvoke.mockResolvedValue({ success: true, tabs: [] })
    const { browserListTabsTool } = await import('./browser-list-tabs.tool')
    const result = await browserListTabsTool.execute({})
    expect(result.success).toBe(true)
    expect(result.content).toContain('没有打开的页面')
  })

  it('未启用 → 引导性错误（含设置路径）', async () => {
    mockInvoke.mockResolvedValue({ success: false, error: '浏览器接入未启用（设置 → 开发者模式 → 浏览器接入）' })
    const { browserListTabsTool } = await import('./browser-list-tabs.tool')
    const result = await browserListTabsTool.execute({})
    expect(result.success).toBe(false)
    expect(result.error).toContain('浏览器接入未启用')
  })
})
