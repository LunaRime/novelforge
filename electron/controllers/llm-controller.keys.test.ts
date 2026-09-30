/**
 * llm-controller 密钥接线（模型管理 v3 §4.4/§4.7；**T5 起 ref-only**）—— 请求边界上的三条通路：
 *
 *  - `llm:generate` / `llm:generate-stream` —— 共用 `getModelConfig`（给 provider 前的唯一收口点）
 *    → 按条目 `apiKeyRef` 解析；盘上残留的明文**不再参与**（回落随 `apiKey` 字段一起删了）
 *  - `llm:test-connection` / `llm:list-provider-models` —— 渲染层送来的 profile **不带密钥**，
 *    用户当场输入的键走 `apiKeyDraft` 一次性参数，且**草稿优先**（typed key wins）
 *  - `llm:list-models` —— 出站剥离：条目上残留的密钥字段一律不回渲染层
 *
 * ⚠️ CI 一致性（ci-parity-standard）：本文件 import 到 electron → **必须 `vi.mock('electron')`**；
 *    另打桩 logger 与 `LLMFactory`（fake provider 记录收到的 model，绝不发真实 HTTP）。
 *    文件层用 config-utils 的 `__setConfigFilesForTest` 注入内存 Map，凭据用 store 的
 *    `__setStoredForTest` 注入明文缓存 —— **绝不读写真实 `~/.novelforge/*.json`**。
 *
 * ⚠️ 凭据 ref 一律用**不可能出现在环境变量里**的名字：`resolveCredential` 的 env 源优先于
 *    store，若借用 `OPENAI_API_KEY` 这类真实名字，开发者机器上会命中的是 shell 变量而不是
 *    用例注入的值（用例随机器而异 —— CI 绿、本机红的那类幽灵）。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

// ===== mock 状态（vi.hoisted：模块工厂先于 import 求值）=====
const h = vi.hoisted(() => {
  /** 记录的「provider 实际收到什么」（fake provider 的观测点） */
  const seen: {
    generate: { apiKey?: string } | null
    listModels: { apiKey?: string } | null
  } = { generate: null, listModels: null }
  return {
    /** 通道 → 真实注册的 handler（由 mock 的 ipcMain.handle 捕获） */
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
    seen,
    /** Ollama 原生清单（T8 起：它在直答**之前**，不能被内置目录遮蔽） */
    listOllamaModels: vi.fn(async () => [] as Array<{ name: string }>),
    provider: {
      generate: vi.fn(async (model: { apiKey?: string }) => {
        seen.generate = model
        return { success: true, content: 'ok', error: undefined }
      }),
      generateStream: vi.fn((model: { apiKey?: string }, _messages: unknown, opts: { onDone: (t: string) => void }) => {
        seen.generate = model
        opts.onDone('ok')
        return Promise.resolve()
      }),
      listModels: vi.fn(async (opts: { apiKey?: string }) => {
        seen.listModels = opts
        return [{ id: 'candidate-1' }]
      }),
    },
  }
})

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

vi.mock('../llm/llm-factory', () => ({
  LLMFactory: { getProvider: () => h.provider },
}))

vi.mock('../ollama-embedding', () => ({
  listOllamaModels: h.listOllamaModels,
}))

import { t } from '../../src/shared/locale'
import { registerLLMController } from './llm-controller'
import { MODELS_CONFIG_PATH, writeJsonFile, __setConfigFilesForTest } from '../utils/config-utils'
import { trustWebContents, resetTrustedWebContentsForTest } from '../security/ipc-guard'
import { __setStoredForTest } from '../credentials/store'
import { builtinCatalogFor, presetModelDefaults } from '../../src/shared/provider-presets'
import type { ModelProfile } from '../../src/shared/ipc-channels'

const SENDER_ID = 31
/** 不可能出现在环境变量里的 ref（见文件头 ⚠️） */
const REF = 'V3_WIRING_TEST_REF'

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

const MODEL_ID = 'm-wiring-1'

