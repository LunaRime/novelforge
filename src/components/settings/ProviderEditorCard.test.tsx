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
import { builtinCatalogFor } from '../../shared/provider-presets'
import { toast } from '../ui/Toast'
import type { CredentialInfo, ProviderAccount } from '../../shared/ipc-channels'

/** saveProvider 的签名（测试要读 `mock.calls[0][4]` = 目录 overrides 那一格，故实参元组要齐） */
type SaveProviderArgs = [
  account: ProviderAccount,
  modelSpecs?: Record<string, { contextWindow?: number; maxTokens?: number }>,
  expectedRevision?: number,
  apiKeyDraft?: string,
  modelOverrides?: Record<string, unknown>,
]

const state = vi.hoisted(() => ({
  saveProvider: vi.fn<(...args: SaveProviderArgs) => Promise<{
    success: boolean; error?: string; revision?: number; conflict?: boolean
  }>>(async () => ({ success: true, revision: 2 })),
  describeCredentials: vi.fn(async () => {}),
  loadProviders: vi.fn(async () => {}),
  loadModels: vi.fn(async () => {}),
  unsetCredential: vi.fn(async () => ({ success: true })),
  deleteProvider: vi.fn(async () => ({ success: true })),
  providers: [] as Array<{ id: string; displayName?: string }>,
  /** 全局模型表 —— 目录区按账户过滤出**派生条目**（初值/placeholder/用途标签） */
  models: [] as Array<{ id: string; modelName: string; name: string }>,
  credentialInfo: {} as Record<string, unknown>,
  /** 引用检查（`blockingReferences` 从三个 store 汇集）—— 默认全空 = 无引用 */
  defaultModelId: null as string | null,
  defaultEmbeddingModelId: null as string | null,
  modelRoutes: { elite: [] as string[], standard: [] as string[], budget: [] as string[], strategy: 'static' },
  conversations: [] as Array<{ id: string; title?: string | null; modelId?: string | null }>,
  llmEmbeddingModelId: null as string | null,
}))

vi.mock('../../stores/llm-store', () => ({
  useLLMStore: Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state },
  ),
}))

