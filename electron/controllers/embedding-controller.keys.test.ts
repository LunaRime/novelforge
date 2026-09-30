/**
 * embedding-controller 密钥解析接线（模型管理 v3 T3 §4.4）—— 「ref 优先、明文回落」落在
 * **交给服务/渲染层之前**的两个取数点：
 *
 *  - `loadEmbeddingModelConfig`（注册时自动配置）→ 值进 `embeddingService`，随后进请求
 *  - `getLLMModels`（`embedding:list-models` / `embedding:list-llm-candidates`）→ 渲染层拿去
 *    配置服务，同样是请求参数的来源
 *
 * 另锁一条**回落项必须已解密**的约束：这两个取数点读的是文件的原始内容（`ENC:` 密文），
 * 少解一层就会把密文当「明文回落值」发给 API（401 且难排查）—— 用一条真密文夹住。
 *
 * ⚠️ CI 一致性（ci-parity-standard）：import 到 electron → **必须 `vi.mock('electron')`**；
 *    打桩 embedding-service（真实模块会拉起向量库）与 logger；文件层用
 *    `__setConfigFilesForTest` 注入内存 Map，凭据用 `__setStoredForTest` 注入明文缓存
 *    —— **绝不读写真实 `~/.novelforge/*.json`**（homedir 也指向临时目录，双保险）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ===== mock 状态（vi.hoisted：模块工厂先于 import 求值）=====
const h = vi.hoisted(() => ({
  home: `${process.env.TEMP ?? process.env.TMP ?? process.cwd()}/nf-emb-ctl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  configureFromModel: vi.fn(),
}))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  const homedir = () => h.home
  return { ...actual, homedir, default: { ...actual, homedir } }
})

vi.mock('electron', () => ({
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

vi.mock('../embedding-service', () => ({
  embeddingService: { configureFromModel: h.configureFromModel },
}))

vi.mock('../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getLogDir: () => '' },
}))

import { registerEmbeddingController } from './embedding-controller'
import { MODELS_CONFIG_PATH, writeJsonFile, __setConfigFilesForTest } from '../utils/config-utils'
import { trustWebContents, resetTrustedWebContentsForTest } from '../security/ipc-guard'
import { __setStoredForTest } from '../credentials/store'
import type { ModelProfile } from '../../src/shared/ipc-channels'

const SENDER_ID = 41
/** 不可能出现在环境变量里的 ref（`resolveCredential` 的 env 源优先于 store） */
const REF = 'V3_EMB_WIRING_TEST_REF'

const fakeEvent = {
  sender: { id: SENDER_ID, send: vi.fn() },
  senderFrame: { url: 'file:///app/index.html', parent: null },
}

function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`通道未注册: ${channel}`)
  return Promise.resolve(fn(fakeEvent, ...args))
}

const EMB_MODEL_ID = 'emb-wiring-1'

function embeddingFixture(over: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: EMB_MODEL_ID,
    name: 'Wiring Embedding',
    provider: 'openai',
    protocol: 'openai',
    modelName: 'text-embedding-3-small',
    apiKey: 'sk-plain',
    baseUrl: 'https://api.example.com/v1',
    temperature: 0,
    maxTokens: 0,
    contextWindow: 0,
    purposes: ['embedding'],
    ...over,
  }
}

/** 一份**真密文**（ENC:B64: 形态，`decryptApiKey` 能解回 plaintext） */
const CIPHER = `ENC:B64:${Buffer.from('sk-secret', 'utf-8').toString('base64')}`

beforeEach(() => {
  vi.clearAllMocks()
  __setConfigFilesForTest(new Map<string, unknown>())
  __setStoredForTest({})
  resetTrustedWebContentsForTest()
  trustWebContents(SENDER_ID)
})

describe('loadEmbeddingModelConfig（注册时自动配置）', () => {
  it('条目带 ref 且已配置 → 交给服务的是凭据库的值，而非盘上明文', () => {
    __setStoredForTest({ [REF]: 'sk-from-store' })
    writeJsonFile(MODELS_CONFIG_PATH, [embeddingFixture({ apiKeyRef: REF })])

    registerEmbeddingController()

    expect(h.configureFromModel).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk-from-store' }))
  })

  it('无 ref → 回落盘上明文（零行为变化）', () => {
    writeJsonFile(MODELS_CONFIG_PATH, [embeddingFixture()])

    registerEmbeddingController()

    expect(h.configureFromModel).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk-plain' }))
  })

  it('回落项必须是明文：盘上是 ENC: 密文时先解密再解析 ref', () => {
    writeJsonFile(MODELS_CONFIG_PATH, [embeddingFixture({ apiKey: CIPHER })])

    registerEmbeddingController()

    expect(h.configureFromModel).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk-secret' }))
  })
})

describe('getLLMModels（embedding:list-models 的取数点）', () => {
  it('条目带 ref → 返回给渲染层的密钥同样以凭据库为准', async () => {
    __setStoredForTest({ [REF]: 'sk-from-store' })
    writeJsonFile(MODELS_CONFIG_PATH, [embeddingFixture({ apiKeyRef: REF })])

    registerEmbeddingController()
    const models = await call('embedding:list-models')

    expect(models).toEqual([expect.objectContaining({ id: EMB_MODEL_ID, apiKey: 'sk-from-store' })])
  })
})
