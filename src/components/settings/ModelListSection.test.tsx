// @vitest-environment jsdom
/**
 * ModelListSection —— 「模型」段（v3 薄容器，2026-10-01）
 *
 * 容器契约：标题（计数）+ `ProviderRowList`（供应商行 + 行内编辑卡 + 添加卡 + 空态）
 * + 「其他」卡（仅存在时）。
 * 行/卡/删除顺序的契约见 `ProviderRowList.test`、`ProviderEditorCard.test` 与 `AddProviderCard.test`；
 * 「其他」卡自身（只写/草稿/保存路径）在本文件下半部分。
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ModelListSection } from './ModelListSection'
import { toast } from '../ui/Toast'
import type { ModelProfile, ProviderAccount } from '../../shared/ipc-channels'

const state = vi.hoisted(() => ({
  models: [] as unknown[],
  providers: [] as unknown[],
  credentialInfo: {} as Record<string, unknown>,
  providersRevision: 0,
  defaultModelId: null as string | null,
  defaultEmbeddingModelId: null as string | null,
  // 实参表要齐：用例要读 `mock.calls[0][1]`（= 一次性 apiKeyDraft）
  saveModel: vi.fn<(...args: [model: unknown, apiKeyDraft?: string]) => Promise<{ success: boolean }>>(
    async () => ({ success: true }),
  ),
  deleteModel: vi.fn(async () => true),
  saveProvider: vi.fn(async () => ({ success: true })),
  setDefaultModel: vi.fn(async () => {}),
  setDefaultEmbeddingModel: vi.fn(async () => {}),
  describeCredentials: vi.fn(async () => {}),
  unsetCredential: vi.fn(async () => ({ success: true })),
  deleteProvider: vi.fn(async () => ({ success: true })),
  listProviderModels: vi.fn(async () => ({ success: true, models: [] })),
}))

vi.mock('../../stores/llm-store', () => ({
  useLLMStore: Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state },
  ),
}))

const ACCOUNT: ProviderAccount = {
  id: 'acct-1', provider: 'custom', protocol: 'openai',
  displayName: 'Acme Gateway',
  apiKeyRef: 'CUSTOM_API_KEY', baseUrl: 'https://gw.example.com', modelNames: ['gen-1'],
}

const makeModel = (id: string, modelName: string): ModelProfile => ({
  id, name: modelName, provider: 'custom', protocol: 'openai',
  modelName, apiKeyRef: 'CUSTOM_API_KEY', baseUrl: 'https://gw.example.com',
  temperature: 0.7, maxTokens: 4096, contextWindow: 4096, purposes: ['generation'],
} as unknown as ModelProfile)

let container: HTMLDivElement | null = null
let root: Root | null = null

function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(<ModelListSection />) })
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  state.models = []
  state.providers = []
  state.credentialInfo = {}
  vi.restoreAllMocks()
})

describe('ModelListSection 薄容器', () => {
  it('全空 → 空态（含「添加供应商」入口）', () => {
    const el = render()
    expect(el.textContent).toContain('暂无')
    expect(el.textContent).toContain('添加供应商')
    expect([...el.querySelectorAll('button')]).toHaveLength(1) // 空态里的那一个
  })

  it('有账户 → 行列表（行上是供应商，不再常驻模型条目）', () => {
    state.providers = [ACCOUNT]
    state.models = [makeModel('acct-1::gen-1', 'gen-1')]
    state.credentialInfo = { CUSTOM_API_KEY: { configured: true, source: 'store', writable: true } }
    const el = render()

    expect(el.textContent).toContain('Acme Gateway')          // 行 = 供应商
    expect(el.textContent).toContain('自定义')                 // provider=custom 的标签
    expect(el.textContent).not.toContain('gw.example.com')    // 地址移到编辑卡的自定义设置里
    expect([...el.querySelectorAll('button[aria-label="编辑"]')]).toHaveLength(1)
    expect([...el.querySelectorAll('button[aria-label="删除供应商"]')]).toHaveLength(1)
  })

  it('无归属模型 → 「其他」卡仅在其存在时出现', () => {
    const el = render()
    expect(el.textContent).not.toContain('其他（无归属）')

    act(() => { root!.unmount() })
    container?.remove()
    state.models = [makeModel('legacy-1', 'legacy-model')]
    const el2 = render()
    expect(el2.textContent).toContain('其他（无归属）')
    expect(el2.textContent).toContain('legacy-model')
  })

  it('「其他」卡的模型不进供应商行（无归属 = 无账户归属）', () => {
    state.providers = [ACCOUNT]
    state.models = [makeModel('legacy-1', 'legacy-model')]
    const el = render()
    expect(el.textContent).toContain('其他（无归属）')
    expect(el.textContent).toContain('legacy-model')
    expect(el.textContent).toContain('Acme Gateway')
  })

  it('「添加供应商」→ 打开两模式添加卡', () => {
    const el = render()
    const addBtn = [...el.querySelectorAll('button')].find(b => b.textContent?.includes('添加供应商'))!
    act(() => { addBtn.click() })
    expect(el.textContent).toContain('第三方模型提供商')
    expect(el.textContent).toContain('自定义模型 API')
  })
})

/**
 * 「其他」卡（无归属手工条目）—— T9 收尾：组件独立成文件、编辑改用「其他」卡专用的 ModelForm
 * （凭据**只写**：框里恒空，值走一次性 `apiKeyDraft`；placeholder 与行内编辑卡同口径）。
 */
