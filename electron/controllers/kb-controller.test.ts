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
 * T3b R1（I1）追加 —— **查询侧同一类缺陷**：
 * `kb:search` / `kb:search-with-scope` 原先只在 `getEmbeddingConfig()` 非 null 时进
 * `searchKnowledge`，否则落 `searchKnowledgeFTS`（其内部硬编码 `queryVector: undefined`）→
 * 「纯本地用户（local 启用 + 无远端模型）」在检索侧走不到模块层的降级链，开关不可观察。
 * 现锁定：本地档开启即可放行；远端配置优先（本地只作为**追加**放行条件）；两者皆无仍走 FTS。
 *
 * ⚠️ CI 一致性（ci-parity-standard）：本文件 import 到 electron → **必须 `vi.mock('electron')`**；
 *    `node:os` homedir 指向临时目录，绝不读写真实 `~/.novelforge`；better-sqlite3 编译目标为
 *    Electron ABI（vitest 为 Node ABI）→ mock `../database`。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import type { ModelProfile } from '../../src/shared/ipc-channels'

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
  // T3b R1（I1）：查询 handler 的两个出口（模块已被 mock，这里是唯一的观测点）
  searchKnowledge: vi.fn(),
  searchKnowledgeFTS: vi.fn(),
  /**
   * Final wave W7/T4-M2 专用：方式 2 读取的「缺向量行」集合。
   * null（默认）→ 沿用下面的固定单行桩；给值 → 用本值（用于注入「空向量行」等形状）。
   * 让 `[vector]` 这类**正交**维度在 W7 用例里可直接摆出，而不必借道无关的计数变化。
   */
  rowsForLlm: null as null | Array<{ id: string; text: string; vector?: number[] }>,
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
  searchKnowledge: h.searchKnowledge,
  searchKnowledgeFTS: h.searchKnowledgeFTS,
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

import { GLOBAL_CONFIG_PATH, MODELS_CONFIG_PATH, RECENT_PROJECTS_PATH, writeJsonFile } from '../utils/config-utils'
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
type SearchHit = { text: string; score: number; fileName: string }

function invokeBackfill(): Promise<BackfillResult> {
  const fn = h.handlers.get('kb:backfill-vectors')
  if (!fn) throw new Error('通道未注册: kb:backfill-vectors')
  return Promise.resolve(fn(fakeEvent) as BackfillResult)
}

/** T3b R1（I1）：`kb:search` handler 的调用入口 */
function invokeSearch(query: string, topK?: number): Promise<SearchHit[]> {
  const fn = h.handlers.get('kb:search')
  if (!fn) throw new Error('通道未注册: kb:search')
  return Promise.resolve(fn(fakeEvent, query, topK) as SearchHit[])
}

/** T3b R1（I1）：`kb:search-with-scope` handler 的调用入口 */
function invokeSearchScoped(query: string, fromChapter: number, toChapter: number, topK?: number): Promise<SearchHit[]> {
  const fn = h.handlers.get('kb:search-with-scope')
  if (!fn) throw new Error('通道未注册: kb:search-with-scope')
  return Promise.resolve(fn(fakeEvent, query, fromChapter, toChapter, topK) as SearchHit[])
}

const REMOTE_MODEL_ID = 'emb-remote-1'

function setGlobalConfig(config: Record<string, unknown>): void {
  writeJsonFile(GLOBAL_CONFIG_PATH, config)
}

/** 打开本地档（无远端模型）：T4 定义的「纯本地用户」形态 */
function enableLocalOnly(): void {
  setGlobalConfig({ theme: 'dark', localEmbedding: { enabled: true, baseUrl: 'http://127.0.0.1:11434', model: 'bge-m3' } })
}

/** 配置一个可用的远端 Embedding 模型（defaultEmbeddingModelId + models.json 条目） */
function setRemoteEmbeddingModel(): void {
  const profile: ModelProfile = {
    id: REMOTE_MODEL_ID,
    name: 'Remote Embedding',
    provider: 'openai',
    protocol: 'openai',
    modelName: 'text-embedding-3-small',
    apiKey: 'sk-plain-key', // 明文（无 ENC: 前缀）→ decryptApiKey 原样返回
    baseUrl: 'https://api.example.com/v1',
    temperature: 0,
    maxTokens: 0,
    purposes: ['embedding'],
  }
  writeJsonFile(MODELS_CONFIG_PATH, [profile])
  setGlobalConfig({ theme: 'dark', defaultEmbeddingModelId: REMOTE_MODEL_ID })
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
  h.rowsForLlm = null

  // T3b R1（I1）：查询出口的返回值（透传断言用）
  h.searchKnowledge.mockResolvedValue([{ text: '语义命中', score: 0.9, fileName: 'a.txt' }])
  h.searchKnowledgeFTS.mockResolvedValue([{ text: '词法命中', score: 0.5, fileName: 'b.txt' }])
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

  // T4 R1（M2）：方式 2 曾丢弃 updateChunkVectors 的 error/count → 具体错误（含「重建索引」指引）
  // 被泛化文案 kb.llmWriteFailed 顶掉，且 processed 把「没写进去」算成成功。
  it('方式 2 写入被拒 → 透传具体 error（非 kb.llmWriteFailed）与真实计数', async () => {
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
    const specific = '向量维度不一致：知识库现有向量为 1536 维，本次生成 1024 维。…请重建知识库索引…'
    h.updateChunkVectors.mockResolvedValue({ success: false, count: 0, failed: 1, error: specific })

    const res = await invokeBackfill()

    expect(res.success).toBe(false)
    expect(res.error).toBe(specific) // 具体错误原样透传（旧写法恒为 kb.llmWriteFailed）
    expect(res.processed).toBe(0)
    expect(res.failed).toBe(1) // vectorless.length(1) - 真实写入数(0)
  })
})

