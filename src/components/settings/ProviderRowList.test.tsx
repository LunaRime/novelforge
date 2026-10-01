// @vitest-environment jsdom
/**
 * ProviderRowList —— 供应商行列表（模型管理 v3 §2.1/§2.2/§4.7，2026-10-01）
 *
 * 契约（brief Step 1 的五条 + 携带项）：
 * - 行 = 名称 +（自定义标签）+ 三态灯 + [编辑][删除]，行片 32px 几何
 * - **单开**：一次只开一张卡；切换行有脏草稿 → 先 confirm
 * - **删除顺序**：credential:unset 失败 → deleteProvider 不被调用；env 影子跳过凭据步骤
 * - 挂载即批量 describe；保存成功播报「已保存 {name}」（aria-live）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ProviderRowList } from './ProviderRowList'
import { toast } from '../ui/Toast'
import type { CredentialInfo, ModelProfile, ProviderAccount } from '../../shared/ipc-channels'

const state = vi.hoisted(() => ({
  providers: [] as ProviderAccount[],
  models: [] as ModelProfile[],
  credentialInfo: {} as Record<string, CredentialInfo>,
  providersRevision: 3,
  defaultModelId: null as string | null,
  defaultEmbeddingModelId: null as string | null,
  modelRoutes: { elite: [] as string[], standard: [] as string[], budget: [] as string[], strategy: 'static' },
  describeCredentials: vi.fn(async () => {}),
  unsetCredential: vi.fn(async () => ({ success: true }) as { success: boolean; error?: string }),
  deleteProvider: vi.fn(async () => ({ success: true }) as { success: boolean; error?: string }),
  saveProvider: vi.fn(async () => ({ success: true, revision: 4 }) as {
    success: boolean; error?: string; revision?: number; conflict?: boolean
  }),
}))

vi.mock('../../stores/llm-store', () => ({
  useLLMStore: Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state },
  ),
}))

const CUSTOM: ProviderAccount = {
  id: 'acct-1', provider: 'custom', protocol: 'openai',
  displayName: 'Acme Gateway',
  apiKeyRef: 'CUSTOM_API_KEY', baseUrl: 'https://gw.example.com', modelNames: ['gen-1'],
}
const OPENAI: ProviderAccount = {
  id: 'acct-2', provider: 'openai', protocol: 'openai',
  apiKeyRef: 'OPENAI_API_KEY', baseUrl: 'https://api.openai.com',
}

const CONFIGURED: CredentialInfo = { configured: true, source: 'store', writable: true }

const makeModel = (id: string, modelName: string): ModelProfile => ({
  id, name: modelName, provider: 'custom', protocol: 'openai',
  modelName, apiKeyRef: 'CUSTOM_API_KEY', baseUrl: 'https://gw.example.com',
  temperature: 0.7, maxTokens: 4096, contextWindow: 4096, purposes: ['generation'],
} as unknown as ModelProfile)

let container: HTMLDivElement | null = null
let root: Root | null = null
/** toast 打桩（只截文案不挂 DOM）：避免跨用例的 DOM 残留把「断言已失败」变成「断言刚好通过」 */
let toastError: ReturnType<typeof vi.spyOn>

function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(<ProviderRowList />) })
  return container
}

beforeEach(() => {
  toastError = vi.spyOn(toast, 'error').mockImplementation(() => {})
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
  state.defaultModelId = null
  vi.restoreAllMocks()
  vi.clearAllMocks()
  state.describeCredentials.mockImplementation(async () => {})
  state.unsetCredential.mockImplementation(async () => ({ success: true }))
  state.deleteProvider.mockImplementation(async () => ({ success: true }))
  state.saveProvider.mockImplementation(async () => ({ success: true, revision: 4 }))
})

