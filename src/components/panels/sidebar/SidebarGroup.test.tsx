// @vitest-environment jsdom
/**
 * SidebarGroup — 四类卡片契约（2026-09-27 可供性重构 / 2026-09-28 行片化）
 *
 * 依据 card-affordance-standard §1/§2：主按钮含图标+标题+计数；折叠卡的指示箭头由悬停置换承担
 * （无右端常驻 `>`）；导航+折叠卡左 chevron 独立按钮（常驻 ›/⌄）；纯状态卡不渲染按钮
 * （不得用 disabled 表达"这里不可点"）。真机验证根因：计数曾是主按钮的兄弟节点（S1b/S2b/S3b 死区）。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import SidebarGroup from './SidebarGroup'

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

describe('SidebarGroup — 四类卡片契约（2026-09-27）', () => {
  it('折叠卡（无 onTitleClick）：整行主按钮 = 展开/折叠；chevron 在主按钮内、置左；计数在内', async () => {
    const el = render(
      <SidebarGroup icon={<span />} title="折叠卡" count="11 章" defaultOpen={false}>
        <div>子项</div>
      </SidebarGroup>
    )
    const buttons = [...el.querySelectorAll('button')]
    expect(buttons).toHaveLength(1)                 // 头部唯一按钮（折叠卡无独立 chevron 按钮）
    const main = buttons[0]
    expect(main.textContent).toContain('折叠卡')
    expect(main.textContent).toContain('11 章')     // 计数在主按钮内（计数死区根因清零）
    // 折叠卡：默认态显示功能图标；悬停置换层携带 ›（收起态）双通道类
    expect(main.querySelector('.lucide-chevron-right')).toBeTruthy()
    expect(el.innerHTML).toContain('group-hover:opacity-0')
    expect(el.innerHTML).toContain('group-focus-within:opacity-100')
    expect(el.textContent).not.toContain('子项')    // 默认收起
    await act(async () => { main.click() })
    expect(el.textContent).toContain('子项')
    await act(async () => { main.click() })
    expect(el.textContent).not.toContain('子项')
    expect(el.querySelectorAll('button button')).toHaveLength(0)
  })

  it('导航卡（onTitleClick + collapsible=false）：点计数区 = 点主按钮；`>` 装饰在主按钮内末尾', async () => {
    const onNav = vi.fn()
    const el = render(
      <SidebarGroup icon={<span />} title="导航卡" count="已完成" collapsible={false} onTitleClick={onNav}>
        <div>正文</div>
      </SidebarGroup>
    )
    const buttons = [...el.querySelectorAll('button')]
    expect(buttons).toHaveLength(1)
    const main = buttons[0]
    // 点击计数文本区 → 冒泡至主按钮 → 触发 onTitleClick（原为死区）
    const countSpan = [...main.querySelectorAll('span')].find(s => s.textContent === '已完成')!
    await act(async () => { countSpan.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onNav).toHaveBeenCalledTimes(1)
    // 无右端常驻 ›（2026-09-28 重订）：指示箭头由悬停置换承担
    expect(main.querySelector('.lucide-chevron-right')).toBeTruthy()   // 置换层的 ›
    expect(el.querySelectorAll('svg')).toHaveLength(1)                 // 不再有第二个（装饰）箭头
  })

  it('导航+折叠卡：折叠 = 左侧独立 chevron 按钮；主按钮只做进入（不误触折叠）', async () => {
    const onNav = vi.fn()
    const el = render(
      <SidebarGroup icon={<span />} title="混合卡" defaultOpen={false} onTitleClick={onNav}>
        <div>子项</div>
      </SidebarGroup>
    )
    const buttons = [...el.querySelectorAll('button')]
    expect(buttons).toHaveLength(2)
    const [chevBtn, main] = buttons
    // 常驻折叠按钮用 ›/⌄（收起=›，展开=⌄）；主按钮只做进入（swap=›）
    expect(chevBtn.querySelector('.lucide-chevron-right')).toBeTruthy()
    await act(async () => { chevBtn.click() })
    expect(chevBtn.querySelector('.lucide-chevron-down')).toBeTruthy()
    await act(async () => { chevBtn.click() })   // 复位，保持后续断言前提
    expect(main.textContent).toContain('混合卡')
    // 主按钮 = 进入，不切换折叠
    await act(async () => { main.click() })
    expect(onNav).toHaveBeenCalledTimes(1)
    expect(el.textContent).not.toContain('子项')
    // 独立 chevron 按钮（头部第一个按钮，置左）= 折叠
    await act(async () => { chevBtn.click() })
    expect(el.textContent).toContain('子项')
  })

  it('纯状态卡（无行为）：不渲染任何按钮，不得用 disabled 表达"不可点"', () => {
    const el = render(
      <SidebarGroup icon={<span />} title="状态卡" count="—" collapsible={false}>
        <div>说明</div>
      </SidebarGroup>
    )
    expect(el.querySelectorAll('button')).toHaveLength(0)
    expect(el.textContent).toContain('状态卡')
    expect(el.textContent).toContain('说明')
  })

  it('头部图标按钮命中区固定 32×32（标准 §5.2）', () => {
    const el = render(
      <SidebarGroup icon={<span />} title="混合卡" defaultOpen={false} onTitleClick={() => {}}>
        <div>子项</div>
      </SidebarGroup>
    )
    const chevBtn = el.querySelector('button') as HTMLButtonElement
    expect(chevBtn.style.width).toBe('32px')
    expect(chevBtn.style.height).toBe('32px')
  })

  it('行片形态：头部为 menu-chip + group；标题 truncate（260px 窄栏不换行）', () => {
    const el = render(<SidebarGroup icon={<span />} title="折叠卡" count="11 章">子项</SidebarGroup>)
    const chip = el.querySelector('.menu-chip')
    expect(chip).toBeTruthy()
    expect(chip!.className).toContain('group')
    expect(el.querySelector('.truncate')).toBeTruthy()
  })
})
