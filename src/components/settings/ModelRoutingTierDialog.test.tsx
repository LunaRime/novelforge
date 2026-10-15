// @vitest-environment jsdom
/**
 * ModelRoutingTierDialog —— 单层「模型 + 优先级」勾选弹窗（§2.3）
 *
 * 用户原话：**「为什么选择模型不改成弹窗勾选加数字显示模型优先度？」** —— 本文件钉住这四件事：
 * 1. **勾选加序** —— 勾上追加到尾部，行首显示序号（1、2、3…）；取消勾选后序号自动重排；
 * 2. **顺序可调** —— 已选列表 ↑/↓ 单格交换，首行的 ↑、末行的 ↓ 各自禁用；
 * 3. **只有保存才写库** —— 取消 / Esc 关闭都不调用 `onSave`（草稿随卸载丢弃）；
 * 4. **空层合法** —— 一个都不勾也能保存（提交 `[]` = 该层回退默认模型），弹窗内有该口径说明。
 *
 * 另：候选列表必须**过滤掉 embedding 用途**的模型。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ModelRoutingTierDialog } from './ModelRoutingTierDialog'
import type { ModelProfile } from '../../shared/ipc-channels'

// Dialog 模块不触达 store，但同目录组件习惯性 import 它 —— 直接打桩避免拉起真实 store
vi.mock('../../stores/llm-store', () => ({ useLLMStore: () => undefined }))

const MODELS = [
  { id: 'e1', name: 'Elite One', modelName: 'elite-one', provider: 'openai' },
  { id: 'e2', name: 'Elite Two', modelName: 'elite-two', provider: 'anthropic' },
] as unknown as ModelProfile[]

const onSave = vi.fn()
const onClose = vi.fn()

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(routeIds: string[] = []) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(
      <ModelRoutingTierDialog
        tier="elite"
        tierLabel="创意写作层"
        routeIds={routeIds}
        candidates={MODELS}
        onSave={onSave}
        onClose={onClose}
      />,
    )
  })
  return container
}

/** 已选列表行（含 §5.2 禁用态按钮） */
const selectedRows = () => [...document.body.querySelectorAll<HTMLElement>('[data-testid^="route-selected-"]')]
/** 已选列表里某行的行首序号（aria-hidden 装饰层，视觉上就是「数字即优先度」） */
const ordinalOf = (id: string) =>
  document.body.querySelector<HTMLElement>(`[data-testid="route-selected-${id}"] > span`)!.textContent
/** 候选行首序号（未勾选时为空串） */
const candidateOrdinal = (id: string) =>
  document.body.querySelector<HTMLElement>(`[data-testid="route-candidate-${id}"] > span[aria-hidden="true"]`)!.textContent
const candidateBox = (id: string) =>
  document.body.querySelector<HTMLInputElement>(`[data-testid="route-candidate-${id}"] input[type="checkbox"]`)!
