// @vitest-environment jsdom
/**
 * ModelListSection —— 「模型」段（v3 薄容器，2026-10-01）
 *
 * 容器契约：标题（计数）+ `ProviderRowList`（供应商行，行内编辑卡）+ 「其他」卡（仅存在时）
 * + 全空时的空态；「添加供应商」→ 两模式建卡表单。
 * 行/卡/删除顺序的契约见 `ProviderRowList.test` 与 `ProviderEditorCard.test`。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ModelListSection } from './ModelListSection'
import type { ModelProfile, ProviderAccount } from '../../shared/ipc-channels'

const state = vi.hoisted(() => ({
  models: [] as unknown[],
  providers: [] as unknown[],
  credentialInfo: {} as Record<string, unknown>,
  providersRevision: 0,
  defaultModelId: null as string | null,
  defaultEmbeddingModelId: null as string | null,
  saveModel: vi.fn(async () => ({ success: true })),
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

  it('「添加供应商」→ 打开两模式建卡表单', () => {
    const el = render()
    const addBtn = [...el.querySelectorAll('button')].find(b => b.textContent?.includes('添加供应商'))!
    act(() => { addBtn.click() })
    expect(el.textContent).toContain('从供应商目录')
    expect(el.textContent).toContain('自定义 API')
  })
})
