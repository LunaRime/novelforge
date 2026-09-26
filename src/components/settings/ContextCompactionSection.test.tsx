// @vitest-environment jsdom
/**
 * ContextCompactionSection — 设置页「上下文与压缩」（§7.1-C2 保留偏好）。
 * 契约：读出已存偏好；保存时**钳制**（与读取侧同一真源）后写 config:set；
 * 文案说明「只影响之后的压缩」与 keepBatches 会释放旧原文。
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import ContextCompactionSection from './ContextCompactionSection'
import { t } from '../../shared/locale'

beforeAll(() => {
  const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  g.IS_REACT_ACT_ENVIRONMENT = true
})

let invoke: ReturnType<typeof vi.fn>

const render = (): { container: HTMLElement; root: Root } => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(<ContextCompactionSection />) })
  return { container, root }
}

beforeEach(() => {
  document.body.innerHTML = ''
  invoke = vi.fn(async (ch: string) => {
    if (ch === 'config:get') return { compaction: { historyMaxTokens: 6000, minimumChangeTokens: 300, keepBatches: 2 } }
    if (ch === 'config:set') return { success: true }
    return null
  })
  Object.defineProperty(window, 'velaAPI', { value: { invoke }, configurable: true })
})

describe('ContextCompactionSection', () => {
  it('读出已存偏好并回填三个输入框', async () => {
    const { container, root } = render()
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    const inputs = [...container.querySelectorAll('input')] as HTMLInputElement[]
    expect(inputs).toHaveLength(3)
    expect(inputs.map(i => i.value)).toEqual(['6000', '300', '2'])
    act(() => { root.unmount() })
  })

  it('文案写明「只影响之后的压缩」与 keepBatches 会释放旧原文（口径诚实）', async () => {
    const { container, root } = render()
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(container.textContent).toContain(t('settings.compactionDesc'))
    expect(container.textContent).not.toContain('**')   // 纯文本 <p> 里星号会原样显示给用户
    expect(container.textContent).toContain('恢复原文')
    act(() => { root.unmount() })
  })

  it('保存：超范围值被钳制后再写（写进去的一定能被读回）', async () => {
    const { container, root } = render()
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    const inputs = [...container.querySelectorAll('input')] as HTMLInputElement[]
    // 把历史预算改成超上限（999999 → 32000）、最小降幅改负数（-5 → 0）
    act(() => {
      const setNative = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setNative.call(inputs[0], '999999')
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
      setNative.call(inputs[1], '-5')
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }))
    })
    const saveBtn = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === t('action.save'))!
    act(() => { saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })

    const call = invoke.mock.calls.find(c => c[0] === 'config:set')
    expect(call?.[1]).toEqual({ compaction: { historyMaxTokens: 32000, minimumChangeTokens: 0, keepBatches: 2 } })
    act(() => { root.unmount() })
  })

  it('读配置失败 → 回默认值（不崩、不冒充已读到）', async () => {
    invoke.mockRejectedValue(new Error('no config'))
    const { container, root } = render()
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    const inputs = [...container.querySelectorAll('input')] as HTMLInputElement[]
    expect(inputs.map(i => i.value)).toEqual(['4000', '200', '0'])
    act(() => { root.unmount() })
  })
})
