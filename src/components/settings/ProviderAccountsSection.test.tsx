// @vitest-environment jsdom
/**
 * ProviderAccountForm — 候选清单的搜索 + 全选/反选（2026-09-28 走查：对齐 dsh）
 *
 * 候选 = 拉取结果 ∪ 预设（`candidateModels`），拉取后长清单必须能搜、能一键全选；
 * 全选/反选只对**过滤后可见项**生效（dsh 同款语义）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ProviderAccountForm } from './ProviderAccountsSection'

const listModels = vi.hoisted(() => vi.fn(async () => ({
  success: true,
  models: [
    { id: 'bge-m3' }, { id: 'bge-large-zh' }, { id: 'nomic-embed-text' }, { id: 'BGE-Reranker' },
  ],
})))

vi.mock('../../stores/llm-store', () => ({
  useLLMStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ providers: [], models: [], listProviderModels: listModels, saveProvider: vi.fn(async () => true) }),
    {
      getState: () => ({
        providers: [], models: [], listProviderModels: listModels,
        saveProvider: vi.fn(async () => true), deleteProvider: vi.fn(),
      }),
    },
  ),
}))
vi.mock('../../stores/agent-store', () => ({
  useAgentStore: Object.assign(() => [], { getState: () => ({ conversations: [] }) }),
}))
vi.mock('../../stores/vector-config-store', () => ({
  useVectorConfigStore: Object.assign(() => ({}), { getState: () => ({ llmEmbeddingSettings: { modelId: null } }) }),
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

const render = () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(
      <ProviderAccountForm
        account={{ id: 'p1', provider: 'ollama', protocol: 'openai', apiKey: '', baseUrl: 'http://localhost:11434', modelNames: [] }}
        onCancel={() => {}}
        onDone={() => {}}
      />,
    )
  })
  return container
}

async function fetchList(el: HTMLElement) {
  await act(async () => {
    const fetchBtn = [...el.querySelectorAll('button')].find(b => b.textContent?.includes('获取可用模型'))
    fetchBtn!.click()
    await new Promise(r => setTimeout(r, 10))
  })
}

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
})

describe('零勾选守卫（v3 T2 fix round 1）', () => {
  const saveBtn = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === '保存')!

  it('零勾选：保存按钮 disabled + title 说明（零勾选会送 [] → 主进程按继承物化整目录）', async () => {
    const el = render()
    await fetchList(el)
    const save = saveBtn(el)
    expect(save.disabled).toBe(true)
    expect(save.getAttribute('title')).toBe('至少保留一个模型')
  })

  it('勾选一个模型 → 保存恢复可用（守卫只挡零勾选）', async () => {
    const el = render()
    await fetchList(el)
    const box = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    act(() => box.click())
    expect(saveBtn(el).disabled).toBe(false)
  })
})

describe('供应商区候选清单（搜索 + 全选/反选）', () => {
  it('搜索过滤：大小写不敏感（输入大写 BGE- 也能过滤出小写模型名）', async () => {
    const el = render()
    await fetchList(el)
    const search = el.querySelector('input[type="search"]') as HTMLInputElement
    expect(search, '缺少搜索框').toBeTruthy()
    act(() => setValue(search, 'BGE-'))
    expect(el.textContent).toContain('bge-m3')
    expect(el.textContent).not.toContain('nomic-embed-text')
  })

  it('全选 → 勾选全部可见项；再点取消全选 → 清空（只对可见项生效）', async () => {
    const el = render()
    await fetchList(el)
    const btn = () => [...el.querySelectorAll('button')].find(b => /全选|取消全选/.test(b.textContent ?? ''))!
    const boxes = () => Array.from(el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    expect(boxes().length, '拉取后应有候选清单').toBeGreaterThanOrEqual(4)

    act(() => btn().click())
    expect(boxes().filter(c => c.checked)).toHaveLength(boxes().length)

    act(() => btn().click())
    expect(boxes().filter(c => c.checked)).toHaveLength(0)
  })

  it('搜索后全选：只勾选过滤后的可见项（其他项不受影响）', async () => {
    const el = render()
    await fetchList(el)
    const search = el.querySelector('input[type="search"]') as HTMLInputElement
    act(() => setValue(search, 'bge-'))
    const btn = () => [...el.querySelectorAll('button')].find(b => /全选|取消全选/.test(b.textContent ?? ''))!
    act(() => btn().click())
    const boxes = () => Array.from(el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    expect(boxes().length).toBeGreaterThan(0)
    expect(boxes().every(c => c.checked)).toBe(true) // 可见项全勾
  })
})
