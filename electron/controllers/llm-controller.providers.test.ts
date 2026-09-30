/**
 * llm-controller 供应商账户写路径（模型管理 v3 T2：apiKeyRef / providers.json v2 / revision / 写队列）
 *
 * 覆盖（brief Interfaces 块）：
 * - `llm:save-provider` 在**主进程**分配 `apiKeyRef`（渲染层不分配）：同 provider 第二账户 → `_2`；
 *   账户已有 ref 不重分配；credentials.json 已占用的 ref 计入 taken
 * - providers.json 升级 **v2**（`{version:2, revision, accounts}`），读兼容旧数组形（视 revision = 0）
 * - `expectedRevision` 不符 → `conflict:true` **且不写盘**；undefined → 不校验、照写、revision +1
 * - 派生条目携 `apiKeyRef`；空/缺省 `modelNames` = 继承内置目录
 * - 删除账户连带清掉其派生条目（**不再靠空 modelNames 表达**）
 * - 并发两次 save 不丢更新（队列：整次「读→改→写」在同一任务内）
 *
 * ⚠️ CI 一致性（ci-parity-standard）：本文件 import 到 electron → **必须 `vi.mock('electron')`**；
 *    另打桩 logger。配置文件的**文件层**用 config-utils 的 `__setConfigFilesForTest` 注入内存 Map，
 *    凭据文件层用 store 的 `__setCredentialFileForTest` —— **绝不读写真实 `~/.novelforge/*.json`**。
 *
 *    ⚠️ 别改用 `vi.mock('../utils/config-utils')` 打桩：`vi.mock` 只替换模块的**外部**引用，
 *    真实 `readProvidersFile`/`writeProvidersFile` 内部调的是同模块的 `readJsonFile`/`writeJsonFile`，
 *    不经过替身 → 用例照样写真实 providers.json（2026-10-01 实测踩到，见 config-utils 的注入注释）。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

// ===== mock 状态（vi.hoisted：模块工厂先于 import 求值）=====
const h = vi.hoisted(() => ({
  /** 通道 → 真实注册的 handler（由 mock 的 ipcMain.handle 捕获） */
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      h.handlers.set(channel, fn)
    },
    removeHandler: vi.fn(),
  },
  // secure-config → safeStorage：可逆打桩（与 credential-controller.test.ts 同款）
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf-8'),
    decryptString: (b: Buffer) => b.toString('utf-8'),
  },
}))

vi.mock('../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getLogDir: () => '' },
}))

import { registerLLMController } from './llm-controller'
import { MODELS_CONFIG_PATH, PROVIDERS_CONFIG_PATH, __setConfigFilesForTest } from '../utils/config-utils'
import { trustWebContents, resetTrustedWebContentsForTest } from '../security/ipc-guard'
import { __setCredentialFileForTest } from '../credentials/store'
import { decryptApiKey, encryptApiKey } from '../utils/secure-config'
import { BUILTIN_PRESETS, builtinCatalogFor, presetModelDefaults } from '../../src/shared/provider-presets'
import { deriveModelId } from '../../src/shared/provider-accounts'
import type { ModelProfile, ProviderAccount } from '../../src/shared/ipc-channels'

const SENDER_ID = 21
/** 伪装成「应用自己的 top frame」（ipc-guard：存活 + top frame + 白名单 + file:// 生产页面） */
const fakeEvent = {
  sender: { id: SENDER_ID, send: vi.fn() },
  senderFrame: { url: 'file:///app/index.html', parent: null },
}

function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`通道未注册: ${channel}`)
  try {
    return Promise.resolve(fn(fakeEvent, ...args))
  } catch (e) {
    return Promise.reject(e)
  }
}

/** 注入的文件层替身（内存「盘」：路径 → 落盘内容） */
let files: Map<string, unknown>

/** 落盘的 providers.json（**原样**，含 version/revision） */
function providersFile(): { version?: number; revision?: number; accounts: ProviderAccount[] } {
  const raw = files.get(PROVIDERS_CONFIG_PATH)
  return Array.isArray(raw)
    ? { accounts: raw as ProviderAccount[] } // 旧数组形（只有用例刻意种下时才会出现）
    : (raw as { version?: number; revision?: number; accounts: ProviderAccount[] })
}

function modelsFile(): ModelProfile[] {
  return (files.get(MODELS_CONFIG_PATH) as ModelProfile[] | undefined) ?? []
}

function mkAccount(over: Partial<ProviderAccount> & { id: string }): ProviderAccount {
  return {
    provider: 'openai',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com',
    modelNames: ['gpt-5.6-sol'],
    ...over,
  }
}

