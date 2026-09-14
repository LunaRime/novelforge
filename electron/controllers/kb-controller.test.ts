/**
 * kb-controller — `kb:backfill-vectors` 的门控与降级语义（T4 / A4.2 + I2）
 *
 * 三个被锁定的行为：
 * ① **本地档可门控**：`localEmbedding.enabled=true` 且**无**远端 Embedding API 模型时，方式 1
 *    （`backfillVectors`）必须被调用 —— 改造前该分支被 `canUseEmbeddingAPI` 独占，
 *    「纯本地用户 + 存量库重建」这条主场景根本不可达；
 * ② **维度错误是终态**：方式 1 返回 `errorCode: 'dim-mismatch'` → **不进入**方式 2
 *    （方式 2 的 `updateChunkVectors` 写入路径遇混维会静默破坏数据）且原样透传该错误；
 * ③ **非维度错误仍降级**（回归锁）：网络/API 失败照旧落到方式 2。
 *
 * ⚠️ CI 一致性（ci-parity-standard）：本文件 import 到 electron → **必须 `vi.mock('electron')`**；
 *    `node:os` homedir 指向临时目录，绝不读写真实 `~/.novelforge`；better-sqlite3 编译目标为
 *    Electron ABI（vitest 为 Node ABI）→ mock `../database`。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'

// ===== mock 状态（vi.hoisted：模块工厂先于 import 求值）=====

const h = vi.hoisted(() => ({
  home: `${process.env.TEMP ?? process.env.TMP ?? process.cwd()}/nf-kb-ctl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  backfillVectors: vi.fn(),
  getVectorlessCount: vi.fn(),
  updateChunkVectors: vi.fn(),
  getConnection: vi.fn(),
  canUseLLMEmbedding: vi.fn(),
  embedBatchWithLLM: vi.fn(),
}))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  const homedir = () => h.home
  return { ...actual, homedir, default: { ...actual, homedir } }
})

vi.mock('better-sqlite3', () => ({ default: vi.fn() }))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      h.handlers.set(channel, fn)
    },
    removeHandler: vi.fn(),
  },
  dialog: { showOpenDialog: vi.fn() },
}))

vi.mock('../knowledge-base', () => ({
  importDocument: vi.fn(),
  importFolder: vi.fn(),
  importText: vi.fn(),
  searchKnowledge: vi.fn(),
  searchKnowledgeFTS: vi.fn(),
  listDocuments: vi.fn(),
  removeDocument: vi.fn(),
  getKnowledgeStats: vi.fn(),
  getVectorlessCount: h.getVectorlessCount,
  backfillVectors: h.backfillVectors,
  backfillTokens: vi.fn(),
}))

vi.mock('../embedding-service', () => ({
  embeddingService: {
    canUseLLMEmbedding: h.canUseLLMEmbedding,
    embedBatchWithLLM: h.embedBatchWithLLM,
  },
}))

vi.mock('../vector-store', () => ({
  getConnection: h.getConnection,
  updateChunkVectors: h.updateChunkVectors,
}))

vi.mock('../database', () => ({
  getProjectDb: () => ({}),
  getCurrentProjectPath: () => '/tmp/project-x',
}))

vi.mock('./fs-controller', () => ({
  grantDirectory: vi.fn(),
  grantExternalFile: vi.fn(),
}))

// 真实 logger 会往 `~/.novelforge/logs/` 写盘（本文件 homedir 已改为临时假 home → ENOENT）
// 且日志内容无断言 → 打桩
vi.mock('../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getLogDir: () => '' },
}))

import { GLOBAL_CONFIG_PATH, RECENT_PROJECTS_PATH, writeJsonFile } from '../utils/config-utils'
import { trustWebContents, resetTrustedWebContentsForTest } from '../security/ipc-guard'
import { registerKBController } from './kb-controller'

// ===== 测试脚手架 =====

const SENDER_ID = 11
const PROJECT = '/tmp/project-x'

const fakeEvent = {
  sender: { id: SENDER_ID, send: vi.fn() },
  senderFrame: { url: 'file:///app/index.html', parent: null },
}

type BackfillResult = { success: boolean; processed: number; failed: number; error?: string; errorCode?: string }

function invokeBackfill(): Promise<BackfillResult> {
  const fn = h.handlers.get('kb:backfill-vectors')
  if (!fn) throw new Error('通道未注册: kb:backfill-vectors')
  return Promise.resolve(fn(fakeEvent) as BackfillResult)
}

function setGlobalConfig(config: Record<string, unknown>): void {
  writeJsonFile(GLOBAL_CONFIG_PATH, config)
}

beforeAll(() => {
  registerKBController()
})

beforeEach(() => {
  vi.clearAllMocks()
  resetTrustedWebContentsForTest()
  trustWebContents(SENDER_ID)
  fs.rmSync(h.home, { recursive: true, force: true })

  // 当前项目：recent-projects[0]（getCurrentProjectPath 的数据源）
  writeJsonFile(RECENT_PROJECTS_PATH, [{ name: 'proj', path: PROJECT }])
  // 默认：无远端 Embedding API 模型（defaultModelId / defaultEmbeddingModelId 均缺失）
  setGlobalConfig({ theme: 'dark' })

  h.canUseLLMEmbedding.mockReturnValue(false)
  h.getVectorlessCount.mockResolvedValue({ count: 0 })
  h.backfillVectors.mockResolvedValue({ success: true, processed: 0, failed: 0 })
  h.updateChunkVectors.mockResolvedValue({ success: true, count: 0, failed: 0 })
})

afterEach(() => {
  fs.rmSync(h.home, { recursive: true, force: true })
})

// ===== 用例 =====

describe('A4.2 ②：维度不匹配是终态（不降级到方式 2）', () => {
  it('方式 1 返回 errorCode=dim-mismatch → 原样透传，且完全不进入方式 2/3', async () => {
    setGlobalConfig({ theme: 'dark', localEmbedding: { enabled: true } })
    h.canUseLLMEmbedding.mockReturnValue(true) // 方式 2 **可进入**（否则「未进入」是废话）
    const dimError: BackfillResult = {
      success: false,
      processed: 0,
      failed: 7,
      error: '向量维度不一致：知识库现有向量为 1536 维，本次生成 1024 维。',
      errorCode: 'dim-mismatch',
    }
    h.backfillVectors.mockResolvedValue(dimError)

    const res = await invokeBackfill()

    expect(res).toEqual(dimError) // 原样透传（不被方式 2/3 的结果替换）
    expect(h.updateChunkVectors).toHaveBeenCalledTimes(0) // ← 核心断言：不静默降级
    expect(h.getVectorlessCount).toHaveBeenCalledTimes(0) // 方式 2/3 都未进入
  })

  it('方式 1 返回维度的成功结果 → 同样直接返回（既有短路语义不变）', async () => {
    setGlobalConfig({ theme: 'dark', localEmbedding: { enabled: true } })
    h.backfillVectors.mockResolvedValue({ success: true, processed: 3, failed: 0 })

    await expect(invokeBackfill()).resolves.toEqual({ success: true, processed: 3, failed: 0 })
    expect(h.updateChunkVectors).toHaveBeenCalledTimes(0)
  })
})

describe('I2 ①：本地档开启 → 无远端 API 模型也走方式 1', () => {
  it('localEmbedding.enabled=true 且无 API 模型 → backfillVectors 被调 1 次（纯本地用户可达）', async () => {
    setGlobalConfig({ theme: 'dark', localEmbedding: { enabled: true, baseUrl: 'http://127.0.0.1:11500', model: 'nomic-embed-text' } })

    await invokeBackfill()

    expect(h.backfillVectors).toHaveBeenCalledTimes(1)
    // 无远端 API 配置时的传参（与 kb:import-* 既有约定一致：protocol 默认 openai、model 空配置）
    expect(h.backfillVectors).toHaveBeenCalledWith(PROJECT, 'openai', { baseUrl: '', apiKey: '' })
  })

  it('回归锁：localEmbedding 未启用且无 API 模型 → 方式 1 不进入（默认路径行为逐字不变）', async () => {
    h.canUseLLMEmbedding.mockReturnValue(false)

    const res = await invokeBackfill()

    expect(h.backfillVectors).toHaveBeenCalledTimes(0)
    // 方式 3：无可用的向量化方式 → FTS-only 明确错误
    expect(res.success).toBe(false)
    expect(res.error).toBeTruthy()
  })
})

describe('A4.2 ③（回归锁）：非维度错误仍按既有语义降级', () => {
  it('方式 1 网络失败（无 errorCode）→ 降级进入方式 2', async () => {
    setGlobalConfig({ theme: 'dark', localEmbedding: { enabled: true } })
    h.canUseLLMEmbedding.mockReturnValue(true)
    h.backfillVectors.mockResolvedValue({ success: false, processed: 0, failed: 0, error: 'fetch failed' })
    h.getVectorlessCount.mockResolvedValue({ count: 0 }) // 无需向量行 → 方式 2 直接报成功

    const res = await invokeBackfill()

    expect(h.getVectorlessCount).toHaveBeenCalledTimes(1) // 方式 2 已被进入
    expect(res).toEqual({ success: true, processed: 0, failed: 0 })
  })

  it('方式 2 真实写入路径可达：有缺向量行 → updateChunkVectors 被调 1 次（正面控制组）', async () => {
    setGlobalConfig({ theme: 'dark', localEmbedding: { enabled: true } })
    h.canUseLLMEmbedding.mockReturnValue(true)
    h.backfillVectors.mockResolvedValue({ success: false, processed: 0, failed: 0, error: 'fetch failed' })
    h.getVectorlessCount.mockResolvedValue({ count: 1 })
    h.getConnection.mockResolvedValue({
      openTable: async () => ({
        query: () => ({ select: () => ({ toArray: async () => [{ id: 'row-1', text: '无向量块' }] }) }),
      }),
    })
    h.embedBatchWithLLM.mockResolvedValue([{ vector: [0.1, 0.2, 0.3, 0.4] }])
    h.updateChunkVectors.mockResolvedValue({ success: true, count: 1, failed: 0 })

    const res = await invokeBackfill()

    expect(h.updateChunkVectors).toHaveBeenCalledTimes(1)
    expect(h.updateChunkVectors.mock.calls[0][1]).toEqual([{ id: 'row-1', vector: [0.1, 0.2, 0.3, 0.4] }])
    expect(res).toEqual({ success: true, processed: 1, failed: 0 })
  })
})