/**
 * 盘上条目 = **迁移期形状**：`ModelProfile` 上已经没有 `apiKey` 了，但旧文件（迁移失败的残留）
 * 可能还带着它 —— 夹具保留该字段正是为了证明「残留明文不会被当密钥用」。
 */
type LegacyModelFixture = ModelProfile & { apiKey?: string }

function modelFixture(over: Partial<LegacyModelFixture> = {}): LegacyModelFixture {
  return {
    id: MODEL_ID,
    name: 'Wiring Model',
    provider: 'openai',
    protocol: 'openai',
    modelName: 'gpt-x',
    apiKey: 'sk-plain',
    baseUrl: 'https://api.example.com/v1',
    temperature: 0.7,
    maxTokens: 128,
    contextWindow: 8192,
    purposes: ['generation'],
    ...over,
  }
}

/** 渲染层送来的 profile：**类型上就没有密钥**（只有 ref）——`apiKeyDraft` 是独立的第二参 */
function rendererModel(over: Partial<ModelProfile> = {}): ModelProfile {
  const model: ModelProfile = { ...modelFixture(), ...over }
  delete (model as { apiKey?: string }).apiKey
  return model
}

const MESSAGES = [{ role: 'user', content: 'hi' }]

beforeAll(() => {
  registerLLMController()
})

beforeEach(() => {
  vi.clearAllMocks()
  h.seen.generate = null
  h.seen.listModels = null
  __setConfigFilesForTest(new Map<string, unknown>())
  __setStoredForTest({})
  resetTrustedWebContentsForTest()
  trustWebContents(SENDER_ID)
})

describe('llm:generate（生成路径收口点 getModelConfig）', () => {
  it('条目带 ref → provider 拿到凭据库的值（不是条目上的明文）', async () => {
    __setStoredForTest({ [REF]: 'sk-from-store' })
    writeJsonFile(MODELS_CONFIG_PATH, [modelFixture({ apiKeyRef: REF })])

    const res = await call('llm:generate', { modelId: MODEL_ID, messages: MESSAGES })

    expect(res).toMatchObject({ success: true })
    expect(h.seen.generate?.apiKey).toBe('sk-from-store')
  })

  it('无 ref → 空串；盘上残留的明文**不再**被当回落值用（T5 收敛 ref-only）', async () => {
    writeJsonFile(MODELS_CONFIG_PATH, [modelFixture()])

    await call('llm:generate', { modelId: MODEL_ID, messages: MESSAGES })

    expect(h.seen.generate?.apiKey).toBe('')
    expect(h.seen.generate?.apiKey).not.toBe('sk-plain')
  })

  it('llm:generate-stream 走同一个收口点（核对一次，避免两条链路演化出分歧）', async () => {
    __setStoredForTest({ [REF]: 'sk-from-store' })
    writeJsonFile(MODELS_CONFIG_PATH, [modelFixture({ apiKeyRef: REF })])

    await call('llm:generate-stream', 'req-1', { modelId: MODEL_ID, messages: MESSAGES })
    // 流式是「返回后流仍在跑」的形态：等 provider 真正被调用（onDone 已同步发出，一两个 tick 内）
    await vi.waitFor(() => { expect(h.seen.generate?.apiKey).toBe('sk-from-store') })
  })
})

describe('llm:test-connection（草稿优先 → ref 解析）', () => {
  it('profile 带 ref、无草稿 → 用凭据库的值', async () => {
    __setStoredForTest({ [REF]: 'sk-from-store' })

    const res = await call('llm:test-connection', rendererModel({ apiKeyRef: REF }))

    expect(res).toEqual({ success: true, error: undefined })
    expect(h.seen.generate?.apiKey).toBe('sk-from-store')
  })

  it('草稿非空即胜出 —— 即便条目带 ref 且库里有值（typed key wins，§4.7）', async () => {
    __setStoredForTest({ [REF]: 'sk-from-store' })

    await call('llm:test-connection', rendererModel({ apiKeyRef: REF }), 'sk-typed')

    expect(h.seen.generate?.apiKey).toBe('sk-typed')
  })

  it('无 ref + 有草稿 → 用草稿（保存前先探一手仍可行）', async () => {
    await call('llm:test-connection', rendererModel(), 'sk-typed')

    expect(h.seen.generate?.apiKey).toBe('sk-typed')
  })

  it('无 ref 且无草稿 → 空串（profile 上没有可回落的明文了）', async () => {
    await call('llm:test-connection', rendererModel())

    expect(h.seen.generate?.apiKey).toBe('')
  })
})