/** 落盘的 models.json（**原样 JSON 文本**：保全类断言要看「成员在不在」，不能走类型后的对象） */
function rawModels(): string {
  return JSON.stringify(files.get(MODELS_CONFIG_PATH) ?? [])
}

/** 每用例一份凭据文件对象（默认空） */
let credFile: Record<string, unknown>

beforeAll(() => {
  registerLLMController()
})

beforeEach(() => {
  vi.clearAllMocks()
  resetTrustedWebContentsForTest()
  trustWebContents(SENDER_ID)
  files = new Map()
  __setConfigFilesForTest(files)   // 文件层 → 内存，绝不碰真实 ~/.novelforge
  credFile = { version: 1, refs: {} }
  __setCredentialFileForTest(credFile as never)
})

// ===== 注册与收口 =====

describe('注册与收口', () => {
  it('供应商两条通道已注册，且来源不可信时拒绝', async () => {
    expect(h.handlers.has('llm:save-provider')).toBe(true)
    expect(h.handlers.has('llm:delete-provider')).toBe(true)
    resetTrustedWebContentsForTest()
    await expect(call('llm:save-provider', mkAccount({ id: 'x' }))).rejects.toThrow(/sender not trusted/)
  })
})

// ===== apiKeyRef 分配 =====

describe('apiKeyRef 分配（主进程侧）', () => {
  it('新账户 → 由 provider 派生 ref（OPENAI_API_KEY），并写进 providers.json', async () => {
    const res = await call('llm:save-provider', mkAccount({ id: 'acc-1' }))
    expect(res).toMatchObject({ success: true })
    expect(providersFile().accounts[0].apiKeyRef).toBe('OPENAI_API_KEY')
  })

  it('同 provider 第二个账户 → 去重后缀 `_2`（多账户挂同一家）', async () => {
    await call('llm:save-provider', mkAccount({ id: 'acc-1' }))
    await call('llm:save-provider', mkAccount({ id: 'acc-2', modelNames: [] }))

    expect(providersFile().accounts.map((a) => a.apiKeyRef)).toEqual(['OPENAI_API_KEY', 'OPENAI_API_KEY_2'])
  })

  it('账户已有 apiKeyRef → 不重分配（ref 创建后不可改）', async () => {
    await call('llm:save-provider', mkAccount({ id: 'acc-1', apiKeyRef: 'MY_OWN_KEY', modelNames: ['gpt-5.6-sol'] }))
    await call('llm:save-provider', mkAccount({ id: 'acc-1', apiKeyRef: 'MY_OWN_KEY', modelNames: ['gpt-5.6-sol', 'gpt-5.6-luna'] }))

    expect(providersFile().accounts).toHaveLength(1)
    expect(providersFile().accounts[0].apiKeyRef).toBe('MY_OWN_KEY')
  })

  it('credentials.json 里已占用的 ref 计入 taken（不撞已有环境变量名）', async () => {
    credFile.refs = { ZAI_CODING_CN_API_KEY: 'ENC:x' }
    await call('llm:save-provider', mkAccount({ id: 'acc-1', provider: 'custom', protocol: 'openai', modelNames: [] }))
    expect(providersFile().accounts[0].apiKeyRef).toBe('CUSTOM_API_KEY')

    await call('llm:save-provider', mkAccount({ id: 'acc-2', provider: 'custom', protocol: 'openai', modelNames: [] }))
    expect(providersFile().accounts[1].apiKeyRef).toBe('CUSTOM_API_KEY_2')
  })

  it('手工模型条目已占用的 ref 也计入 taken（账户与手工条目共用同一命名空间）', async () => {
    files.set(MODELS_CONFIG_PATH, [
      { id: 'uuid-hand', name: '手工', provider: 'openai', protocol: 'openai', modelName: 'm', apiKeyRef: 'OPENAI_API_KEY', baseUrl: '', temperature: 0.7, maxTokens: 1, contextWindow: 1, purposes: ['generation'] },
    ])
    await call('llm:save-provider', mkAccount({ id: 'acc-1' }))
    expect(providersFile().accounts[0].apiKeyRef).toBe('OPENAI_API_KEY_2')
  })

  it('派生条目只带引用、不带凭据副本（T5：条目上的密钥字段已消失）', async () => {
    await call('llm:save-provider', mkAccount({ id: 'acc-1', apiKeyRef: 'OPENAI_API_KEY' }))
    const derived = modelsFile().filter((m) => m.id.startsWith('acc-1::'))
    expect(derived.length).toBeGreaterThan(0)
    expect(derived.every((m) => m.apiKeyRef === 'OPENAI_API_KEY')).toBe(true)
    expect(derived.every((m) => !('apiKey' in m))).toBe(true)
    // 落盘也一样：文件里不该出现任何密钥字段（连空串都不留）
    expect(JSON.stringify(files.get(MODELS_CONFIG_PATH))).not.toContain('"apiKey"')
  })
})