const buttonByText = (text: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!
const closeButtons = (label: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`)]

/** Esc 派发到 document.body（冒泡到 Radix 的 document 级监听）——只发 keydown 会漏掉部分实现，keyup 一并补 */
const escape = () => {
  for (const type of ['keydown', 'keyup'] as const) {
    document.body.dispatchEvent(new KeyboardEvent(type, { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
  }
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  onSave.mockClear()
  onClose.mockClear()
  // locale 是运行时单例（其它测试切过语言会残留）——清掉偏好，t() 回落 zh-CN 默认
  localStorage.removeItem('novelforge-locale')
})

describe('ModelRoutingTierDialog 勾选加序', () => {
  it('候选行是复选框，行首带「1、2、3…」序号位；已勾选行显示序号', () => {
    render(['e2'])
    expect(document.body.querySelectorAll('[data-testid^="route-candidate-"] input[type="checkbox"]').length).toBe(2)
    // 已勾选的 e2 序号 = 1；未勾选的 e1 序号位是空的
    expect(candidateOrdinal('e2')).toBe('1')
    expect(candidateOrdinal('e1')).toBe('')
  })

  it('勾选第二个模型 → 追加到尾部 = 优先级 2（勾选不插队）', () => {
    render()
    act(() => candidateBox('e1').click())
    act(() => candidateBox('e2').click())
    expect(candidateOrdinal('e1')).toBe('1')
    expect(candidateOrdinal('e2')).toBe('2')
    expect(selectedRows().map(r => r.getAttribute('data-testid'))).toEqual([
      'route-selected-e1', 'route-selected-e2',
    ])
  })

  it('取消勾选后序号自动重排（不留空号）', () => {
    render(['e1', 'e2'])
    act(() => candidateBox('e1').click())   // 取消 e1 → e2 升为 1
    expect(candidateOrdinal('e2')).toBe('1')
    expect(selectedRows().map(r => r.getAttribute('data-testid'))).toEqual(['route-selected-e2'])
  })
})

describe('ModelRoutingTierDialog 顺序调整', () => {
  it('↓ 与后一行交换；↑ 与前一行交换', () => {
    render(['e1', 'e2'])
    const down = closeButtons('下移一位')
    act(() => down[0].click())
    expect(selectedRows().map(r => r.getAttribute('data-testid'))).toEqual([
      'route-selected-e2', 'route-selected-e1',
    ])
    expect(ordinalOf('e2')).toBe('1')

    const up = closeButtons('上移一位')
    act(() => up[1].click())
    expect(selectedRows().map(r => r.getAttribute('data-testid'))).toEqual([
      'route-selected-e1', 'route-selected-e2',
    ])
  })

  it('首行的 ↑ 与末行的 ↓ 禁用（临时不可用 → disabled，不是不渲染）', () => {
    render(['e1', 'e2'])
    const up = closeButtons('上移一位')
    const down = closeButtons('下移一位')
    expect(up[0].disabled).toBe(true)
    expect(down[down.length - 1].disabled).toBe(true)
    expect(up[1].disabled).toBe(false)
    expect(down[0].disabled).toBe(false)
  })

  it('图标按钮热区 32×32，且 aria-label 齐全', () => {
    render(['e1', 'e2'])
    const btns = [
      ...closeButtons('上移一位'), ...closeButtons('下移一位'), ...closeButtons('从该层移除'),
    ]
    expect(btns.length).toBe(6)
    for (const b of btns) {
      expect(b.style.width).toBe('32px')
      expect(b.style.height).toBe('32px')
    }
  })

  it('「从该层移除」= 取消勾选，序号随之重排', () => {
    render(['e1', 'e2'])
    act(() => closeButtons('从该层移除')[0].click())
    expect(candidateBox('e1').checked).toBe(false)
    expect(selectedRows().map(r => r.getAttribute('data-testid'))).toEqual(['route-selected-e2'])
  })
})

describe('ModelRoutingTierDialog 只有保存才写库', () => {
  it('保存 → 按当前顺序提交 `{ tier, ids }`，并关窗', () => {
    render(['e1', 'e2'])
    act(() => closeButtons('下移一位')[0].click())
    act(() => buttonByText('保存').click())
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('elite', ['e2', 'e1'])
    expect(onClose).toHaveBeenCalled()
  })

  it('取消 → 不写库', () => {
    render(['e1'])
    act(() => candidateBox('e2').click())
    act(() => buttonByText('取消').click())
    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('Esc 关闭 → 不写库（Radix 自带 Esc + 焦点陷阱，不手写）', () => {
    render(['e1'])
    act(() => candidateBox('e2').click())
    act(() => escape())
    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('空层合法：一个都不勾也能保存（提交 [] = 回退默认模型）', () => {
    render()
    act(() => buttonByText('保存').click())
    expect(onSave).toHaveBeenCalledWith('elite', [])
  })

  it('空层时弹窗内说明「一个都不勾 = 回退默认模型」', () => {
    render()
    expect(document.body.textContent).toContain('回退到默认模型')
  })
})
