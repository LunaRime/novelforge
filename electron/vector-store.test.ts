import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  Field,
  FixedSizeList as ArrowFixedSizeList,
  Float32,
  Int32,
  Schema as ArrowSchema,
  Utf8,
} from 'apache-arrow'
import {
  computeFTSRelevance,
  parseChapterNumberForBackfill,
  buildChunkTokens,
  selectRowsMissingTokens,
  ensureChunksSchema,
  getConnection,
  closeConnection,
  addChunks,
  getChunksWithoutTokens,
  backfillTokens,
  searchWithScope,
  buildChunkFTSFilter,
  tokenizeQueryWords,
  selectQueryTerms,
  rrfFuse,
} from './vector-store'

describe('computeFTSRelevance（P1-1 FTS 相关性打分）', () => {
  it('空输入返回基础分 0.5', () => {
    expect(computeFTSRelevance('', '查询')).toBe(0.5)
    expect(computeFTSRelevance('文本', '')).toBe(0.5)
    expect(computeFTSRelevance('', '')).toBe(0.5)
  })

  it('分数范围恒在 [0.5, 1.0]', () => {
    for (let i = 0; i < 20; i++) {
      const s = computeFTSRelevance(`测试文本 ${i} 内容`, '测试')
      expect(s).toBeGreaterThanOrEqual(0.5)
      expect(s).toBeLessThanOrEqual(1)
    }
  })

  it('完全命中（query 全在 text）比部分命中分数高', () => {
    const full = computeFTSRelevance('知识库支持搜索与向量检索功能', '搜索')
    const partial = computeFTSRelevance('今天天气不错', '搜索')
    expect(full).toBeGreaterThan(partial)
  })

  it('连续片段命中比同字符散落分数高', () => {
    // '搜索知识' 在 text1 连续出现，text2 只零散含 搜/索/知/识
    const contiguous = computeFTSRelevance('本章讲解搜索知识库的方法', '搜索知识')
    const scattered = computeFTSRelevance('搜遍全书才知道知识的用处', '搜索知识')
    expect(contiguous).toBeGreaterThan(scattered)
  })

  it('命中位置靠前的文本分数更高（同命中率时）', () => {
    const early = computeFTSRelevance('搜索功能在开头，后面是无关内容……'.padEnd(60, '填充'), '搜索功能')
    const late = computeFTSRelevance('前面全是无关内容……'.padEnd(60, '填充') + '搜索功能在结尾', '搜索功能')
    expect(early).toBeGreaterThan(late)
  })

  it('中文标点/英文混合 query 不崩溃', () => {
    expect(() => computeFTSRelevance('这是 hero 的剑', 'hero')).not.toThrow()
    expect(computeFTSRelevance('这是 hero 的剑', 'hero')).toBeGreaterThan(0.5)
  })
})

describe('存量回填章节号解析（真实定稿导入格式）', () => {
  it('第N章 标题.txt（真实格式：定稿导入文件名）→ 章节号', () => {
    expect(parseChapterNumberForBackfill('第9章 破坛换晶.txt')).toBe(9)
    expect(parseChapterNumberForBackfill('第 9 章 破坛换晶.txt')).toBe(9)
  })

  it('无匹配 → null（回填 NULL，scopeFilter 容忍）', () => {
    expect(parseChapterNumberForBackfill('设定集.md')).toBeNull()
    expect(parseChapterNumberForBackfill('chapter_9.txt')).toBeNull()
    expect(parseChapterNumberForBackfill('第9章 正文.md')).toBeNull() // 旧格式（正文/要点/蓝图.md）非定稿导入
  })
})

// ===== L3 T2：chunks tokens 字段 + 导入分词 + backfillTokens 回填 =====

describe('chunk 分词写入（L3 T2：tokens 字段）', () => {
  it('中文文本 → 非空、空格分隔的 tokens 串', () => {
    const tokens = buildChunkTokens('主角的剑在月光下闪耀')
    expect(tokens).toBeTruthy()
    expect(tokens).toContain(' ')
    expect(tokens!.split(' ').filter(Boolean).length).toBeGreaterThan(1)
  })

  it('中英混排 → 英文词与中文词都保留', () => {
    const tokens = buildChunkTokens('hero 的剑')
    expect(tokens).toContain('hero')
    expect(tokens).toContain('剑')
  })

  it('空文本 / 纯空白 → undefined（不写空串，交由缺失判定走回填）', () => {
    expect(buildChunkTokens('')).toBeUndefined()
    expect(buildChunkTokens('   \n\t ')).toBeUndefined()
  })
})