describe('llm:list-provider-models（草稿优先 → apiKeyRef 解析）', () => {
  // ⚠️ provider 用 `custom`（**无内置目录**）：v3 T8 起内置目录命中的 provider 免网络直答，
  //    键解析根本不会发生（要测的是「探测这道门上的键接线」，不是目录直答 —— 直答另有专测块）。
  const base = { provider: 'custom', protocol: 'openai', baseUrl: 'https://api.example.com/v1' } as const

  it('入参带 ref → listModels 收到凭据库的值', async () => {
    __setStoredForTest({ [REF]: 'sk-from-store' })

    const res = await call('llm:list-provider-models', { ...base, apiKeyRef: REF })

    expect(res).toEqual({ success: true, models: [{ id: 'candidate-1' }] })
    expect(h.seen.listModels?.apiKey).toBe('sk-from-store')
  })

  it('草稿非空即胜出（表单里刚敲的键要能当场验证）', async () => {
    __setStoredForTest({ [REF]: 'sk-from-store' })

    await call('llm:list-provider-models', { ...base, apiKeyRef: REF, apiKeyDraft: 'sk-typed' })

    expect(h.seen.listModels?.apiKey).toBe('sk-typed')
  })

  it('草稿为纯空白 → 不遮蔽 ref（空输入 = 没输入）', async () => {
    __setStoredForTest({ [REF]: 'sk-from-store' })

    await call('llm:list-provider-models', { ...base, apiKeyRef: REF, apiKeyDraft: '   ' })

    expect(h.seen.listModels?.apiKey).toBe('sk-from-store')
  })

  it('无 ref 且无草稿 → 仍落「需要密钥」分支（不放行空密钥探测）', async () => {
    const res = await call('llm:list-provider-models', { ...base, apiKeyDraft: '  ' })

    expect(res).toMatchObject({ success: false })
    expect(h.seen.listModels).toBeNull()
  })
})