// ===== providers.json v2 / revision =====

describe('providers.json v2 + revision 门控', () => {
  it('首次保存 → 文件升级为 v2 且 revision = 1', async () => {
    const res = await call('llm:save-provider', mkAccount({ id: 'acc-1' }))
    expect(res).toEqual({ success: true, revision: 1 })
    expect(files.get(PROVIDERS_CONFIG_PATH)).toMatchObject({ version: 2, revision: 1 })
  })

  it('读旧数组形 = revision 0 基线；下一次写即升级为 v2/revision 1', async () => {
    files.set(PROVIDERS_CONFIG_PATH, [mkAccount({ id: 'legacy', apiKeyRef: 'LEGACY_KEY' })])
    const res = await call('llm:save-provider', mkAccount({ id: 'acc-1' }))
    expect(res).toEqual({ success: true, revision: 1 })
    expect(providersFile().version).toBe(2)
    expect(providersFile().accounts.map((a) => a.id)).toEqual(['legacy', 'acc-1'])
  })

  it('expectedRevision 不符 → conflict，且**文件一个字节都不写**', async () => {
    await call('llm:save-provider', mkAccount({ id: 'acc-1' }))          // revision 1
    const beforeProviders = JSON.stringify(files.get(PROVIDERS_CONFIG_PATH))
    const beforeModels = JSON.stringify(files.get(MODELS_CONFIG_PATH))

    const res = await call('llm:save-provider', mkAccount({ id: 'acc-2', modelNames: [] }), undefined, 0)

    expect(res).toEqual({ success: false, conflict: true, error: 'provider/conflict' })
    expect(JSON.stringify(files.get(PROVIDERS_CONFIG_PATH))).toBe(beforeProviders)
    expect(JSON.stringify(files.get(MODELS_CONFIG_PATH))).toBe(beforeModels) // 派生同步也不许跑
  })

  it('expectedRevision 相符 → 写成功且 revision + 1', async () => {
    await call('llm:save-provider', mkAccount({ id: 'acc-1' }))                 // revision 1
    const res = await call('llm:save-provider', mkAccount({ id: 'acc-1', modelNames: ['gpt-5.6-luna'] }), undefined, 1)
    expect(res).toEqual({ success: true, revision: 2 })
    expect(providersFile().revision).toBe(2)
  })

  it('expectedRevision 缺省 = 不校验、照写（unfenced：老调用方零改动仍可用）', async () => {
    await call('llm:save-provider', mkAccount({ id: 'acc-1' }))   // revision 1
    const res = await call('llm:save-provider', mkAccount({ id: 'acc-2', modelNames: [] }))
    expect(res).toEqual({ success: true, revision: 2 })
    expect(providersFile().accounts).toHaveLength(2)
  })

  it('conflict 之后队列不断链：下一次正常保存照常成功', async () => {
    await call('llm:save-provider', mkAccount({ id: 'acc-1' }))
    await call('llm:save-provider', mkAccount({ id: 'acc-2', modelNames: [] }), undefined, 0)
    const res = await call('llm:save-provider', mkAccount({ id: 'acc-2', modelNames: [] }))
    expect(res).toEqual({ success: true, revision: 2 })
  })
})

// ===== 读取端（v2 形换了盘上形状，读点必须跟着换）=====

describe('llm:list-providers', () => {
  it('v2 形下返回 {accounts, revision}：apiKeyRef 随行、**不含密钥**（不能把包装对象漏给渲染层）', async () => {
    await call('llm:save-provider', mkAccount({ id: 'acc-1' }), undefined, undefined, 'sk-secret')
    const { accounts: list, revision } = (await call('llm:list-providers')) as {
      accounts: ProviderAccount[]
      revision: number
    }

    expect(Array.isArray(list)).toBe(true)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('acc-1')
    expect(list[0].apiKeyRef).toBe('OPENAI_API_KEY')
    expect(list[0]).not.toHaveProperty('apiKey')
    expect(JSON.stringify(list)).not.toContain('sk-secret')
    // revision 与 accounts 同快照（v3 §5）：存了一次 → 版本号必须是存后那个
    expect(revision).toBe(1)
  })

  it('迁移失败残留（盘上还带明文）→ 出站剥离，值不过境', async () => {
    files.set(PROVIDERS_CONFIG_PATH, {
      version: 2,
      revision: 1,
      accounts: [{ ...mkAccount({ id: 'acc-1', apiKeyRef: 'OPENAI_API_KEY' }), apiKey: 'sk-residual' }],
    })
    const { accounts: list, revision } = (await call('llm:list-providers')) as {
      accounts: ProviderAccount[]
      revision: number
    }

    expect(list[0]).not.toHaveProperty('apiKey')
    expect(JSON.stringify(list)).not.toContain('sk-residual')
    // 盘上 revision 1 原样带出（读点不 bump）
    expect(revision).toBe(1)
  })
})

