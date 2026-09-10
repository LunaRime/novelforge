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
