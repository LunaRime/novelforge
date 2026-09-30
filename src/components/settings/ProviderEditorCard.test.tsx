// @vitest-environment jsdom
/**
 * ProviderEditorCard —— 行内编辑卡（模型管理 v3 §2.2/§4.5/§4.7，2026-10-01）
 *
 * 契约（brief Step 1 的五条 + 携带项）：
 * - **只写**：密钥框初值恒空；placeholder 三态（env 锁定 / 已配置 / 待输入；ollama 特例）
 * - **应用顺序**：`saveProvider(patch, undefined, revision, keyDraft.trim() || undefined)`，成功后清草稿
 * - **conflict**：卡不关 + toast + 草稿保留（重载后重试不用重敲）
 * - **凭据阶段失败**（配置已写、返回带 revision）：文案「配置已保存，密钥未写入」，同样保留草稿
 * - 拒因码 → 行内红字 + 禁「应用」
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ProviderEditorCard, type ProviderEditorCardProps } from './ProviderEditorCard'
import { toast } from '../ui/Toast'
import type { CredentialInfo, ProviderAccount } from '../../shared/ipc-channels'

const state = vi.hoisted(() => ({
  saveProvider: vi.fn(async () => ({ success: true, revision: 2 }) as {
    success: boolean; error?: string; revision?: number; conflict?: boolean
  }),
  describeCredentials: vi.fn(async () => {}),
  unsetCredential: vi.fn(async () => ({ success: true })),
  deleteProvider: vi.fn(async () => ({ success: true })),
  providers: [] as Array<{ id: string; displayName?: string }>,
  credentialInfo: {} as Record<string, unknown>,
}))

vi.mock('../../stores/llm-store', () => ({
  useLLMStore: Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state },
  ),
}))

const ACCOUNT: ProviderAccount = {
  id: 'acct-1', provider: 'custom', protocol: 'openai',
  apiKeyRef: 'CUSTOM_API_KEY', baseUrl: 'https://gw.example.com', modelNames: ['gen-1'],
}

const CONFIGURED: CredentialInfo = { configured: true, source: 'store', writable: true }
const ENV_SHADOWED: CredentialInfo = { configured: true, source: 'env', writable: false }
const MISSING: CredentialInfo = { configured: false, writable: true }

let container: HTMLDivElement | null = null
let root: Root | null = null
/**
 * toast 打桩：只截文案、不真挂 DOM。
 *
 * 真挂的话，ToastContainer 挂在 body 上的根会被 `afterEach` 的清理摘掉而 React 侧没卸载，
 * 下一条断言再 toast 就落进「已脱离文档的根」——**断言会时真时假**（跨用例的 DOM 残留同理）。
 * 打桩后每条断言只取决于本用例自己的那次调用。
 */
let toastError: ReturnType<typeof vi.spyOn>

function render(overrides: Partial<ProviderEditorCardProps> = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const props: ProviderEditorCardProps = {
    account: ACCOUNT,
    revision: 7,
    keyInfo: CONFIGURED,
    onClose: vi.fn(),
    ...overrides,
  }
  act(() => { root!.render(<ProviderEditorCard {...props} />) })
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
  vi.restoreAllMocks()
  vi.clearAllMocks()
  state.saveProvider.mockImplementation(async () => ({ success: true, revision: 2 }))
})