// ===== 派生同步（继承三态在控制器层的落点）=====

describe('派生条目同步', () => {
  it('modelNames 缺省（继承态）→ 物化内置目录全集', async () => {
    await call('llm:save-provider', mkAccount({ id: 'acc-1', modelNames: undefined }))
    expect(modelsFile().map((m) => m.modelName)).toEqual(builtinCatalogFor('openai'))
  })

  it('生成表独有的型号也进继承目录（bigmodel：手写之外还有 pi-ai 键）', async () => {
    await call('llm:save-provider', mkAccount({ id: 'acc-b', provider: 'bigmodel', modelNames: undefined }))
    const names = modelsFile().map((m) => m.modelName)
    const handwritten = BUILTIN_PRESETS.find((p) => p.provider === 'bigmodel')!.models.map((m) => m.name)

    expect(names).toEqual(builtinCatalogFor('bigmodel'))
    expect(names.length).toBeGreaterThan(handwritten.length)
  })

  it('自定义清单 → 只物化所列模型（现语义）', async () => {
    await call('llm:save-provider', mkAccount({ id: 'acc-1', modelNames: ['gpt-5.6-luna'] }))
    expect(modelsFile().map((m) => m.id)).toEqual([deriveModelId('acc-1', 'gpt-5.6-luna')])
  })

  it('目录区 overrides（第 5 参）落到派生条目：只改所列字段，未列字段仍取规格', async () => {
    await call(
      'llm:save-provider',
      mkAccount({ id: 'acc-1', modelNames: ['gpt-5.6-sol', 'gpt-5.6-luna'] }),
      undefined, undefined, undefined,
      { 'gpt-5.6-sol': { name: '主力', contextWindow: 256_000, maxTokens: 24_576, inputTypes: ['text', 'image'] } },
    )

    const sol = modelsFile().find((m) => m.modelName === 'gpt-5.6-sol')!
    expect(sol.name).toBe('主力')
    expect(sol.contextWindow).toBe(256_000)
    expect(sol.maxTokens).toBe(24_576)
    expect(sol.inputTypes).toEqual(['text', 'image'])
    // 没进 overrides 的那一行：规格默认原样
    const luna = modelsFile().find((m) => m.modelName === 'gpt-5.6-luna')!
    const spec = presetModelDefaults('openai', 'gpt-5.6-luna')
    expect(luna.contextWindow).toBe(spec.contextWindow)
    expect(luna.maxTokens).toBe(spec.maxTokens)
  })

  it('目录区清空容量（null 覆盖）→ 该字段回到内置规格，用户旧值消失、落盘是有效的数', async () => {
    const save = (overrides?: Record<string, { contextWindow?: number | null }>) =>
      call('llm:save-provider', mkAccount({ id: 'acc-1', modelNames: ['gpt-5.6-sol'] }),
        undefined, undefined, undefined, overrides)

    await save()                                                   // 建条目（= 规格默认）
    await save({ 'gpt-5.6-sol': { contextWindow: 9_999 } })        // 覆盖
    expect(modelsFile().find((m) => m.modelName === 'gpt-5.6-sol')!.contextWindow).toBe(9_999)

    await save({ 'gpt-5.6-sol': { contextWindow: null } })         // 清空 = 移除覆盖

    const sol = modelsFile().find((m) => m.modelName === 'gpt-5.6-sol')!
    const spec = presetModelDefaults('openai', 'gpt-5.6-sol')
    expect(sol.contextWindow).toBe(spec.contextWindow)             // 回落内置规格
    expect(sol.contextWindow).not.toBe(9_999)
    expect(sol.maxTokens).toBe(spec.maxTokens)                     // 未动的字段零影响
    // 落盘是**有效的数**（不是 null、也不是缺键 —— 缺键会被读取路径按 maxTokens 兜底，
    // 那等于把「回继承」变成「窗口缩水」；见 provider-accounts.mergeOverride 的注释）
    expect(Number.isFinite(JSON.parse(rawModels())[0].contextWindow)).toBe(true)
  })

  it('overrides 二次保存：叠加在已有条目上（用户此前在别处改的字段不被冲掉）', async () => {
    await call('llm:save-provider', mkAccount({ id: 'acc-1', modelNames: ['gpt-5.6-sol'] }))
    // 模拟「用户此前改过的逐模型设置」（比如 temperature —— 目录区改不了它）
    files.set(MODELS_CONFIG_PATH, modelsFile().map((m) => ({ ...m, temperature: 1.2, purposes: ['refinement'] })))

    await call(
      'llm:save-provider',
      mkAccount({ id: 'acc-1', modelNames: ['gpt-5.6-sol'] }),
      undefined, undefined, undefined,
      { 'gpt-5.6-sol': { maxTokens: 4_096 } },
    )

    const sol = modelsFile().find((m) => m.modelName === 'gpt-5.6-sol')!
    expect(sol.maxTokens).toBe(4_096)
    expect(sol.temperature).toBe(1.2)             // 目录区碰不到的字段原样保留
    expect(sol.purposes).toEqual(['refinement'])
  })

  it('并发两次保存不丢更新（整次读→改→写在同一个队列任务内）', async () => {
    const [r1, r2] = await Promise.all([
      call('llm:save-provider', mkAccount({ id: 'acc-1' })),
      call('llm:save-provider', mkAccount({ id: 'acc-2', modelNames: [] })),
    ])

    expect(r1).toMatchObject({ success: true })
    expect(r2).toMatchObject({ success: true })
    expect(providersFile().accounts.map((a) => a.id).sort()).toEqual(['acc-1', 'acc-2'])
    expect(providersFile().revision).toBe(2)
    // models.json 也两条都在（models 队列同样串行）
    const ids = modelsFile().map((m) => m.id)
    expect(ids).toContain(deriveModelId('acc-1', 'gpt-5.6-sol'))
    expect(ids).toContain(deriveModelId('acc-2', 'gpt-5.6-luna'))
  })
})

