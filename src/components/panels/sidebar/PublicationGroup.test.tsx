// @vitest-environment jsdom
/**
 * PublicationGroup — 卡片可供性契约（2026-09-27 修复）
 *
 * 修复前：标题行纯 span 死区（主区不可点、键盘不可达）；列表行整行 hover 变色却无点击处理器。
 * 修复后：头部 = 整行主按钮（chevron 置左、计数在内）；行 = 打开平台正文（编辑器只读标签页，
 * 正文随 db:publication-list 已返回，无需新 IPC）。
 */
import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import PublicationGroup from './PublicationGroup'
import { useEditorStore } from '../../../stores/editor-store'
import { t } from '../../../shared/locale'

const ENTRY = {
  chapterNumber: 3,
  externalTitle: '平台改标题',
  externalContent: '平台正文内容',
  importedAt: 1,
  similarity: 0.92,
  auditIssues: 0,
}

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(node: React.ReactNode): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(node) })
  return container
}

beforeAll(() => {
  const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  g.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('PublicationGroup — 可供性（2026-09-27）', () => {
  let invoke: ReturnType<typeof vi.fn>

  beforeEach(() => {
    document.body.innerHTML = ''
    useEditorStore.setState({ tabs: [], activeTabId: null })
    invoke = vi.fn(async (ch: string) => {
      if (ch === 'db:publication-list') return [ENTRY]
      return null
    })
    Object.defineProperty(window, 'velaAPI', {
      value: { invoke, on: () => () => {}, once: () => {}, send: () => {}, setZoomLevel: () => {}, setZoomFactor: () => {}, getZoomLevel: () => 0 },
      configurable: true,
    })
  })

  it('列表行点击 → 打开平台正文（type=publication）；行主按钮可聚焦（键盘可达）', async () => {
    const el = render(<PublicationGroup projectPath="/mock/proj" />)
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })

    // 头部整行主按钮（含标题与计数）→ 点击展开
    const head = [...el.querySelectorAll('button')].find(b => b.textContent?.includes(t('pub.title')))!
    expect(head).toBeTruthy()
    await act(async () => { head.click() })

    const row = [...el.querySelectorAll('button')].find(b => b.textContent?.includes('平台改标题'))!
    expect(row).toBeTruthy()
    row.focus()
    expect(document.activeElement).toBe(row)
    await act(async () => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    const st = useEditorStore.getState()
    expect(st.tabs).toHaveLength(1)
    expect(st.tabs[0]).toMatchObject({
      id: 'publication://3',
      type: 'publication',
      content: '平台正文内容',
    })
  })

  it('行容器为 .menu-chip 且不再有 hover 类（hover 由片承接，死带清零）；无 button 嵌套', async () => {
    const el = render(<PublicationGroup projectPath="/mock/proj" />)
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    const head = [...el.querySelectorAll('button')].find(b => b.textContent?.includes(t('pub.title')))!
    await act(async () => { head.click() })

    expect(el.querySelectorAll('button button')).toHaveLength(0)
    const rowBox = [...el.querySelectorAll('div')].find(d =>
      String(d.className).includes('group') && d.textContent?.includes('平台改标题'))!
    expect(rowBox.className).toContain('menu-chip')
    expect(rowBox.className).not.toContain('hover:bg-')
  })
})