describe('缺失 tokens 行筛选（回填选择 + 幂等）', () => {
  it('只选中 tokens 为 null/undefined/空串/纯空白的行', () => {
    const rows = [
      { id: 'a', text: '主角的剑', tokens: null },
      { id: 'b', text: '配角登场', tokens: '' },
      { id: 'c', text: '已有分词', tokens: '已有 分词' },
      { id: 'd', text: '空白串', tokens: '   ' },
      { id: 'e', text: '旧表无该列', tokens: undefined },
    ]
    expect(selectRowsMissingTokens(rows).map(r => r.id)).toEqual(['a', 'b', 'd', 'e'])
  })

  it('回填后不再被选中，已有 tokens 原样保留（幂等）', () => {
    const rows: Array<{ id: string; text: string; tokens?: string | null }> = [
      { id: 'a', text: '主角的剑在月光下', tokens: null },
      { id: 'b', text: '配角登场说话', tokens: '配角 登场 说话' },
    ]
    expect(selectRowsMissingTokens(rows).map(r => r.id)).toEqual(['a'])

    // 模拟回填：只对缺失行写分词结果，已有 tokens 不动
    const afterBackfill = rows.map(r =>
      selectRowsMissingTokens([r]).length > 0 ? { ...r, tokens: buildChunkTokens(r.text) } : r
    )
    expect(selectRowsMissingTokens(afterBackfill)).toHaveLength(0)
    expect(afterBackfill[1].tokens).toBe('配角 登场 说话')
  })
})

describe('LanceDB 端到端：tokens 写入 + 回填（L3 T2）', () => {
  /** 隔离的临时项目目录（LanceDB 落到 {projectPath}/.novelforge/lancedb） */
  function makeTempProject(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'nf-tokens-'))
  }

  async function cleanupProject(projectPath: string): Promise<void> {
    await closeConnection(projectPath)
    fs.rmSync(projectPath, { recursive: true, force: true })
  }

  async function readChunks(projectPath: string): Promise<Array<{ id: string; text: string; tokens?: string | null }>> {
    const db = await getConnection(projectPath)
    const table = await db.openTable('chunks')
    return await table.query().select(['id', 'text', 'tokens']).toArray() as
      Array<{ id: string; text: string; tokens?: string | null }>
  }

  it('addChunks 写入 tokens → 缺失行回填 → 重复回填零动作（幂等）', async () => {
    const projectPath = makeTempProject()
    try {
      const added = await addChunks(
        projectPath, randomUUID(), '第1章 测试.txt',
        ['主角的剑在月光下闪耀', '配角登场说话'], undefined,
      )
      expect(added.success).toBe(true)

      const rows = await readChunks(projectPath)
      expect(rows).toHaveLength(2)
      for (const r of rows) {
        expect(r.tokens).toBeTruthy()
        expect(String(r.tokens)).toContain(' ')
      }
      expect(await getChunksWithoutTokens(projectPath)).toHaveLength(0)

      // 模拟升级前旧数据：清空一行 tokens（tokens 列本身已存在）
      const db = await getConnection(projectPath)
      await (await db.openTable('chunks')).update({ where: `id = '${rows[0].id}'`, values: { tokens: '' } })

      const missing = await getChunksWithoutTokens(projectPath)
      expect(missing).toEqual([{ text: rows[0].text, fileName: '第1章 测试.txt' }])

      const first = await backfillTokens(projectPath)
      expect(first).toMatchObject({ success: true, processed: 1, failed: 0 })

      const after = await readChunks(projectPath)
      const filled = after.find(r => r.id === rows[0].id)
      expect(filled?.tokens).toBeTruthy()
      expect(String(filled?.tokens)).toContain(' ')
      expect(await getChunksWithoutTokens(projectPath)).toHaveLength(0)

      // 幂等：无缺失行时零动作，已有 tokens 不被改写
      const second = await backfillTokens(projectPath)
      expect(second).toEqual({ success: true, processed: 0, failed: 0 })
      expect((await readChunks(projectPath)).map(r => r.tokens)).toEqual(after.map(r => r.tokens))
    } finally {
      await cleanupProject(projectPath)
    }
  })

  it('存量旧表（无 tokens 列）自检补列幂等，且旧行可被回填', async () => {
    const projectPath = makeTempProject()
    try {
      const db = await getConnection(projectPath)
      await db.createTable('chunks', [{
        id: randomUUID(), docId: randomUUID(), fileName: '第1章 旧.txt',
        chapterNumber: 1, chapterTitle: '旧', text: '旧章节正文内容',
        chunkIndex: 0, totalChunks: 1, importedAt: '2026-01-01T00:00:00.000Z',
      }])

      // 未迁移表（连 tokens 列都没有）→ 全部行视为缺失（不写库）
      expect(await getChunksWithoutTokens(projectPath))
        .toEqual([{ text: '旧章节正文内容', fileName: '第1章 旧.txt' }])

      const migrated = await ensureChunksSchema(db)
      expect(migrated.migrated, JSON.stringify(migrated)).toBe(true) // 失败时打印 LanceDB 侧错误
      const fields = (await (await db.openTable('chunks')).schema()).fields.map(f => f.name)
      expect(fields).toContain('tokens')
      expect((await ensureChunksSchema(db)).migrated).toBe(false) // 幂等

      expect(await getChunksWithoutTokens(projectPath))
        .toEqual([{ text: '旧章节正文内容', fileName: '第1章 旧.txt' }])

      const res = await backfillTokens(projectPath)
      expect(res).toMatchObject({ success: true, processed: 1, failed: 0 })
      expect(await getChunksWithoutTokens(projectPath)).toHaveLength(0)
    } finally {
      await cleanupProject(projectPath)
    }
  })

  it('存量向量库（有 vector 列、无 tokens 列）导入不失败，向量列不丢', async () => {
    const projectPath = makeTempProject()
    try {
      const db = await getConnection(projectPath)
      // 模拟 L2 时代产物：全部字段齐备（含 vector）但缺 tokens 列
      const legacySchema = new ArrowSchema([
        new Field('id', new Utf8()),
        new Field('docId', new Utf8()),
        new Field('fileName', new Utf8()),
        new Field('chapterNumber', new Int32(), true),
        new Field('chapterTitle', new Utf8(), true),
        new Field('text', new Utf8()),
        new Field('vector', new ArrowFixedSizeList(4, new Field('item', new Float32())), true),
        new Field('chunkIndex', new Int32()),
        new Field('totalChunks', new Int32()),
        new Field('importedAt', new Utf8()),
      ])
      await db.createTable('chunks', [{
        id: randomUUID(), docId: randomUUID(), fileName: '第1章 旧.txt',
        chapterNumber: 1, chapterTitle: '旧', text: '旧章节正文内容',
        vector: [1, 0, 0, 0], chunkIndex: 0, totalChunks: 1, importedAt: '2026-01-01T00:00:00.000Z',
      }], { schema: legacySchema })

      // 导入路径先补列再写入（修复前：记录含 tokens 键 → "Found field not in schema: tokens" 整体失败）
      const added = await addChunks(projectPath, randomUUID(), '第2章 新.txt', ['新章节正文内容'], undefined)
      expect(added.success, JSON.stringify(added)).toBe(true)

      const fields = (await (await db.openTable('chunks')).schema()).fields.map(f => f.name)
      expect(fields).toContain('tokens')
      expect(fields).toContain('vector') // add_columns 不重建表 → 存量向量保留

      const rows = await readChunks(projectPath)
      expect(rows.find(r => r.text === '新章节正文内容')?.tokens).toBeTruthy()
      expect(rows.find(r => r.text === '旧章节正文内容')?.tokens ?? null).toBeNull()

      const res = await backfillTokens(projectPath)
      expect(res).toMatchObject({ success: true, processed: 1, failed: 0 }) // 仅旧行缺失
      expect(rows).toHaveLength(2)
    } finally {
      await cleanupProject(projectPath)
    }
  })
})