describe('「其他」卡（无归属手工条目）', () => {
  const editBtn = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLButtonElement>('button[aria-label="编辑"]')][0]

  async function openEditor(el: HTMLElement) {
    await act(async () => { editBtn(el).click() })
    return el.querySelector<HTMLInputElement>('input[type="password"]')!
  }

  const type = (input: HTMLInputElement, value: string) => act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

  const clickSave = (el: HTMLElement) => act(async () => {
    const save = [...el.querySelectorAll('button')].find(b => b.textContent?.trim() === '保存配置')!
    save.click()
    await new Promise((r) => setTimeout(r, 10))
  })

  // toast 打桩：失败路径会真弹 sonner 的 DOM，跨用例残留会让「断言失败」变成「断言刚好通过」
  beforeEach(() => { vi.spyOn(toast, 'error').mockImplementation(() => {}) })

  it('只写：编辑卡打开时密钥框为空 + placeholder 走 describe 三态（已配置）', async () => {
    state.models = [makeModel('legacy-1', 'legacy-model')]
    state.credentialInfo = { CUSTOM_API_KEY: { configured: true, source: 'store', writable: true } }
    const el = render()

    const key = await openEditor(el)
    expect(key.value, '已存的密钥读不回来（只写语义）').toBe('')
    expect(key.placeholder).toBe('已配置（留空保持不变）')
    expect(key.disabled).toBe(false)
  })

  it('env 影子（writable=false）→ 密钥框禁用 + placeholder 点名环境变量（与编辑卡同口径）', async () => {
    state.models = [makeModel('legacy-1', 'legacy-model')]
    state.credentialInfo = { CUSTOM_API_KEY: { configured: true, source: 'env', writable: false } }
    const el = render()

    const key = await openEditor(el)
    expect(key.disabled).toBe(true)
    expect(key.placeholder).toBe('由环境变量 CUSTOM_API_KEY 提供（只读）')
  })

  it('保存路径：草稿作一次性 apiKeyDraft 提交（不进落盘对象），成功后关卡', async () => {
    state.models = [makeModel('legacy-1', 'legacy-model')]
    const el = render()
    const key = await openEditor(el)

    await type(key, 'sk-abc')
    await clickSave(el)

    expect(state.saveModel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'legacy-1' }),
      'sk-abc',
    )
    // 只写语义的第二半：草稿**不进落盘对象**（落盘类型里本就没有 apiKey 字段）
    expect(state.saveModel.mock.calls[0][0]).not.toHaveProperty('apiKey')
    expect(el.querySelector('input[type="password"]'), '成功后关卡').toBeNull()
  })

  it('保存失败 → 保留草稿（卡不关、刚敲的键还在，重试不必重打）', async () => {
    state.models = [makeModel('legacy-1', 'legacy-model')]
    state.saveModel.mockImplementationOnce(async () => ({ success: false, error: 'disk full' }))
    const el = render()
    const key = await openEditor(el)

    await type(key, 'sk-draft')
    await clickSave(el)

    expect(el.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe('sk-draft')
  })
})
