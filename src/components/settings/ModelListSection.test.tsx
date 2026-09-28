// @vitest-environment jsdom
/**
 * ModelListSection —— 「模型」一体卡区（v2，薄容器）
 *
 * 容器契约：账户 → 每户一张卡；无归属模型 → 「其他」卡（仅存在时）；全空 → 空态；
 * 「添加供应商」/空态按钮 → 打开两模式建卡表单（ProviderAccountForm）。
 * （卡内行为见 ModelProviderCard.test；Picker 见 ModelPickerDialog.test——v1 的本文件用例已随重构迁移。）
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ModelListSection } from './ModelListSection'
import type { ModelProfile, ProviderAccount } from '../../shared/ipc-channels'

const state = vi.hoisted(() => ({
  models: [] as unknown[],
  providers: [] as unknown[],
  defaultModelId: null as string | null,
  defaultEmbeddingModelId: null as string | null,
  saveModel: vi.fn(async () => true),
  deleteModel: vi.fn(async () => {}),
  saveProvider: vi.fn(async () => true),
  setDefaultModel: vi.fn(async () => {}),
  setDefaultEmbeddingModel: vi.fn(async () => {}),
  deleteProvider: vi.fn(async () => {}),
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
  apiKey: 'sk-x', baseUrl: 'https://gw.example.com', modelNames: ['gen-1'],
}

const makeModel = (id: string, modelName: string): ModelProfile => ({
  id, name: modelName, provider: 'custom', protocol: 'openai',
  modelName, apiKey: 'sk-x', baseUrl: 'https://gw.example.com',
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
  state.models = []
  state.providers = []
})

describe('ModelListSection 一体卡容器', () => {
  it('全空 → 空态（含「添加供应商」入口）', () => {
    const el = render()
    expect(el.textContent).toContain('添加供应商')
    // 空态区块存在（唯一按钮就是空态里的入口）
    expect([...el.querySelectorAll('button')].length).toBeGreaterThanOrEqual(2) // 头部 + 空态
  })

  it('有账户 → 渲染账户卡（名下派生模型在该卡内）', () => {
    state.providers = [ACCOUNT]
    state.models = [makeModel('acct-1::gen-1', 'gen-1')]
    const el = render()
    expect(el.textContent).toContain('gw.example.com') // 卡头地址
    expect(el.textContent).toContain('gen-1')          // 卡内行
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

  it('「添加供应商」→ 打开两模式建卡表单', () => {
    const el = render()
    const addBtn = [...el.querySelectorAll('button')].find(b => b.textContent?.includes('添加供应商'))!
    act(() => { addBtn.click() })
    expect(el.textContent).toContain('从供应商目录')
    expect(el.textContent).toContain('自定义 API')
  })
})
