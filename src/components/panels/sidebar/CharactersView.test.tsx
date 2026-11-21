// @vitest-environment jsdom
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import CharactersView from './CharactersView'
import { useCharacterStore } from '../../../stores/character-store'
import { useProjectStore } from '../../../stores/project-store'
import { t } from '../../../shared/locale'

// 渲染期不触达 IPC；import 链上的 Confirm/Toast 保持真实（不触发弹窗）
vi.mock('../../../services/ipc-client', () => ({
  ipc: { invoke: vi.fn(async () => null) },
}))

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

const makeCard = (name: string, tier: number, role = 'supporting') => ({ name, tier, role })

/** 工具栏筛选按钮与各分组的折叠按钮独立。 */
function filters(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll('[data-appearance=filters] > button')] as HTMLButtonElement[]
}

describe('CharactersView — 分级筛选', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    useProjectStore.setState({ currentProject: { name: 'p', path: '/p' } as never })
    useCharacterStore.setState({
      characters: [
        makeCard('甲', 1, 'protagonist'),
        makeCard('乙', 2),
        makeCard('丙', 3),
      ] as never,
      selectedName: null,
      dirty: false,
    })
  })

  it('四个选项：全部 + 三档，文案完整且带计数', () => {
    const { container, root } = render(<CharactersView />)
    const texts = filters(container).map(b => b.textContent ?? '')
    expect(texts).toHaveLength(4)
    expect(texts[0]).toContain(t('charList.filterAll'))
    expect(texts[1]).toContain(t('character.tierLabel.core'))
    expect(texts[2]).toContain(t('character.tierLabel.important'))
    expect(texts[3]).toContain(t('character.tierLabel.minor'))
    // 计数就位：全部 = 总数 3；各档 = 1
    expect(texts[0]).toContain('3')
    for (const tx of texts.slice(1)) expect(tx).toContain('1')
    act(() => root.unmount())
  })

  it('选择核心档时仅显示对应角色，选项向读屏暴露状态', () => {
    const { container, root } = render(<CharactersView />)
    const items = filters(container)
    expect(items[0].getAttribute('aria-pressed')).toBe('true')
    act(() => items[1].click())
    expect(items[1].getAttribute('aria-pressed')).toBe('true')
    expect(container.textContent).toContain('甲')
    expect(container.textContent).not.toContain('乙')
    act(() => root.unmount())
  })
})
