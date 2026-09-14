/**
 * 查询改写端到端（L3 T5，真实 LanceDB + 真实 jieba 分词 + 真实 RRF 融合）
 *
 * 沙箱内无 Embedding API → 仅把 `generateEmbeddings` 换成**确定性 stub**：
 * 文本含哪些角色形态 → 对应维度置 1（不是对真实 embedding 的近似，只用于验证
 * 「扩展文本 → 语义通道输入 → 召回结果」这条链路是否真的改善召回）。
 *
 * 两个用例：
 * ① 别名 query 经扩展 → 召回只含**正名**的 chunk（扩展生效；无 characters 时为改造前行为）
 * ② 有/无 characters 时 **FTS-only 入口结果完全相同**（扩展不得进入 T3 的词级 AND 通道——
 *    并入变体等于增加 AND 约束，会把别名查询的召回清零；见 task-5-report.md §落点与语义选择）
 *
 * T3 追加（真实 LanceDB）：**向量维度硬校验端到端**——现有表向量维度 ≠ 待写维度 →
 * 拒绝且给出明确错误（提示重建索引），**不产生半写入**（表维度不被污染、既有同名文档不被破坏）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { searchKnowledge, searchKnowledgeFTS, importText, backfillVectors } from './knowledge-base'
import { addChunks, closeConnection, getStats, listDocuments, getChunksWithoutVectors } from './vector-store'

const h = vi.hoisted(() => ({
  db: null as unknown,
  currentProjectPath: null as string | null,
  embedCalls: [] as string[][],
  /** T3：stub 向量的维度（0 = 用检索用例的 5 维 stubEmbed）——模拟「换了 Embedding 模型」 */
  embedDim: 0,
  /** T3 R1：api 档失败开关（→ 降级 LLM 档，复现"LLM 结果含空向量"的可达形状） */
  apiShouldFail: false,
  llmEnabled: false,
  llmVectors: null as null | number[][],
  llmCalls: [] as string[][],
}))

vi.mock('./database', () => ({
  getProjectDb: () => h.db,
  getCurrentProjectPath: () => h.currentProjectPath,
}))

/** 形态维度（顺序固定）：苏晚 / 阿晚 / 晚儿 / 今天 */
const VARIANTS = ['苏晚', '阿晚', '晚儿', '今天']
function stubEmbed(text: string): number[] {
  return [...VARIANTS.map(v => (text.includes(v) ? 1 : 0)), 0.1]
}

vi.mock('./embedding', () => ({
  // T3 起 importText 也走本文件：真实 chunkText 换成分行 chunker（每个非空行一个块），
  // 保证「文本 → 块 → 向量 → 写入」链路可端到端断言（原 `() => []` 只服务检索用例）
  chunkText: (text: string) => text.split('\n').map(l => l.trim()).filter(l => l !== ''),
  generateEmbeddings: async (texts: string[]) => {
    h.embedCalls.push(texts)
    // T3 R1：api 档失败开关 → 降级到 LLM 档
    if (h.apiShouldFail) throw new Error('stub: api embedding unavailable')
    // T3：embedDim > 0 → 该维度常量向量（模拟本地 1024 维 / API 1536 维）；
    //    否则用 5 维 stubEmbed（检索用例）
    return texts.map(t => (h.embedDim > 0 ? new Array(h.embedDim).fill(0.1) : stubEmbed(t)))
  },
}))

/** T3 R1：LLM 档（`backfillVectors` 里**不过滤空向量**的档 —— R1 缺陷的入口） */
vi.mock('./embedding-service', () => ({
  embeddingService: {
    canUseLLMEmbedding: () => h.llmEnabled,
    embedBatchWithLLM: async (texts: string[]) => {
      h.llmCalls.push(texts)
      // 与真实 embedding-service 一致：单条失败合法返回 { vector: [] }
      return (h.llmVectors ?? texts.map(() => [0.1, 0.2, 0.3, 0.4])).map(vector => ({ vector }))
    },
  },
}))

