// @vitest-environment jsdom
/**
 * ThinkingCollapse — 单链路折叠行契约（线② · dsh 照搬，ReasoningRow 形态）
 *
 * 从带边框折叠块改为 24px 折叠行 + 首行摘要 + 流式尾部渐隐。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import ThinkingCollapse from './ThinkingCollapse'

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

describe('ThinkingCollapse — 单链路折叠行（线② · dsh 照搬）', () => {
  it('24px 折叠行：标题「思考」+ 首行摘要，默认折叠正文不可见', () => {
    const el = render(<ThinkingCollapse thinking={'_思考过程：_\n> 我正在构思第一章的剧情\n> 然后写人物'} />)
    expect(el.textContent).toContain('思考过程')
    // 首行摘要（剥离 > 引用符后的正文首行）
    expect(el.textContent).toContain('我正在构思第一章的剧情')
    // 默认折叠：完整正文（含后续行）不可见
    expect(el.textContent).not.toContain('然后写人物')
  })

  it('整行可点展开/收起（role=button + tabIndex），展开显示正文', async () => {
    const el = render(<ThinkingCollapse thinking={'_思考过程：_\n> 第一行\n> 第二行'} />)
    const row = el.querySelector('[role="button"]') as HTMLElement
    expect(row).toBeTruthy()
    expect(row.getAttribute('tabindex')).toBe('0')
    await act(async () => { row.click() })
    expect(el.textContent).toContain('第二行')
    await act(async () => { row.click() })
    expect(el.textContent).not.toContain('第二行')
  })

  it('流式态：摘要取最新完成段落首行 + 尾部渐隐（mask）', () => {
    const el = render(<ThinkingCollapse streaming thinking={'_思考过程：_\n> 第一段首行\n> 第一段次行\n\n> 第二段首行（流式中）'} />)
    // 流式：最新完成段落 = 第一段，其首行 = 第一段首行
    expect(el.textContent).toContain('第一段首行')
    // 无 button 嵌 button
    expect(el.querySelectorAll('button button')).toHaveLength(0)
  })

  it('无 button 嵌 button', () => {
    const el = render(<ThinkingCollapse thinking={'x'} />)
    expect(el.querySelectorAll('button button')).toHaveLength(0)
  })
})
