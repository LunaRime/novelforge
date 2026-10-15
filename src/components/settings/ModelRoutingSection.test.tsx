// @vitest-environment jsdom
/**
 * ModelRoutingSection — 三层路由的层卡形态（§2.3 排版改版）
 *
 * 2026-10 改版前：每层「左标签列 + 芯片列表 + ArrowUp 一格一格挪 + Select 添加」；
 * 改版后：标题独占一行在上、说明收进 `Disclosure`、每层一块**层卡**（层名 + 摘要 + 「编辑优先级」），
 * 顺序调整一律进弹窗（见 `ModelRoutingTierDialog.test.tsx`）。
 *
 * ⚠️ 本文件钉住**三条不许退化的行为契约**（改版只换皮，不换语义）：
 * 1. **顺序即优先级** —— 数组顺序 = ModelRouter 的取用顺序，界面按同序展示；
 * 2. **单层 patch 形状** —— 写库一律 `updateModelRoutes({ elite: [...] })`，不整包覆盖三层；
 * 3. **空层回退默认模型** —— 空层合法，文案说明回退口径。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ModelRoutingSection } from './SettingsModal'

const mockUpdate = vi.hoisted(() => vi.fn())

const state = vi.hoisted(() => ({
  models: [
    { id: 'e1', name: 'Elite One', modelName: 'elite-one', provider: 'openai' },
    { id: 'e2', name: 'Elite Two', modelName: 'elite-two', provider: 'anthropic' },
    { id: 'e3', name: 'Elite Three', modelName: 'elite-three', provider: 'deepseek' },
    { id: 'e4', name: 'Elite Four', modelName: 'elite-four', provider: 'gemini' },
    { id: 's1', name: 'Std One', modelName: 'std-one', provider: 'openai' },
    // embedding 用途：弹窗候选里必须被过滤掉
    { id: 'emb', name: 'Embed One', modelName: 'embed-one', provider: 'openai', purposes: ['embedding'] },
  ],
  modelRoutes: { elite: [] as string[], standard: [] as string[], budget: [] as string[] } as {
    elite: string[]; standard: string[]; budget: string[]; strategy?: 'static' | 'dynamic'
  },
}))

vi.mock('../../stores/llm-store', () => ({
  useLLMStore: (selector: (s: typeof state & { updateModelRoutes: typeof mockUpdate }) => unknown) =>
    selector({ ...state, updateModelRoutes: mockUpdate }),
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(<ModelRoutingSection />) })
  return container
}

/** 层卡（按 data-testid 取） */
const tierCard = (tier: string) =>
  document.body.querySelector<HTMLElement>(`[data-testid="route-tier-${tier}"]`)
/** 「编辑优先级」入口 */
const editBtn = (tier: string) =>
  document.body.querySelector<HTMLButtonElement>(`[data-testid="route-edit-${tier}"]`)!
/** 层卡上的状态行（数量 / 回退口径；卡片不显示型号名） */
const summaryOf = (tier: string) => tierCard(tier)!.querySelector('p')!.textContent ?? ''

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  mockUpdate.mockClear()
  state.modelRoutes = { elite: [], standard: [], budget: [] }
  // locale 是运行时单例（其它测试切过语言会残留）——清掉偏好，t() 回落 zh-CN 默认
  localStorage.removeItem('novelforge-locale')
})

describe('ModelRoutingSection 层卡排版', () => {
  it('标题独占一行在上，动态路由开关同排右侧，说明收进「说明」折叠', () => {
    const el = render()
    const text = el.textContent ?? ''
    // 标题 + 动态路由开关都在（开关是 role=switch）
    expect(text).toContain('模型路由（分层调度）')
    expect(document.body.querySelector('[role="switch"]')).toBeTruthy()
    // 说明收进 details（默认收起 → 正文不在可见文本里，但折叠的「说明」摘要行在）
    const details = el.querySelector('details')
    expect(details).toBeTruthy()
    expect(details!.querySelector('summary')!.textContent).toContain('说明')
    // 标题是块级 h3（独占行），**不与动态路由开关同容器**：开关在标题的兄弟节点里
    const title = el.querySelector('h3')!
    expect(title.textContent).toBe('模型路由（分层调度）')
    expect(title.parentElement!.querySelector('[role="switch"]')).toBeTruthy()
  })

  it('三层各渲染一块层卡（含「编辑优先级」按钮）', () => {
    render()
    for (const tier of ['elite', 'standard', 'budget']) {
      expect(tierCard(tier)).toBeTruthy()
      expect(editBtn(tier).textContent).toContain('编辑优先级')
    }
  })

  it('空层显示回退口径文案（顺序即优先级契约的另一半：空 = 回退默认模型）', () => {
    render()
    expect(summaryOf('elite')).toContain('未指定（回退默认模型）')
  })

  it('非空层显示数量（型号名与顺序不上卡片 —— 2026-10-16 用户要求）', () => {
    state.modelRoutes.elite = ['e1', 'e2']
    render()
    expect(summaryOf('elite')).toContain('2 个模型')
    // ⚠️ 卡片上**不显示模型型号**：选了哪些一律进「编辑优先级」弹窗看
    const body = tierCard('elite')!.textContent ?? ''
    expect(body).not.toContain('Elite One')
    expect(body).not.toContain('Elite Two')
    expect(body).not.toContain('①')
    expect(body).not.toContain('(openai)')
  })
})

describe('ModelRoutingSection 改版后的写库纪律', () => {
  it('点「编辑优先级」只开弹窗，**不写库**', () => {
    state.modelRoutes.elite = ['e1']
    render()
    act(() => editBtn('elite').click())
    expect(document.body.querySelector('[data-testid="route-tier-dialog"]')).toBeTruthy()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('弹窗内保存 → 单层 patch 形状 `{ elite: [...] }`（不整包覆盖三层）', () => {
    state.modelRoutes.elite = ['e1']
    state.modelRoutes.standard = ['s1']
    render()
    act(() => editBtn('elite').click())
    // 取消勾选 e1（= 空层，合法）后保存
    const box = document.body.querySelector<HTMLInputElement>(`[data-testid="route-candidate-e1"] input`)!
    act(() => box.click())
    const save = [...document.body.querySelectorAll('button')].find(b => b.textContent === '保存')!
    act(() => save.click())
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith({ elite: [] })
  })

  it('弹窗候选过滤掉 embedding 用途的模型', () => {
    render()
    act(() => editBtn('elite').click())
    expect(document.body.querySelector('[data-testid="route-candidate-e1"]')).toBeTruthy()
    expect(document.body.querySelector('[data-testid="route-candidate-emb"]')).toBeNull()
  })
})