/** 关联 Label 的输入框（Label[for] → id）——顺带把「标签与控件已关联」钉住 */
function inputByLabel(label: string): HTMLInputElement {
  const lab = [...container!.querySelectorAll('label')].find((l) => l.textContent?.trim() === label)
  expect(lab, `未找到标签「${label}」`).toBeTruthy()
  return container!.querySelector(`#${lab!.htmlFor}`) as HTMLInputElement
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function buttonByText(text: string): HTMLButtonElement {
  const btn = [...container!.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  expect(btn, `未找到按钮「${text}」`).toBeTruthy()
  return btn as HTMLButtonElement
}

const tick = () => new Promise((r) => setTimeout(r, 10))

describe('ProviderEditorCard 行内编辑卡', () => {
  it('只写：卡打开时密钥框为空（掩码），placeholder =「已配置（留空保持不变）」', () => {
    const el = render()
    const input = inputByLabel('API 密钥')
    expect(input.value).toBe('')
    expect(input.type).toBe('password')
    expect(input.placeholder).toBe('已配置（留空保持不变）')
    // 只写语义：卡上没有任何地方回显已存的密钥
    expect(el.textContent).not.toContain('CUSTOM_API_KEY')
  })

  it('env 影子（writable=false）→ 密钥框禁用 + placeholder=「由环境变量 X 提供（只读）」', () => {
    const el = render({ keyInfo: ENV_SHADOWED })
    const input = inputByLabel('API 密钥')
    expect(input.disabled).toBe(true)
    expect(input.placeholder).toBe('由环境变量 CUSTOM_API_KEY 提供（只读）')
    // 来源要显式可见（T5 评审 obs①）：只说「已配置」用户不知道这值从哪来、为什么改不了
    expect(el.textContent + input.placeholder).toContain('CUSTOM_API_KEY')
  })

  it('未配置：普通供应商 →「输入 API 密钥」；ollama →「留空 = 不使用密钥」', () => {
    render({ keyInfo: MISSING })
    expect(inputByLabel('API 密钥').placeholder).toBe('输入 API 密钥')

    act(() => root!.unmount())
    container!.remove()
    render({ keyInfo: MISSING, account: { ...ACCOUNT, provider: 'ollama', apiKeyRef: 'OLLAMA_API_KEY' } })
    expect(inputByLabel('API 密钥').placeholder).toBe('留空 = 不使用密钥')
  })

  it('describe 未完成（keyInfo=undefined）→ 不误报「已配置」：placeholder 回落「输入 API 密钥」', () => {
    render({ keyInfo: undefined })
    const input = inputByLabel('API 密钥')
    expect(input.placeholder).toBe('输入 API 密钥')
    // 状态未知 ≠ 影子：框必须可输入（否则 describe 一失败就再也填不了密钥）
    expect(input.disabled).toBe(false)
  })

  it('拒因码 → 行内红字 +「应用」禁用 + 不提交（saveProvider 未被调用）', async () => {
    const el = render({ keyInfo: MISSING })
    await act(async () => { setValue(inputByLabel('API 密钥'), 'sk-密钥') })
    expect(el.textContent).toContain('密钥含非法字符')
    expect(buttonByText('应用').disabled).toBe(true)
    await act(async () => { buttonByText('应用').click(); await tick() })
    expect(state.saveProvider).not.toHaveBeenCalled()
  })

  it('应用：提交 saveProvider(patch, undefined, revision, 草稿) → 成功后清空草稿 + onClose(true)', async () => {
    const onClose = vi.fn()
    render({ keyInfo: MISSING, revision: 7, onClose })
    await act(async () => { setValue(inputByLabel('API 密钥'), '  sk-abc\t') })
    await act(async () => { buttonByText('应用').click(); await tick() })

    expect(state.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'acct-1', provider: 'custom', baseUrl: 'https://gw.example.com', protocol: 'openai' }),
      undefined,
      7,
      'sk-abc', // 边缘空白是粘贴噪声：提交前 trim
    )
    expect(onClose).toHaveBeenCalledWith(true)
    expect(inputByLabel('API 密钥').value).toBe('')
  })

  it('应用（空草稿）→ apiKeyDraft 缺省 = 不改已存密钥', async () => {
    render()
    await act(async () => { buttonByText('应用').click(); await tick() })
    expect(state.saveProvider).toHaveBeenCalledWith(expect.anything(), undefined, 7, undefined)
  })

  it('自定义设置：显示名/地址随应用一起提交（provider 锁定不变）', async () => {
    render()
    await act(async () => {
      setValue(inputByLabel('显示名称'), '我的中转')
      setValue(inputByLabel('API 地址'), 'https://relay.example.com')
    })
    await act(async () => { buttonByText('应用').click(); await tick() })

    expect(state.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'acct-1',
        provider: 'custom',                       // 身份字段：换家 = 删除重建，卡里改不了
        displayName: '我的中转',
        baseUrl: 'https://relay.example.com',
      }),
      undefined, 7, undefined,
    )
  })

  it('conflict：saveProvider 返回 conflict → 卡不关 + toast + 草稿保留', async () => {
    state.saveProvider.mockImplementationOnce(async () => ({ success: false, conflict: true, error: 'provider/conflict' }))
    const onClose = vi.fn()
    render({ keyInfo: MISSING, onClose })
    await act(async () => { setValue(inputByLabel('API 密钥'), 'sk-abc') })
    await act(async () => { buttonByText('应用').click(); await tick() })

    expect(onClose).not.toHaveBeenCalled()
    expect(inputByLabel('API 密钥').value).toBe('sk-abc')
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('配置已被其他窗口修改，请重载'))
  })

  it('凭据阶段失败（带 revision = 配置已写）→ 文案说清「配置已保存，密钥未写入」+ 草稿保留', async () => {
    state.saveProvider.mockImplementationOnce(async () => ({ success: false, error: 'disk full', revision: 9 }))
    const onClose = vi.fn()
    render({ keyInfo: MISSING, onClose })
    await act(async () => { setValue(inputByLabel('API 密钥'), 'sk-abc') })
    await act(async () => { buttonByText('应用').click(); await tick() })

    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('配置已保存，密钥未写入'))
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('disk full')) // 技术串原样可见（排障）
    expect(onClose).not.toHaveBeenCalled()
    expect(inputByLabel('API 密钥').value).toBe('sk-abc')
  })

  it('普通失败（无 revision）→ 走通用保存失败文案（与「配置已保存」区分）', async () => {
    state.saveProvider.mockImplementationOnce(async () => ({ success: false, error: 'keyIllegalCharacters' }))
    render({ keyInfo: MISSING })
    // 草稿非法时行内红字就拦住了；这里给合法串，让**主进程侧**回的拒因码走到文案映射
    await act(async () => { setValue(inputByLabel('API 密钥'), 'sk-abc') })
    await act(async () => { buttonByText('应用').click(); await tick() })

    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('保存失败'))
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('密钥含非法字符')) // 拒因码已翻译
    expect(toastError).not.toHaveBeenCalledWith(expect.stringContaining('配置已保存'))
  })

  it('取消：onClose(false)（没写过盘 → 容器不重拉、不播报）', async () => {
    const onClose = vi.fn()
    render({ onClose })
    await act(async () => { buttonByText('取消').click() })
    expect(onClose).toHaveBeenCalledWith(false)
    expect(state.saveProvider).not.toHaveBeenCalled()
  })

  it('脏草稿上报：输入密钥 → onDirtyChange(true)；清空 → false（容器据此做切换保护）', async () => {
    const onDirtyChange = vi.fn()
    render({ keyInfo: MISSING, onDirtyChange })
    await act(async () => { setValue(inputByLabel('API 密钥'), 'sk-abc') })
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    await act(async () => { setValue(inputByLabel('API 密钥'), '') })
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })
})
