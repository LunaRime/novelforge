/**
 * embedding-controller 密钥接线（模型管理 v3 §4.4/§4.7，T5 起 ref-only）—— 两个取数点
 * 的去向相反，这正是本文件要锁住的性质：
 *
 *  - `loadEmbeddingModelConfig`（注册时自动配置）→ 值进 `embeddingService`，随后进请求
 *    → **必须解析出密钥**（按 `apiKeyRef`；盘上残留的明文不再参与，T5 删除了回落）
 *  - `getLLMModels`（`embedding:list-models` / `list-llm-candidates`）→ 值回**渲染层**
 *    → **一律不带密钥**（即便盘上还有迁移失败残留的明文）
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
  /** 服务内部那份配置（get-model / get-llm-config 的取数点）—— 用例按需注入 */
  getConfig: vi.fn(),
  getLLMEmbeddingConfig: vi.fn(),
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
  embeddingService: {
    configureFromModel: h.configureFromModel,
    getConfig: h.getConfig,
    getLLMEmbeddingConfig: h.getLLMEmbeddingConfig,
  },
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

/** 盘上条目 = **迁移期形状**（旧文件可能还带着 `apiKey`）——用它模拟「迁移失败的残留」 */
type LegacyEmbeddingModel = ModelProfile & { apiKey?: string }

function embeddingFixture(over: Partial<LegacyEmbeddingModel> = {}): LegacyEmbeddingModel {
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

/** 一份**真密文**（ENC:B64: 形态）—— 迁移残留的另一种形态 */
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

  it('无 ref → **交不出密钥**（T5 收敛 ref-only：盘上残留的明文不再被当回落值使用）', () => {
    writeJsonFile(MODELS_CONFIG_PATH, [embeddingFixture()])

    registerEmbeddingController()

    expect(h.configureFromModel).toHaveBeenCalledWith(expect.objectContaining({ apiKey: '' }))
  })

  it('无 ref 且盘上是 ENC: 密文 → 同样交空串（**绝不把密文串当密钥发出去**）', () => {
    writeJsonFile(MODELS_CONFIG_PATH, [embeddingFixture({ apiKey: CIPHER })])

    registerEmbeddingController()

    expect(h.configureFromModel).toHaveBeenCalledWith(expect.objectContaining({ apiKey: '' }))
  })

  it('ref 已分配但解析不到（env/store 皆空）→ 空串', () => {
    writeJsonFile(MODELS_CONFIG_PATH, [embeddingFixture({ apiKeyRef: REF })])

    registerEmbeddingController()

    expect(h.configureFromModel).toHaveBeenCalledWith(expect.objectContaining({ apiKey: '' }))
  })
})

describe('embedding:get-model（配置回读，投影剥离）', () => {
  const serviceConfig = {
    modelId: 'emb-1',
    protocol: 'openai' as const,
    modelName: 'text-embedding-3-small',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-service-key',
    dimensions: 1536,
  }

  it('返回值**不含 apiKey**：投影的键集逐字锁定（服务那份带钥匙也不外泄）', async () => {
    h.getConfig.mockReturnValue(serviceConfig)

    registerEmbeddingController()
    const cfg = await call('embedding:get-model') as Record<string, unknown>

    expect(Object.keys(cfg).sort()).toEqual(['baseUrl', 'dimensions', 'modelId', 'modelName', 'protocol'])
    expect(JSON.stringify(cfg)).not.toContain('sk-service-key')
  })

  it('未配置 → null（投影不改空态语义）', async () => {
    h.getConfig.mockReturnValue(null)

    registerEmbeddingController()

    expect(await call('embedding:get-model')).toBeNull()
  })
})

describe('embedding:get-llm-config（回读整个 ModelProfile）', () => {
  it('模型上残留的密钥字段被剥离，且**不动服务内部那份配置**', async () => {
    // 服务内部那份与返回值里的 model 是同一个对象引用 —— 就地 delete 会把服务自己的配置也改掉
    const internal: LegacyEmbeddingModel = { ...embeddingFixture(), purposes: ['generation'], apiKey: 'sk-residual' }
    h.getLLMEmbeddingConfig.mockReturnValue({ enabled: true, model: internal, dimensions: 256, promptTemplate: 'x' })

    registerEmbeddingController()
    const cfg = await call('embedding:get-llm-config') as { model: Record<string, unknown> }

    expect(cfg.model).not.toHaveProperty('apiKey')
    expect(JSON.stringify(cfg)).not.toContain('sk-residual')
    expect(internal.apiKey, '服务内部配置被就地改掉了（下次请求就没钥匙了）').toBe('sk-residual')
  })

  it('未选模型（model=null）→ 原样返回 null，不抛', async () => {
    h.getLLMEmbeddingConfig.mockReturnValue({ enabled: false, model: null, dimensions: 256, promptTemplate: 'x' })

    registerEmbeddingController()
    const cfg = await call('embedding:get-llm-config') as { model: unknown }

    expect(cfg.model).toBeNull()
  })
})

describe('getLLMModels（embedding:list-models / list-llm-candidates 的取数点）', () => {
  it('带 ref → 回渲染层的条目**不含密钥**（值由服务侧现场解析，不过境）', async () => {
    __setStoredForTest({ [REF]: 'sk-from-store' })
    writeJsonFile(MODELS_CONFIG_PATH, [embeddingFixture({ apiKeyRef: REF })])

    registerEmbeddingController()
    const models = await call('embedding:list-models')

    expect(models).toEqual([expect.objectContaining({ id: EMB_MODEL_ID, apiKeyRef: REF })])
    expect((models as Array<Record<string, unknown>>)[0]).not.toHaveProperty('apiKey')
  })

  it('迁移失败残留（盘上还有明文）→ 出站剥离，照样不回传', async () => {
    writeJsonFile(MODELS_CONFIG_PATH, [embeddingFixture({ apiKey: 'sk-residual' })])

    registerEmbeddingController()
    const models = await call('embedding:list-models')

    expect((models as Array<Record<string, unknown>>)[0]).not.toHaveProperty('apiKey')
    expect(JSON.stringify(models)).not.toContain('sk-residual')
  })

  it('list-llm-candidates 同款剥离（它的值会被渲染层原样回传回来）', async () => {
    writeJsonFile(MODELS_CONFIG_PATH, [embeddingFixture({ purposes: ['generation'], apiKey: 'sk-residual' })])

    registerEmbeddingController()
    const models = await call('embedding:list-llm-candidates')

    expect(models).toHaveLength(1)
    expect(JSON.stringify(models)).not.toContain('sk-residual')
  })
})
