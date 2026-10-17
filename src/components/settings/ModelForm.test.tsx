// @vitest-environment jsdom
/**
 * ModelForm —— 「其他」卡手工条目的行内表单（2026-10-17 百万上下文时代）。
 *
 * 契约（task-5）：
 * - 上下文窗口留空/非法 → onBlur 回填 `DEFAULT_CONTEXT_WINDOW_TOKENS`（1M），不再回填 131k
 * - 快捷挡位 300K / 600K / 1M → 直接写入 300000 / 600000 / 1000000（原生 button、可 Tab 到）
 * - 窗口挡位不抬高输出上限：maxTokens 仍钳在 [1, MAX_TOKENS_CAP]
 * - `tokenSpec`：预设没写窗口 → 1M 兜底；写了 → 显式值优先；maxTokens 仍取 fallback 参数
 * - 向量模型不渲染窗口参数（也就没有挡位按钮）—— 保持既有行为
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ModelForm, tokenSpec } from './ModelForm'
import { BUILTIN_PRESETS, DEFAULT_CONTEXT_WINDOW_TOKENS } from '../../shared/provider-presets'
import { MAX_TOKENS_CAP } from '../../shared/llm-constants'
import type { ModelProfile } from '../../shared/ipc-channels'

/** ModelForm 只读 store 的测试连接；其余动作（拉模型）在本文件里不触发 */
const state = vi.hoisted(() => ({
  testConnection: vi.fn(async () => ({ success: true })),
  listProviderModels: vi.fn(async () => ({ success: true, models: [] as unknown[] })),
}))

vi.mock('../../stores/llm-store', () => ({
  useLLMStore: Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state },
  ),
}))

const BASE: ModelProfile = {
  id: 'manual-1',
  name: '手工模型',
  provider: 'custom',
  protocol: 'openai',
  modelName: 'my-model',
  baseUrl: 'https://api.example.com',
  temperature: 0.7,
  maxTokens: 4096,
  contextWindow: 131_072,
  purposes: ['generation'],
}

let container: HTMLDivElement | null = null
let root: Root | null = null

/** 最小父级：持有受控 model（与 OrphanRows 的接线同形） */
function Harness({ initial }: { initial: ModelProfile }) {
  const [model, setModel] = useState<ModelProfile>(initial)
  return (
    <ModelForm
      model={model}
      presets={BUILTIN_PRESETS}
      onChange={setModel}
      onSave={() => {}}
      onCancel={() => {}}
      saving={false}
    />
  )
}

function render(initial: ModelProfile = BASE) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(<Harness initial={initial} />) })
  return container
}

beforeEach(() => { vi.clearAllMocks() })

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
})

/** 表单里两个 number 框：DOM 序 = [上下文窗口, 最大输出 token] */
function numberInputs(): HTMLInputElement[] {
  return [...container!.querySelectorAll('input[type="number"]')] as HTMLInputElement[]
}

const contextWindowInput = () => numberInputs()[0]
const maxTokensInput = () => numberInputs()[1]

function buttonByText(text: string): HTMLButtonElement | null {
  return ([...container!.querySelectorAll('button')]
    .find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined) ?? null
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function click(el: HTMLElement) {
  act(() => { el.click() })
}

/** 失焦提交（jsdom 只在已聚焦元素上派发 blur/focusout） */
function blur(el: HTMLElement) {
  act(() => { el.focus() })
  act(() => { el.blur() })
}

describe('ModelForm 上下文窗口默认值与快捷挡位', () => {
  it('窗口留空失焦 → 回填 1M（不再是旧口径 131072）', () => {
    render()
    expect(contextWindowInput().value).toBe('131072')

    act(() => { setValue(contextWindowInput(), '') })
    blur(contextWindowInput())

    expect(contextWindowInput().value).toBe('1000000')
    expect(contextWindowInput().value).toBe(String(DEFAULT_CONTEXT_WINDOW_TOKENS))
  })

  it('窗口非法值（0）失焦 → 回填 1M', () => {
    render()
    act(() => { setValue(contextWindowInput(), '0') })
    blur(contextWindowInput())

    expect(contextWindowInput().value).toBe('1000000')
  })

  it('快捷挡位 300K / 600K / 1M → 写入 300000 / 600000 / 1000000（原生 button）', () => {
    render()
    const tiers: Array<[string, number]> = [['300K', 300_000], ['600K', 600_000], ['1M', 1_000_000]]

    for (const [label, value] of tiers) {
      const btn = buttonByText(label)
      expect(btn, `未找到挡位按钮「${label}」`).toBeTruthy()
      expect(btn!.tagName).toBe('BUTTON')       // 键盘可达：原生按钮，不是 div
      expect(btn!.type).toBe('button')          // 不触发外层表单提交
      click(btn!)
      expect(contextWindowInput().value, label).toBe(String(value))
    }
  })

  it('窗口挡位不抬高输出上限：maxTokens 仍钳到 MAX_TOKENS_CAP', () => {
    render()
    click(buttonByText('1M')!)

    const mt = maxTokensInput()
    act(() => { setValue(mt, '9999999') })
    blur(mt)

    expect(maxTokensInput().value).toBe(String(MAX_TOKENS_CAP))
    expect(MAX_TOKENS_CAP).toBe(131_072)
    expect(contextWindowInput().value).toBe('1000000') // 窗口仍是用户点的挡位
  })

  it('向量模型不渲染窗口参数：无窗口输入框、无快捷挡位（保持既有行为）', () => {
    render({ ...BASE, purposes: ['embedding'] })

    expect(numberInputs()).toHaveLength(0)
    expect(buttonByText('300K')).toBeNull()
    expect(buttonByText('600K')).toBeNull()
    expect(buttonByText('1M')).toBeNull()
  })
})

describe('tokenSpec（预设规格 → 表单初值）', () => {
  it('预设没写窗口 → 1M 兜底；maxTokens 仍取 fallback 参数', () => {
    expect(tokenSpec(null, 4_096)).toEqual({ maxTokens: 4_096, contextWindow: 1_000_000 })
    expect(tokenSpec(undefined, 8_192)).toEqual({ maxTokens: 8_192, contextWindow: 1_000_000 })
    expect(tokenSpec({ name: 'm', maxTokens: 64_000 }, 4_096))
      .toEqual({ maxTokens: 64_000, contextWindow: 1_000_000 })
  })

  it('预设显式写了窗口 → 显式值优先（不覆盖真实窗口）', () => {
    expect(tokenSpec({ name: 'm', maxTokens: 64_000, contextWindow: 200_000 }, 4_096))
      .toEqual({ maxTokens: 64_000, contextWindow: 200_000 })
  })
})
