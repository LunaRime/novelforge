// @vitest-environment jsdom
/**
 * ModelRoutingSection — 三层路由的「每层多模型」有序列表（A 档）
 *
 * 数据模型与 ModelRouter 一直支持层内多模型（string[]，顺序即优先级），
 * 只有 UI 把它压成了单模型（patch[tier] = [modelId]）。本测试钉住列表语义：
 * 追加到尾部、上移交换、移除保留顺序、移除干净后回退空数组。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ModelRoutingSection } from './SettingsModal'

const mockUpdate = vi.hoisted(() => vi.fn())

const state = vi.hoisted(() => ({
  models: [
    { id: 'e1', name: 'Elite One', modelName: 'elite-one', provider: 'openai' },
    { id: 'e2', name: 'Elite Two', modelName: 'elite-two', provider: 'anthropic' },
    { id: 's1', name: 'Std One', modelName: 'std-one', provider: 'openai' },
  ],
  modelRoutes: { elite: [] as string[], standard: [] as string[], budget: [] as string[] },
}))

vi.mock('../../stores/llm-store', () => ({
  useLLMStore: (selector: (s: typeof state & { updateModelRoutes: typeof mockUpdate }) => unknown) =>
    selector({ ...state, updateModelRoutes: mockUpdate }),
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(<ModelRoutingSection />) })
  return container
}

/** 按 aria-label 取按钮（与组件 a11y 标注一致） */
const btn = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`))

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  mockUpdate.mockClear()
  state.modelRoutes = { elite: [], standard: [], budget: [] }
})

describe('ModelRoutingSection 每层多模型', () => {
  it('elite 层两个模型 → 渲染两行且顺序即数组顺序', () => {
    state.modelRoutes.elite = ['e1', 'e2']
    const el = render()
    const text = el.textContent ?? ''
    expect(text).toContain('Elite One')
    expect(text).toContain('Elite Two')
    expect(text.indexOf('Elite One')).toBeLessThan(text.indexOf('Elite Two'))
  })

  it('移除第一个 → 提交保留顺序的剩余列表', () => {
    state.modelRoutes.elite = ['e1', 'e2']
    render()
    act(() => btn('移除')[0].click())
    expect(mockUpdate).toHaveBeenCalledWith({ elite: ['e2'] })
  })

  it('上移第二个 → 交换顺序', () => {
    state.modelRoutes.elite = ['e1', 'e2']
    render()
    // 首行没有上移按钮 → 唯一的「上移」属于第二行
    act(() => btn('上移')[0].click())
    expect(mockUpdate).toHaveBeenCalledWith({ elite: ['e2', 'e1'] })
  })

  it('移除全部 → 提交空数组（回退默认模型，而非保留 null）', () => {
    state.modelRoutes.elite = ['e1']
    render()
    act(() => btn('移除')[0].click())
    expect(mockUpdate).toHaveBeenCalledWith({ elite: [] })
  })
})