/**
 * T3：本地档在测试环境恒不可用。
 *
 * 目的：**降级链行为不依赖宿主 config.json**——若开发机/CI 恰好开启了 `localEmbedding`，
 * 真实 `detectOllama` 会去探测 127.0.0.1:11434，用例行为将随环境漂移。此处桩死"本地不可用"
 * 后，四级链必然落到 api 档，断言与宿主配置无关（确定性）。
 */
vi.mock('./ollama-embedding', () => ({
  detectOllama: async () => ({ ok: false, error: 'stub: no local Ollama in tests' }),
  embedLocal: async () => { throw new Error('stub: no local Ollama in tests') },
}))

const MODEL = { baseUrl: '', apiKey: 'test-key' }

function makeTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nf-alias-'))
}

async function cleanupProject(projectPath: string): Promise<void> {
  await closeConnection(projectPath)
  fs.rmSync(projectPath, { recursive: true, force: true })
}

function makeCharactersDb(rows: Array<{ name: string; aliases: string }>): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec("CREATE TABLE characters (name TEXT PRIMARY KEY, aliases TEXT DEFAULT '[]')")
  const insert = db.prepare('INSERT INTO characters (name, aliases) VALUES (?, ?)')
  for (const r of rows) insert.run(r.name, r.aliases)
  return db
}

beforeEach(() => {
  h.db = null
  h.currentProjectPath = null
  h.embedCalls.length = 0
  h.embedDim = 0
  h.apiShouldFail = false
  h.llmEnabled = false
  h.llmVectors = null
  h.llmCalls.length = 0
})

describe('端到端：别名 query 召回含正名的 chunk（真实 LanceDB，L3 T5）', () => {
  /**
   * 显式 timeout（L3 T6 fix）：本文件是**真实 LanceDB** 端到端（建表 + 写入 + 迁移自检 + 双通道检索），
   * 默认 5s 在 CI/官方环境与并发负载下会抖（T6 门禁实测：并发跑时首例 > 5s 触发
   * "Test timed out in 5000ms"）。断言逐字未改，只放宽时限。
   */
  const E2E_TIMEOUT_MS = 30_000

  it('扩展生效：query 用别名「阿晚」→ 召回只含正名「苏晚」的 chunk；无 characters 时与改造前一致', async () => {
    const projectPath = makeTempProject()
    try {
      h.currentProjectPath = projectPath
      // 正名 chunk（只含 苏晚/晚儿/今天 形态）；对照 chunk 只含别名 阿晚
      const canonical = '苏晚（晚儿）今天在城墙上等待'
      const aliasOnly = '阿晚离开了'
      await addChunks(projectPath, randomUUID(), '第1章 正名.txt', [canonical], [stubEmbed(canonical)])
      await addChunks(projectPath, randomUUID(), '第2章 别名.txt', [aliasOnly], [stubEmbed(aliasOnly)])

      const query = '阿晚今天做了什么'

      // ① 基线 = 无 characters（改造前行为）：别名 query 只贴近别名 chunk
      h.db = null
      const before = await searchKnowledge(query, projectPath, 'openai', MODEL, 1)
      expect(before).toHaveLength(1)
      expect(before[0].text).toBe(aliasOnly)

      // ② 有 characters 别名注册表：query 扩展为「正名 + 别名」→ 语义通道召回含正名的 chunk
      h.db = makeCharactersDb([{ name: '苏晚', aliases: '["阿晚","晚儿"]' }])
      const after = await searchKnowledge(query, projectPath, 'openai', MODEL, 1)
      expect(after).toHaveLength(1)
      expect(after[0].text).toBe(canonical)
      // knowledge-base 声明的返回类型只含 3 键（source 由 vector-store 的 SearchResult 携带）→ 显式取用
      expect((after[0] as { source?: string }).source).toBe('vector')
      expect(Object.keys(after[0]).sort()).toEqual(['fileName', 'score', 'source', 'text'])

      // 语义通道输入确实被改写（词法通道不受影响 → 见下一个用例）
      expect(h.embedCalls).toEqual([[query], [`${query} 苏晚 晚儿`]])
    } finally {
      await cleanupProject(projectPath)
    }
  }, E2E_TIMEOUT_MS)

  it('回归守卫：有/无 characters 时 FTS-only 检索结果逐字相同（扩展不进 T3 的 AND 通道）', async () => {
    const projectPath = makeTempProject()
    try {
      h.currentProjectPath = projectPath
      const canonical = '苏晚（晚儿）今天在城墙上等待'
      const aliasOnly = '阿晚离开了'
      await addChunks(projectPath, randomUUID(), '第1章 正名.txt', [canonical], [stubEmbed(canonical)])
      await addChunks(projectPath, randomUUID(), '第2章 别名.txt', [aliasOnly], [stubEmbed(aliasOnly)])

      // 别名 query 在词级 AND 下命中只含别名的 chunk（非空，是本守卫有意义的前提）
      h.db = null
      const withoutCharacters = await searchKnowledgeFTS('阿晚', projectPath, 2)
      expect(withoutCharacters.map(r => r.text)).toEqual([aliasOnly])

      // 有 characters 且 query 命中别名：若把扩展并入 query 交给词法通道，
      // 词表会变成 [阿晚, 苏晚, 晚儿] → AND 要求 chunk 同时含三种形态 → 本用例将返回空
      h.db = makeCharactersDb([{ name: '苏晚', aliases: '["阿晚","晚儿"]' }])
      const withCharacters = await searchKnowledgeFTS('阿晚', projectPath, 2)
      expect(withCharacters).toEqual(withoutCharacters)
    } finally {
      await cleanupProject(projectPath)
    }
  }, E2E_TIMEOUT_MS)
})