// ===== 模型写路径也走同一队列（v3 §5「models.json 全部写路径」）=====

describe('llm:save-model / llm:delete-model 入队', () => {
  const mkModel = (id: string): ModelProfile => ({
    id, name: id, provider: 'openai', protocol: 'openai', modelName: id,
    baseUrl: '', temperature: 0.7, maxTokens: 1, contextWindow: 1, purposes: ['generation'],
  })

  it('并发保存两个模型：都落盘（各自基于最新快照改，不丢更新）', async () => {
    await Promise.all([call('llm:save-model', mkModel('m1')), call('llm:save-model', mkModel('m2'))])
    expect(modelsFile().map((m) => m.id).sort()).toEqual(['m1', 'm2'])
  })

  it('删除不存在 → success:false（既有语义不变，且不写盘）', async () => {
    files.set(MODELS_CONFIG_PATH, [mkModel('m1')])
    const before = JSON.stringify(files.get(MODELS_CONFIG_PATH))
    expect(await call('llm:delete-model', 'nope')).toMatchObject({ success: false })
    expect(JSON.stringify(files.get(MODELS_CONFIG_PATH))).toBe(before)
  })

  it('删除存在 → 条目消失，其余保留', async () => {
    files.set(MODELS_CONFIG_PATH, [mkModel('m1'), mkModel('m2')])
    expect(await call('llm:delete-model', 'm1')).toMatchObject({ success: true })
    expect(modelsFile().map((m) => m.id)).toEqual(['m2'])
  })
})

// ===== 删除账户 =====

describe('llm:delete-provider', () => {
  it('删账户 → 条目消失、其派生条目一并清掉、其它账户不受影响', async () => {
    await call('llm:save-provider', mkAccount({ id: 'acc-1' }))
    await call('llm:save-provider', mkAccount({ id: 'acc-2', modelNames: ['gpt-5.6-luna'] }))

    expect(await call('llm:delete-provider', 'acc-1')).toEqual({ success: true })

    expect(providersFile().accounts.map((a) => a.id)).toEqual(['acc-2'])
    const ids = modelsFile().map((m) => m.id)
    expect(ids.some((id) => id.startsWith('acc-1::'))).toBe(false)
    expect(ids).toEqual([deriveModelId('acc-2', 'gpt-5.6-luna')])
  })

  it('目标不存在 → success:false + i18n 文案，且不写盘（不空转 bump revision）', async () => {
    await call('llm:save-provider', mkAccount({ id: 'acc-1' }))
    const before = JSON.stringify(files.get(PROVIDERS_CONFIG_PATH))

    const res = await call('llm:delete-provider', 'nope')
    expect(res).toMatchObject({ success: false })
    expect(res).not.toHaveProperty('conflict')
    expect(JSON.stringify(files.get(PROVIDERS_CONFIG_PATH))).toBe(before)
  })

  it('手工条目在删账户后原样保留（逐字段相同 —— 写盘不再加解密，没有任何字段被改写）', async () => {
    const hand: ModelProfile = {
      id: 'uuid-hand', name: '手工', provider: 'openai', protocol: 'openai', modelName: 'm',
      apiKeyRef: 'OPENAI_API_KEY_9', baseUrl: '', temperature: 0.7, maxTokens: 1, contextWindow: 1, purposes: ['generation'],
    }
    await call('llm:save-provider', mkAccount({ id: 'acc-1' }))
    files.set(MODELS_CONFIG_PATH, [...modelsFile(), hand])

    await call('llm:delete-provider', 'acc-1')
    expect(modelsFile()).toEqual([hand])
  })
})