// ===== L3 T3：FTS 通道中文词级检索（替换逐字 LIKE）+ tokens 缺失兜底 =====

describe('FTS 过滤表达式构造（L3 T3，纯函数）', () => {
  it('query 分词 → 每词一个 tokens LIKE 片段 AND 连并（chunk 须含全部词），且带 tokens 缺失逐字兜底', () => {
    const expr = buildChunkFTSFilter('搜索知识', ['搜索', '知识'])
    expect(expr).toContain(`tokens LIKE '%搜索%' AND tokens LIKE '%知识%'`)
    expect(expr).toContain(`(tokens IS NULL OR tokens = '')`)
    expect(expr).toContain(`text LIKE '%搜%索%知%识%'`)
  })

  it('分词不可用（无词）→ 全量退回逐字 LIKE，行为与改造前一致', () => {
    expect(buildChunkFTSFilter('搜索', [])).toBe(`text LIKE '%搜%索%'`)
    expect(buildChunkFTSFilter('搜索', [])).not.toContain('tokens LIKE')
  })

  it('逐字兜底：query 字符间插 %；%/ _ 转全角、单引号 SQL 闭合转义', () => {
    expect(buildChunkFTSFilter('100%', [])).toBe(`text LIKE '%1%0%0%％%'`)
    expect(buildChunkFTSFilter('a_b', [])).toBe(`text LIKE '%a%＿%b%'`)
    expect(buildChunkFTSFilter("it's", [])).toBe(`text LIKE '%i%t%''%s%'`)
  })

  it('词级片段同样转义通配符与引号（LIKE 注入 / SQL 闭合防护）', () => {
    const expr = buildChunkFTSFilter("100% it's", ['100%', "it's"])
    expect(expr).toContain(`tokens LIKE '%100％%'`)
    expect(expr).toContain(`tokens LIKE '%it''s%'`)
  })

  it('查询侧分词与写入侧同源（T1 jieba），标点词保留不特判', () => {
    expect(tokenizeQueryWords('主角的剑')).toEqual(['主角', '的', '剑'])
    expect(tokenizeQueryWords('主力，配角。')).toContain('，')
    expect(tokenizeQueryWords('')).toEqual([])
  })
})

