/**
 * 查询改写（角色别名扩展，L3 T5）测试 —— 纯函数 + 检索入口接线
 *
 * 三个层次：
 * ① 纯函数 `rewriteQuery` / `buildCharacterAliasMap`（零 IO）
 * ② 检索入口接线（mock 项目 DB + mock 检索/向量层）：扩展文本进**语义通道**、词法通道输入不变、
 *    各类失败降级零损失
 * ③ 真实 LanceDB 端到端：`electron/knowledge-base.e2e.test.ts`
 *
 * T3 追加（降级链四级 + 维度硬校验）：
 * ④ `importContent` / `backfillVectors` 的**降级链调用序列**（mock 各档，断言顺序/短路/降级）
 * ⑤ 维度硬校验的接线与「不写入/不删旧文档」（mock 维度读取；真实 LanceDB 见 e2e 文件）
 *
 * ⚠️ better-sqlite3 编译目标为 Electron ABI，vitest（Node ABI）无法加载 → mock `./database`
 *    （与 `electron/repositories/character-repository.test.ts` 同法，用 node:sqlite 内存库）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tokenize } from './chinese-tokenizer'
import { logger } from './utils/logger'
import { GLOBAL_CONFIG_PATH, writeJsonFile } from './utils/config-utils'
import {
  rewriteQuery,
  buildCharacterAliasMap,
  searchKnowledge,
  searchKnowledgeFTS,
  importText,
  backfillVectors,
  assertVectorDimCompatible,
} from './knowledge-base'

// ===== mock 状态（vi.hoisted：模块工厂先于 import 求值） =====

const h = vi.hoisted(() => ({
  /**
   * 临时假 home（T4/A4.3）：`readLocalEmbeddingConfig` 已从 knowledge-base 下沉到 config-utils，
   * 其内部读的是**模块级 GLOBAL_CONFIG_PATH**（拦截导出的 readJsonFile 影响不到它）→
   * 用假 home 把真实路径重定向到临时目录，测的就是**真实读取实现**。
   */
  home: `${process.env.TEMP ?? process.env.TMP ?? process.cwd()}/nf-kb-localcfg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  searchCalls: [] as Array<{
    projectPath: string
    query: string
    queryVector?: number[]
    topK: number
    chapterScope?: [number, number]
  }>,
  searchResults: [] as Array<{ text: string; score: number; fileName: string; source?: 'vector' | 'fts' }>,
  embedCalls: [] as string[][],
  embedVector: [1, 0, 0, 1] as number[],
  embedShouldFail: false,
  db: null as unknown,
  currentProjectPath: null as string | null,

  // ===== T3：降级链 + 维度硬校验 =====
  /** importContent 的分块实现（默认 null → `() => []`，保持既有检索用例行为不变） */
  chunkTextImpl: null as null | ((text: string) => string[]),
  /** API 档返回值（null → 既有 embedVector 4 维）；用于指定维度 */
  apiVectors: null as null | number[][],
  /** 本地档探测结果 / 向量化结果 / 是否 throw（可指定抛出的错误形态） */
  localDetectOk: true,
  localEmbedShouldFail: false,
  localEmbedError: null as Error | null,
  localVectors: null as null | number[][],
  /** LLM 档：canUseLLMEmbedding 返回值 + 调用计数 */
  llmEnabled: false,
  llmCanUseCalls: 0,
  llmVectors: null as null | number[][],
  /** 现有表向量维度（0 = 无表/无向量列） */
  existingDim: 0,
  /** 维度读取次数（用于锁定「仅在确有向量写入时才读表」） */
  dimReadCalls: 0,
  /** 调用记录 */
  addChunksCalls: [] as Array<{
    projectPath: string
    docId: string
    fileName: string
    chunks: string[]
    vectors?: number[][]
  }>,
  removeDocCalls: [] as string[],
  /** 已导入文档（驱动 importContent 的「删同名旧文档」分支；默认空 = 不触发） */
  existingDocs: [] as Array<{ id: string; fileName: string; importedAt: string; chunkCount: number; filePath: string }>,
  detectCalls: [] as string[],
  localEmbedCalls: [] as string[][],
  llmCalls: [] as string[][],
  /** backfillVectors 的假库写入记录（应保持为空 = 无半写入） */
  dbWrites: [] as string[],
  /** backfillVectors 待回填行（缺向量扫描 + 全表读取；后者含"回填目标行"） */
  backfillRows: [{ id: 'row-1', text: '无向量块', vector: null as unknown }],
  backfillFullRows: [{ id: 'row-1', text: '无向量块', vector: null as unknown }],
  vectorlessCount: 0,
}))

vi.mock('./database', () => ({
  getProjectDb: () => h.db,
  getCurrentProjectPath: () => h.currentProjectPath,
}))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  const homedir = () => h.home
  return { ...actual, homedir, default: { ...actual, homedir } }
})

vi.mock('./vector-store', () => ({
  searchWithScope: async (
    projectPath: string,
    query: string,
    queryVector?: number[],
    topK = 5,
    chapterScope?: [number, number],
  ) => {
    h.searchCalls.push({ projectPath, query, queryVector, topK, chapterScope })
    return h.searchResults
  },
  // knowledge-base 顶层 import 的其余符号（检索用例不触发，仅为模块图完整 / T3 链用例使用）
  addChunks: async (
    projectPath: string,
    docId: string,
    fileName: string,
    chunks: string[],
    vectors?: number[][],
  ) => {
    h.addChunksCalls.push({ projectPath, docId, fileName, chunks, vectors })
    return { success: true, chunkCount: chunks.length }
  },
  removeDocument: async (_projectPath: string, docId: string) => {
    h.removeDocCalls.push(docId)
    return true
  },
  listDocuments: async () => h.existingDocs,
  getStats: async () => ({ documentCount: 0, totalChunks: 0, vectorDimension: 0, hasVectors: false }),
  migrateFromJSON: async () => ({ success: true, migrated: 0 }),
  getChunksWithoutVectors: async () => ({ count: h.vectorlessCount }),
  backfillTokens: async () => ({ success: true, processed: 0, failed: 0 }),
  // T3 维度校验：现有表维度（0 = 首建放行）
  getChunksTableVectorDim: async () => {
    h.dimReadCalls++
    return h.existingDim
  },
  // T3 backfillVectors 需要的假连接（断言点：createTable/dropTable 未被调用 = 无半写入）
  getConnection: async () => {
    // 第 1 次 query = 缺向量行扫描；之后 = 全表读取（重建用）——与真实调用序一致
    let queryCount = 0
    const makeChain = (rows: Array<{ id: string; text: string; vector: unknown }>) => {
      const chain: {
        select: () => unknown
        limit: () => unknown
        toArray: () => Promise<Array<{ id: string; text: string; vector: unknown }>>
      } = {
        select: () => chain,
        limit: () => chain,
        toArray: async () => rows,
      }
      return chain
    }
    return {
      tableNames: async () => ['chunks'],
      openTable: async () => ({
        schema: async () => ({
          fields: [
            { name: 'id', type: {} },
            { name: 'text', type: {} },
            { name: 'vector', type: { listSize: h.existingDim } },
          ],
        }),
        query: () => {
          queryCount++
          return makeChain(queryCount === 1 ? h.backfillRows : h.backfillFullRows)
        },
        countRows: async () => h.backfillFullRows.length,
        createIndex: async () => { h.dbWrites.push('createIndex') },
      }),
      createTable: async (
        name: string,
        rows: Array<Record<string, unknown>>,
        opts?: { schema?: { fields: Array<{ name: string }> } },
      ) => {
        h.dbWrites.push(`create:${name}`)
        // 忠实模拟 LanceDB 的 schema 契约（reviewer I1 实测原文：`Found field not in schema: vector at row 0`）：
        // schema 里没有 vector 列、数据却带 vector → 真实 LanceDB 抛错。假库不做这个校验的话，
        // 「VECTOR_DIM 读成 0 → 构造出无 vector 列的 schema」这条缺陷在单测里会静默通过。
        const hasVectorField = opts?.schema?.fields.some(f => f.name === 'vector') ?? false
        if (!hasVectorField && rows.some(r => r.vector !== undefined && r.vector !== null)) {
          throw new Error('Found field not in schema: vector at row 0')
        }
      },
      dropTable: async (name: string) => { h.dbWrites.push(`drop:${name}`) },
    }
  },
}))

vi.mock('./embedding', () => ({
  // T3：importContent 的分块（默认空，保持既有检索用例零影响）
  chunkText: (text: string) => (h.chunkTextImpl ? h.chunkTextImpl(text) : []),
  generateEmbeddings: async (texts: string[]) => {
    h.embedCalls.push(texts)
    if (h.embedShouldFail) throw new Error('embedding unavailable')
    return h.apiVectors ?? texts.map(() => h.embedVector)
  },
  fetchWithTimeout: async () => { throw new Error('fetchWithTimeout not used in this test') },
}))

/** T3：本地档（Ollama）——真实模块只做 fetch，测试里全部桩死以便断言调用序列 */
vi.mock('./ollama-embedding', () => ({
  detectOllama: async (baseUrl: string) => {
    h.detectCalls.push(baseUrl)
    return h.localDetectOk ? { ok: true, version: '0.6.0' } : { ok: false, error: 'connect ECONNREFUSED' }
  },
  embedLocal: async (texts: string[]) => {
    h.localEmbedCalls.push(texts)
    if (h.localEmbedShouldFail) {
      // T2 交接：错误串为**英文**（不得直接当 UI 文案）；网络不可用时为 raw TypeError('fetch failed')
      throw h.localEmbedError ?? new Error('Ollama /api/embed failed: HTTP 500')
    }
    return h.localVectors ?? texts.map(() => [0.1, 0.2, 0.3])
  },
}))

/** T3：LLM 档（embedding-service，importContent/backfillVectors 内均为动态 import） */
vi.mock('./embedding-service', () => ({
  embeddingService: {
    canUseLLMEmbedding: () => {
      h.llmCanUseCalls++
      return h.llmEnabled
    },
    embedBatchWithLLM: async (texts: string[]) => {
      h.llmCalls.push(texts)
      return (h.llmVectors ?? texts.map(() => [0.5, 0.5])).map(vector => ({ vector }))
    },
  },
}))

/**
 * T4/A4.3：全局配置改为**真实落盘**到假 home 的 config.json（不再拦截 readJsonFile 导出）——
 * `readLocalEmbeddingConfig` 现在住在 config-utils 内部，直接读真实 GLOBAL_CONFIG_PATH。
 * 每个用例前由 beforeEach 删除该文件（默认 = 无 localEmbedding 字段）。
 */
function setGlobalConfig(config: Record<string, unknown>): void {
  writeJsonFile(GLOBAL_CONFIG_PATH, config)
}

// ===== 测试夹具 =====

const PROJECT = 'C:\\nf-test-project'
const OTHER_PROJECT = 'C:\\nf-other-project'
const MODEL = { baseUrl: '', apiKey: 'test-key' }

/** 内存 characters 表（只有本任务需要的 name + v14 aliases 两列） */
function makeCharactersDb(rows: Array<{ name: string; aliases: string }>): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec("CREATE TABLE characters (name TEXT PRIMARY KEY, aliases TEXT DEFAULT '[]')")
  const insert = db.prepare('INSERT INTO characters (name, aliases) VALUES (?, ?)')
  for (const r of rows) insert.run(r.name, r.aliases)
  return db
}

/** 无 characters 表的库（旧库 / 极端情况） */
function makeDbWithoutCharacters(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE project_core (id INTEGER PRIMARY KEY)')
  return db
}

beforeEach(() => {
  h.searchCalls.length = 0
  h.searchResults.length = 0
  h.embedCalls.length = 0
  h.embedShouldFail = false
  h.db = null
  h.currentProjectPath = PROJECT

  // T3
  h.chunkTextImpl = null
  h.apiVectors = null
  h.localDetectOk = true
  h.localEmbedShouldFail = false
  h.localEmbedError = null
  h.localVectors = null
  h.llmEnabled = false
  h.llmCanUseCalls = 0
  h.llmVectors = null
  h.existingDim = 0
  h.dimReadCalls = 0
  fs.rmSync(GLOBAL_CONFIG_PATH, { force: true }) // 每个用例从「无 localEmbedding 字段」开始
  h.existingDocs = []
  h.addChunksCalls.length = 0
  h.removeDocCalls.length = 0
  h.detectCalls.length = 0
  h.localEmbedCalls.length = 0
  h.llmCalls.length = 0
  h.dbWrites.length = 0
  h.vectorlessCount = 0
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ===== ① 纯函数 =====

describe('rewriteQuery（L3 T5，纯函数）', () => {
  const map = new Map<string, string[]>([['苏晚', ['阿晚', '晚儿']]])

  it('brief 场景：query 命中别名 → 并入正名 + 其余别名（空格拼接）', () => {
    const query = '阿晚今天做了什么'
    const out = rewriteQuery(query, map)
    expect(out).toBe('阿晚今天做了什么 苏晚 晚儿')
    expect(out.startsWith(query)).toBe(true)
    expect(out).toContain('苏晚')
    expect(out).toContain('晚儿')
  })

  it('query 命中正名 → 并入其全部别名', () => {
    expect(rewriteQuery('苏晚的剑在哪里', map)).toBe('苏晚的剑在哪里 阿晚 晚儿')
  })

  it('无角色名命中 → 逐字原样返回', () => {
    const query = '今天天气不错'
    expect(rewriteQuery(query, map)).toBe(query)
  })

  it('空 aliasMap / 空 query / 纯空白 query → 原样返回', () => {
    expect(rewriteQuery('阿晚', new Map())).toBe('阿晚')
    expect(rewriteQuery('', map)).toBe('')
    expect(rewriteQuery('   ', map)).toBe('   ')
  })

  it('query 已含全部形态 → 原样（不重复并入；扩展幂等）', () => {
    const query = '苏晚和阿晚还有晚儿都在'
    expect(rewriteQuery(query, map)).toBe(query)
    expect(rewriteQuery(rewriteQuery(query, map), map)).toBe(query)
  })

  it('扩展结果可被 T1 分词回读：正名/别名成为独立词，不与原 query 粘连', () => {
    const words = tokenize(rewriteQuery('阿晚今天做了什么', map))
    expect(words).toContain('苏晚')
    expect(words).toContain('阿晚')
    expect(words).toContain('晚儿')
  })

  it('多角色命中 → 各自并入（map 顺序）；同输入同输出（确定性）', () => {
    const two = new Map<string, string[]>([['苏晚', ['阿晚']], ['林动', ['动哥']]])
    const out = rewriteQuery('苏晚和林动', two)
    expect(out).toBe('苏晚和林动 阿晚 动哥')
    expect(rewriteQuery('苏晚和林动', two)).toBe(out)
  })

  it('单字变体只在分词 token 精确相等时命中（防子串误命中：不为「云海」扩展「云」）', () => {
    const single = new Map<string, string[]>([['云', ['阿云']]])
    expect(rewriteQuery('云海之上', single)).toBe('云海之上')
    expect(rewriteQuery('云，你好', single)).toBe('云，你好 阿云')
  })

  it('aliasMap 值非数组（脏 map）→ 不抛、不扩展', () => {
    const dirty = new Map<string, string[]>([['苏晚', '阿晚' as unknown as string[]]])
    expect(() => rewriteQuery('苏晚的剑', dirty)).not.toThrow()
    expect(rewriteQuery('苏晚的剑', dirty)).toBe('苏晚的剑')
  })

  it('别名解析失败的字符不参与扩展（query 原样）', () => {
    const broken = buildCharacterAliasMap([{ name: '苏晚', aliases: '不是JSON' }])
    expect(rewriteQuery('阿晚今天做了什么', broken)).toBe('阿晚今天做了什么')
  })
})

describe('buildCharacterAliasMap（characters v14 aliases → aliasMap，纯函数）', () => {
  it('正常解析：name + aliases JSON 数组', () => {
    const map = buildCharacterAliasMap([
      { name: '苏晚', aliases: '["阿晚","晚儿"]' },
      { name: '林动', aliases: '[]' },
    ])
    expect(map.get('苏晚')).toEqual(['阿晚', '晚儿'])
    expect(map.get('林动')).toEqual([])
  })

  it('别名元素去空白、只保留字符串（非字符串元素丢弃）', () => {
    const map = buildCharacterAliasMap([{ name: '苏晚', aliases: '[" 阿晚 ",3,null,"  ","晚儿"]' }])
    expect(map.get('苏晚')).toEqual(['阿晚', '晚儿'])
  })

  it('非法 JSON / 非数组 / 别名缺失 / name 为空 → 跳过该角色（不抛）', () => {
    const rows = [
      { name: '苏晚', aliases: '不是JSON' },
      { name: '林动', aliases: '{"alias":"动哥"}' },
      { name: '萧炎', aliases: '' },
      { name: '牧尘', aliases: undefined },
      { name: '', aliases: '["x"]' },
      { name: '药老', aliases: '["药尊者"]' },
    ]
    expect(() => buildCharacterAliasMap(rows)).not.toThrow()
    const map = buildCharacterAliasMap(rows)
    expect([...map.keys()]).toEqual(['药老'])
    expect(map.get('药老')).toEqual(['药尊者'])
  })

  it('空表 → 空 map', () => {
    expect(buildCharacterAliasMap([]).size).toBe(0)
  })
})

// ===== ② 检索入口接线 =====

describe('检索入口接线（L3 T5）', () => {
  it('混合检索：扩展文本进语义通道（query 命中别名 → 正名 + 别名都参与向量检索）', async () => {
    h.db = makeCharactersDb([{ name: '苏晚', aliases: '["阿晚","晚儿"]' }])
    h.searchResults.push({ text: '苏晚在城墙上等待', score: 0.9, fileName: '第1章 正名.txt', source: 'vector' })

    const res = await searchKnowledge('阿晚今天做了什么', PROJECT, 'openai', MODEL, 5)

    expect(h.embedCalls).toEqual([['阿晚今天做了什么 苏晚 晚儿']])
    expect(res).toEqual(h.searchResults)
  })

  it('词法通道输入保持原 query —— 扩展不得收紧 T3 的 AND（否则别名查询召回清零）', async () => {
    h.db = makeCharactersDb([{ name: '苏晚', aliases: '["阿晚","晚儿"]' }])

    await searchKnowledge('阿晚今天做了什么', PROJECT, 'openai', MODEL, 5)

    expect(h.searchCalls).toHaveLength(1)
    expect(h.searchCalls[0].query).toBe('阿晚今天做了什么')
    expect(h.searchCalls[0].projectPath).toBe(PROJECT)
    expect(h.searchCalls[0].queryVector).toEqual(h.embedVector) // 向量来自扩展文本
  })

  it('范围检索参数原样透传（chapterScope / topK 不受改写影响）', async () => {
    h.db = makeCharactersDb([{ name: '苏晚', aliases: '["阿晚"]' }])

    await searchKnowledge('阿晚', PROJECT, 'openai', MODEL, 3, [1, 5])

    expect(h.searchCalls[0].topK).toBe(3)
    expect(h.searchCalls[0].chapterScope).toEqual([1, 5])
  })

  it('FTS-only 入口逐字保持改造前行为（不读 characters、不改写 query）', async () => {
    h.db = makeCharactersDb([{ name: '苏晚', aliases: '["阿晚","晚儿"]' }])

    await searchKnowledgeFTS('阿晚今天做了什么', PROJECT, 5)

    expect(h.searchCalls).toEqual([{
      projectPath: PROJECT,
      query: '阿晚今天做了什么',
      queryVector: undefined,
      topK: 5,
      chapterScope: undefined,
    }])
    expect(h.embedCalls).toHaveLength(0)
  })

  it('无 characters（DB 未打开 / 无 characters 表）→ 扩展不发生，行为与改造前一致（零损失）', async () => {
    h.db = null
    await searchKnowledge('阿晚今天做了什么', PROJECT, 'openai', MODEL, 5)
    h.db = makeDbWithoutCharacters()
    await searchKnowledge('阿晚今天做了什么', PROJECT, 'openai', MODEL, 5)

    expect(h.embedCalls).toEqual([['阿晚今天做了什么'], ['阿晚今天做了什么']])
    expect(h.searchCalls.map(c => c.query)).toEqual(['阿晚今天做了什么', '阿晚今天做了什么'])
  })

  it('别名解析失败 → 该角色跳过，query 原样（零损失）', async () => {
    h.db = makeCharactersDb([{ name: '苏晚', aliases: '{"alias":"阿晚"}' }])

    await searchKnowledge('阿晚今天做了什么', PROJECT, 'openai', MODEL, 5)

    expect(h.embedCalls[0]).toEqual(['阿晚今天做了什么'])
  })

  it('项目边界：检索项目 ≠ 当前项目库 → 不读别名、不扩展（跨项目别名不污染）', async () => {
    h.db = makeCharactersDb([{ name: '苏晚', aliases: '["阿晚"]' }])
    h.currentProjectPath = OTHER_PROJECT

    await searchKnowledge('阿晚今天做了什么', PROJECT, 'openai', MODEL, 5)

    expect(h.embedCalls[0]).toEqual(['阿晚今天做了什么'])
  })

  it('向量化失败 → 降级为纯 FTS（queryVector undefined），检索照常返回', async () => {
    h.db = makeCharactersDb([{ name: '苏晚', aliases: '["阿晚"]' }])
    h.embedShouldFail = true
    h.searchResults.push({ text: '阿晚离开了', score: 0.7, fileName: '第2章.txt', source: 'fts' })

    const res = await searchKnowledge('阿晚今天做了什么', PROJECT, 'openai', MODEL, 5)

    expect(h.searchCalls[0].queryVector).toBeUndefined()
    expect(res).toEqual(h.searchResults)
  })

  it('无 Embedding 配置（apiKey 空）→ 不读别名、不向量化，纯 FTS 路径与改造前一致', async () => {
    h.db = makeCharactersDb([{ name: '苏晚', aliases: '["阿晚"]' }])

    await searchKnowledge('阿晚今天做了什么', PROJECT, 'openai', { baseUrl: '', apiKey: '' }, 5)

    expect(h.embedCalls).toHaveLength(0)
    expect(h.searchCalls[0]).toEqual({
      projectPath: PROJECT,
      query: '阿晚今天做了什么',
      queryVector: undefined,
      topK: 5,
      chapterScope: undefined,
    })
  })

  it('返回结构保持 4 键（text / score / fileName / source）', async () => {
    h.searchResults.push({ text: '苏晚在城墙上等待', score: 0.8, fileName: 'x.txt', source: 'fts' })

    const res = await searchKnowledge('阿晚今天做了什么', PROJECT, 'openai', MODEL, 5)

    expect(res).toHaveLength(1)
    expect(Object.keys(res[0]).sort()).toEqual(['fileName', 'score', 'source', 'text'])
  })

  it('分词器不可用（tokenize 抛错）→ 降级为子串匹配，仍不抛且扩展正确', async () => {
    vi.resetModules()
    vi.doMock('./chinese-tokenizer', () => ({
      tokenize: () => { throw new Error('wasm unavailable') },
      tokenizeToSpaceSeparated: () => { throw new Error('wasm unavailable') },
    }))
    try {
      const mod = await import('./knowledge-base')
      expect(mod.rewriteQuery('阿晚今天做了什么', new Map([['苏晚', ['阿晚', '晚儿']]])))
        .toBe('阿晚今天做了什么 苏晚 晚儿')
    } finally {
      vi.doUnmock('./chinese-tokenizer')
      vi.resetModules()
    }
  })
})

// ============================================================
// ④ T3：降级链四级（调用序列 / 短路 / 降级）
// ============================================================

const LOCAL_BASE = 'http://127.0.0.1:11434'
const LOCAL_MODEL = 'bge-m3'

/** 打开本地档（字段同形于 T4 `GlobalConfig.localEmbedding`；读写走全局 config.json） */
function enableLocal(preferLocal: boolean): void {
  setGlobalConfig({ localEmbedding: { enabled: true, preferLocal, baseUrl: LOCAL_BASE, model: LOCAL_MODEL } })
}

describe('降级链四级：调用序列（T3）', () => {
  beforeEach(() => {
    // 一个文本一个块（默认 `() => []` 会让降级链空转，链用例统一覆盖分块）
    h.chunkTextImpl = (text: string) => [text]
  })

  describe('兼容性：enabled=false（默认）与现状逐字等价', () => {
    it('无 localEmbedding 字段 → api 成功即短路（本地档零调用）', async () => {
      setGlobalConfig({})

      const res = await importText('正文内容', 'a.txt', PROJECT, 'openai', MODEL)

      expect(res.success).toBe(true)
      expect(h.embedCalls).toEqual([['正文内容']])
      expect(h.llmCanUseCalls).toBe(0)      // api 成功 → 不再问 LLM 档
      expect(h.detectCalls).toHaveLength(0) // 本地档不在链上
      expect(h.localEmbedCalls).toHaveLength(0)
      expect(h.addChunksCalls[0].vectors).toEqual([[1, 0, 0, 1]])
    })

    it('api 失败 → LLM 档；LLM 未启用 → FTS-only（无向量写入，导入不阻断）', async () => {
      setGlobalConfig({})
      h.embedShouldFail = true
      h.llmEnabled = false

      const res = await importText('正文内容', 'a.txt', PROJECT, 'openai', MODEL)

      expect(res.success).toBe(true)                     // 降级链尽头不阻断导入
      expect(h.llmCanUseCalls).toBe(1)                   // 问过 LLM 档
      expect(h.llmCalls).toHaveLength(0)                 // 未启用 → 不调用
      expect(h.addChunksCalls[0].vectors).toBeUndefined() // FTS-only：不写向量
      expect(h.detectCalls).toHaveLength(0)
    })

    it('api 失败 → LLM 成功 → 用 LLM 向量（现状第二档顺序不变）', async () => {
      setGlobalConfig({})
      h.embedShouldFail = true
      h.llmEnabled = true
      h.llmVectors = [[0.7, 0.7, 0.7]]

      const res = await importText('正文内容', 'a.txt', PROJECT, 'openai', MODEL)

      expect(res.success).toBe(true)
      expect(h.llmCalls).toEqual([['正文内容']])
      expect(h.addChunksCalls[0].vectors).toEqual([[0.7, 0.7, 0.7]])
    })

    it('无 API Key → api 档不尝试（现状：apiKey 为空时不调用 generateEmbeddings），直接 LLM 档', async () => {
      setGlobalConfig({})
      h.llmEnabled = true

      const res = await importText('正文内容', 'a.txt', PROJECT, 'openai', { baseUrl: '', apiKey: '' })

      expect(res.success).toBe(true)
      expect(h.embedCalls).toHaveLength(0) // api 档未被尝试
      expect(h.llmCalls).toHaveLength(1)
    })

    it('enabled=false 但本地可用 → 仍不探测（兼容性硬要求：默认路径逐字等价）', async () => {
      setGlobalConfig({
        localEmbedding: { enabled: false, preferLocal: true, baseUrl: LOCAL_BASE, model: LOCAL_MODEL },
      })

      const res = await importText('正文内容', 'a.txt', PROJECT, 'openai', MODEL)

      expect(res.success).toBe(true)
      expect(h.detectCalls).toHaveLength(0)
      expect(h.localEmbedCalls).toHaveLength(0)
      expect(h.embedCalls).toHaveLength(1)
    })

    it('配置损坏（localEmbedding 非对象 / enabled 非布尔）→ 回退默认，不探测本地', async () => {
      setGlobalConfig({ localEmbedding: 'yes' })
      await importText('正文内容', 'a.txt', PROJECT, 'openai', MODEL)
      setGlobalConfig({ localEmbedding: { enabled: 'true', preferLocal: true } })
      await importText('正文内容', 'b.txt', PROJECT, 'openai', MODEL)

      expect(h.detectCalls).toHaveLength(0)
      expect(h.embedCalls).toHaveLength(2)
    })
  })

  describe('四级：enabled=true（本地档参与 + 用户优先级）', () => {
    it('preferLocal=true：本地成功即短路（api/llm 都不调用）', async () => {
      enableLocal(true)
      h.localVectors = [[1, 1, 1, 1]]

      const res = await importText('正文内容', 'a.txt', PROJECT, 'openai', MODEL)

      expect(res.success).toBe(true)
      expect(h.detectCalls).toEqual([LOCAL_BASE])     // 探测用的是配置里的 baseUrl
      expect(h.localEmbedCalls).toEqual([['正文内容']])
      expect(h.embedCalls).toHaveLength(0)            // api 档未尝试
      expect(h.llmCanUseCalls).toBe(0)
      expect(h.addChunksCalls[0].vectors).toEqual([[1, 1, 1, 1]])
    })

    it('preferLocal=false：api 成功即短路，本地档连探测都不做（优先级生效）', async () => {
      enableLocal(false)

      const res = await importText('正文内容', 'a.txt', PROJECT, 'openai', MODEL)

      expect(res.success).toBe(true)
      expect(h.embedCalls).toHaveLength(1)
      expect(h.detectCalls).toHaveLength(0)
      expect(h.localEmbedCalls).toHaveLength(0)
    })

    it('preferLocal=false：api 失败 → 降级本地（顺序 api → local）', async () => {
      enableLocal(false)
      h.embedShouldFail = true
      h.localVectors = [[2, 2, 2]]

      const res = await importText('正文内容', 'a.txt', PROJECT, 'openai', MODEL)

      expect(res.success).toBe(true)
      expect(h.embedCalls).toHaveLength(1)
      expect(h.detectCalls).toEqual([LOCAL_BASE])
      expect(h.addChunksCalls[0].vectors).toEqual([[2, 2, 2]])
    })

    it('preferLocal=true：本地探测失败 → 跳过本地档（不发起 /api/embed）并降级 api', async () => {
      enableLocal(true)
      h.localDetectOk = false

      const res = await importText('正文内容', 'a.txt', PROJECT, 'openai', MODEL)

      expect(res.success).toBe(true)
      expect(h.detectCalls).toEqual([LOCAL_BASE])
      expect(h.localEmbedCalls).toHaveLength(0) // 探测失败不浪费 embed 超时
      expect(h.embedCalls).toHaveLength(1)      // 降级到 api
    })

    it('本地向量化 throw（T2：英文错误串）→ 降级 api；英文串只进日志，不作 UI 文案', async () => {
      enableLocal(true)
      h.localEmbedShouldFail = true
      const warnSpy = vi.spyOn(logger, 'warn')

      const res = await importText('正文内容', 'a.txt', PROJECT, 'openai', MODEL)

      expect(res.success).toBe(true)          // 导入不阻断
      expect(h.embedCalls).toHaveLength(1)    // 降级到 api
      const logged = warnSpy.mock.calls.map(args => args.map(String).join(' ')).join('\n')
      expect(logged).toContain('Ollama /api/embed failed: HTTP 500')
      expect(res.error).toBeUndefined()       // 英文原始错误串不上交 UI
    })

    it('本地网络 reject（T2：raw `TypeError: fetch failed`）→ 同样只进日志并降级 api', async () => {
      enableLocal(true)
      h.localEmbedShouldFail = true
      h.localEmbedError = new TypeError('fetch failed') // Ollama 未运行时 undici 的原始 reject 形态
      const warnSpy = vi.spyOn(logger, 'warn')

      const res = await importText('正文内容', 'a.txt', PROJECT, 'openai', MODEL)

      expect(res.success).toBe(true)
      expect(h.embedCalls).toHaveLength(1)
      const logged = warnSpy.mock.calls.map(args => args.map(String).join(' ')).join('\n')
      expect(logged).toContain('fetch failed')
      expect(res.error).toBeUndefined()
    })

    it('本地返回空向量（T2：空输入 → [] / 全空）→ 视为该档失败，继续降级', async () => {
      enableLocal(true)
      h.localVectors = []

      const res = await importText('正文内容', 'a.txt', PROJECT, 'openai', MODEL)

      expect(res.success).toBe(true)
      expect(h.detectCalls).toHaveLength(1)
      expect(h.embedCalls).toHaveLength(1) // 空结果不算成功
    })

    it('四级全败 → FTS-only，导入仍成功（链尽头不阻断）', async () => {
      enableLocal(true)
      h.localDetectOk = false
      h.embedShouldFail = true
      h.llmEnabled = false

      const res = await importText('正文内容', 'a.txt', PROJECT, 'openai', MODEL)

      expect(res.success).toBe(true)
      // FTS-only：不写任何向量（本地档失败返回 [] → addChunks 收到的可能是 [] 而非 undefined，
      // 但两者对 addChunks 等价：无任何非空向量可写）
      expect(h.addChunksCalls[0].vectors ?? []).toHaveLength(0)
      expect(h.addChunksCalls[0].chunks).toEqual(['正文内容']) // 文本照常入库（FTS 可用）
    })
  })
})

// ============================================================
// ⑤ T3：向量维度硬校验（写入前拒绝；真实 LanceDB 见 e2e 文件）
// ============================================================

describe('向量维度硬校验接线（T3）', () => {
  beforeEach(() => {
    h.chunkTextImpl = (text: string) => [text]
  })

  it('assertVectorDimCompatible：现有 1536 维 vs 待写 1024 维 → throw（不返回、不静默降级）', async () => {
    h.existingDim = 1536

    await expect(assertVectorDimCompatible(PROJECT, 1024)).rejects.toThrow(/1536/)
    await expect(assertVectorDimCompatible(PROJECT, 1024)).rejects.toThrow(/1024/)
    await expect(assertVectorDimCompatible(PROJECT, 1024)).rejects.toThrow(/重建/)
  })

  it('维度一致 → 放行；首建（无表/无向量列 → 0）→ 放行', async () => {
    h.existingDim = 1024
    await expect(assertVectorDimCompatible(PROJECT, 1024)).resolves.toBeUndefined()

    h.existingDim = 0
    await expect(assertVectorDimCompatible(PROJECT, 1536)).resolves.toBeUndefined()
  })

  it('本次不写向量（newDim=0）→ 放行（存量纯文本库 / FTS-only 不受影响）', async () => {
    h.existingDim = 1536
    await expect(assertVectorDimCompatible(PROJECT, 0)).resolves.toBeUndefined()
  })

  it('importText：维度不一致 → 拒绝（明确错误），不写入、不删同名旧文档（无半写入/无数据丢失）', async () => {
    h.existingDim = 1536
    h.apiVectors = [new Array(1024).fill(0.1)]
    h.existingDocs = [{ id: 'doc-old', fileName: 'a.txt', importedAt: '', chunkCount: 1, filePath: '' }]

    const res = await importText('正文内容', 'a.txt', PROJECT, 'openai', MODEL)

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/1536/)
    expect(res.error).toMatch(/1024/)
    expect(h.dimReadCalls).toBe(1)
    expect(h.addChunksCalls).toHaveLength(0) // 未写入
    expect(h.removeDocCalls).toHaveLength(0) // 未删除旧文档（校验先于清理）
  })

  it('importText：维度一致 → 校验放行并正常写入（同名旧文档照常清理，幂等性不受影响）', async () => {
    h.existingDim = 1024
    h.apiVectors = [new Array(1024).fill(0.1)]
    h.existingDocs = [{ id: 'doc-old', fileName: 'a.txt', importedAt: '', chunkCount: 1, filePath: '' }]

    const res = await importText('正文内容', 'a.txt', PROJECT, 'openai', MODEL)

    expect(res.success).toBe(true)
    expect(h.dimReadCalls).toBe(1)
    expect(h.removeDocCalls).toEqual(['doc-old'])
    expect(h.addChunksCalls).toHaveLength(1)
    expect(h.addChunksCalls[0].vectors?.[0]).toHaveLength(1024)
  })

  it('importText：FTS-only（无向量可写）→ 不做维度校验（不读表），导入照常', async () => {
    h.existingDim = 1536
    h.embedShouldFail = true
    h.llmEnabled = false

    const res = await importText('正文内容', 'a.txt', PROJECT, 'openai', MODEL)

    expect(res.success).toBe(true)
    expect(h.dimReadCalls).toBe(0)
    expect(h.addChunksCalls[0].vectors).toBeUndefined()
  })
})

describe('backfillVectors 四级接入 + 维度拒绝（T3）', () => {
  beforeEach(() => {
    // 1 个待回填块（table.query() 第 1 次 = 缺向量扫描；之后 = 全表读取）
    h.vectorlessCount = 1
    h.backfillRows = [{ id: 'row-1', text: '无向量块', vector: null }]
    h.backfillFullRows = [{ id: 'row-1', text: '无向量块', vector: null }]
  })

  it('默认（enabled=false）→ 仅 api 档，不探测本地（兼容）', async () => {
    h.existingDim = 1536 // 与 api 桩向量 4 维不一致 → 走拒绝分支（无需跑通全量重建写盘）

    const res = await backfillVectors(PROJECT, 'openai', MODEL)

    expect(h.embedCalls).toHaveLength(1)
    expect(h.detectCalls).toHaveLength(0)
    expect(h.localEmbedCalls).toHaveLength(0)
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/1536/)
    expect(h.dbWrites).toHaveLength(0) // 无半写入（临时表都未创建）
  })

  it('enabled + preferLocal：本地档先试并短路 api → 维度不一致时同样拒绝且无写入', async () => {
    enableLocal(true)
    h.existingDim = 1536 // 本地桩向量 3 维 → 不一致

    const res = await backfillVectors(PROJECT, 'openai', MODEL)

    expect(h.detectCalls).toEqual([LOCAL_BASE])
    expect(h.localEmbedCalls).toHaveLength(1)
    expect(h.embedCalls).toHaveLength(0) // 本地成功 → api 不再尝试
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/1536/)
    expect(h.dbWrites).toHaveLength(0)
  })

  it('enabled + !preferLocal：api 失败后降级本地（顺序 api → local）', async () => {
    enableLocal(false)
    h.embedShouldFail = true
    h.existingDim = 1536

    const res = await backfillVectors(PROJECT, 'openai', MODEL)

    expect(h.embedCalls).toHaveLength(1)
    expect(h.detectCalls).toEqual([LOCAL_BASE])
    expect(h.localEmbedCalls).toHaveLength(1)
    expect(res.success).toBe(false)
    expect(h.dbWrites).toHaveLength(0)
  })

  it('维度一致 → 校验放行，既有回填写盘路径原样跑通（临时表 → 替换 → 校验）', async () => {
    h.existingDim = 4
    h.backfillFullRows = [{ id: 'row-1', text: '无向量块', vector: [1, 0, 0, 1] }]

    const res = await backfillVectors(PROJECT, 'openai', MODEL)

    expect(res.success).toBe(true)
    expect(res.processed).toBe(1)
    expect(res.failed).toBe(0)
    expect(h.dbWrites).toContain('create:chunks_backfill')
    expect(h.dbWrites).toContain('create:chunks')
  })

  /**
   * T3 R1（reviewer I1 修复的回归锁）：**守卫不得因「首个向量为空」而自跳过**。
   *
   * 可达形状：LLM 档在 `backfillVectors` 里是 `vectors = llmResults.map(r => r.vector)`（**未过滤空向量**，
   * 与 importContent 的 `.filter(v => v.length > 0)` 不同），而 `embedding-service` 对失败项合法返回
   * `{ vector: [] }` → `vectors = [[], [1024…]]`。若维度取自 `vectors[0].length` 就会得到 0，
   * 而 `assertVectorDimCompatible(…, 0)` 按「本次不写向量」提前放行 → 守卫**从未运行**，
   * 且 `VECTOR_DIM === 0` 还会构造出**不带 vector 列**的 schema，与携带向量的行冲突。
   */
  describe('T3 R1：空向量在首位（LLM 档不过滤空向量）→ 守卫不得静默自跳过', () => {
    beforeEach(() => {
      h.embedShouldFail = true // api 档失败 → 降级 LLM 档
      h.llmEnabled = true
    })

    it('表 1536 维 + LLM 结果 [[], 1024 维] → 拒绝，文案含 1536 与 1024，且无半写入', async () => {
      h.existingDim = 1536
      h.llmVectors = [[], new Array(1024).fill(0.5)]

      const res = await backfillVectors(PROJECT, 'openai', MODEL)

      expect(res.success).toBe(false)
      expect(res.error).toMatch(/1536/)
      expect(res.error).toMatch(/1024/)
      expect(h.dbWrites).toHaveLength(0) // 守卫在写盘前拦下（临时表都未创建）
    })

    it('表 1536 维 + LLM 结果 [[], [1,2,3,4]] → 取首个**非空**向量（4 维）而非首元素（0 维）', async () => {
      h.existingDim = 1536
      h.llmVectors = [[], [1, 2, 3, 4]]

      const res = await backfillVectors(PROJECT, 'openai', MODEL)

      expect(res.success).toBe(false)
      expect(res.error).toMatch(/1536/)
      expect(res.error).toMatch(/本次生成 4 维/)
      expect(res.error).not.toMatch(/本次生成 0 维/)
      expect(h.dbWrites).toHaveLength(0)
    })

    it('同维度变体（表 4 维 / LLM 结果 [[], [1,2,3,4]]）→ 放行且落库成功（schema 带 vector 列）', async () => {
      h.existingDim = 4
      h.vectorlessCount = 2
      h.backfillRows = [
        { id: 'row-1', text: '块1', vector: null },
        { id: 'row-2', text: '块2', vector: null },
      ]
      h.backfillFullRows = [
        { id: 'row-1', text: '块1', vector: null },
        { id: 'row-2', text: '块2', vector: [1, 2, 3, 4] },
      ]
      h.llmVectors = [[], [1, 2, 3, 4]]

      const res = await backfillVectors(PROJECT, 'openai', MODEL)

      expect(res.success).toBe(true)
      expect(res.processed).toBe(1) // 只有 row-2 拿到向量（row-1 对应空向量 → 跳过）
      expect(h.dbWrites).toContain('create:chunks_backfill')
      expect(h.dbWrites).toContain('create:chunks')
    })
  })
})
