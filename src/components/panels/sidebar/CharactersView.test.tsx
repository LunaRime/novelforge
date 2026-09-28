// @vitest-environment jsdom
/**
 * CharactersView — 分级筛选胶囊（2026-09-28 真机走查修复）
 *
 * 缺陷：4 个 tier 胶囊在侧栏宽度里被 flex 压缩，文案**不均折行**
 *（"全部 6" 折成 "全/部 6"、"★☆☆ 龙套 0" 折进字中 "龙/套 0"）——胶囊被压扁成两行块。
 * 契约：胶囊文案永不内折（`whitespace-nowrap` + `flex-shrink-0`），容器允许整齐换行（`flex-wrap`）。
 */
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

/** 分级胶囊（rounded-full 的工具栏按钮；行内其它按钮不带该类） */
function chips(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll('button.rounded-full')] as HTMLButtonElement[]
}

describe('CharactersView — 分级筛选胶囊', () => {
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

  it('四个胶囊：全部 + 三档，文案完整且带计数', () => {
    const { container } = render(<CharactersView />)
    const texts = chips(container).map(b => b.textContent ?? '')
    expect(texts).toHaveLength(4)
    expect(texts[0]).toContain(t('charList.filterAll'))
    expect(texts[1]).toContain(t('character.tierLabel.core'))
    expect(texts[2]).toContain(t('character.tierLabel.important'))
    expect(texts[3]).toContain(t('character.tierLabel.minor'))
    // 计数就位：全部 = 总数 3；各档 = 1
    expect(texts[0]).toContain('3')
    for (const tx of texts.slice(1)) expect(tx).toContain('1')
  })

  it('防压扁契约：胶囊 whitespace-nowrap + flex-shrink-0，容器 flex-wrap（折行回归锁）', () => {
    const { container } = render(<CharactersView />)
    const bar = chips(container)[0].parentElement as HTMLElement
    expect(bar.className).toContain('flex-wrap')
    for (const chip of chips(container)) {
      expect(chip.className).toContain('whitespace-nowrap')
      expect(chip.className).toContain('flex-shrink-0')
    }
  })
})
