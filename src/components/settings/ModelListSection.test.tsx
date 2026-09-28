// @vitest-environment jsdom
/**
 * ModelListSection — 模型列表 + 编辑（拆分基座 + 后续任务契约）
 * store mock 模板参照 ModelRoutingSection.test.tsx（selector 直调）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ModelListSection } from './ModelListSection'
import type { ModelProfile } from '../../shared/ipc-channels'

const state = vi.hoisted(() => ({
  models: [] as ModelProfile[],
  defaultModelId: null as string | null,
  defaultEmbeddingModelId: null as string | null,
  loaded: true,
  loadModels: vi.fn(),
  saveModel: vi.fn(async () => {}),
  deleteModel: vi.fn(async () => {}),
  setDefaultModel: vi.fn(async () => {}),
  setDefaultEmbeddingModel: vi.fn(async () => {}),
}))

vi.mock('../../stores/llm-store', () => ({
  useLLMStore: (selector: (s: typeof state) => unknown) => selector(state),
}))

const makeModel = (id: string, name: string): ModelProfile => ({
  id, name, provider: 'openai', protocol: 'openai',
  modelName: `${id}-model`, apiKey: 'sk-x', baseUrl: 'https://api.openai.com',
  temperature: 0.7, maxTokens: 4096, contextWindow: 4096, purposes: ['generation'],
})

let container: HTMLDivElement | null = null
let root: Root | null = null

function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(<ModelListSection purposes={['generation']} purposeLabel="生成模型" />)
  })
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  state.models = []
})

describe('ModelListSection 基座', () => {
  it('渲染已配置卡片（名称 + provider 信息）与添加按钮', () => {
    state.models = [makeModel('m1', 'GPT-4o'), makeModel('m2', 'Claude')]
    const el = render()
    expect(el.textContent).toContain('GPT-4o')
    expect(el.textContent).toContain('Claude')
    expect(el.textContent).toContain('生成模型') // 添加按钮/计数文案含 label
  })

  it('空列表 → 空态（虚线框）与"添加第一个"按钮', () => {
    const el = render()
    expect(el.textContent).toContain('暂无生成模型配置') // t('model.noLabelConfig') 的 zh-CN 实际文案
    expect(el.textContent).toContain('添加第一个生成模型')
  })
})
