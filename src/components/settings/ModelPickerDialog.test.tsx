// @vitest-environment jsdom
/**
 * ModelPickerDialog —— 拉取候选的多选 Modal（dsh 式批量采纳，2026-09-28）
 *
 * 契约：打开即用凭据拉取；候选 checkbox 多选 + 搜索 + 全选（只作用可见项）；
 * 已在卡内的模型禁用勾选并标「已添加」；「采用所选（N）」一次性交付（names + specs）；
 * 失败给分类文案且手工输入仍可用（不是死路）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ModelPickerDialog } from './ModelPickerDialog'

const listProviderModels = vi.hoisted(() => vi.fn(async () => ({
  success: true,
  models: [
    { id: 'qwen-max', contextWindow: 32000, maxTokens: 8192 },
    { id: 'qwen-plus', contextWindow: 131072, maxTokens: 8192 },
    { id: 'qwen-turbo' },
    { id: 'text-embedding-v3' },
  ],
})))

vi.mock('../../stores/llm-store', () => ({
  useLLMStore: Object.assign(() => undefined, {
    getState: () => ({ listProviderModels }),
  }),
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

const CREDENTIALS = { provider: 'custom' as const, protocol: 'openai' as const, apiKey: 'sk-x', baseUrl: 'https://x' }

function render(onAdopt: (names: string[], specs: Record<string, { contextWindow?: number; maxTokens?: number }>) => void = () => {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(
      <ModelPickerDialog
        open
        credentials={CREDENTIALS}
        existing={['qwen-turbo']}
        onAdopt={onAdopt}
        onClose={() => {}}
      />,
    )
  })
  return container
}

async function flush() {
  await act(async () => { await new Promise(r => setTimeout(r, 10)) })
}

const boxes = () => Array.from(document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
const buttonByText = (text: string) =>
  [...document.body.querySelectorAll('button')].find(b => b.textContent?.includes(text))

const setValue = (input: HTMLInputElement, v: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, v)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  listProviderModels.mockClear()
})

describe('ModelPickerDialog 拉取多选 Modal', () => {
  it('打开即用凭据拉取；候选渲染', async () => {
    render()
    await flush()
    expect(listProviderModels).toHaveBeenCalledWith(CREDENTIALS)
    expect(document.body.textContent).toContain('qwen-max')
    expect(document.body.textContent).toContain('text-embedding-v3')
  })

  it('勾选 2 个 → 采用所选 → onAdopt(names, specs) 恰一次（带规格）', async () => {
    const onAdopt = vi.fn()
    render(onAdopt)
    await flush()
    act(() => { boxes()[0].click(); boxes()[1].click() })
    act(() => { buttonByText('采用所选')!.click() })
    expect(onAdopt).toHaveBeenCalledTimes(1)
    expect(onAdopt).toHaveBeenCalledWith(['qwen-max', 'qwen-plus'], {
      'qwen-max': { contextWindow: 32000, maxTokens: 8192 },
      'qwen-plus': { contextWindow: 131072, maxTokens: 8192 },
    })
  })

  it('已在卡内的候选：禁用勾选并标「已添加」', async () => {
    render()
    await flush()
    const turboBox = boxes()[2] // 候选中第 3 个 = qwen-turbo（existing）
    expect(turboBox.disabled).toBe(true)
    expect(document.body.textContent).toContain('已添加')
  })

  it('搜索只过滤显示；全选只作用可见项（不碰 disabled）', async () => {
    render()
    await flush()
    const search = document.body.querySelector('input[type="search"]') as HTMLInputElement
    act(() => setValue(search, 'embedding'))
    expect(document.body.textContent).toContain('text-embedding-v3')
    expect(document.body.textContent).not.toContain('qwen-max')
    act(() => { buttonByText('全选')!.click() })
    const checked = boxes().filter(c => c.checked)
    expect(checked).toHaveLength(1) // 仅可见的 text-embedding-v3
    expect(checked[0].disabled).toBe(false)
  })

  it('拉取失败 → 分类错误文案仍可手工输入添加；采用交付手输模型（无规格）', async () => {
    listProviderModels.mockResolvedValueOnce({ success: false, error: 'ECONNREFUSED' } as never)
    const onAdopt = vi.fn()
    render(onAdopt)
    await flush()
    expect(document.body.textContent).toContain('ECONNREFUSED')

    const manual = document.body.querySelector<HTMLInputElement>('input[type="text"][placeholder]')!
    act(() => setValue(manual, 'my-gateway-model'))
    act(() => { manual.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    act(() => { buttonByText('采用所选')!.click() })
    expect(onAdopt).toHaveBeenCalledWith(['my-gateway-model'], {})
  })
})