// ===== L3 T3 Fix round 1：查询词过滤（Critical-1）+ AND 选择性 + tokens 列不可用兜底（Important-2）=====

describe('查询词过滤（L3 T3 Fix round 1，纯函数）', () => {
  it('丢弃标点/符号与单字功能词（的/是/在…）', () => {
    expect(selectQueryTerms(['主角', '的', '剑', '，', '在', '是'])).toEqual(['主角', '剑'])
  })

  it('保留实义单字词（剑/盾）——丢弃会把 query 退化成更宽的词，重演候选池泛滥', () => {
    expect(selectQueryTerms(['剑'])).toEqual(['剑'])
    expect(selectQueryTerms(['主角', '的', '剑'])).toEqual(['主角', '剑'])
  })

  it('纯噪声词表（功能词/标点）→ 空词表 → 调用方退回逐字 LIKE（单字/纯功能词 query 能力保持）', () => {
    expect(selectQueryTerms(['的', '是', '，', '。', ' '])).toEqual([])
    expect(buildChunkFTSFilter('的是，。', [])).toBe(`text LIKE '%的%是%，%。%'`)
  })

  it('过滤保持词序与重复词（不重排、不去重，语义不变）', () => {
    expect(selectQueryTerms(['主角', '剑', '主角'])).toEqual(['主角', '剑', '主角'])
  })
})

// ===== L3 T4：RRF 融合（替换双通道 max 取并）=====

describe('RRF 融合（L3 T4，纯函数）', () => {
  it('brief 对称构造：B 排 A 前（品秩多重集相同 → RRF 分打平，靠最佳原始分破平）', () => {
    // 向量通道 A(0.9) > B(0.85)；FTS 通道 B(1.0) > A(0.5)
    const fused = rrfFuse([
      [{ key: 'A', score: 0.9 }, { key: 'B', score: 0.85 }],
      [{ key: 'B', score: 1.0 }, { key: 'A', score: 0.5 }],
    ])

    expect(fused.map(f => f.key)).toEqual(['B', 'A'])
    // 两个 key 都是「一通道 rank1 + 另一通道 rank2」→ RRF 分**完全相等**；
    // 破平用各 key 的最佳原始分（B 1.0 > A 0.9）→ 结果确定，无 Map 插入序依赖
    expect(fused[0].score).toBeCloseTo(fused[1].score, 12)
    expect(fused[0].score).toBeCloseTo(1 / 61 + 1 / 62, 12)
  })

  it('两通道共识优先：两通道都排第 2 的 key 超过只在一个通道排第 1 的 key（与 max 取并语义不同）', () => {
    // 向量通道 A(0.95) > C(0.80)；FTS 通道 B(1.0) > C(0.90)
    const fused = rrfFuse([
      [{ key: 'A', score: 0.95 }, { key: 'C', score: 0.8 }],
      [{ key: 'B', score: 1.0 }, { key: 'C', score: 0.9 }],
    ])

    // C：1/62 + 1/62 = 1/31 ≈ 0.0323；A/B：各自 1/61 ≈ 0.0164
    // ⚠️ max 取并语义（旧实现）下 A(0.95)、B(1.0) 都在 C(max 0.90) 之前 → C 垫底；
    //    RRF 只用品秩 → 两通道共识的 C 提到首位
    expect(fused.map(f => f.key)).toEqual(['C', 'B', 'A'])
    expect(fused[0].score).toBeCloseTo(1 / 31, 12)
    // 名义原始分最高的 B(1.0) 也不是第一 → 排序确实没看原始分
    expect(fused[0].key).not.toBe('B')
  })

  it('单通道退化安全：排序与通道自身分数序一致', () => {
    const fused = rrfFuse([
      [{ key: 'X', score: 0.9 }, { key: 'Y', score: 0.7 }, { key: 'Z', score: 0.5 }],
      [],
    ])
    expect(fused.map(f => f.key)).toEqual(['X', 'Y', 'Z'])
    expect(fused.map(f => f.score)).toEqual([1 / 61, 1 / 62, 1 / 63])
  })

  it('无命中通道 / 全空 → 空数组', () => {
    expect(rrfFuse([[], []])).toEqual([])
    expect(rrfFuse([])).toEqual([])
    expect(rrfFuse([[{ key: 'X', score: 1 }], []])).toHaveLength(1)
  })

  it('同一 key 两通道均 rank1 → 分叠加（2/61）', () => {
    const fused = rrfFuse([
      [{ key: 'X', score: 0.9 }],
      [{ key: 'X', score: 0.6 }],
    ])
    expect(fused).toHaveLength(1)
    expect(fused[0].score).toBeCloseTo(2 / 61, 12)
  })

  it('k 可配（默认 60）：k=1 时 rank1 权重 = 1/2', () => {
    expect(rrfFuse([[{ key: 'X', score: 1 }]], 1)[0].score).toBeCloseTo(0.5, 12)
    expect(rrfFuse([[{ key: 'X', score: 1 }]], 0)[0].score).toBeCloseTo(1, 12)
  })
})

