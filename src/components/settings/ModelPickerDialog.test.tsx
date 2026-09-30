// @vitest-environment jsdom
/**
 * ModelPickerDialog —— 拉取候选的多选 Modal（模型管理 v3 §5，2026-10-01 候选规则升级）
 *
 * 契约（task-8-brief Step 1 + Resolution 4）：
 * - 打开即用凭据拉取；失败给分类文案且**手工输入仍可用**（不是死路）
 * - **新候选默认勾选**；**已存在默认不勾、但可勾**（v2 是「禁用」——已存在也能重新采纳，
 *   采纳时由目录区按「保留用户值、只补齐缺失字段」合并）
 * - 全选**只作用可见项**；「取消全选」**清全部勾选**（含被搜索挡住的隐藏项与手工项）
 * - 搜索匹配 **id 与显示名**
 * - 等宽 id + `title=显示名`（无显示名回落 id）
 * - 「采用所选（N）」一次性交付 `AdoptedModel[]`（id/显示名/容量/输入类型；手工项无规格）
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ModelPickerDialog, type AdoptedModel } from './ModelPickerDialog'

const listProviderModels = vi.hoisted(() => vi.fn(async () => ({
  success: true,
  models: [
    { id: 'qwen-max', name: 'Qwen Max', contextWindow: 32000, maxTokens: 8192, inputTypes: ['text', 'image'] },
    { id: 'qwen-plus', contextWindow: 131072, maxTokens: 8192 },
    { id: 'qwen-turbo' },            // 目录里已有 → 默认不勾
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

const CREDENTIALS = { provider: 'custom' as const, protocol: 'openai' as const, baseUrl: 'https://x', apiKeyDraft: 'sk-x' }

/** 目录里已有的模型 ID（qwen-turbo） */
const EXISTING = ['qwen-turbo']

