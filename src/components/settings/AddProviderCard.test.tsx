// @vitest-environment jsdom
/**
 * AddProviderCard —— 底部「添加模型提供商」卡（模型管理 v3 §2.3/§2.4，2026-10-01）
 *
 * 契约（brief Step 1 三条 + T9 Resolution 8 的补面）：
 * 1. **两模式**：分段（第三方模型提供商 / 自定义模型 API）+ 说明行。目录模式 = provider 下拉 +
 *    行内编辑卡（hideTitle，**无显示名** —— `displayName` 仅自定义账户可编）；自定义模式 = 路由字段
 *    （显示名/端点/协议/密钥/目录区）。
 * 2. **面板首访后保持挂载**：未访问过的模式不挂载；访问过后切走只是 `hidden` —— 切模式不丢对侧草稿。
 * 3. **写入 / 探测中锁定切换**：保存中或「获取可用模型」进行中，分段控件禁用。
 * 4. **首次运行**：无账户 → 空态保留；点开默认选中第一家**有内置目录**的预设 + 密钥框聚焦。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { AddProviderCard } from './AddProviderCard'
import { ProviderRowList } from './ProviderRowList'
import type { CredentialInfo, ModelProfile, ProviderAccount } from '../../shared/ipc-channels'

const state = vi.hoisted(() => ({
  providers: [] as ProviderAccount[],
  models: [] as ModelProfile[],
  credentialInfo: {} as Record<string, CredentialInfo>,
  providersRevision: 1,
  defaultModelId: null as string | null,
  defaultEmbeddingModelId: null as string | null,
  modelRoutes: { elite: [] as string[], standard: [] as string[], budget: [] as string[], strategy: 'static' },
  describeCredentials: vi.fn(async () => {}),
  unsetCredential: vi.fn(async () => ({ success: true })),
  deleteProvider: vi.fn(async () => ({ success: true })),
  // 实参表要齐：用例要读 `mock.calls[0][0]`（= 提交的账户草稿）
  saveProvider: vi.fn<(...args: [
    account: ProviderAccount, modelSpecs?: unknown, revision?: number, apiKeyDraft?: string, overrides?: unknown,
  ]) => Promise<{ success: boolean; revision?: number; error?: string; conflict?: boolean }>>(
    async () => ({ success: true, revision: 2 }),
  ),
  listProviderModels: vi.fn(async () => ({ success: true, models: [] })),
}))

vi.mock('../../stores/llm-store', () => ({
  useLLMStore: Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state },
  ),
}))

/** 分段两个模式的名字（= 面板的 aria-label，也是切换按钮的文案） */
const MODE_CATALOG = '第三方模型提供商'
const MODE_CUSTOM = '自定义模型 API'

let container: HTMLDivElement | null = null
let root: Root | null = null

function mount(node: React.ReactElement) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(node) })
  return container
}

/** 直接挂添加卡（父级把「关闭」交给 spy） */
function renderAdd() {
  const onCancel = vi.fn()
  const onDone = vi.fn()
  mount(<AddProviderCard onCancel={onCancel} onDone={onDone} />)
  return { el: container!, onCancel, onDone }
}

/** 走行列表（首次运行的入口在空态/底部按钮上） */
const renderRows = () => mount(<ProviderRowList />)

const panel = (label: string) =>
  container!.querySelector<HTMLElement>(`[role="group"][aria-label="${label}"]`)

function segButton(label: string): HTMLButtonElement {
  const btn = [...container!.querySelectorAll<HTMLButtonElement>('button')]
    .find((b) => b.textContent?.trim() === label)
  expect(btn, `未找到分段按钮「${label}」`).toBeTruthy()
  return btn!
}

const switchMode = (label: string) => act(async () => { segButton(label).click() })

/** 面板内按文案取按钮（两个模式各有一份「取消/应用」，必须限定范围） */
function buttonIn(scope: HTMLElement, text: string): HTMLButtonElement {
  const btn = [...scope.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)
  expect(btn, `面板里未找到按钮「${text}」`).toBeTruthy()
  return btn!
}

const keyInputIn = (scope: HTMLElement) => scope.querySelector<HTMLInputElement>('input[type="password"]')

const hasLabel = (scope: HTMLElement, text: string) =>
  [...scope.querySelectorAll('label')].some((l) => l.textContent?.trim() === text)

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const tick = () => new Promise((r) => setTimeout(r, 10))

