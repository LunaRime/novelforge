// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, beforeEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import SceneList from './SceneList'

const mocks = vi.hoisted(() => ({
  listScenes: vi.fn(),
  reorderScenes: vi.fn(),
  deleteScene: vi.fn(),
  upsertScene: vi.fn(),
}))

vi.mock('../../../services/scene-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/scene-service')>()
  return {
    ...actual,
    listScenes: mocks.listScenes,
    reorderScenes: mocks.reorderScenes,
    deleteScene: mocks.deleteScene,
    upsertScene: mocks.upsertScene,
  }
})

beforeAll(() => {
  const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  g.IS_REACT_ACT_ENVIRONMENT = true
})

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

beforeEach(() => {
  mocks.listScenes.mockReset()
  mocks.reorderScenes.mockReset().mockResolvedValue({ success: true })
  mocks.deleteScene.mockReset().mockResolvedValue({ success: true })
  mocks.upsertScene.mockReset().mockResolvedValue({ success: true })
})

async function render() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<SceneList chapterNumber={1} />) })
  cleanups.push(() => { act(() => root.unmount()); container.remove() })
  return container
}

function scene(id: number, title: string, sortOrder: number, wordCount = 0) {
  return { id, chapterNumber: 1, title, summary: '', status: 'planned', sortOrder, wordCount, contentId: null }
}

describe('SceneList — 场景层', () => {
  it('按后端顺序渲染场景与字数', async () => {
    mocks.listScenes.mockResolvedValue([scene(1, '开场', 10, 120), scene(2, '对峙', 20)])
    const el = await render()
    expect(el.textContent).toContain('开场')
    expect(el.textContent).toContain('对峙')
    expect(el.textContent).toContain('120')
  })

  it('Alt+↓ 调换顺序并写库', async () => {
    mocks.listScenes.mockResolvedValue([scene(1, '开场', 10), scene(2, '对峙', 20)])
    const el = await render()
    const row = el.querySelector('[aria-label^="开场"]') as HTMLElement
    await act(async () => {
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }))
    })
    expect(mocks.reorderScenes).toHaveBeenCalledWith(1, [2, 1])
  })

  it('加载失败给出重试入口，而不是显示空态', async () => {
    mocks.listScenes.mockRejectedValueOnce(new Error('ipc down'))
    const el = await render()
    expect(el.textContent).toContain('场景加载失败')
    expect(el.textContent).toContain('重试')

    mocks.listScenes.mockResolvedValueOnce([scene(1, '开场', 10)])
    const retry = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('重试'))!
    await act(async () => { retry.click() })
    expect(el.textContent).toContain('开场')
  })
})