// ===== 密钥草稿（v3 §4.4/§4.7）：写路径的「一次性草稿」========

describe('apiKeyDraft（一次性草稿 → 凭据库）', () => {
  const handModel = (id: string): ModelProfile => ({
    id, name: id, provider: 'openai', protocol: 'openai', modelName: id,
    baseUrl: '', temperature: 0.7, maxTokens: 1, contextWindow: 1, purposes: ['generation'],
  })

  /** 凭据库里的 ref 集合（`{ref → ENC: 密文}`）—— `credFile` 由用例注入 */
  const credRefs = (): Record<string, string> => (credFile as { refs: Record<string, string> }).refs

  it('save-provider：草稿非空 → 按分配到的 ref 写入凭据库（密文落盘）', async () => {
    const res = await call('llm:save-provider', mkAccount({ id: 'acc-1' }), undefined, undefined, 'sk-draft')

    expect(res).toMatchObject({ success: true })
    expect(Object.keys(credRefs())).toEqual(['OPENAI_API_KEY'])
    expect(credRefs().OPENAI_API_KEY).toMatch(/^ENC:/) // 盘上是密文
  })

  it('save-provider：草稿为空 → 不碰凭据库（保留已存值，§4.4）', async () => {
    await call('llm:save-provider', mkAccount({ id: 'acc-1' }), undefined, undefined, '')

    expect(credRefs()).toEqual({})
    expect(providersFile().accounts[0].apiKeyRef).toBe('OPENAI_API_KEY') // 配置照写
  })

  it('save-provider：草稿先 trim 再入库（粘贴噪声不进库）', async () => {
    await call('llm:save-provider', mkAccount({ id: 'acc-1' }), undefined, undefined, '  sk-draft\t')

    expect(decryptApiKey(credRefs().OPENAI_API_KEY)).toBe('sk-draft')
  })

  it('save-provider：非法草稿（形如 NAME=value）→ 拒写且配置也不落盘', async () => {
    const res = await call('llm:save-provider', mkAccount({ id: 'acc-1' }), undefined, undefined, 'OPENAI_API_KEY=sk-x')

    expect(res).toEqual({ success: false, error: 'keyIllegalCharacters' })
    expect(files.has(PROVIDERS_CONFIG_PATH)).toBe(false) // 配置压根没落盘（校验在最前）
    expect(credRefs()).toEqual({})
  })

  it('save-model：新手工条目分配 ref（OPENAI_API_KEY）并写入草稿密钥', async () => {
    const res = await call('llm:save-model', handModel('m1'), 'sk-draft')

    expect(res).toMatchObject({ success: true })
    expect(modelsFile()[0].apiKeyRef).toBe('OPENAI_API_KEY')
    expect(decryptApiKey(credRefs().OPENAI_API_KEY)).toBe('sk-draft')
  })

  it('save-model：已有 ref 的条目沿用原 ref（只补写草稿值，不重分配）', async () => {
    files.set(MODELS_CONFIG_PATH, [{ ...handModel('m1'), apiKeyRef: 'MY_OWN_KEY' }])

    await call('llm:save-model', { ...handModel('m1'), apiKeyRef: 'MY_OWN_KEY' }, 'sk-draft')

    expect(modelsFile()[0].apiKeyRef).toBe('MY_OWN_KEY')
    expect(Object.keys(credRefs())).toEqual(['MY_OWN_KEY'])
  })

  it('save-model：草稿为空 → 不写凭据库（新建条目就只有 ref、没有值）', async () => {
    await call('llm:save-model', handModel('m1'))

    expect(modelsFile()[0].apiKeyRef).toBe('OPENAI_API_KEY')
    expect(credRefs()).toEqual({})
  })

  it('save-model：非法草稿 → 拒写（配置与凭据都不动）', async () => {
    files.set(MODELS_CONFIG_PATH, [])
    const res = await call('llm:save-model', handModel('m1'), '   ')

    expect(res).toEqual({ success: false, error: 'keyBlank' })
    expect(modelsFile()).toHaveLength(0)
    expect(credRefs()).toEqual({})
  })

  it('save-model：派生条目（账户名下）继承账户的 ref，不另分配一个', async () => {
    await call('llm:save-provider', mkAccount({ id: 'acc-1' }))  // 分配 OPENAI_API_KEY
    const derivedId = deriveModelId('acc-1', 'gpt-5.6-sol')

    // 模拟「半迁移的旧条目」：账户有 ref，models.json 里的派生条目还没写上
    await call('llm:save-model', { ...handModel(derivedId), modelName: 'gpt-5.6-sol' })

    const row = modelsFile().find((m) => m.id === derivedId)!
    expect(row.apiKeyRef).toBe('OPENAI_API_KEY')      // 继承账户的，不是 OPENAI_API_KEY_2
    expect(modelsFile().every((m) => m.apiKeyRef !== 'OPENAI_API_KEY_2')).toBe(true)
  })

  it('save-model 与 save-provider 共用 taken 命名空间（先到者拿裸名，后到者 _2）', async () => {
    await call('llm:save-model', handModel('m1'))
    await call('llm:save-provider', mkAccount({ id: 'acc-1' }))

    expect(modelsFile().find((m) => m.id === 'm1')?.apiKeyRef).toBe('OPENAI_API_KEY')
    expect(providersFile().accounts[0].apiKeyRef).toBe('OPENAI_API_KEY_2')
  })

  it('并发保存两个新手工条目 → 各得一个 ref（taken 在队列任务内重算）', async () => {
    await Promise.all([
      call('llm:save-model', handModel('m1')),
      call('llm:save-model', handModel('m2')),
    ])

    const refs = modelsFile().map((m) => m.apiKeyRef).sort()
    expect(refs).toEqual(['OPENAI_API_KEY', 'OPENAI_API_KEY_2'])
  })
})