const buttonByLabel = (label: string) =>
  [...container!.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`)]

/** 点确认框（命令式 Confirm 挂 body 末尾）的按钮并等退出动画 */
async function confirmDialog(confirmText = '删除') {
  await act(async () => {
    const box = document.body.lastElementChild as HTMLElement
    const okBtn = [...box.querySelectorAll('button')].find((b) => b.textContent?.trim() === confirmText)
    expect(okBtn, `确认框里没有「${confirmText}」按钮`).toBeTruthy()
    okBtn!.click()
    await new Promise((r) => setTimeout(r, 300))
  })
}

/** 确认框（命令式 Confirm 挂 body 末尾）——按按钮文案区分场景（删除用「删除」，切换保护用「放弃」） */
const hasConfirmDialog = (confirmText = '删除') => {
  const box = document.body.lastElementChild as HTMLElement | null
  return !!box && [...box.querySelectorAll('button')].some((b) => b.textContent?.trim() === confirmText)
}

/** 卡里的密钥框（卡内唯一的 password 输入） */
const keyInput = () => container!.querySelector('input[type="password"]') as HTMLInputElement

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const tick = () => new Promise((r) => setTimeout(r, 10))

describe('ProviderRowList 供应商行列表', () => {
  it('行 = 名称 +（自定义标签）+ 三态灯 + [编辑][删除]；describe 未回的行无灯', () => {
    state.providers = [CUSTOM, OPENAI]
    state.credentialInfo = { CUSTOM_API_KEY: CONFIGURED } // OPENAI_API_KEY 还没查到
    const el = render()

    expect(el.textContent).toContain('Acme') // 无预设 → provider id 兜底
    expect(el.textContent).toContain('自定义')
    expect(el.textContent).toContain('OpenAI')

    const dots = [...el.querySelectorAll('[role="img"]')]
    expect(dots).toHaveLength(1)
    expect(dots[0].getAttribute('aria-label')).toBe('密钥已配置')

    expect(buttonByLabel('编辑')).toHaveLength(2)
    expect(buttonByLabel('删除供应商')).toHaveLength(2)
  })

  it('行是行片（menu-chip，32px 几何）+ 操作常驻 32×32 单图标按钮', () => {
    state.providers = [CUSTOM]
    const el = render()
    expect(el.querySelectorAll('.menu-chip')).toHaveLength(1)
    for (const b of [...buttonByLabel('编辑'), ...buttonByLabel('删除供应商')]) {
      expect(b.style.width).toBe('32px')
      expect(b.style.height).toBe('32px')
      expect(b.className).not.toContain('opacity-0') // 常驻，不是 hover-only 隐形按钮
    }
  })

  it('灯 env 态：aria-label 点名环境变量（来源显式可见）', () => {
    state.providers = [OPENAI]
    state.credentialInfo = { OPENAI_API_KEY: { configured: true, source: 'env', writable: false } }
    const el = render()
    expect(el.querySelector('[role="img"]')?.getAttribute('aria-label'))
      .toBe('由环境变量 OPENAI_API_KEY 提供（只读）')
  })

  it('未配置的 ref → 红灯（与「无灯」可区分）', () => {
    state.providers = [OPENAI]
    state.credentialInfo = { OPENAI_API_KEY: { configured: false, writable: true } }
    const el = render()
    expect(el.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('未配置密钥')
  })

  it('挂载即批量 describe（灯的数据源，一次拉全）', () => {
    state.providers = [CUSTOM]
    render()
    expect(state.describeCredentials).toHaveBeenCalled()
  })

  it('单开：点第二行「编辑」→ 只有第二行的卡展开', async () => {
    state.providers = [CUSTOM, OPENAI]
    state.credentialInfo = { CUSTOM_API_KEY: CONFIGURED, OPENAI_API_KEY: CONFIGURED }
    const el = render()

    await act(async () => { buttonByLabel('编辑')[1].click() })
    expect(keyInput()).toBeTruthy()
    expect(el.querySelectorAll('input[type="password"]')).toHaveLength(1)
    // 展开的是**第二行**的卡：卡头上印着该账户的 provider id（行上显示的是显示名 OpenAI，
    // 只有卡头带小写 id —— 用这个把「开的是哪张卡」钉住）
    expect(el.querySelector('section')?.textContent).toContain('openai')
    // 第一行仍在（收起态），没有第二张卡
    expect(buttonByLabel('编辑')).toHaveLength(2)
  })

  it('切换行有脏草稿 → 先 confirm；取消则不切换、草稿还在', async () => {
    state.providers = [CUSTOM, OPENAI]
    state.credentialInfo = { CUSTOM_API_KEY: CONFIGURED, OPENAI_API_KEY: CONFIGURED }
    render()

    await act(async () => { buttonByLabel('编辑')[0].click() })
    await act(async () => { setValue(keyInput(), 'sk-draft') })

    // 切到第二行：有脏草稿 → 弹确认；点「取消」→ 不切换
    await act(async () => { buttonByLabel('编辑')[1].click(); await tick() })
    expect(hasConfirmDialog('放弃')).toBe(true)
    await confirmDialog('取消')
    expect(keyInput().value).toBe('sk-draft') // 第一行的卡还在、草稿没丢

    // 再来一次，这次确认放弃 → 切到第二行（新卡草稿为空）
    await act(async () => { buttonByLabel('编辑')[1].click(); await tick() })
    await confirmDialog('放弃')
    expect(keyInput().value).toBe('')
  })

  it('删除：credential:unset 失败 → deleteProvider 未被调用（配置与行都保留，可重试）', async () => {
    state.providers = [CUSTOM]
    state.credentialInfo = { CUSTOM_API_KEY: CONFIGURED }
    state.unsetCredential.mockImplementationOnce(async () => ({ success: false, error: 'disk full' }))
    render()

    await act(async () => { buttonByLabel('删除供应商')[0].click(); await tick() })
    await confirmDialog()

    expect(state.unsetCredential).toHaveBeenCalledWith('CUSTOM_API_KEY')
    expect(state.deleteProvider).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('删除已存密钥失败'))
  })

  it('删除顺序：先 unset 凭据、后 deleteProvider（反了会留孤儿密钥）', async () => {
    state.providers = [CUSTOM]
    state.credentialInfo = { CUSTOM_API_KEY: CONFIGURED }
    render()

    await act(async () => { buttonByLabel('删除供应商')[0].click(); await tick() })
    await confirmDialog()

    expect(state.unsetCredential).toHaveBeenCalledWith('CUSTOM_API_KEY')
    expect(state.deleteProvider).toHaveBeenCalledWith('acct-1')
    const unsetOrder = state.unsetCredential.mock.invocationCallOrder[0]
    const deleteOrder = state.deleteProvider.mock.invocationCallOrder[0]
    expect(unsetOrder).toBeLessThan(deleteOrder)
  })

  it('env 影子（writable=false）→ 跳过凭据步骤，直接删配置（值由环境提供、不归本页管）', async () => {
    state.providers = [OPENAI]
    state.credentialInfo = { OPENAI_API_KEY: { configured: true, source: 'env', writable: false } }
    render()

    await act(async () => { buttonByLabel('删除供应商')[0].click(); await tick() })
    await confirmDialog()

    expect(state.unsetCredential).not.toHaveBeenCalled()
    expect(state.deleteProvider).toHaveBeenCalledWith('acct-2')
  })

  it('删除前先 describe 一次该 ref（spec §4.7 的第一步，不靠陈旧灯色）', async () => {
    state.providers = [CUSTOM]
    state.credentialInfo = { CUSTOM_API_KEY: CONFIGURED }
    render()
    state.describeCredentials.mockClear()

    await act(async () => { buttonByLabel('删除供应商')[0].click(); await tick() })
    await confirmDialog()
    expect(state.describeCredentials).toHaveBeenCalledWith(['CUSTOM_API_KEY'])
  })

  it('删除失败 → toast 说明原因（不能「点了没反应」）', async () => {
    state.providers = [CUSTOM]
    state.credentialInfo = { CUSTOM_API_KEY: CONFIGURED }
    state.deleteProvider.mockImplementationOnce(async () => ({ success: false, error: 'provider not found' }))
    render()

    await act(async () => { buttonByLabel('删除供应商')[0].click(); await tick() })
    await confirmDialog()
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('删除供应商失败'))
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('provider not found'))
  })

  it('引用检查前置：派生条目仍是默认模型 → 连确认框都不出现', async () => {
    state.providers = [CUSTOM]
    state.models = [makeModel('acct-1::gen-1', 'gen-1')]
    state.defaultModelId = 'acct-1::gen-1'
    render()

    await act(async () => { buttonByLabel('删除供应商')[0].click(); await tick() })
    expect(hasConfirmDialog()).toBe(false)
    expect(state.deleteProvider).not.toHaveBeenCalled()
    expect(state.unsetCredential).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('以下位置正在使用这些模型'))
  })

  it('应用成功 → aria-live 播报「已保存 {name}」，名字取重载后的那一行', async () => {
    state.providers = [CUSTOM]
    state.credentialInfo = { CUSTOM_API_KEY: CONFIGURED }
    // 主进程保存后重载：该行改名 → 播报要用新名字（spec §2.7「从刷新后的行取最新名称」）
    state.saveProvider.mockImplementationOnce(async () => {
      state.providers = [{ ...CUSTOM, displayName: '我的中转' }]
      return { success: true, revision: 4 }
    })
    const el = render()

    await act(async () => { buttonByLabel('编辑')[0].click() })
    await act(async () => { setValue(keyInput(), 'sk-abc') })
    await act(async () => {
      const apply = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === '应用')!
      apply.click()
      await tick()
    })

    const live = el.querySelector('[role="status"][aria-live="polite"]')
    expect(live?.textContent).toContain('已保存 我的中转')
    expect(keyInput()).toBeNull() // 成功后关卡
  })

  it('连续保存：重新开卡即清空上一条播报（同一个名字再存一次也会发声）', async () => {
    state.providers = [CUSTOM]
    state.credentialInfo = { CUSTOM_API_KEY: CONFIGURED }
    const el = render()
    const live = () => el.querySelector('[role="status"][aria-live="polite"]')?.textContent

    await act(async () => { buttonByLabel('编辑')[0].click() })
    await act(async () => {
      const apply = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === '应用')!
      apply.click()
      await tick()
    })
    expect(live()).toContain('已保存')
    expect(keyInput()).toBeNull() // 成功后关卡

    // 再开一次（同名账户）→ 播报先清空，保存后再出现 —— aria-live 只在内容变化时发声
    await act(async () => { buttonByLabel('编辑')[0].click() })
    expect(live()).toBe('')

    await act(async () => {
      const apply = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === '应用')!
      apply.click()
      await tick()
    })
    expect(live()).toContain('已保存')
  })

  it('取消（没写过盘）→ 关卡且不播报', async () => {
    state.providers = [CUSTOM]
    state.credentialInfo = { CUSTOM_API_KEY: CONFIGURED }
    const el = render()
    await act(async () => { buttonByLabel('编辑')[0].click() })
    await act(async () => {
      const cancel = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === '取消')!
      cancel.click()
      await tick()
    })
    expect(keyInput()).toBeNull()
    expect(el.querySelector('[role="status"]')?.textContent).toBe('')
  })

  it('底部「添加模型提供商」→ 打开添加卡（两模式分段）', async () => {
    const el = render()
    const add = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('添加模型'))!
    await act(async () => { add.click() })
    expect(el.textContent).toContain('添加模型提供商')
    expect(el.textContent).toContain('第三方模型提供商')
    expect(el.textContent).toContain('自定义模型 API')
  })

  it('打开添加卡不卸载行列表：编辑卡里未保存的草稿仍在（第三条草稿丢失路径已封）', async () => {
    state.providers = [CUSTOM]
    state.credentialInfo = { CUSTOM_API_KEY: CONFIGURED }
    const el = render()

    await act(async () => { buttonByLabel('编辑')[0].click() })
    await act(async () => { setValue(keyInput(), 'sk-draft') })

    const add = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('添加模型'))!
    await act(async () => { add.click() })

    // 行列表没被卸载（此前 `if (adding) return <表单/>` 会把整棵行列表换掉，草稿随之蒸发）
    const drafts = [...el.querySelectorAll<HTMLInputElement>('input[type="password"]')].map((i) => i.value)
    expect(drafts).toContain('sk-draft')
  })
})
