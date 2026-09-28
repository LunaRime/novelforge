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

describe('ModelCard 操作按钮（常驻 32×32 + aria-label）', () => {
  it('设默认/编辑/删除三按钮常驻（无 hover 显形门控）、热区 32×32、带 aria-label', () => {
    state.models = [makeModel('m1', 'GPT-4o')]
    const el = render()
    const ops = Array.from(el.querySelectorAll<HTMLButtonElement>('button[aria-label]'))
      .filter(b => ['设为默认', '编辑', '删除'].includes(b.getAttribute('aria-label') ?? ''))
    expect(ops).toHaveLength(3)
    for (const b of ops) {
      expect(b.className, '不得再用 hover 显形门控').not.toContain('opacity-0')
      expect(b.style.width).toBe('32px')
      expect(b.style.height).toBe('32px')
    }
  })
})
