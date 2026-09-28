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
  saveModel: vi.fn<(m: ModelProfile) => Promise<boolean>>(async () => true),
  deleteModel: vi.fn(async () => {}),
  setDefaultModel: vi.fn(async () => {}),
  setDefaultEmbeddingModel: vi.fn(async () => {}),
  listProviderModels: vi.fn<() => Promise<{ success: boolean; models?: { id: string; contextWindow?: number; maxTokens?: number }[]; error?: string }>>(
    async () => ({ success: true, models: [] }),
  ),
}))

vi.mock('../../stores/llm-store', () => ({
  useLLMStore: Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state },
  ),
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

describe('行内编辑（列表常驻 + 单展开 + 切换保护）', () => {
  it('点「编辑」→ 该位展开表单，其余卡仍在 DOM（列表不被替换）', () => {
    state.models = [makeModel('m1', 'GPT-4o'), makeModel('m2', 'Claude')]
    const el = render()
    act(() => { (el.querySelector('button[aria-label="编辑"]') as HTMLButtonElement).click() })
    expect(el.textContent).toContain('编辑：') // ModelForm 标题（t('model.editConfig') = "编辑：{name}"）
    expect(el.textContent).toContain('Claude') // 另一张卡仍在
  })

  it('取消 → 表单收回，列表恢复', () => {
    state.models = [makeModel('m1', 'GPT-4o')]
    const el = render()
    act(() => { (el.querySelector('button[aria-label="编辑"]') as HTMLButtonElement).click() })
    act(() => {
      const cancelBtn = [...el.querySelectorAll('button')].find(b => b.textContent?.includes('取消'))
      cancelBtn!.click()
    })
    expect(el.textContent).not.toContain('编辑：')
  })

  it('未改动直接切换编辑 → 不弹确认；改动后切换 → 弹确认，取消则保持原编辑态', async () => {
    state.models = [makeModel('m1', 'GPT-4o'), makeModel('m2', 'Claude')]
    const el = render()
    const editBtns = () => Array.from(el.querySelectorAll<HTMLButtonElement>('button[aria-label="编辑"]'))

    // ① 未改动直接切换 → 不弹确认（此时编辑按钮只剩 Claude 的一个）
    act(() => { editBtns()[0].click() })
    await act(async () => { editBtns()[0].click() })
    expect(document.body.textContent).not.toContain('放弃未保存的修改')

    // ② 改动显示名称字段 → 切换时弹确认
    const nameInput = [...el.querySelectorAll('input')].find(i => i.value === 'Claude') as HTMLInputElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(nameInput, 'Claude 改')
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      editBtns()[0].click() // 现在只剩 GPT-4o 的编辑按钮
      await new Promise(r => setTimeout(r, 10))
    })
    expect(document.body.textContent).toContain('放弃未保存的修改')

    // ③ 取消 → 仍停在「Claude 改」的原编辑态（未切走）
    //    确认框挂在 body 末尾的独立容器（命令式 confirm），且按钮有退出动画——
    //    必须限定在**最后一个 body 子节点**内找「取消」（页面上 ModelForm 也有一个「取消」），
    //    并等动画延迟结束（exitThen）再断言
    await act(async () => {
      const confirmRoot = document.body.lastElementChild as HTMLElement
      const cancelBtn = [...confirmRoot.querySelectorAll('button')].find(b => b.textContent?.trim() === '取消')
      cancelBtn!.click()
      await new Promise(r => setTimeout(r, 300))
    })
    expect([...el.querySelectorAll('input')].some(i => i.value === 'Claude 改')).toBe(true)
  })

  it('保存失败（saveModel resolve false，真实可达路径）→ 草稿保留，不丢编辑', async () => {
    state.saveModel.mockResolvedValueOnce(false)
    state.models = [makeModel('m1', 'GPT-4o')]
    const el = render()
    act(() => { (el.querySelector('button[aria-label="编辑"]') as HTMLButtonElement).click() })
    await act(async () => {
      const saveBtn = [...el.querySelectorAll('button')].find(b => b.textContent?.includes('保存配置'))
      saveBtn!.click()
      await new Promise(r => setTimeout(r, 10))
    })
    expect(el.textContent).toContain('编辑：') // 表单仍在 = 草稿未丢（2026-09-28 复核 I1 修复）
  })

  it('保存异常（IPC reject）→ 草稿保留', async () => {
    state.saveModel.mockRejectedValueOnce(new Error('disk full'))
    state.models = [makeModel('m1', 'GPT-4o')]
    const el = render()
    act(() => { (el.querySelector('button[aria-label="编辑"]') as HTMLButtonElement).click() })
    await act(async () => {
      const saveBtn = [...el.querySelectorAll('button')].find(b => b.textContent?.includes('保存配置'))
      saveBtn!.click()
      await new Promise(r => setTimeout(r, 10))
    })
    expect(el.textContent).toContain('编辑：')
  })
})