// 引用检查要跨三个 store 汇集（默认模型/路由在 llm，会话在 agent，向量配置在 vector）
vi.mock('../../stores/agent-store', () => ({
  useAgentStore: { getState: () => ({ conversations: state.conversations }) },
}))
vi.mock('../../stores/vector-config-store', () => ({
  useVectorConfigStore: { getState: () => ({ llmEmbeddingSettings: { modelId: state.llmEmbeddingModelId } }) },
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
  state.models = []
  state.defaultModelId = null
  state.defaultEmbeddingModelId = null
  state.modelRoutes = { elite: [], standard: [], budget: [], strategy: 'static' }
  state.conversations = []
  state.llmEmbeddingModelId = null
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

/** 目录区的控件没有 `<Label for>`（行号进 aria-label，多行才分得清） */
function inputByAriaLabel(label: string): HTMLInputElement {
  const input = container!.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement | null
  expect(input, `未找到输入框「${label}」`).toBeTruthy()
  return input!
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
      undefined, // 目录没动过 → 不带 overrides
    )
    expect(onClose).toHaveBeenCalledWith(true)
    expect(inputByLabel('API 密钥').value).toBe('')
  })

  it('应用（空草稿）→ apiKeyDraft 缺省 = 不改已存密钥', async () => {
    render()
    await act(async () => { buttonByText('应用').click(); await tick() })
    expect(state.saveProvider).toHaveBeenCalledWith(expect.anything(), undefined, 7, undefined, undefined)
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
        modelNames: ['gen-1'],                    // 目录没动 → 清单原样带走（不是 undefined！）
      }),
      undefined, 7, undefined, undefined,
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

  it('换家重播种（添加卡的 provider 下拉）：地址/协议跟新家走，密钥草稿与卡都不动', async () => {
    // 编辑卡拿的是快照，provider 锁定；只有添加卡会换 `account.provider` —— 这里直接模拟那次重渲染
    render({ keyInfo: MISSING })
    await act(async () => { setValue(inputByLabel('API 密钥'), 'sk-keep') })

    await act(async () => {
      root!.render(
        <ProviderEditorCard
          account={{ ...ACCOUNT, provider: 'deepseek' as never, baseUrl: 'https://api.deepseek.com' }}
          revision={7}
          keyInfo={MISSING}
          onClose={vi.fn()}
        />,
      )
    })
    expect(inputByLabel('API 密钥').value, '换家不动密钥草稿').toBe('sk-keep')

    await act(async () => { buttonByText('应用').click(); await tick() })
    expect(state.saveProvider).toHaveBeenCalledWith(
      // 新家的身份与地址：旧家的地址若被带过去，就是一个打不通的账户
      expect.objectContaining({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com' }),
      undefined, 7, 'sk-keep', undefined,
    )
  })

  it('conflict → 卡内「重新加载」就地出口：重读账户与条目、草稿不动，重载后可再提交', async () => {
    state.saveProvider.mockImplementationOnce(async () => ({ success: false, conflict: true, error: 'provider/conflict' }))
    const onClose = vi.fn()
    render({ keyInfo: MISSING, onClose })
    await act(async () => { setValue(inputByLabel('API 密钥'), 'sk-abc') })
    await act(async () => { buttonByText('应用').click(); await tick() })

    await act(async () => { buttonByText('重新加载').click(); await tick() })
    expect(state.loadProviders).toHaveBeenCalled()
    expect(state.loadModels).toHaveBeenCalled()
    expect(inputByLabel('API 密钥').value, '重载不动草稿').toBe('sk-abc')

    // 版本号跟上后再点「应用」即可写入（这就是 conflict 的恢复路径）
    await act(async () => { buttonByText('应用').click(); await tick() })
    expect(state.saveProvider).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'acct-1' }), undefined, 7, 'sk-abc', undefined,
    )
    expect(onClose).toHaveBeenCalledWith(true)
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

/**
 * 目录区接线（v3 T7 §2.3）—— 编辑卡把「行列表 + overrides」并进**同一次**「应用」：
 * 账户与派生条目要么一起落盘，要么都不动（拆成两次 IPC 时中途失败会留下不一致的半成品）。
 */
describe('ProviderEditorCard × 目录区', () => {
  it('目录行的改动随「应用」一次提交：modelNames + 第 5 参 modelOverrides', async () => {
    render() // ACCOUNT.modelNames = ['gen-1']
    await act(async () => { setValue(inputByAriaLabel('显示名 1'), '主力') })
    await act(async () => { buttonByText('应用').click(); await tick() })

    expect(state.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'acct-1', modelNames: ['gen-1'] }),
      undefined, 7, undefined,
      { 'gen-1': { name: '主力' } },
    )
  })

  it('目录区：清空容量框 → 随应用提交 contextWindow: null（移除覆盖，回落内置规格）', async () => {
    render() // ACCOUNT.modelNames = ['gen-1']
    await act(async () => { container!.querySelector<HTMLButtonElement>('button[aria-label="模型选项 1"]')!.click() })
    await act(async () => { setValue(inputByAriaLabel('上下文窗口 1'), '256K') }) // 先设
    await act(async () => { setValue(inputByAriaLabel('上下文窗口 1'), '') })     // 再清空
    await act(async () => { buttonByText('应用').click(); await tick() })

    expect(state.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'acct-1', modelNames: ['gen-1'] }),
      undefined, 7, undefined,
      { 'gen-1': { contextWindow: null } },
    )
  })

  it('目录行非法（id 清空）→「应用」禁用 + 不提交（account 与目录一起被拦住）', async () => {
    render()
    await act(async () => { setValue(inputByAriaLabel('模型 ID 1'), '') })

    expect(container!.textContent).toContain('模型 ID 不能为空')
    expect(buttonByText('应用').disabled).toBe(true)
    await act(async () => { buttonByText('应用').click(); await tick() })
    expect(state.saveProvider).not.toHaveBeenCalled()
  })

  it('删除目录行 → 该行连同其派生条目一起消失（不改显示名也能提交目录变化）', async () => {
    render()
    await act(async () => { container!.querySelector<HTMLButtonElement>('button[aria-label="删除模型 1"]')!.click() })
    await act(async () => { buttonByText('应用').click(); await tick() })

    expect(state.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ modelNames: [] }), // 删光 = 空清单（主进程按继承语义重建全集）
      undefined, 7, undefined, undefined,
    )
  })

  it('继承态（modelNames 缺省）：没碰目录 → 提交仍是「继承」（modelNames undefined + 无 overrides）', async () => {
    render({ account: { ...ACCOUNT, modelNames: undefined } })
    await act(async () => { buttonByText('应用').click(); await tick() })

    const [patch, , , , overrides] = state.saveProvider.mock.calls[0]
    expect((patch as ProviderAccount).modelNames).toBeUndefined()
    expect(overrides).toBeUndefined()
  })
})