describe('llm:list-provider-models（内置目录直答，v3 §5）', () => {
  /** 直答的期望形状：id + name（同串）+ 三级规格补全出的两个容量 */
  const directAnswer = (id: string) => {
    const { contextWindow, maxTokens } = presetModelDefaults('openai', id)
    return { id, name: id, contextWindow, maxTokens }
  }

  it('内置目录命中（openai）→ 免网络直答：不调 fetch、不碰 provider，名字 × 规格容量全数返回', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      const res = (await call('llm:list-provider-models', {
        provider: 'openai', protocol: 'openai', baseUrl: 'https://api.openai.com',
      })) as { success: boolean; models: Array<Record<string, unknown>> }

      expect(res.success).toBe(true)
      expect(h.seen.listModels, '内置目录命中却打了端点 —— 免网络直答没生效').toBeNull()
      expect(fetchSpy, '免网络直答不该发起任何真实请求').not.toHaveBeenCalled()
      expect(res.models.map((m) => m.id)).toEqual(builtinCatalogFor('openai'))
      // 容量走三级规格补全（字面量 → 生成表 → 兜底），与目录区的继承值同源
      const sample = builtinCatalogFor('openai')[0]
      expect(res.models[0]).toEqual(directAnswer(sample))
      // 输入类型不由直答编造（保持 undefined → 采纳时按继承链回落）
      expect(res.models.every((m) => !('inputTypes' in m))).toBe(true)
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('无密钥/无地址也照样直答（这条路根本不发请求，别在门口拦它）', async () => {
    const res = await call('llm:list-provider-models', {
      provider: 'deepseek', protocol: 'openai', baseUrl: '',
    })

    expect(res).toMatchObject({ success: true })
    expect(h.seen.listModels).toBeNull()
  })

  it('生成表并入后才非空的 provider（moonshot）同样直答 —— 不再打端点', async () => {
    const res = (await call('llm:list-provider-models', {
      provider: 'moonshot', protocol: 'openai', baseUrl: 'https://api.moonshot.cn',
    })) as { success: boolean; models: Array<{ id: string }> }

    expect(builtinCatalogFor('moonshot').length).toBeGreaterThan(0) // 防「目录其实为空」把这条断言变成空转
    expect(res.models.map((m) => m.id)).toEqual(builtinCatalogFor('moonshot'))
    expect(h.seen.listModels).toBeNull()
  })

  it('无内置目录（custom）→ 仍走端点探测（直答不是把所有家都短路掉）', async () => {
    __setStoredForTest({ [REF]: 'sk-from-store' })

    const res = (await call('llm:list-provider-models', {
      provider: 'custom', protocol: 'openai', baseUrl: 'https://gateway.example/v1', apiKeyRef: REF,
    })) as { success: boolean; models: Array<{ id: string }> }

    expect(res.models.map((m) => m.id)).toEqual(['candidate-1'])
    expect(h.seen.listModels?.apiKey).toBe('sk-from-store')
  })

  it('重排只动了成功分支：空地址的失败路径两条都原样（ollama / 端点探测）', async () => {
    // 「ollama 原生分支保持在最前」是 team-lead 的裁决（2026-10-01）——连同它的**失败路径**一起
    // 保真：这次重排把地址校验挪进了 ollama 分支内，出错文案与「不发起调用」的语义都没变
    const ollama = await call('llm:list-provider-models', {
      provider: 'ollama', protocol: 'openai', baseUrl: '   ',
    })
    expect(ollama).toEqual({ success: false, error: t('error.baseUrlRequired') })
    expect(h.listOllamaModels, '空地址不该去打本地端点').not.toHaveBeenCalled()

    const custom = await call('llm:list-provider-models', {
      provider: 'custom', protocol: 'openai', baseUrl: '',
    })
    expect(custom).toEqual({ success: false, error: t('error.baseUrlRequired') })
    expect(h.seen.listModels).toBeNull()
  })

  it('ollama 仍走原生 /api/tags（**刻意排在直答之前**：内置那几个名字只是起步猜测，本地装了什么只有端点知道）', async () => {
    h.listOllamaModels.mockResolvedValueOnce([{ name: 'deepseek-r1:14b' }, { name: 'qwen3:32b' }])

    const res = (await call('llm:list-provider-models', {
      provider: 'ollama', protocol: 'openai', baseUrl: 'http://localhost:11434',
    })) as { success: boolean; models: Array<{ id: string }> }

    expect(h.listOllamaModels).toHaveBeenCalledWith('http://localhost:11434')
    expect(res.models.map((m) => m.id)).toEqual(['deepseek-r1:14b', 'qwen3:32b'])
    expect(h.seen.listModels).toBeNull()
  })
})

describe('llm:list-models（出站剥离）', () => {
  it('条目带 ref → 回渲染层的是同一条目（含 apiKeyRef），但**不含密钥**', async () => {
    writeJsonFile(MODELS_CONFIG_PATH, [modelFixture({ apiKeyRef: REF })])

    const models = await call('llm:list-models') as Array<Record<string, unknown>>

    expect(models[0]).toMatchObject({ id: MODEL_ID, apiKeyRef: REF })
    expect(models[0]).not.toHaveProperty('apiKey')
  })

  it('迁移失败残留（盘上还有明文）→ 剥离后才回传，值不过境', async () => {
    writeJsonFile(MODELS_CONFIG_PATH, [modelFixture({ apiKey: 'sk-residual' })])

    const models = await call('llm:list-models')

    expect(JSON.stringify(models)).not.toContain('sk-residual')
    expect((models as Array<Record<string, unknown>>)[0]).not.toHaveProperty('apiKey')
  })
})