// ===== 盘上残留密钥的保全（T5 修复 round 1，评审 Important）=====
//
// 出站剥离后，渲染层回传的条目**已无 apiKey** —— 若整条替换，盘上尚未迁移的明文就被静默抹掉，
// 此后 hasLegacyKey 恒 false、迁移永不再搬，密钥只剩重填一条路。
// 派生同步（syncAccountModels）用 `{...m, ...credentials}` 合并语义本来就有这层保护 —— 两处口径必须一致。

describe('盘上残留密钥的保全（保存不得抹掉未迁移的明文）', () => {
  const handModel = (id: string): ModelProfile => ({
    id, name: id, provider: 'openai', protocol: 'openai', modelName: id,
    baseUrl: '', temperature: 0.7, maxTokens: 1, contextWindow: 1, purposes: ['generation'],
  })

  it('save-model：盘上有残留明文 + 只改一个字段 → 残留**原样带过去**，其余字段同样无损', async () => {
    const onDisk = { ...handModel('m1'), apiKey: 'sk-plain-residual', name: '旧名' }
    files.set(MODELS_CONFIG_PATH, [onDisk])

    await call('llm:save-model', { ...handModel('m1'), name: '新名' })

    const raw = JSON.parse(rawModels())
    expect(raw[0].apiKey, '盘上未迁移的明文被抹掉了 —— 迁移再也搬不到它').toBe('sk-plain-residual')
    expect(raw[0].name).toBe('新名')
    // 盘上原本的每个字段都还在（保存只该**增**——补发 apiKeyRef，不该减）
    expect(Object.keys(onDisk).filter((k) => !(k in raw[0])), '有字段被保存丢掉了').toEqual([])
    expect(raw[0].apiKeyRef).toBe('OPENAI_API_KEY')
  })

  it('save-provider：账户上的残留同样带过去（密文残留也照带）', async () => {
    const onDisk = { ...mkAccount({ id: 'acc-1' }), apiKey: 'ENC:legacy-cipher' }
    files.set(PROVIDERS_CONFIG_PATH, { version: 2, revision: 3, accounts: [onDisk] })

    await call('llm:save-provider', mkAccount({ id: 'acc-1', baseUrl: 'https://changed.example' }))

    const raw = JSON.parse(JSON.stringify(files.get(PROVIDERS_CONFIG_PATH)))
    expect(raw.accounts[0].apiKey).toBe('ENC:legacy-cipher')
    expect(raw.accounts[0].baseUrl).toBe('https://changed.example')
    expect(raw.revision).toBe(4)
  })

  it('反向守卫：全新条目落盘**不含** apiKey 键（保全不等于把密码字段写回去）', async () => {
    await call('llm:save-model', handModel('m-new'))

    expect(JSON.stringify(files.get(MODELS_CONFIG_PATH))).not.toContain('"apiKey"')
  })
})

// ===== 孤儿 ref 回收（终审小修③：删除路径 gc）=====

/**
 * 判据：凭据库的全部 ref 减去「账户 ∪ 全部条目」的引用集合 = 孤儿。
 *
 * 为什么必须有：ref 是**全局命名空间**（就是环境变量名）——删条目/删账户后留下的死 ref
 * 永久占住裸名，下一个同 provider 的条目只能拿 `_2`，用户 shell 里的裸名影子失效。
 * 三条边界各有一条用例：账户（含继承态）引用、共享 ref、env 影子。
 */