// ============================================================
// Final wave W7 / T4-M2：方式 2 计数的**判别**用例
//
// 背景：T4 R1 把方式 2 的计数改成「processed = 真正写成功数、failed 含空向量行」，
// 但原用例 fixture 是 `N=1,U=1,E=0,res.count=0`（N=缺向量行数、U=push 进 updates 的行数、
// E=拿到空向量未进 updates 的行数、res.count=真实写入成功数）—— 该形态下
// `processed`/`failed` 在**新旧两版代码上取值相同**（processed=0、failed=1），
// 故这次修复本身**没有被判别**；而「部分成功」分支（`processed = res.count`、
// `failed += U - res.count`）与原「空向量行计入 failed」在这次修复前**零用例**。
// 下面两条把这两处补成有判别力的形状。
// ============================================================

describe('W7/T4-M2：方式 2 计数（部分成功 / 空向量行）', () => {
  /** 进入方式 2 的公共前置：方式 1 失败且无 errorCode、LLM 可用 */
  function enterMethod2(rows: Array<{ id: string; text: string; vector?: number[] }>): void {
    setGlobalConfig({ theme: 'dark', localEmbedding: { enabled: true } })
    h.canUseLLMEmbedding.mockReturnValue(true)
    h.backfillVectors.mockResolvedValue({ success: false, processed: 0, failed: 0, error: 'fetch failed' })
    h.getVectorlessCount.mockResolvedValue({ count: rows.length })
    h.rowsForLlm = rows
    h.getConnection.mockResolvedValue({
      openTable: async () => ({
        query: () => ({ select: () => ({ toArray: async () => h.rowsForLlm }) }),
      }),
    })
  }

  it('部分成功：N=2,U=2 其中 1 行未写成功 → processed===1 && failed===1（旧码报 2/0）', async () => {
    enterMethod2([
      { id: 'row-1', text: '块1' },
      { id: 'row-2', text: '块2' },
    ])
    // 两行都拿到非空向量 → U=2
    h.embedBatchWithLLM.mockResolvedValue([{ vector: [0.1, 0.2, 0.3, 0.4] }, { vector: [0.5, 0.6, 0.7, 0.8] }])
    // 真实写入只成功 1 行（LanceDB `rowsUpdated` 未命中第 2 行）
    h.updateChunkVectors.mockResolvedValue({ success: true, count: 1, failed: 1 })

    const res = await invokeBackfill()

    expect(h.updateChunkVectors.mock.calls[0][1]).toHaveLength(2) // U=2 确实全推给了写入层
    expect(res.success).toBe(true)                                 // 部分成功仍是成功
    expect(res.processed).toBe(1) // = res.count（旧码是 updates.length = 2）
    expect(res.failed).toBe(1)    // = U - res.count（旧码恒 0）
    expect(res.processed + res.failed).toBe(2) // 与 N 相等（不漏计）
  })

  it('空向量行：E=1 未进入 updates → 计入 failed，且 processed 只有真实写入的 1 行', async () => {
    enterMethod2([
      { id: 'row-1', text: '块1', vector: [] }, // 空向量行（vectorless 扫描命中）
      { id: 'row-2', text: '块2' },
    ])
    // row-1 拿到空向量（LLM 对失败项合法返回 {vector: []}）→ E=1；row-2 拿到非空 → U=1
    h.embedBatchWithLLM.mockResolvedValue([{ vector: [] }, { vector: [0.1, 0.2, 0.3, 0.4] }])
    h.updateChunkVectors.mockResolvedValue({ success: true, count: 1, failed: 0 })

    const res = await invokeBackfill()

    // 唯一进写入层的只有 row-2（空向量行被 `results[i].vector.length > 0` 挡下）
    expect(h.updateChunkVectors.mock.calls[0][1]).toEqual([{ id: 'row-2', vector: [0.1, 0.2, 0.3, 0.4] }])
    expect(res.success).toBe(true)
    expect(res.processed).toBe(1)
    expect(res.failed).toBe(1) // = E(1) + (U - res.count)(0)：空向量行如实计入
    expect(res.processed + res.failed).toBe(2)
  })
})