/**
 * 向量维度硬校验端到端（T3 v1 必做，真实 LanceDB）
 *
 * 背景：本地 Ollama 模型（如 bge-m3 1024 维）与远程 Embedding API（1536 维）**不得**混入
 * 同一张 LanceDB 表——LanceDB 的 vector 列是 `FixedSizeList(dim)`，混维写入会污染/破坏整表。
 * 故写入前读现有表维度，不一致 → 明确拒绝（提示重建索引），**不静默降级、不半写入**。
 *
 * 用例覆盖 brief Step 1 B 三条 + 数据保护 + backfillVectors 同法接线。
 */
describe('向量维度硬校验端到端（T3，真实 LanceDB）', () => {
  const E2E_TIMEOUT_MS = 30_000

  /** 定维常量向量（值不重要，测的是维度契约） */
  const vec = (dim: number): number[] => new Array(dim).fill(0.1)

  /** 建一张「已有向量的表」：1536 或 1024 维，1 行 */
  async function seedTable(projectPath: string, dim: number, fileName = '第1章 已有.txt'): Promise<void> {
    await addChunks(projectPath, randomUUID(), fileName, ['已有块内容'], [vec(dim)])
  }

  it('现有 1536 维 → 以 1024 维写入 → 拒绝，错误明确并提示重建索引', async () => {
    const projectPath = makeTempProject()
    try {
      await seedTable(projectPath, 1536)
      h.embedDim = 1024

      const res = await importText('新文档正文内容', '新文档.txt', projectPath, 'openai', MODEL)

      expect(res.success).toBe(false)
      expect(res.error).toContain('1536')
      expect(res.error).toContain('1024')
      // 提示重建索引（i18n 文案，默认 locale = zh-CN）
      expect(res.error).toContain('重建')
      expect(res.docId).toBeUndefined()
    } finally {
      await cleanupProject(projectPath)
    }
  }, E2E_TIMEOUT_MS)

  it('拒绝时无半写入：表维度未被污染、无新增行、文档表无新记录', async () => {
    const projectPath = makeTempProject()
    try {
      await seedTable(projectPath, 1536)
      h.embedDim = 1024

      await importText('新文档正文内容', '新文档.txt', projectPath, 'openai', MODEL)

      const stats = await getStats(projectPath)
      expect(stats.vectorDimension).toBe(1536) // 维度未被 1024 覆盖
      expect(stats.totalChunks).toBe(1)        // 没有多出半写入的块
      expect((await listDocuments(projectPath)).map(d => d.fileName)).toEqual(['第1章 已有.txt'])
    } finally {
      await cleanupProject(projectPath)
    }
  }, E2E_TIMEOUT_MS)

  it('拒绝不破坏既有同名文档（删旧文档发生在校验之后——无「删了再失败」的数据丢失）', async () => {
    const projectPath = makeTempProject()
    try {
      h.embedDim = 1536
      const first = await importText('旧版正文', '同名.txt', projectPath, 'openai', MODEL)
      expect(first.success).toBe(true)

      h.embedDim = 1024
      const second = await importText('新版正文', '同名.txt', projectPath, 'openai', MODEL)
      expect(second.success).toBe(false)

      expect((await listDocuments(projectPath)).map(d => d.fileName)).toEqual(['同名.txt'])
      expect((await getStats(projectPath)).totalChunks).toBe(1) // 旧块仍在，未被清空
    } finally {
      await cleanupProject(projectPath)
    }
  }, E2E_TIMEOUT_MS)

  it('同维度（1024 → 1024）→ 放行写入成功', async () => {
    const projectPath = makeTempProject()
    try {
      await seedTable(projectPath, 1024)
      h.embedDim = 1024

      const res = await importText('新文档正文内容', '新文档.txt', projectPath, 'openai', MODEL)

      expect(res.success).toBe(true)
      expect(res.chunkCount).toBeGreaterThan(0)
      const stats = await getStats(projectPath)
      expect(stats.vectorDimension).toBe(1024)
      expect(stats.totalChunks).toBe(1 + (res.chunkCount ?? 0))
    } finally {
      await cleanupProject(projectPath)
    }
  }, E2E_TIMEOUT_MS)

  it('方向对称：现有 1024 维 → 以 1536 维写入 → 同样拒绝', async () => {
    const projectPath = makeTempProject()
    try {
      await seedTable(projectPath, 1024)
      h.embedDim = 1536

      const res = await importText('新文档正文内容', '新文档.txt', projectPath, 'openai', MODEL)

      expect(res.success).toBe(false)
      expect(res.error).toContain('1024')
      expect(res.error).toContain('1536')
      expect((await getStats(projectPath)).vectorDimension).toBe(1024)
    } finally {
      await cleanupProject(projectPath)
    }
  }, E2E_TIMEOUT_MS)

  it('backfillVectors：现有 1536 维 + 无向量行 → 以 1024 维回填 → 显式拒绝且表不变', async () => {
    const projectPath = makeTempProject()
    try {
      await seedTable(projectPath, 1536)
      // 无向量行（存量库重建的痛点场景：回填正是要处理这种行）
      await addChunks(projectPath, randomUUID(), '第2章 无向量.txt', ['无向量块'])
      expect((await getChunksWithoutVectors(projectPath)).count).toBe(1)

      h.embedDim = 1024 // 本地模型 1024 维 vs 表 1536 维
      const res = await backfillVectors(projectPath, 'openai', MODEL)

      expect(res.success).toBe(false)
      expect(res.processed).toBe(0)
      expect(res.error).toContain('1536')
      expect(res.error).toContain('1024')
      // T4 R1（M1）：`errorCode` 是 controller 判定「维度错误是终态、不得降级」的唯一依据，
      // 此前只有 kb-controller.test.ts 用 **mock 的** backfillVectors 覆盖 →
      // 这里在**真实模块 + 真实 LanceDB** 上锁住标记的真实产出链路（knowledge-base.ts:775-776）
      expect(res.errorCode).toBe('dim-mismatch')

      const stats = await getStats(projectPath)
      expect(stats.vectorDimension).toBe(1536) // 维度未被污染
      expect(stats.totalChunks).toBe(2)        // 表未被重建/丢行
      expect((await getChunksWithoutVectors(projectPath)).count).toBe(1)
    } finally {
      await cleanupProject(projectPath)
    }
  }, E2E_TIMEOUT_MS)

  it('backfillVectors：同维度（1536 → 1536）→ 回填成功（维度校验不阻断既有重建链）', async () => {
    const projectPath = makeTempProject()
    try {
      await seedTable(projectPath, 1536)
      await addChunks(projectPath, randomUUID(), '第2章 无向量.txt', ['无向量块'])

      h.embedDim = 1536
      const res = await backfillVectors(projectPath, 'openai', MODEL)

      expect(res.success).toBe(true)
      // 不断言 processed / failed 的确切值：`backfillVectors` 内部的缺向量扫描用
      // `!Array.isArray(r.vector)` 判定（Arrow Vector 行也被算作缺向量 → processed 偏大、
      // failed 可能算出负数），是既有行为、非本任务范围——断言真正的终点不变量
      expect((await getChunksWithoutVectors(projectPath)).count).toBe(0)
      expect((await getStats(projectPath)).vectorDimension).toBe(1536)
    } finally {
      await cleanupProject(projectPath)
    }
  }, E2E_TIMEOUT_MS)

  /**
   * T3 R1（reviewer I1）：LLM 档在 `backfillVectors` 里**不过滤空向量**，而
   * `embedding-service` 对失败项合法返回 `{ vector: [] }` → `vectors = [[], [1024…]]` 可达。
   * 若维度取自 `vectors[0].length`：真实 LanceDB 上既**拦不住真冲突**（守卫按 0 提前放行），
   * 同维度时也**照样炸**（schema 被构造成不带 vector 列 → `Found field not in schema: vector`）。
   */
  it('T3 R1：LLM 结果首位空向量（[[], 1024 维]）+ 表 1536 维 → 仍须以 i18n 文案拒绝且无半写入', async () => {
    const projectPath = makeTempProject()
    try {
      await seedTable(projectPath, 1536)
      // ⚠️ 必须有**待回填行**：无缺向量行时 backfillVectors 会提前 `{success:true, processed:0}` 返回，
      //    根本走不到守卫（本用例首版即因此假绿，已修）
      await addChunks(projectPath, randomUUID(), '第2章 无向量.txt', ['无向量块'])
      expect((await getChunksWithoutVectors(projectPath)).count).toBe(1)
      h.apiShouldFail = true // api 档失败 → 降级 LLM 档
      h.llmEnabled = true
      h.llmVectors = [[], new Array(1024).fill(0.1)]

      const res = await backfillVectors(projectPath, 'openai', MODEL)

      expect(res.success).toBe(false)
      expect(res.error).toContain('1536')
      expect(res.error).toContain('1024')

      const stats = await getStats(projectPath)
      expect(stats.vectorDimension).toBe(1536) // 维度未被污染
      expect(stats.totalChunks).toBe(2)        // 表未被重建/丢行
      expect((await getChunksWithoutVectors(projectPath)).count).toBe(1)
    } finally {
      await cleanupProject(projectPath)
    }
  }, E2E_TIMEOUT_MS)

  it('T3 R1：LLM 结果首位空向量 + 同维度（表 4 维 / [[], [1,2,3,4]]）→ 落库成功（schema 带 vector 列）', async () => {
    const projectPath = makeTempProject()
    try {
      await addChunks(projectPath, randomUUID(), '第1章 四维.txt', ['四维块'], [vec(4)])
      await addChunks(projectPath, randomUUID(), '第2章 无向量.txt', ['无向量块'])
      h.apiShouldFail = true
      h.llmEnabled = true
      h.llmVectors = [[], [1, 2, 3, 4]]

      const res = await backfillVectors(projectPath, 'openai', MODEL)

      expect(res.success).toBe(true)
      expect((await getStats(projectPath)).vectorDimension).toBe(4)
      expect((await getChunksWithoutVectors(projectPath)).count).toBe(0)
    } finally {
      await cleanupProject(projectPath)
    }
  }, E2E_TIMEOUT_MS)
})