function render(onAdopt: (models: AdoptedModel[]) => void = () => {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(
      <ModelPickerDialog
        open
        credentials={CREDENTIALS}
        existing={EXISTING}
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
/** 候选行的 id 文本节点（等宽 + title 的观测点） */
const idLabel = (id: string) =>
  [...document.body.querySelectorAll('span')].find(s => s.textContent === id)

const setValue = (input: HTMLInputElement, v: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, v)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const search = () => document.body.querySelector('input[type="search"]') as HTMLInputElement

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  listProviderModels.mockClear()
})

describe('ModelPickerDialog 候选规则', () => {
  it('打开即用凭据拉取；候选渲染（等宽 id + title=显示名，无显示名回落 id）', async () => {
    render()
    await flush()
    expect(listProviderModels).toHaveBeenCalledWith(CREDENTIALS)
    expect(document.body.textContent).toContain('qwen-max')
    expect(document.body.textContent).toContain('text-embedding-v3')

    expect(idLabel('qwen-max')!.getAttribute('title')).toBe('Qwen Max')
    expect(idLabel('qwen-max')!.className).toContain('font-mono')
    expect(idLabel('qwen-plus')!.getAttribute('title')).toBe('qwen-plus') // 无显示名 → 回落 id
  })

  it('新候选默认勾选；已存在默认不勾、但**可勾**（不再禁用）', async () => {
    render()
    await flush()
    const [max, plus, turbo, embed] = boxes()

    expect([max.checked, plus.checked, turbo.checked, embed.checked]).toEqual([true, true, false, true])
    expect(turbo.disabled).toBe(false)                      // v2 是 disabled —— 现在要能重新勾
    expect(document.body.textContent).toContain('已添加')      // 但仍标出来源
  })

  it('已存在的候选被勾选 → 照样交付（合并留给目录区：保留用户值、只补齐缺失字段）', async () => {
    const onAdopt = vi.fn()
    render(onAdopt)
    await flush()
    act(() => { buttonByText('全选')!.click() })            // 先全勾
    act(() => { buttonByText('取消全选')!.click() })         // 再清空（默认勾选的新候选也一起清）
    act(() => { boxes()[2].click() })                       // 只勾 qwen-turbo（已存在的那条）
    act(() => { buttonByText('采用所选')!.click() })

    expect(onAdopt).toHaveBeenCalledTimes(1)
    const adopted = onAdopt.mock.calls[0][0] as AdoptedModel[]
    expect(adopted.map(m => m.name)).toEqual(['qwen-turbo'])
  })

  it('搜索匹配 id 与显示名（`Qwen Max` 只出现在显示名上）', async () => {
    render()
    await flush()

    act(() => setValue(search(), 'Qwen Max'))
    expect(boxes()).toHaveLength(1)
    expect(idLabel('qwen-max')).toBeTruthy()

    act(() => setValue(search(), 'turbo'))                  // 命中 id
    expect(boxes()).toHaveLength(1)
    expect(idLabel('qwen-turbo')).toBeTruthy()

    act(() => setValue(search(), 'qwen-'))                  // 前缀 → 3 条（不含 embedding）
    expect(boxes()).toHaveLength(3)
  })

  it('全选只作用**可见项**；「取消全选」清**全部**勾选（含被搜索挡住的隐藏项）', async () => {
    render()
    await flush()
    act(() => setValue(search(), 'embedding'))              // 只剩 text-embedding-v3 可见
    expect(boxes()).toHaveLength(1)

    // 默认态下可见项已勾 → 按钮是「取消全选」→ 清掉**全部**（含隐藏的 qwen-max/qwen-plus）
    act(() => { buttonByText('取消全选')!.click() })
    act(() => setValue(search(), ''))
    expect(boxes().map(b => b.checked)).toEqual([false, false, false, false])

    // 再「全选」：只加可见项（仍筛着 embedding）——隐藏项不许被顺手带上
    act(() => setValue(search(), 'embedding'))
    act(() => { buttonByText('全选')!.click() })
    act(() => setValue(search(), ''))
    expect(boxes().map(b => b.checked)).toEqual([false, false, false, true])
  })

  it('采用所选：交付 AdoptedModel[]（id / 显示名 / 容量 / 输入类型；无规格者只带 id）', async () => {
    const onAdopt = vi.fn()
    render(onAdopt)
    await flush()
    act(() => { buttonByText('采用所选')!.click() })

    expect(onAdopt).toHaveBeenCalledWith([
      { name: 'qwen-max', displayName: 'Qwen Max', contextWindow: 32000, maxTokens: 8192, inputTypes: ['text', 'image'] },
      { name: 'qwen-plus', contextWindow: 131072, maxTokens: 8192 },
      { name: 'text-embedding-v3' },
    ])
  })

  it('手工输入行常驻：回车加入并进交付（无规格）；失败态下仍可用', async () => {
    listProviderModels.mockResolvedValueOnce({ success: false, error: 'ECONNREFUSED' } as never)
    const onAdopt = vi.fn()
    render(onAdopt)
    await flush()
    expect(document.body.textContent).toContain('ECONNREFUSED')

    const manual = document.body.querySelector<HTMLInputElement>('input[type="text"][placeholder]')!
    act(() => setValue(manual, 'my-gateway-model'))
    act(() => { manual.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    act(() => { buttonByText('采用所选')!.click() })

    expect(onAdopt).toHaveBeenCalledWith([{ name: 'my-gateway-model' }])
  })

  it('全选（补齐未勾的已存在项）→ 取消全选清空 → 「采用所选」禁用（空交付不是一种操作）', async () => {
    render()
    await flush()
    expect(boxes()[2].checked).toBe(false)                  // 已存在项默认不勾

    act(() => { buttonByText('全选')!.click() })
    expect(boxes().every(b => b.checked)).toBe(true)

    act(() => { buttonByText('取消全选')!.click() })
    expect(boxes().some(b => b.checked)).toBe(false)
    expect((buttonByText('采用所选') as HTMLButtonElement).disabled).toBe(true)
  })
})