describe('LanceDB 端到端：FTS 词级检索（L3 T3）', () => {
  /** 隔离的临时项目目录（LanceDB 落到 {projectPath}/.novelforge/lancedb） */
  function makeTempProject(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'nf-fts-'))
  }

  async function cleanupProject(projectPath: string): Promise<void> {
    await closeConnection(projectPath)
    fs.rmSync(projectPath, { recursive: true, force: true })
  }

  /** 直接改写某行 tokens（模拟存量未回填 NULL / 回填失败空串） */
  async function setTokens(projectPath: string, text: string, tokens: string | null): Promise<void> {
    const db = await getConnection(projectPath)
    await (await db.openTable('chunks')).update({ where: `text = '${text}'`, values: { tokens } })
  }

  /** 直接跑过滤表达式（用于证明「词级子句 / 逐字子句」单独的命中情况） */
  async function filterTexts(projectPath: string, filterExpr: string): Promise<string[]> {
    const db = await getConnection(projectPath)
    const rows = await (await db.openTable('chunks')).query().filter(filterExpr).toArray()
    return (rows as Array<{ text: string }>).map(r => r.text)
  }

  it('词级检索命中：query 分词后匹配 tokens，source=fts 且返回结构不变', async () => {
    const projectPath = makeTempProject()
    try {
      const added = await addChunks(
        projectPath, randomUUID(), '第1章 主角.txt', ['主角的剑在月光下'], undefined,
      )
      expect(added.success, JSON.stringify(added)).toBe(true)

      const results = await searchWithScope(projectPath, '主角')
      const hit = results.find(r => r.text === '主角的剑在月光下')
      expect(results.map(r => r.text)).toContain('主角的剑在月光下')
      expect(hit?.source).toBe('fts') // rag-context-provider 靠 source='fts' 豁免 0.6 阈值
      expect(hit?.fileName).toBe('第1章 主角.txt')
      expect(hit?.score).toBeGreaterThanOrEqual(0.5)
      expect(hit?.score).toBeLessThanOrEqual(1)
      expect(Object.keys(hit!).sort()).toEqual(['fileName', 'score', 'source', 'text']) // 返回结构不变
    } finally {
      await cleanupProject(projectPath)
    }
  })

  it('逐字 LIKE 不命中而词级命中（query「搜索知识」→ chunk「知识搜索的方法」）', async () => {
    const projectPath = makeTempProject()
    try {
      expect((await addChunks(
        projectPath, randomUUID(), '第2章 检索.txt', ['知识搜索的方法'], undefined,
      )).success).toBe(true)

      // 证据：旧通道的逐字容错 pattern 对该 chunk 不命中（本任务的直接收益）
      expect(await filterTexts(projectPath, `text LIKE '%搜%索%知%识%'`)).toHaveLength(0)
      // 词级：query 分词 ['搜索','知识'] → 命中其中一个词即召回
      expect(await filterTexts(projectPath, `tokens LIKE '%搜索%' OR tokens LIKE '%知识%'`))
        .toContain('知识搜索的方法')

      const results = await searchWithScope(projectPath, '搜索知识')
      expect(results.find(r => r.text === '知识搜索的方法')?.source).toBe('fts')
    } finally {
      await cleanupProject(projectPath)
    }
  })

  it('词级语义：跨词边界的字符碎片不再命中（tokens 行由逐字容错改为整词匹配）', async () => {
    const projectPath = makeTempProject()
    try {
      expect((await addChunks(
        projectPath, randomUUID(), '第7章 词级.txt', ['主角的剑在月光下'], undefined,
      )).success).toBe(true)

      // 证据：逐字容错通道会命中跨词碎片「光下」（tokens 为「月光 下」，中间无该词）
      expect(await filterTexts(projectPath, `text LIKE '%光%下%'`)).toContain('主角的剑在月光下')
      // 词级通道：jieba 把「光下」切为整词，而该 chunk 的 tokens 只含「月光」「下」→ 不再命中
      const fragment = await searchWithScope(projectPath, '光下')
      expect(fragment.map(r => r.text)).not.toContain('主角的剑在月光下')
      // 同一条 chunk 的整词查询仍命中
      expect((await searchWithScope(projectPath, '月光')).map(r => r.text)).toContain('主角的剑在月光下')
    } finally {
      await cleanupProject(projectPath)
    }
  })

  it('tokens 缺失（NULL / 空串）行退回逐字 LIKE 兜底，不因改造而漏检', async () => {
    const projectPath = makeTempProject()
    try {
      expect((await addChunks(
        projectPath, randomUUID(), '第3章 主角.txt', ['主角的剑在月光下'], undefined,
      )).success).toBe(true)
      expect((await addChunks(
        projectPath, randomUUID(), '第4章 配角.txt', ['配角登场说话'], undefined,
      )).success).toBe(true)

      // 模拟存量库：一行 tokens 从未回填（NULL），一行回填失败留空串
      await setTokens(projectPath, '主角的剑在月光下', null)
      await setTokens(projectPath, '配角登场说话', '')

      // 词级子句对缺失行无效（无 tokens 可比）→ 命中只可能来自逐字兜底
      expect(await filterTexts(projectPath, `tokens LIKE '%主角%' OR tokens LIKE '%配角%'`)).toHaveLength(0)

      const protagonist = await searchWithScope(projectPath, '主角')
      expect(protagonist.find(r => r.text === '主角的剑在月光下')?.source).toBe('fts')

      const supporting = await searchWithScope(projectPath, '配角')
      expect(supporting.find(r => r.text === '配角登场说话')?.source).toBe('fts')
    } finally {
      await cleanupProject(projectPath)
    }
  })

  it('混合库：新行（有 tokens）词级命中 + 存量行（NULL tokens）逐字兜底，同一条 query 都召回', async () => {
    const projectPath = makeTempProject()
    try {
      expect((await addChunks(
        projectPath, randomUUID(), '第5章 新.txt', ['主角的新剑'], undefined,
      )).success).toBe(true)
      expect((await addChunks(
        projectPath, randomUUID(), '第6章 旧.txt', ['主角的旧剑'], undefined,
      )).success).toBe(true)
      await setTokens(projectPath, '主角的旧剑', null) // 存量行

      const results = await searchWithScope(projectPath, '主角')
      expect(results.map(r => r.text)).toContain('主角的新剑') // 词级
      expect(results.map(r => r.text)).toContain('主角的旧剑') // 兜底
      expect(results.every(r => r.source === 'fts')).toBe(true)
    } finally {
      await cleanupProject(projectPath)
    }
  })

  it('范围检索（chapterScope）在词级通道下仍生效，且 NULL 章节行不被排除', async () => {
    const projectPath = makeTempProject()
    try {
      expect((await addChunks(
        projectPath, randomUUID(), '第1章 甲.txt', ['主角在第一章'], undefined, undefined, { chapterNumber: 1 },
      )).success).toBe(true)
      expect((await addChunks(
        projectPath, randomUUID(), '第9章 乙.txt', ['主角在第九章'], undefined, undefined, { chapterNumber: 9 },
      )).success).toBe(true)

      const scoped = await searchWithScope(projectPath, '主角', undefined, 5, [1, 3])
      expect(scoped.map(r => r.text)).toContain('主角在第一章')
      expect(scoped.map(r => r.text)).not.toContain('主角在第九章')
    } finally {
      await cleanupProject(projectPath)
    }
  })
})