/**
 * 引用检查（v2 有、v3 重建时丢掉的守卫 —— 终审 I1 的真回归）。
 *
 * 目录区删行 / 恢复默认**会真的删掉派生条目**，而默认模型、三层路由、会话按 id 引用它们：
 * 不查就提交 = 一串悬空 id（界面报「已保存」，状态栏/工作流报未配置，只能人工修）。
 * 判据：被引用 → **整张卡不提交**（`saveProvider` 未被调用）+ toast 点名引用位置 + 草稿保留。
 */
describe('ProviderEditorCard × 引用检查（删目录条目的守卫）', () => {
  /** 该账户当前唯一的派生条目（目录行删掉后，主进程就会把它删掉） */
  const DERIVED = { id: 'acct-1::gen-1', modelName: 'gen-1', name: 'gen-1' }

  const removeFirstRow = async () => {
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('button[aria-label="删除模型 1"]')!.click()
    })
  }

  it('删掉当前默认模型所在行 → 拦下：saveProvider 未被调用 + toast + 草稿保留', async () => {
    state.models = [DERIVED]
    state.defaultModelId = DERIVED.id
    render()

    await removeFirstRow()
    await act(async () => { buttonByText('应用').click(); await tick() })

    expect(state.saveProvider).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('默认生成模型'))
    // 草稿保留（整张卡原地不动）：目录仍是删掉后的那份，不是被静默回滚
    expect(container!.textContent).toContain('已自定义模型目录')
  })

  it('路由 / 会话引用同样拦得住（引用源跨三个 store）', async () => {
    state.models = [DERIVED]
    state.modelRoutes = { elite: [DERIVED.id], standard: [], budget: [], strategy: 'static' }
    state.conversations = [{ id: 'c1', title: '第一章', modelId: DERIVED.id }]
    render()

    await removeFirstRow()
    await act(async () => { buttonByText('应用').click(); await tick() })

    expect(state.saveProvider).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('三层路由 · elite、会话 · 第一章'))
  })

  it('「恢复默认模型」把被引用的条目挤出目录 → 同样拦（清空走的也是这条差集）', async () => {
    // 自定义清单里的模型**不在**内置目录里：恢复默认后它就会被删掉
    state.models = [{ id: 'acct-1::my-custom', modelName: 'my-custom', name: 'my-custom' }]
    state.defaultModelId = 'acct-1::my-custom'
    render({ account: { ...ACCOUNT, provider: 'deepseek' as never, modelNames: ['my-custom'] } })

    await act(async () => { buttonByText('恢复默认模型').click() })
    await act(async () => { buttonByText('应用').click(); await tick() })

    expect(state.saveProvider).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('默认生成模型'))
    // 草稿保留：目录仍停在用户点下的「恢复默认」态（没有被静默回滚成自定义清单）
    expect(container!.textContent).toContain('默认模型目录')
    expect(container!.textContent).not.toContain('已自定义模型目录')
  })

  it('删掉**未被引用**的行 → 照常提交（守卫不是一刀切）', async () => {
    state.models = [DERIVED]
    render()

    await removeFirstRow()
    await act(async () => { buttonByText('应用').click(); await tick() })

    expect(toastError).not.toHaveBeenCalled()
    expect(state.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ modelNames: [] }), undefined, 7, undefined, undefined,
    )
  })

  it('「删光 = 恢复默认」不误拦：条目名仍在内置目录里 → 差集为空', async () => {
    // provider 自带内置目录时，空清单在存储层是**继承**（下次保存会把全集重建出来）——
    // 用 `??` 直算差集会对这家误报「整个目录被删掉」
    const builtin = builtinCatalogFor('openai')[0]
    state.models = [{ id: `acct-1::${builtin}`, modelName: builtin, name: builtin }]
    state.defaultModelId = `acct-1::${builtin}`
    render({ account: { ...ACCOUNT, provider: 'openai' as never, modelNames: [builtin] } })

    await removeFirstRow()
    await act(async () => { buttonByText('应用').click(); await tick() })

    expect(toastError).not.toHaveBeenCalled()
    expect(state.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ modelNames: [] }), undefined, 7, undefined, undefined,
    )
  })
})