beforeEach(() => {
  // jsdom 没实现 scrollIntoView，而 Radix Select 打开时要把选中项滚进视野——
  // 不补的话下拉根本打不开（`candidate?.scrollIntoView is not a function`）
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  state.providers = []
  state.models = []
  state.credentialInfo = {}
  state.providersRevision = 1
  vi.restoreAllMocks()
  vi.clearAllMocks()
  state.saveProvider.mockImplementation(async () => ({ success: true, revision: 2 }))
  state.listProviderModels.mockImplementation(async () => ({ success: true, models: [] }))
})

describe('AddProviderCard 两模式', () => {
  it('目录模式 = provider 下拉 + 编辑卡（无「显示名」）；自定义模式 = 路由字段（有「显示名」）', async () => {
    renderAdd()

    const catalog = panel(MODE_CATALOG)!
    expect(catalog.hidden).toBe(false)
    expect(catalog.querySelector('[role="combobox"]'), '目录模式缺 provider 下拉').toBeTruthy()
    expect(hasLabel(catalog, '服务商')).toBe(true)
    expect(hasLabel(catalog, '显示名称'), 'displayName 仅自定义账户可编').toBe(false)
    expect(keyInputIn(catalog), '目录模式缺密钥框').toBeTruthy()

    await switchMode(MODE_CUSTOM)
    const custom = panel(MODE_CUSTOM)!
    expect(custom.hidden).toBe(false)
    expect(catalog.hidden).toBe(true)
    expect(hasLabel(custom, '显示名称')).toBe(true)   // 自定义账户可编显示名
    expect(hasLabel(custom, '服务商')).toBe(false)     // 自定义模式不选家
    expect(hasLabel(custom, 'API 地址')).toBe(true)    // 路由字段直接可见（不是折叠的次要项）
    expect(hasLabel(custom, '调用协议')).toBe(true)
  })

  it('目录模式下拉 = 全部非 custom 预设（含没有内置目录的家，如 xAI）；custom 不进下拉', async () => {
    renderAdd()
    const trigger = panel(MODE_CATALOG)!.querySelector<HTMLElement>('[role="combobox"]')!
    trigger.focus()
    await act(async () => {
      // ARIA combobox 的展开键（Radix：OPEN_KEYS）——jsdom 里比 pointerdown 可靠
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      await tick()
    })

    // 候选面板走 Portal 挂在 body 上（不在本用例的 container 里）
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')].map((o) => o.textContent?.trim())
    expect(options.length, '下拉没打开或没有选项').toBeGreaterThan(0)
    expect(options, '有内置目录的家').toContain('OpenAI')
    // 手写 models/embeddingModels 为空、也不在生成表里的家（评审 I1 抓到的 7 家里取一例）：
    // 它靠端点探测服务，绝不能从添加流程里消失
    expect(options, '无内置目录的家也要在下拉里').toContain('xAI（Grok）')
    expect(options, 'custom 由「自定义 API」模式承担').not.toContain('自定义')
  })

  it('面板首访后保持挂载：没访问过的模式不在 DOM 里，访问过的一直在', async () => {
    renderAdd()
    expect(panel(MODE_CUSTOM), '未访问过的模式不该挂载').toBeNull()

    await switchMode(MODE_CUSTOM)
    expect(panel(MODE_CUSTOM)).not.toBeNull()

    await switchMode(MODE_CATALOG)
    expect(panel(MODE_CUSTOM), '切走也要留在 DOM 里（草稿活着）').not.toBeNull()
    expect(panel(MODE_CUSTOM)!.hidden).toBe(true)
  })

  it('切换两模式不丢对侧草稿（面板保持挂载）', async () => {
    renderAdd()
    const catalog = panel(MODE_CATALOG)!
    await act(async () => { setValue(keyInputIn(catalog)!, 'sk-catalog') })

    await switchMode(MODE_CUSTOM)
    const custom = panel(MODE_CUSTOM)!
    await act(async () => { setValue(keyInputIn(custom)!, 'sk-custom') })

    await switchMode(MODE_CATALOG)
    expect(keyInputIn(panel(MODE_CATALOG)!)!.value).toBe('sk-catalog')

    await switchMode(MODE_CUSTOM)
    expect(keyInputIn(panel(MODE_CUSTOM)!)!.value).toBe('sk-custom')
  })
})