// ===== L3 T3 Fix round 1：候选池截断丢召回回归（Critical-1）+ tokens 列不可用兜底（Important-2）=====

describe('LanceDB 端到端：多词查询不再因候选池截断丢召回（L3 T3 Fix round 1）', () => {
  function makeTempProject(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'nf-fts-fix-'))
  }

  async function cleanupProject(projectPath: string): Promise<void> {
    await closeConnection(projectPath)
    fs.rmSync(projectPath, { recursive: true, force: true })
  }

  it('多词含高频词（的）：无关行不撑满候选池，真命中仍返回（reviewer 复现场景）', async () => {
    const projectPath = makeTempProject()
    try {
      // 200 行含高频词「的」的无关内容；目标行**最后**写入 →
      // 多词 OR + limit(topK*3) 会先按表扫描顺序截断，把目标挤出候选池（改造引入的静默丢召回）
      const noise = Array.from({ length: 200 }, (_, i) => `无关内容第${i}段，他的心情很复杂`)
      expect((await addChunks(projectPath, randomUUID(), '第1章 噪声.txt', noise, undefined)).success).toBe(true)
      expect((await addChunks(
        projectPath, randomUUID(), '第2章 目标.txt', ['主角的剑在月光下'], undefined,
      )).success).toBe(true)

      const results = await searchWithScope(projectPath, '主角的剑')
      expect(results.map(r => r.text)).toContain('主角的剑在月光下') // 真命中不丢
      expect(results.every(r => r.text.includes('主角'))).toBe(true) // 无关行不灌入（FTS 豁免阈值）
      expect(results.find(r => r.text === '主角的剑在月光下')?.source).toBe('fts')
    } finally {
      await cleanupProject(projectPath)
    }
  })

  it('实义单字词不被丢弃：200 条含「主角」的行不会挤出同时含「剑」的真命中', async () => {
    const projectPath = makeTempProject()
    try {
      // 若按「丢弃全部单字词」实现，词表退化为 ['主角'] → 201 行命中 → 上限截断 → 目标丢失
      const noise = Array.from({ length: 200 }, (_, i) => `主角的心情第${i}段`)
      expect((await addChunks(projectPath, randomUUID(), '第3章 噪声.txt', noise, undefined)).success).toBe(true)
      expect((await addChunks(
        projectPath, randomUUID(), '第4章 目标.txt', ['主角的剑在月光下'], undefined,
      )).success).toBe(true)

      const results = await searchWithScope(projectPath, '主角的剑')
      expect(results.map(r => r.text)).toContain('主角的剑在月光下')
      expect(results.every(r => r.text.includes('剑'))).toBe(true)
    } finally {
      await cleanupProject(projectPath)
    }
  })

  it('单字 query（剑）仍可检索到目标（单词查询能力保持）', async () => {
    const projectPath = makeTempProject()
    try {
      expect((await addChunks(
        projectPath, randomUUID(), '第5章 目标.txt', ['主角的剑在月光下'], undefined,
      )).success).toBe(true)

      const results = await searchWithScope(projectPath, '剑')
      expect(results.map(r => r.text)).toContain('主角的剑在月光下')
      expect(results.find(r => r.text === '主角的剑在月光下')?.source).toBe('fts')
    } finally {
      await cleanupProject(projectPath)
    }
  })

  it('tokens 列不可用（类型不符 / 补列失败）→ 词级表达式抛错时退回逐字 LIKE，FTS 不静默归零（Important-2）', async () => {
    const projectPath = makeTempProject()
    try {
      const db = await getConnection(projectPath)
      // 模拟 tokens 列未被正确补出（非字符串列）→ 词级表达式整体抛错
      await db.createTable('chunks', [{
        id: randomUUID(), docId: randomUUID(), fileName: '第1章 旧.txt',
        chapterNumber: 1, chapterTitle: '旧', text: '主角的剑在月光下',
        tokens: 0, chunkIndex: 0, totalChunks: 1, importedAt: '2026-01-01T00:00:00.000Z',
      }])

      // 证据：词级表达式在该表上确实抛错（否则本用例不成立）
      await expect(
        (await db.openTable('chunks')).query().filter("tokens LIKE '%主角%'").toArray(),
      ).rejects.toThrow()

      const results = await searchWithScope(projectPath, '主角')
      expect(results.map(r => r.text)).toContain('主角的剑在月光下') // 改造前靠逐字 LIKE 可召回
      expect(results.find(r => r.text === '主角的剑在月光下')?.source).toBe('fts')
    } finally {
      await cleanupProject(projectPath)
    }
  })
})