// ============================================================
// T3b R1（I1）：查询 handler 的门控 —— 纯本地用户在**检索侧**必须可达
//
// 模块层（`knowledge-base.ts`）在 T3b 已能按降级链取本地查询向量，但 IPC 门控
// （`if (embConfig)`）在无远端 Embedding 模型时直接把用户导向 `searchKnowledgeFTS`
// （其内部硬编码 `queryVector: undefined`）→ 开关在检索侧依然不可观察。
// 与 T4/A4.2 修好的回填侧门控（`canUseLocal || canUseEmbeddingAPI`）是同一类缺陷。
// ============================================================

describe('T3b R1（I1）：kb:search 门控放行纯本地用户', () => {
  it('local 启用 + 无远端模型 → 进 searchKnowledge（1 次、入参正确），不进 FTS-only 入口', async () => {
    enableLocalOnly()

    const res = await invokeSearch('阿晚今天做了什么')

    expect(h.searchKnowledge).toHaveBeenCalledTimes(1)
    // 无远端配置时的传参：与 kb:import-* / kb:backfill-vectors 既有约定一致（protocol 默认 openai、model 空配置）
    expect(h.searchKnowledge).toHaveBeenCalledWith('阿晚今天做了什么', PROJECT, 'openai', { baseUrl: '', apiKey: '' }, 5)
    expect(h.searchKnowledgeFTS).toHaveBeenCalledTimes(0) // ← 核心断言：不被静默导向 FTS
    expect(res).toEqual([{ text: '语义命中', score: 0.9, fileName: 'a.txt' }]) // 结果原样透传
  })

  it('回归锁：local 未启用 + 无远端模型 → 仍走 searchKnowledgeFTS（默认路径逐字不变）', async () => {
    const res = await invokeSearch('阿晚今天做了什么')

    expect(h.searchKnowledgeFTS).toHaveBeenCalledTimes(1)
    expect(h.searchKnowledgeFTS).toHaveBeenCalledWith('阿晚今天做了什么', PROJECT, 5)
    expect(h.searchKnowledge).toHaveBeenCalledTimes(0)
    expect(res).toEqual([{ text: '词法命中', score: 0.5, fileName: 'b.txt' }])
  })

  it('远端模型优先：有远端配置时逐字沿用远端参数（local 开不开都不影响）', async () => {
    setRemoteEmbeddingModel()
    // 远端 + 本地同时可用 → 必须仍用远端参数（local 只是**追加**放行条件，不改既有路径）
    setGlobalConfig({
      theme: 'dark',
      defaultEmbeddingModelId: REMOTE_MODEL_ID,
      localEmbedding: { enabled: true, baseUrl: 'http://127.0.0.1:11434', model: 'bge-m3' },
    })

    await invokeSearch('阿晚今天做了什么', 3)

    expect(h.searchKnowledge).toHaveBeenCalledTimes(1)
    // 远端参数原样透传（含 modelName）；不是本地档的空配置
    expect(h.searchKnowledge).toHaveBeenCalledWith('阿晚今天做了什么', PROJECT, 'openai',
      { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-plain-key', modelName: 'text-embedding-3-small' }, 3)
    expect(h.searchKnowledgeFTS).toHaveBeenCalledTimes(0)
  })
})

describe('T3b R1（I1）：kb:search-with-scope 门控放行纯本地用户', () => {
  it('local 启用 + 无远端模型 → 进 searchKnowledge（1 次、chapterScope 原样透传）', async () => {
    enableLocalOnly()

    const res = await invokeSearchScoped('阿晚', 1, 5, 3)

    expect(h.searchKnowledge).toHaveBeenCalledTimes(1)
    expect(h.searchKnowledge).toHaveBeenCalledWith('阿晚', PROJECT, 'openai', { baseUrl: '', apiKey: '' }, 3, [1, 5])
    expect(h.searchKnowledgeFTS).toHaveBeenCalledTimes(0)
    expect(res).toEqual([{ text: '语义命中', score: 0.9, fileName: 'a.txt' }])
  })

  it('回归锁：local 未启用 + 无远端模型 → 仍走 searchKnowledgeFTS（scope 原样透传）', async () => {
    await invokeSearchScoped('阿晚', 1, 5, 3)

    expect(h.searchKnowledgeFTS).toHaveBeenCalledTimes(1)
    expect(h.searchKnowledgeFTS).toHaveBeenCalledWith('阿晚', PROJECT, 3, [1, 5])
    expect(h.searchKnowledge).toHaveBeenCalledTimes(0)
  })
})
