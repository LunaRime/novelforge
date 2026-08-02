// @vitest-environment jsdom
/**
 * HistoricalProjectsNav（Sidebar 常驻底部方块列表）渲染测试
 *
 * 验证历史项目方块列表：
 * - 数据就绪时渲染竖排方块（项目名 + 路径）
 * - 旧版字符串 updatedAt（"1781397664000.0"）不导致渲染崩溃
 * - 点击方块显示单选详情，切换方块替换内容
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import HistoricalProjectsNav from './HistoricalProjectsNav'
import { useProjectStore } from '../../../stores/project-store'

// mock IPC：jsdom 环境无 velaAPI（渲染列表不调用 IPC，仅点击详情时调用）
vi.mock('../../../services/ipc-client', () => ({
  ipc: {
    invoke: vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'project:get-summary') {
        const path = args[0] as string
        // 按项目路径返回不同摘要，模拟真实数据隔离
        if (path.includes('穿越')) {
          return {
            name: '穿越斗罗之我即天命',
            path: 'E:\\vale\\小说\\穿越斗罗之我即天命',
            totalChapters: 5,
            chapters: [],
            draftChapters: [],
            blueprintCount: 0,
            archGenerated: 1,
          }
        }
        return {
          name: '斗罗大陆虚界之痕',
          path: 'E:\\vale\\小说\\斗罗大陆虚界之痕',
          totalChapters: 3,
          chapters: [{ chapterNumber: 1, title: '第一章' }],
          draftChapters: [{ chapterNumber: 1, draftCount: 2, hasFinalized: false }],
          blueprintCount: 1,
          archGenerated: 0,
        }
      }
      return null
    }),
  },
}))

function render(ui: React.ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(ui) })
  return { container, root }
}

describe('历史项目方块列表', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    useProjectStore.setState({
      currentProject: null,
      recentProjects: [
        { name: '斗罗大陆虚界之痕', path: 'E:\\vale\\小说\\斗罗大陆虚界之痕', updatedAt: 1785584321000 },
        // 旧版遗留：updatedAt 为字符串格式（含小数点），曾导致渲染崩溃
        { name: '穿越斗罗之我即天命', path: 'E:\\vale\\小说\\穿越斗罗之我即天命', updatedAt: '1781397664000.0' } as unknown as { name: string; path: string; updatedAt: number },
      ],
    })
  })

  it('渲染竖排方块列表（项目名 + 路径）', () => {
    const { container } = render(<HistoricalProjectsNav />)
    const text = container.textContent || ''
    expect(text).toContain('斗罗大陆虚界之痕')
    expect(text).toContain('E:\\vale\\小说\\斗罗大陆虚界之痕')
    expect(text).toContain('穿越斗罗之我即天命')
    // 方块数量 = 2（不含当前项目）
    const squareButtons = Array.from(container.querySelectorAll('button'))
      .filter(b => (b.textContent || '').includes('E:\\vale\\小说\\'))
    expect(squareButtons).toHaveLength(2)
  })

  it('旧字符串 updatedAt 不导致渲染崩溃（Invalid Date 保护）', () => {
    expect(() => render(<HistoricalProjectsNav />)).not.toThrow()
  })

  it('点击方块显示单选详情，切换方块替换内容', async () => {
    const { container } = render(<HistoricalProjectsNav />)
    const buttons = Array.from(container.querySelectorAll('button'))

    // 点击第一个项目方块 → 加载并显示详情
    const first = buttons.find(b => (b.textContent || '').includes('斗罗大陆虚界之痕'))
    expect(first).toBeTruthy()
    await act(async () => { first!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    let text = container.textContent || ''
    // 详情内容出现（章节蓝图徽标 1/3）
    expect(text).toContain('1/3')

    // 点击第二个方块 → 内容替换为项目二（仅显示其加载态/名称）
    const second = Array.from(container.querySelectorAll('button'))
      .find(b => (b.textContent || '').includes('穿越斗罗之我即天命'))
    expect(second).toBeTruthy()
    await act(async () => { second!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    // 项目一详情被替换（不再显示 1/3 徽标，显示项目二加载态）
    text = container.textContent || ''
    expect(text).not.toContain('1/3')
  })
})