describe('新增草稿卡', () => {
  it('点「添加」→ 列表头部出现编辑表单，且空态被隐藏（不与编辑卡同屏）', () => {
    const el = render() // 空列表
    act(() => {
      const addBtn = [...el.querySelectorAll('button')].find(b => b.textContent?.includes('添加生成模型'))
      addBtn!.click()
    })
    expect(el.textContent).toContain('新建模型配置') // t('model.newConfig')
    expect(el.textContent).not.toContain('暂无生成模型配置') // 空态不与之同屏（Review Focus 2）
  })

  it('取消新增 → 表单消失且不产生卡片', () => {
    state.models = [makeModel('m1', 'GPT-4o')]
    const el = render()
    act(() => {
      const addBtn = [...el.querySelectorAll('button')].find(b => b.textContent?.includes('添加生成模型'))
      addBtn!.click()
    })
    act(() => {
      const cancelBtn = [...el.querySelectorAll('button')].find(b => b.textContent?.includes('取消'))
      cancelBtn!.click()
    })
    expect(el.textContent).not.toContain('新建模型配置')
    expect(el.querySelectorAll('button[aria-label="编辑"]')).toHaveLength(1) // 仍只有原卡
  })

  it('保存新增 → saveModel 收到草稿（填入显示名称 + API Key 以解除保存禁用）', async () => {
    const el = render()
    act(() => {
      const addBtn = [...el.querySelectorAll('button')].find(b => b.textContent?.includes('添加生成模型'))
      addBtn!.click()
    })
    // 保存按钮 disabled 条件：无名称 或（非 ollama 且无 key）→ 两处都要填
    const setValue = (input: HTMLInputElement, v: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, v)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const inputs = [...el.querySelectorAll('input')]
    const nameInput = inputs.find(i => i.placeholder === '如：DeepSeek 主力 / GPT-4o 备用')!
    const keyInput = inputs.find(i => i.placeholder === 'sk-...')!
    act(() => { setValue(nameInput, '我的模型'); setValue(keyInput, 'sk-test') })
    await act(async () => {
      const saveBtn = [...el.querySelectorAll('button')].find(b => b.textContent?.includes('保存配置'))
      saveBtn!.click()
      await new Promise(r => setTimeout(r, 10))
    })
    const lastCall = state.saveModel.mock.calls.at(-1)?.[0]
    expect(lastCall?.name).toBe('我的模型')
  })
})

describe('模型表单「获取模型」面板', () => {
  const openFormForEdit = (el: HTMLElement) => {
    act(() => { (el.querySelector('button[aria-label="编辑"]') as HTMLButtonElement).click() })
    // 展开「自定义设置」——模型标识（含拉取入口）在其中
    act(() => {
      const s = [...el.querySelectorAll('summary')].find(x => x.textContent?.includes('自定义设置'))
      s!.click()
    })
  }
  const clickFetch = async (el: HTMLElement) => {
    await act(async () => {
      const b = [...el.querySelectorAll('button')].find(x => x.textContent?.includes('获取可用模型'))
      b!.click()
      await new Promise(r => setTimeout(r, 10))
    })
  }

  it('点击 → 用当前表单值调 listProviderModels；点选候选 → 切自定义输入并填入模型标识', async () => {
    const lm = vi.fn(async () => ({ success: true, models: [{ id: 'qwen-max' }, { id: 'qwen-plus' }] }))
    state.listProviderModels = lm
    state.models = [makeModel('m1', 'GPT-4o')]
    const el = render()
    openFormForEdit(el)
    await clickFetch(el)
    expect(lm).toHaveBeenCalledWith(expect.objectContaining({ provider: 'openai', apiKey: 'sk-x' }))
    expect(el.textContent).toContain('qwen-max') // 面板候选就位
    act(() => {
      const pick = [...el.querySelectorAll('button')].find(b => b.textContent?.trim() === 'qwen-max')
      pick!.click()
    })
    // 点选 = 切到手动输入模式并填入（否则预设下拉会处于「值不在选项里」的非法态）
    const modelIdInput = [...el.querySelectorAll('input')].find(i => i.value === 'qwen-max')
    expect(modelIdInput).toBeTruthy()
  })

  it('拉取失败 → 面板内错误文案；表单字段不丢（Review Focus 4）', async () => {
    state.listProviderModels = vi.fn(async () => ({ success: false, error: 'ECONNREFUSED' }))
    state.models = [makeModel('m1', 'GPT-4o')]
    const el = render()
    openFormForEdit(el)
    await clickFetch(el)
    expect(el.textContent).toContain('ECONNREFUSED')
    expect((el.querySelector('input[placeholder="sk-..."]') as HTMLInputElement).value).toBe('sk-x')
  })

  it('面板打开时按 Esc → 只关面板；不得冒泡到设置弹窗级监听（Esc 连带关闭回归锁，I2）', async () => {
    state.listProviderModels = vi.fn(async () => ({ success: true, models: [{ id: 'qwen-max' }] }))
    state.models = [makeModel('m1', 'GPT-4o')]
    const el = render()
    openFormForEdit(el)
    await clickFetch(el)
    expect(el.textContent).toContain('qwen-max') // 面板开着

    // 代理断言：bubble 阶段的 window 监听 = 设置弹窗 useEscapeKey 的注册方式；
    // 未被调用即证明事件被面板的 capture 监听阻断（否则一次 Esc 会连设置弹窗一起关）
    let outerListenerCalled = false
    const spy = () => { outerListenerCalled = true }
    window.addEventListener('keydown', spy)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    window.removeEventListener('keydown', spy)

    expect(el.textContent).not.toContain('qwen-max') // 面板已关
    expect(outerListenerCalled).toBe(false)          // 外层监听未收到
  })
})