// ===== L3 T4：RRF 融合（替换双通道 max 取并，排序在截断之前）=====

describe('LanceDB 端到端：RRF 融合排序在截断之前（L3 T4）', () => {
  function makeTempProject(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'nf-rrf-'))
  }

  async function cleanupProject(projectPath: string): Promise<void> {
    await closeConnection(projectPath)
    fs.rmSync(projectPath, { recursive: true, force: true })
  }

  const QUERY = '主角的剑' // 词级 AND 词表 = ['主角', '剑']（'的' 为功能词被丢弃）
  const QUERY_VECTOR = [1, 0, 0, 0]

  /**
   * 与 query 向量夹角 rad 的 4 维单位向量：L2 距离 d = 2·sin(rad/2)，
   * 相似度 = 1 - d/2 = 1 - sin(rad/2)（rad 越大越不相似）。
   */
  function vecAt(rad: number): number[] {
    return [Math.cos(rad), Math.sin(rad), 0, 0]
  }

  it('两通道共识行排首位；topK 截断发生在融合排序之后（单通道榜首跌出 top2）', async () => {
    const projectPath = makeTempProject()
    try {
      // A：仅向量命中（相似度最高 ≈0.90）
      // B：仅 FTS 命中（启发式 0.807；向量相似度最低 ≈0.36）
      // C：两通道都命中（FTS 1.0 rank1；向量 ≈0.70 rank2）——共识行
      // D：仅向量命中（相似度最低 ≈0.52，无 FTS）
      const A = '没有任何关键词的段落'
      const B = '剑在鞘中，主角静立'
      const C = '主角的剑在月光下'
      const D = '无关内容第二段'
      expect((await addChunks(
        projectPath, randomUUID(), '第1章 混合.txt', [A, B, C, D],
        [vecAt(0.2), vecAt(1.4), vecAt(0.6), vecAt(1.0)], undefined,
      )).success).toBe(true)

      // 前置证据：FTS 通道排序 = C(1.0) > B(0.807)（A/D 无词级命中）
      expect(computeFTSRelevance(C, QUERY)).toBeGreaterThan(computeFTSRelevance(B, QUERY))
      expect(computeFTSRelevance(A, QUERY)).toBeLessThan(computeFTSRelevance(B, QUERY))

      const full = await searchWithScope(projectPath, QUERY, QUERY_VECTOR, 4)
      // RRF：C(1/62+1/61≈0.0325) > B(1/64+1/62≈0.0318) > A(1/61≈0.0164) > D(1/63≈0.0159)
      expect(full.map(r => r.text)).toEqual([C, B, A, D])

      const top2 = await searchWithScope(projectPath, QUERY, QUERY_VECTOR, 2)
      expect(top2.map(r => r.text)).toEqual([C, B])

      // ⚠️ 回归证据（T3 handoff）：A 是向量通道榜首、原始分最高，但在融合排序里是第 3 名
      //   → ① 排序只用品秩（分数更高却排在 B 之后）；② 截断在融合排序之后
      //   （max 取并语义按原始分排：C 1.0 > A 0.90 > B 0.807 > D 0.52 → top2 会是 [C, A]）
      const foundA = full.find(r => r.text === A)!
      const foundB = full.find(r => r.text === B)!
      expect(foundA.score).toBeGreaterThan(foundB.score)
      expect(full.indexOf(foundA)).toBeGreaterThan(full.indexOf(foundB))
      expect(top2.map(r => r.text)).not.toContain(A)
      expect(top2.map(r => r.text)).not.toContain(D)

      // score/source 语义保持通道原始分（rag-context-provider 靠 source='fts' 豁免 0.6 阈值）：
      //   C 两通道都命中 → 取较高者（FTS 1.0）→ source='fts'
      expect(full.find(r => r.text === C)?.source).toBe('fts')
      expect(foundB.source).toBe('fts')
      expect(foundA.source).toBe('vector')
      expect(full.every(r => Object.keys(r).sort().join(',') === 'fileName,score,source,text')).toBe(true)
    } finally {
      await cleanupProject(projectPath)
    }
  })

  it('单通道（仅向量命中）退化为向量相似度序，RRF 不改单通道排序', async () => {
    const projectPath = makeTempProject()
    try {
      const A = '没有任何关键词的段落'
      const B = '剑在鞘中，主角静立'
      const C = '主角的剑在月光下'
      const D = '无关内容第二段'
      expect((await addChunks(
        projectPath, randomUUID(), '第1章 混合.txt', [A, B, C, D],
        [vecAt(0.2), vecAt(1.4), vecAt(0.6), vecAt(1.0)], undefined,
      )).success).toBe(true)

      // 该 query 词级 AND 无命中 → FTS 通道为空（仅向量通道有结果）
      const results = await searchWithScope(projectPath, '没有这个词的段落xyz', QUERY_VECTOR, 4)
      expect(results.map(r => r.text)).toEqual([A, C, D, B]) // 与向量相似度降序一致
      expect(results.every(r => r.source === 'vector')).toBe(true)
    } finally {
      await cleanupProject(projectPath)
    }
  })

  it('同一 text 多行（重复导入）只返回一次，且不因通道内重复而虚增融合分', async () => {
    const projectPath = makeTempProject()
    try {
      const DUP = '剑在鞘中，主角静立'
      const E = '主角的剑' // 两通道各 rank1（FTS 1.0 / 向量 ≈0.90）
      const F = '没有任何关键词的段落' // 仅向量 rank2（≈0.70）
      expect((await addChunks(
        projectPath, randomUUID(), '第1章 重复.txt', [DUP, DUP, DUP],
        [vecAt(1.4), vecAt(1.4), vecAt(1.4)], undefined,
      )).success).toBe(true)
      expect((await addChunks(
        projectPath, randomUUID(), '第2章 共识.txt', [E, F],
        [vecAt(0.2), vecAt(0.6)], undefined,
      )).success).toBe(true)

      const results = await searchWithScope(projectPath, QUERY, QUERY_VECTOR, 5)
      // 通道内按 text 去重后再品秩：E(1/61+1/61≈0.0328) > DUP(1/63+1/62≈0.0320) > F(1/62≈0.0161)；
      //   若不去重，DUP 占据 FTS 的 rank1/2/3 与向量的 rank3/4/5 → 融合分≈0.079 反超 E（排序错误）
      expect(results.map(r => r.text)).toEqual([E, DUP, F])
      expect(results.filter(r => r.text === DUP)).toHaveLength(1)
    } finally {
      await cleanupProject(projectPath)
    }
  })
})
