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
import { BUILTIN_PRESETS, builtinCatalogFor } from '../../src/shared/provider-presets'
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
    apiKey: 'sk-test',
    baseUrl: 'https://api.openai.com',
    modelNames: ['gpt-5.6-sol'],
    ...over,
  }
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

    await call('llm:save-provider', mkAccount({ id: 'acc-2', provider: 'custom', protocol: 'openai', modelNames: [], apiKey: 'sk-2' }))
    expect(providersFile().accounts[1].apiKeyRef).toBe('CUSTOM_API_KEY_2')
  })

  it('手工模型条目已占用的 ref 也计入 taken（账户与手工条目共用同一命名空间）', async () => {
    files.set(MODELS_CONFIG_PATH, [
      { id: 'uuid-hand', name: '手工', provider: 'openai', protocol: 'openai', modelName: 'm', apiKey: 'ENC:xx', baseUrl: '', temperature: 0.7, maxTokens: 1, contextWindow: 1, purposes: ['generation'], apiKeyRef: 'OPENAI_API_KEY' },
    ])
    await call('llm:save-provider', mkAccount({ id: 'acc-1' }))
    expect(providersFile().accounts[0].apiKeyRef).toBe('OPENAI_API_KEY_2')
  })

  it('派生条目的凭据副本带上同一个 ref（T5 之后唯一通路）', async () => {
    await call('llm:save-provider', mkAccount({ id: 'acc-1', apiKeyRef: 'OPENAI_API_KEY' }))
    const derived = modelsFile().filter((m) => m.id.startsWith('acc-1::'))
    expect(derived.length).toBeGreaterThan(0)
    expect(derived.every((m) => m.apiKeyRef === 'OPENAI_API_KEY')).toBe(true)
    expect(derived.every((m) => m.apiKey.startsWith('ENC:'))).toBe(true) // 落盘仍是密文
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
  it('v2 形下照常返回账号数组：apiKey 解密、apiKeyRef 随行（不能把包装对象漏给渲染层）', async () => {
    await call('llm:save-provider', mkAccount({ id: 'acc-1', apiKey: 'sk-secret' }))
    const list = (await call('llm:list-providers')) as ProviderAccount[]

    expect(Array.isArray(list)).toBe(true)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('acc-1')
    expect(list[0].apiKey).toBe('sk-secret') // 盘上密文、渲染层明文（与 llm:list-models 同一约定）
    expect(list[0].apiKeyRef).toBe('OPENAI_API_KEY')
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
    apiKey: 'sk-x', baseUrl: '', temperature: 0.7, maxTokens: 1, contextWindow: 1, purposes: ['generation'],
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

  it('手工条目在删账户后原样保留', async () => {
    const hand: ModelProfile = {
      id: 'uuid-hand', name: '手工', provider: 'openai', protocol: 'openai', modelName: 'm',
      apiKey: 'ENC:xx', baseUrl: '', temperature: 0.7, maxTokens: 1, contextWindow: 1, purposes: ['generation'],
    }
    await call('llm:save-provider', mkAccount({ id: 'acc-1' }))
    files.set(MODELS_CONFIG_PATH, [...modelsFile(), hand])

    await call('llm:delete-provider', 'acc-1')
    expect(modelsFile()).toHaveLength(1)
    // apiKey 除外：任何一次 saveModelConfigs 都会重新加密一遍（既有行为，非本次改动）→ 只比其余字段
    expect({ ...modelsFile()[0], apiKey: hand.apiKey }).toEqual(hand)
  })
})
