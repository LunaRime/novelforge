/**
 * llm-controller 密钥解析接线（模型管理 v3 T3 §4.4）—— 在**请求边界**上验证「ref 优先、明文回落」。
 *
 * 三个接线点：
 *  - `llm:generate` / `llm:generate-stream` —— 共用 `getModelConfig`（给 provider 前的唯一收口点）
 *  - `llm:test-connection` —— 收到的 profile 自带 ref（可能是账户派生条目）
 *  - `llm:list-provider-models` —— 入参带 `apiKeyRef` 时以凭据库为准
 *
 * 每处都**成对**断言：ref 命中 → 用凭据库的值；无 ref → 用明文。
 * 后者就是本任务「零行为变化」的那一半（此刻凭据库为空/无 ref，全走这一支）。
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

import { registerLLMController } from './llm-controller'
import { MODELS_CONFIG_PATH, writeJsonFile, __setConfigFilesForTest } from '../utils/config-utils'
import { trustWebContents, resetTrustedWebContentsForTest } from '../security/ipc-guard'
import { __setStoredForTest } from '../credentials/store'
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

function modelFixture(over: Partial<ModelProfile> = {}): ModelProfile {
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

  it('无 ref / ref 未配置 → provider 拿到条目上的明文（零行为变化的那一半）', async () => {
    writeJsonFile(MODELS_CONFIG_PATH, [modelFixture()])

    await call('llm:generate', { modelId: MODEL_ID, messages: MESSAGES })

    expect(h.seen.generate?.apiKey).toBe('sk-plain')
  })

  it('llm:generate-stream 走同一个收口点（核对一次，避免两条链路演化出分歧）', async () => {
    __setStoredForTest({ [REF]: 'sk-from-store' })
    writeJsonFile(MODELS_CONFIG_PATH, [modelFixture({ apiKeyRef: REF })])

    await call('llm:generate-stream', 'req-1', { modelId: MODEL_ID, messages: MESSAGES })
    // 流式是「返回后流仍在跑」的形态：等 provider 真正被调用（onDone 已同步发出，一两个 tick 内）
    await vi.waitFor(() => { expect(h.seen.generate?.apiKey).toBe('sk-from-store') })
  })
})

describe('llm:test-connection（收到的 profile 可能自带 ref）', () => {
  it('profile 带 ref → 用凭据库的值（表单里那片明文只作回落项）', async () => {
    __setStoredForTest({ [REF]: 'sk-from-store' })

    const res = await call('llm:test-connection', modelFixture({ apiKeyRef: REF }))

    expect(res).toEqual({ success: true, error: undefined })
    expect(h.seen.generate?.apiKey).toBe('sk-from-store')
  })

  it('profile 无 ref → 用 profile 里的明文（手输草稿仍可直接测试）', async () => {
    const res = await call('llm:test-connection', modelFixture())

    expect(res).toEqual({ success: true, error: undefined })
    expect(h.seen.generate?.apiKey).toBe('sk-plain')
  })
})

describe('llm:list-provider-models（入参可带 apiKeyRef）', () => {
  const base = { provider: 'openai', protocol: 'openai', baseUrl: 'https://api.example.com/v1' } as const

  it('入参带 ref → listModels 收到凭据库的值', async () => {
    __setStoredForTest({ [REF]: 'sk-from-store' })

    const res = await call('llm:list-provider-models', { ...base, apiKey: 'sk-plain', apiKeyRef: REF })

    expect(res).toEqual({ success: true, models: [{ id: 'candidate-1' }] })
    expect(h.seen.listModels?.apiKey).toBe('sk-from-store')
  })

  it('无 ref → 沿用入参明文（既有行为不变）', async () => {
    await call('llm:list-provider-models', { ...base, apiKey: 'sk-plain' })

    expect(h.seen.listModels?.apiKey).toBe('sk-plain')
  })

  it('无 ref 且明文为空 → 仍落「需要密钥」分支（空串回落不改既有错误路径）', async () => {
    const res = await call('llm:list-provider-models', { ...base, apiKey: '  ' })

    expect(res).toMatchObject({ success: false })
    expect(h.seen.listModels).toBeNull()
  })
})
