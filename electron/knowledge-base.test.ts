/**
 * 查询改写（角色别名扩展，L3 T5）测试 —— 纯函数 + 检索入口接线
 *
 * 三个层次：
 * ① 纯函数 `rewriteQuery` / `buildCharacterAliasMap`（零 IO）
 * ② 检索入口接线（mock 项目 DB + mock 检索/向量层）：扩展文本进**语义通道**、词法通道输入不变、
 *    各类失败降级零损失
 * ③ 真实 LanceDB 端到端：`electron/knowledge-base.e2e.test.ts`
 *
 * ⚠️ better-sqlite3 编译目标为 Electron ABI，vitest（Node ABI）无法加载 → mock `./database`
 *    （与 `electron/repositories/character-repository.test.ts` 同法，用 node:sqlite 内存库）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { tokenize } from './chinese-tokenizer'
import {
  rewriteQuery,
  buildCharacterAliasMap,
  searchKnowledge,
  searchKnowledgeFTS,
} from './knowledge-base'

// ===== mock 状态（vi.hoisted：模块工厂先于 import 求值） =====

const h = vi.hoisted(() => ({
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
}))

vi.mock('./database', () => ({
  getProjectDb: () => h.db,
  getCurrentProjectPath: () => h.currentProjectPath,
}))

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
  // knowledge-base 顶层 import 的其余符号（本文件不触发，仅为模块图完整）
  addChunks: async () => ({ success: true, chunkCount: 0 }),
  removeDocument: async () => true,
  listDocuments: async () => [],
  getStats: async () => ({ documentCount: 0, totalChunks: 0, vectorDimension: 0, hasVectors: false }),
  migrateFromJSON: async () => ({ success: true, migrated: 0 }),
  getChunksWithoutVectors: async () => ({ count: 0 }),
  backfillTokens: async () => ({ success: true, processed: 0, failed: 0 }),
}))

vi.mock('./embedding', () => ({
  chunkText: () => [],
  generateEmbeddings: async (texts: string[]) => {
    h.embedCalls.push(texts)
    if (h.embedShouldFail) throw new Error('embedding unavailable')
    return texts.map(() => h.embedVector)
  },
}))

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
