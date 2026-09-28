// @vitest-environment jsdom
/**
 * WelcomePage — 未打开项目时的着陆页（2026-09-28 改版）
 *
 * 「最近项目」区块已迁至侧栏主页（HomeSidebarPanel，同一数据源），本页不再渲染；
 * 三个入口大按钮（新建 / 打开 / 导入小说）保留 —— 前者锁定迁移决策不回退，
 * 后者防止误删入口。
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import WelcomePage from './WelcomePage'
import { useProjectStore } from '../../stores/project-store'
import { t } from '../../shared/locale'

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

function render(ui: React.ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(ui) })
  return { container, root }
}

describe('WelcomePage — 着陆页（最近项目已迁出）', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    // 跳过首次引导，聚焦被断言的区块
    localStorage.setItem('vela-first-run', 'done')
    useProjectStore.setState({
      currentProject: null,
      recentProjects: [{ name: '甲项目', path: '/p/a', updatedAt: Date.now() }],
      openProject: (async () => true) as never,
    })
  })

  it('三个入口大按钮保留：新建 / 打开 / 导入小说', () => {
    const { container } = render(<WelcomePage onNewProject={() => {}} onOpenProject={() => {}} />)
    const texts = [...container.querySelectorAll('button')].map(b => b.textContent ?? '')
    expect(texts.some(x => x.includes(t('welcome.newProject')))).toBe(true)
    expect(texts.some(x => x.includes(t('welcome.openProject')))).toBe(true)
    expect(texts.some(x => x.includes(t('welcome.importNovel')))).toBe(true)
  })

  it('不再渲染「最近项目」区块（2026-09-28 迁至侧栏主页，数据仍在 store）', () => {
    const { container } = render(<WelcomePage onNewProject={() => {}} onOpenProject={() => {}} />)
    expect(container.textContent).not.toContain(t('project.recent'))
    expect(container.textContent).not.toContain('甲项目')
  })
})
