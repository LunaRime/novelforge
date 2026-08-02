// @vitest-environment jsdom
/**
 * ProjectWorkspace — 项目工作台渲染测试
 *
 * 验证：
 * - 三大块（蓝图/草稿箱/正式稿）渲染
 * - 点击蓝图 → 打开 chapter-card Tab
 * - 点击草稿 → 打开 chapter Tab
 * - 点击正式稿 → 打开 vela://manuscript Tab
 * - 未打开项目时提示
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import ProjectWorkspace from './ProjectWorkspace'
import { useProjectStore } from '../../../stores/project-store'
import { useEditorStore } from '../../../stores/editor-store'

// mock IPC（get-summary）
vi.mock('../../../services/ipc-client', () => ({
  ipc: {
    invoke: vi.fn(async (channel: string) => {
      if (channel === 'project:get-summary') {
        return {
          name: '测试项目',
          path: 'E:\\test\\project',
          totalChapters: 3,
          chapters: [
            { chapterNumber: 1, title: '第一章', draftId: 101 },
            { chapterNumber: 2, title: '第二章', draftId: 102 },
          ],
          draftChapters: [
            { chapterNumber: 1, draftCount: 2, hasFinalized: false, chapterTitle: '第一章' },
          ],
          blueprintCount: 1,
          archGenerated: 1,
        }
      }
      return null
    }),
  },
}))

// mock 草稿内容服务（工作台用 getChapterLatestDraft 拿真实草稿 id）
vi.mock('../../../services/version-service', () => ({
  getChapterLatestDraft: vi.fn(async () => ({ id: 42, content: '最新草稿内容' })),
  getChapterLatestContent: vi.fn(async () => '最新草稿内容'),
}))

function render(ui: React.ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(ui) })
  return { container, root }
}

const mockProject = {
  id: 'test-id',
  name: '测试项目',
  path: 'E:\\test\\project',
  genre: '',
  targetAudience: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  novelConfig: null,
  characterStates: [],
} as never

describe('ProjectWorkspace 项目工作台', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    useEditorStore.setState({ tabs: [], activeTabId: null })
    useProjectStore.setState({ currentProject: mockProject })
  })

  it('未打开项目时显示提示', () => {
    useProjectStore.setState({ currentProject: null })
    const { container } = render(<ProjectWorkspace />)
    expect(container.textContent).toContain('请先打开项目')
  })

  it('渲染三大块（蓝图/草稿箱/正式稿）', async () => {
    const { container } = render(<ProjectWorkspace />)
    // 等待 summary 加载完成
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
    const text = container.textContent || ''
    expect(text).toContain('章节蓝图')
    expect(text).toContain('草稿')
    expect(text).toContain('正式稿')
    // 蓝图徽标 1/3
    expect(text).toContain('1/3')
    // 草稿箱数量 2
    expect(text).toContain('2')
    // 正式稿列表含章节标题（"第1章"格式来自 chapter.label）
    expect(text).toContain('第1章 第一章')
    expect(text).toContain('第2章 第二章')
  })

  it('点击蓝图块 → 打开 chapter-card Tab', async () => {
    const { container } = render(<ProjectWorkspace />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
    const btn = Array.from(container.querySelectorAll('button'))
      .find(b => (b.textContent || '').includes('章节蓝图'))
    expect(btn).toBeTruthy()
    await act(async () => { btn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const tabs = useEditorStore.getState().tabs
    expect(tabs.some(t => t.type === 'chapter-card')).toBe(true)
  })

  it('点击草稿 → 打开 vela://draft/{真实id} Tab（parseDraftMeta 可解析）', async () => {
    const { container } = render(<ProjectWorkspace />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
    // 草稿按钮文本为 "第一章"（含草稿计数）
    const btn = Array.from(container.querySelectorAll('button'))
      .find(b => (b.textContent || '').includes('第一章') && (b.textContent || '').includes('草稿'))
    expect(btn).toBeTruthy()
    await act(async () => { btn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    const tabs = useEditorStore.getState().tabs
    expect(tabs.some(t => t.type === 'chapter' && t.filePath === 'vela://draft/42')).toBe(true)
  })

  it('点击正式稿 → 打开 vela://manuscript/{draftId} Tab', async () => {
    const { container } = render(<ProjectWorkspace />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
    // 正式稿按钮文本为 "第1章 第一章"（草稿按钮含"草稿"计数，需排除）
    const btn = Array.from(container.querySelectorAll('button'))
      .find(b => (b.textContent || '').includes('第1章 第一章') && !(b.textContent || '').includes('草稿'))
    expect(btn).toBeTruthy()
    await act(async () => { btn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    // 异步链路较长：openFinal → openChapterFile → readVelaContent(ipc) → openFile
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    const tabs = useEditorStore.getState().tabs
    expect(tabs.some(t => t.type === 'chapter' && t.filePath === 'vela://manuscript/101')).toBe(true)
  })
})