describe('AddProviderCard 模式切换锁定', () => {
  it('探测进行中（busy）时分段切换禁用', async () => {
    renderAdd()
    expect(segButton(MODE_CUSTOM).disabled).toBe(false)

    await act(async () => {
      buttonIn(panel(MODE_CATALOG)!, '获取可用模型').click()
      await tick()
    })

    expect(segButton(MODE_CATALOG).disabled).toBe(true)
    expect(segButton(MODE_CUSTOM).disabled).toBe(true)
  })

  it('写入进行中（saving）时分段切换禁用；写完后解锁', async () => {
    let release: (() => void) | null = null
    state.saveProvider.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = () => resolve({ success: true, revision: 2 })
      }),
    )
    renderAdd()

    await act(async () => {
      buttonIn(panel(MODE_CATALOG)!, '应用').click()
      await tick()
    })
    expect(segButton(MODE_CUSTOM).disabled).toBe(true)

    await act(async () => { release!(); await tick() })
    expect(segButton(MODE_CUSTOM).disabled).toBe(false)
  })
})

describe('AddProviderCard 首次运行', () => {
  it('无账户 → 空态保留；点开后默认选中第一家（有内置目录）的预设 + 密钥框聚焦', async () => {
    const el = renderRows()
    expect(el.textContent, '空态应保留').toContain('暂无')

    const addBtn = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('添加供应商'))!
    await act(async () => { addBtn.click() })

    const key = keyInputIn(panel(MODE_CATALOG)!)!
    expect(key, '密钥框应自动聚焦').toBe(document.activeElement)

    // 「默认选中第一家」用**保存载荷**钉住（Radix Select 的显示值在 jsdom 里不可靠）：
    // BUILTIN_PRESETS 里第一家**有内置目录**的家是 openai
    await act(async () => { setValue(key, 'sk-abc') })
    await act(async () => {
      buttonIn(panel(MODE_CATALOG)!, '应用').click()
      await tick()
    })
    expect(state.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai', protocol: 'openai', baseUrl: 'https://api.openai.com' }),
      undefined,
      1,          // 打开时的 providersRevision
      'sk-abc',
      undefined,  // 目录没动过 → 不带 overrides
    )
  })

  it('保存成功 → onDone(新账户 id)（关卡）；取消 → onCancel（不写盘）', async () => {
    const { onCancel, onDone } = renderAdd()
    await act(async () => {
      buttonIn(panel(MODE_CATALOG)!, '应用').click()
      await tick()
    })
    expect(onDone).toHaveBeenCalledTimes(1)
    // 容器要靠这个 id 从**重载后**的行里取名字播报（spec §2.7）
    expect(onDone.mock.calls[0][0]).toBe(state.saveProvider.mock.calls[0][0].id)
    expect(onCancel).not.toHaveBeenCalled()

    act(() => root!.unmount())
    container?.remove()
    const second = renderAdd()
    await act(async () => {
      buttonIn(panel(MODE_CATALOG)!, '取消').click()
    })
    expect(second.onCancel).toHaveBeenCalled()
  })

  it('添加成功后行列表播报「已保存 {name}」（名字取重载后的那一行）', async () => {
    state.saveProvider.mockImplementationOnce(async (account) => {
      state.providers = [account] // 主进程写盘后 store 重载：新账户进了列表
      return { success: true, revision: 2 }
    })
    const el = renderRows()

    const addBtn = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('添加供应商'))!
    await act(async () => { addBtn.click() })
    await act(async () => {
      buttonIn(panel(MODE_CATALOG)!, '应用').click()
      await tick()
    })

    expect(el.querySelector('[role="status"][aria-live="polite"]')?.textContent).toContain('已保存 OpenAI')
    expect(panel(MODE_CATALOG), '保存成功即收起添加卡').toBeNull()
  })

  it('连续添加两个**同名**供应商（两家 OpenAI）→ 两次都发声（开卡即清上一条播报）', async () => {
    state.saveProvider.mockImplementation(async (account) => {
      state.providers = [...state.providers, account]
      return { success: true, revision: 2 }
    })
    const el = renderRows()
    const addBtn = () => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('添加供应商'))!
    const live = () => el.querySelector('[role="status"][aria-live="polite"]')?.textContent

    const addOne = async () => {
      await act(async () => { addBtn().click() })
      await act(async () => {
        buttonIn(panel(MODE_CATALOG)!, '应用').click()
        await tick()
      })
    }

    await addOne()
    expect(live()).toContain('已保存 OpenAI')
    // 第二次开卡：播报先清空 —— aria-live 只在内容变化时发声，而两家的显示名一模一样
    await act(async () => { addBtn().click() })
    expect(live()).toBe('')
    await act(async () => {
      buttonIn(panel(MODE_CATALOG)!, '应用').click()
      await tick()
    })
    expect(live()).toContain('已保存 OpenAI')
  })
})
