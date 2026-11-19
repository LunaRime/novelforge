// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { BookOpen } from 'lucide-react'
import MenuRow from './MenuRow'

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
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('MenuRow — 行片（唯一实现）', () => {
  it('主按钮包含标题与计数；点计数（冒泡）触发 onPrimary', async () => {
    const onPrimary = vi.fn()
    const el = render(
      <MenuRow icon={<BookOpen size={12} />} title="小说配置" count="已完成" swap="nav" onPrimary={onPrimary} />
    )
    const main = el.querySelector('button') as HTMLButtonElement
    expect(main).toBeTruthy()
    expect(main.textContent).toContain('小说配置')
    expect(main.textContent).toContain('已完成')
    const countSpan = [...main.querySelectorAll('span')].find(s => s.textContent === '已完成')!
    await act(async () => { countSpan.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onPrimary).toHaveBeenCalledTimes(1)
  })

  it('容器是 menu-chip 且带 group（置换触发源）；标题 truncate、计数不缩', () => {
    const el = render(<MenuRow icon={<BookOpen size={12} />} title="故事架构" count="4/4" swap="expand" onPrimary={() => {}} />)
    const chip = el.firstElementChild as HTMLElement
    expect(chip.className).toContain('menu-chip')
    expect(chip.className).toContain('group')
    expect(el.querySelector('.truncate')).toBeTruthy()
  })

  it('leadingButton 在主轴之前；actions 在主轴之后（兄弟）', () => {
    const el = render(
      <MenuRow title="混合卡" swap="nav" onPrimary={() => {}}
        leadingButton={<button type="button" data-testid="fold" />}
        actions={<button type="button" data-testid="act" />} />
    )
    const buttons = [...el.querySelectorAll('button')]
    expect(buttons.map(b => b.getAttribute('data-testid'))).toEqual(['fold', null, 'act'])
  })

  it('无 onPrimary → 不渲染按钮（纯展示行）；无嵌套 button', () => {
    const el = render(<MenuRow title="状态卡" count="—" />)
    expect(el.querySelectorAll('button')).toHaveLength(0)
    expect(el.querySelectorAll('button button')).toHaveLength(0)
  })

  it('主按钮可聚焦、无嵌套 button（键盘可达契约）', () => {
    const el = render(<MenuRow title="折叠卡" swap="expand" onPrimary={() => {}} actions={<button type="button" />} />)
    const main = el.querySelector('button') as HTMLButtonElement
    main.focus()
    expect(document.activeElement).toBe(main)
    expect(el.querySelectorAll('button button')).toHaveLength(0)
  })

  it('折叠行向辅助技术公布展开状态与受控区域', () => {
    const el = render(<MenuRow title="第一卷" swap="expand" expanded={false} controlsId="volume-one" onPrimary={() => {}} />)
    const button = el.querySelector('button')!
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-controls')).toBe('volume-one')
  })

  it('导航行可标记当前页，通用高亮不声明当前页或展开状态', () => {
    const el = render(<>
      <MenuRow title="雾港来信" swap="nav" current="page" active onPrimary={() => {}} />
      <MenuRow title="草稿箱" swap="nav" expanded active onPrimary={() => {}} />
    </>)
    const [currentPage, highlighted] = el.querySelectorAll('button')
    expect(currentPage.getAttribute('aria-current')).toBe('page')
    expect(highlighted.hasAttribute('aria-current')).toBe(false)
    expect(highlighted.hasAttribute('aria-expanded')).toBe(false)
  })
})