describe('gcOrphanRefs（删除路径的孤儿 ref 回收）', () => {
  const credRefs = (): Record<string, string> => (credFile as { refs: Record<string, string> }).refs

  const handModel = (id: string, apiKeyRef?: string): ModelProfile => ({
    id, name: id, provider: 'openai', protocol: 'openai', modelName: id,
    ...(apiKeyRef ? { apiKeyRef } : {}),
    baseUrl: '', temperature: 0.7, maxTokens: 1, contextWindow: 1, purposes: ['generation'],
  })

  /** 往注入的凭据库里塞一条真密文（走 encryptApiKey，与写路径同形） */
  const seedRef = (ref: string, value: string) => { credRefs()[ref] = encryptApiKey(value) }

  it('删手工条目 → 它独有的 ref 被清（死 ref 不再占住裸名）', async () => {
    files.set(MODELS_CONFIG_PATH, [handModel('uuid-1', 'HAND_API_KEY')])
    seedRef('HAND_API_KEY', 'sk-hand')

    expect(await call('llm:delete-model', 'uuid-1')).toMatchObject({ success: true })
    expect(Object.keys(credRefs())).toEqual([])
  })

  it('共享 ref 保留：账户还在用同一个名字 → 不删（并集判定）', async () => {
    await call('llm:save-provider', mkAccount({ id: 'acc-1', apiKeyRef: 'SHARED_API_KEY' }))
    files.set(MODELS_CONFIG_PATH, [...modelsFile(), handModel('uuid-1', 'SHARED_API_KEY')])
    seedRef('SHARED_API_KEY', 'sk-shared')

    await call('llm:delete-model', 'uuid-1')

    expect(Object.keys(credRefs())).toEqual(['SHARED_API_KEY'])
  })

  it('继承态账户（无派生条目）的 ref 不算孤儿：账户本身就是引用者', async () => {
    // 继承 + 该家没有内置目录 = 一个派生条目都没有 —— 只看条目会把这把钥匙删掉
    await call('llm:save-provider', mkAccount({ id: 'acc-1', provider: 'custom', modelNames: undefined }))
    seedRef('CUSTOM_API_KEY', 'sk-custom')
    files.set(MODELS_CONFIG_PATH, [handModel('uuid-1', 'HAND_API_KEY')])
    seedRef('HAND_API_KEY', 'sk-hand')

    await call('llm:delete-model', 'uuid-1')

    expect(Object.keys(credRefs())).toEqual(['CUSTOM_API_KEY'])
  })

  it('env 影子跳过：那条值由环境提供（写了也不生效），不归应用删', async () => {
    files.set(MODELS_CONFIG_PATH, [handModel('uuid-1', 'GC_SHADOW_API_KEY')])
    seedRef('GC_SHADOW_API_KEY', 'sk-store')
    process.env.GC_SHADOW_API_KEY = 'from-shell'
    try {
      expect(await call('llm:delete-model', 'uuid-1')).toMatchObject({ success: true })
    } finally {
      delete process.env.GC_SHADOW_API_KEY
    }

    expect(Object.keys(credRefs())).toEqual(['GC_SHADOW_API_KEY'])
  })

  it('存量孤儿（迁移留下的无主 ref）在下一次删除后被顺带清掉', async () => {
    files.set(MODELS_CONFIG_PATH, [handModel('uuid-1', 'HAND_API_KEY')])
    seedRef('LEGACY_ORPHAN_API_KEY', 'sk-orphan') // 没有任何账户/条目引用它
    seedRef('HAND_API_KEY', 'sk-hand')

    await call('llm:delete-model', 'uuid-1')

    expect(Object.keys(credRefs())).toEqual([])
  })

  it('删账户 → 其 ref（渲染层跳过 unset / 半迁移残留）由 gc 兜底清掉', async () => {
    await call('llm:save-provider', mkAccount({ id: 'acc-1' })) // ref = OPENAI_API_KEY
    seedRef('OPENAI_API_KEY', 'sk-openai')

    expect(await call('llm:delete-provider', 'acc-1')).toEqual({ success: true })

    expect(Object.keys(credRefs())).toEqual([])
  })

  it('删除失败（目标不存在）→ 一次 gc 都不跑（ref 还有人用着，不能动）', async () => {
    seedRef('HAND_API_KEY', 'sk-hand')
    expect(await call('llm:delete-model', 'nope')).toMatchObject({ success: false })
    expect(Object.keys(credRefs())).toEqual(['HAND_API_KEY'])
  })
})
