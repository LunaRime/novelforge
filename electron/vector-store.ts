/**
 * NovelForge 向量数据库封装 — 基于 LanceDB
 *
 * 提供本地嵌入式向量数据库能力，替代旧的 vectors.json 方案。
 * 支持两种检索模式：
 * - FTS-only（BM25 全文检索，零配置默认可用）
 * - 混合检索（FTS + 向量近邻，需要 Embedding 模型）
 *
 * 存储位置：{projectPath}/.vela/lancedb/
 */
import type * as LanceDB from '@lancedb/lancedb'
import { Field, FixedSizeList as ArrowFixedSizeList, Float32, Int32, Utf8, Schema as ArrowSchema } from 'apache-arrow'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { logger } from './utils/logger'
import { safeErrorMessage } from './utils/error-utils'
import { t } from '../src/shared/locale'

// 懒加载：避免 Electron 启动时同步 require 原生模块导致数秒无日志
let _lancedb: typeof LanceDB | null = null
function getLanceDB(): typeof LanceDB {
  if (!_lancedb) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _lancedb = require('@lancedb/lancedb')
    logger.debug('VectorStore', t('log.vectorStore.moduleLoaded'))
  }
  return _lancedb as typeof LanceDB
}

// ===== 类型定义 =====

/** 写入 LanceDB 的文本块记录 */
export interface ChunkRecord {
  [key: string]: unknown
  id: string
  docId: string
  fileName: string
  /** 章节号（可选，用于范围检索） */
  chapterNumber?: number
  /** 章节标题（可选，用于展示） */
  chapterTitle?: string
  text: string
  vector?: number[]
  chunkIndex: number
  totalChunks: number
  importedAt: string
}

/** 文档元信息（聚合查询结果） */
export interface DocumentInfo {
  [key: string]: unknown
  id: string
  fileName: string
  importedAt: string
  chunkCount: number
  filePath: string
}

/** 检索结果 */
export interface SearchResult {
  text: string
  score: number
  fileName: string
  /** 命中通道：vector=向量检索 / fts=全文匹配（精确关键词召回） */
  source?: 'vector' | 'fts'
}

/**
 * L2 归一化（P0 修复：检索度量统一——OpenAI 原始 embedding 未归一化、LLM 兜底向量已归一化，
 * 混库后 1/(1+d) 分数域断裂；归一化后 L2 距离 ∈[0,2]，相似度 = 1 - d/2 可解释）
 */
export function normalizeVector(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
  if (norm === 0 || !Number.isFinite(norm)) return v
  return v.map(x => x / norm)
}

/** 从 LanceDB 行值提取向量维度（兼容 Arrow FixedSizeList / number[] / toArray） */
function extractVectorDim(v: unknown): number | null {
  if (!v) return null
  if (Array.isArray(v)) return v.length
  if (typeof v === 'object') {
    const obj = v as { toArray?: () => number[]; dataType?: unknown }
    if (typeof obj.toArray === 'function') {
      try { return obj.toArray().length } catch { /* fallthrough */ }
    }
    // Arrow FixedSizeList 的 dataType 可能嵌套 listSize 信息
    const json = JSON.stringify(obj.dataType ?? '')
    const m = json.match(/listSize[^0-9]*(\d+)/)
    if (m) return parseInt(m[1], 10)
  }
  return null
}

/** 知识库统计 */
export interface KBStats {
  documentCount: number
  totalChunks: number
  vectorDimension: number
  hasVectors: boolean
}

// ===== 常量 =====

const TABLE_NAME = 'chunks'
const DOCS_TABLE_NAME = 'documents'

/**
 * 校验并转义 LanceDB 过滤表达式中使用的值，防止注入
 * LanceDB 的 delete/update/filter 接受类 SQL 字符串，单引号是主要注入向量
 */
function sanitizeFilterValue(value: string, context: string): string {
  if (!value || typeof value !== 'string') {
    throw new Error(t('error.vectorFilterInvalid').replace('{context}', context))
  }
  // 移除可能导致注入的字符（反斜杠、NULL字节等），然后转义单引号
  const cleaned = value.replace(/\\/g, '').replace(/\0/g, '')
  return cleaned.replace(/'/g, "''")
}

/** UUID v4 格式校验（用于 docId/id 等内部 ID） */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function validateUUID(value: string, context: string): void {
  if (!UUID_RE.test(value)) {
    logger.warn('VectorStore', t('log.vectorStore.invalidUuid').replace('{context}', context).replace('{value}', value.slice(0, 50)))
  }
}

/** 从第一个有效向量中检测维度；无向量时返回 0（表示纯 FTS 模式） */
function detectVectorDim(records: ChunkRecord[]): number {
  for (const r of records) {
    if (r.vector && r.vector.length > 0) return r.vector.length
  }
  return 0
}

/** 构建包含可选向量列的 Arrow Schema */
function buildChunksSchema(vectorDim: number): ArrowSchema {
  const fields: Field[] = [
    new Field('id', new Utf8()),
    new Field('docId', new Utf8()),
    new Field('fileName', new Utf8()),
    new Field('chapterNumber', new Int32(), true),
    new Field('chapterTitle', new Utf8(), true),
    new Field('text', new Utf8()),
  ]
  // 仅在确实有向量数据时添加 FixedSizeList 列
  if (vectorDim > 0) {
    fields.push(new Field('vector', new ArrowFixedSizeList(vectorDim, new Field('item', new Float32())), true))
  }
  fields.push(
    new Field('chunkIndex', new Int32()),
    new Field('totalChunks', new Int32()),
    new Field('importedAt', new Utf8()),
  )
  return new ArrowSchema(fields)
}

// ===== 连接池（按项目路径缓存） =====

const connectionPool = new Map<string, LanceDB.Connection>()

/** 获取 LanceDB 连接（惰性创建） */
export async function getConnection(projectPath: string): Promise<LanceDB.Connection> {
  const dbPath = path.join(projectPath, '.vela', 'lancedb')

  const cached = connectionPool.get(dbPath)
  if (cached) return cached

  // 确保目录存在
  fs.mkdirSync(dbPath, { recursive: true })

  const db = await getLanceDB().connect(dbPath)
  connectionPool.set(dbPath, db)
  return db
}

/** 关闭指定项目的连接（⚠️ P3 修复：真正关闭底层连接——此前仅从 Map 删除，原生内存不释放） */
export async function closeConnection(projectPath: string): Promise<void> {
  const dbPath = path.join(projectPath, '.vela', 'lancedb')
  const conn = connectionPool.get(dbPath)
  if (conn) {
    try { await conn.close() } catch { /* 忽略关闭失败 */ }
    connectionPool.delete(dbPath)
  }
}


// ===== 核心操作 =====

/**
 * 写入文档块到 LanceDB
 * 支持带向量（混合模式）和不带向量（FTS-only 模式）
 */
export async function addChunks(
  projectPath: string,
  docId: string,
  fileName: string,
  chunks: string[],
  vectors?: number[][],
  filePath?: string,
  metadata?: { chapterNumber?: number; chapterTitle?: string },
): Promise<{ success: boolean; chunkCount: number; error?: string }> {
  try {
    const db = await getConnection(projectPath)
    const now = new Date().toISOString()

    // 构建记录
    const records: ChunkRecord[] = chunks.map((text, i) => {
      const record: ChunkRecord = {
        id: randomUUID(),
        docId,
        fileName,
        text,
        chunkIndex: i,
        totalChunks: chunks.length,
        importedAt: now,
        chapterNumber: metadata?.chapterNumber,
        chapterTitle: metadata?.chapterTitle,
      }
      // 如果有向量，附加到记录上（⚠️ P0：统一 L2 归一化——混库后度量空间一致）
      if (vectors && vectors[i] && vectors[i].length > 0) {
        record.vector = normalizeVector(vectors[i])
      }
      return record
    })

    // 写入 chunks 表
    const tableNames = await db.tableNames()
    const VECTOR_DIM = detectVectorDim(records)
    const targetSchema = buildChunksSchema(VECTOR_DIM)

    if (tableNames.includes(TABLE_NAME)) {
      const table = await db.openTable(TABLE_NAME)
      const existingSchema = await table.schema()
      const existingFieldNames = existingSchema.fields.map(f => f.name)
      // 检查旧表 schema 是否包含所有必要字段
      const requiredFields = ['id', 'docId', 'fileName', 'text', 'chunkIndex', 'totalChunks', 'importedAt', 'chapterNumber', 'chapterTitle', 'vector']
      const hasAllFields = requiredFields.every(f => existingFieldNames.includes(f))

      if (hasAllFields) {
        // ⚠️ P1 修复：维度守卫——模型切换后向量维度不一致时 table.add 硬失败且外层 catch 吞掉
        //    （用户看到"导入失败"却无原因）；采样现有行探测维度，不一致给明确错误
        if (vectors && vectors.length > 0 && vectors[0].length > 0) {
          try {
            const sample = await table.query().limit(1).toArray()
            if (sample.length > 0) {
              const existingDim = extractVectorDim((sample[0] as { vector?: unknown }).vector)
              if (existingDim && existingDim !== vectors[0].length) {
                return {
                  success: false,
                  chunkCount: 0,
                  error: t('error.vectorDimMismatch')
                    .replace('{expected}', String(existingDim))
                    .replace('{actual}', String(vectors[0].length)),
                }
              }
            }
          } catch { /* 探测失败跳过（由 add 失败兜底） */ }
        }
        await table.add(records)
      } else {
        // schema 不匹配（旧表缺少字段），需要重建表
        // 先把 Arrow Vector 对象转成纯 number[]，避免 isValid 等元数据字段干扰 schema 校验
        const allRows = await table.query().toArray()
        const cleanRows = allRows.map((r: Record<string, unknown>) => {
          const cleaned: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(r)) {
            if (k === 'vector' && v) {
              // Arrow Vector → 纯数组
              const vec = v as { toArray?: () => number[] }
              cleaned[k] = vec.toArray ? vec.toArray() : v
            } else {
              cleaned[k] = v
            }
          }
          return cleaned
        })
        await db.dropTable(TABLE_NAME)
        await db.createTable(TABLE_NAME, [...cleanRows, ...records], { schema: targetSchema })
      }
    } else {
      // 首次创建时使用显式 Schema，确保 vector 列正确识别为 FixedSizeList
      await db.createTable(TABLE_NAME, records, { schema: targetSchema })
    }

    // 写入/更新 documents 表
    const docInfo: DocumentInfo = {
      id: docId,
      fileName,
      importedAt: now,
      chunkCount: chunks.length,
      filePath: filePath || '',
    }

    if (tableNames.includes(DOCS_TABLE_NAME)) {
      const docsTable = await db.openTable(DOCS_TABLE_NAME)
      // 先删除同名文档（幂等性），再添加新的
      try {
        const safeName = sanitizeFilterValue(fileName, 'fileName')
        await docsTable.delete(`fileName = '${safeName}'`)
      } catch { /* 表可能为空或无匹配 */ }
      await docsTable.add([docInfo])
    } else {
      await db.createTable(DOCS_TABLE_NAME, [docInfo])
    }

    // 尝试创建 FTS 索引（如果尚不存在）
    try {
      const chunksTable = await db.openTable(TABLE_NAME)
      await chunksTable.createIndex('text', {
        config: getLanceDB().Index.fts(),
      })
    } catch {
      // FTS 索引可能已存在，忽略错误
    }

    // 尝试创建向量 ANN 索引（IVF_PQ）
    await ensureVectorIndex(projectPath)

    return { success: true, chunkCount: chunks.length }
  } catch (error) {
    logger.error('VectorStore', t('log.vectorStore.writeFailed').replace('{err}', String(error)))
    return { success: false, chunkCount: 0, error: safeErrorMessage(error) }
  }
}

/**
 * 删除文档及其所有块
 */
export async function removeDocument(
  projectPath: string,
  docId: string,
): Promise<boolean> {
  try {
    const db = await getConnection(projectPath)
    const tableNames = await db.tableNames()

    if (tableNames.includes(TABLE_NAME)) {
      const table = await db.openTable(TABLE_NAME)
      validateUUID(docId, 'removeDocument.docId')
      const safeDocId = sanitizeFilterValue(docId, 'docId')
      await table.delete(`docId = '${safeDocId}'`)
    }

    if (tableNames.includes(DOCS_TABLE_NAME)) {
      const docsTable = await db.openTable(DOCS_TABLE_NAME)
      const safeId = sanitizeFilterValue(docId, 'id')
      await docsTable.delete(`id = '${safeId}'`)
    }

    return true
  } catch (error) {
    logger.error('VectorStore', t('log.vectorStore.deleteFailed').replace('{err}', String(error)))
    return false
  }
}

/**
 * 确保向量 ANN 索引存在（IVF_PQ）
 * 仅在 chunk 数量超过阈值且有向量列时创建，避免小数据量下索引开销
 */
async function ensureVectorIndex(projectPath: string): Promise<void> {
  try {
    const db = await getConnection(projectPath)
    const tableNames = await db.tableNames()
    if (!tableNames.includes(TABLE_NAME)) return

    const table = await db.openTable(TABLE_NAME)
    const chunkCount = await table.countRows()

    // 仅当 chunk 数量 > 1000 时创建向量索引（小数据集暴力扫描更快）
    const MIN_CHUNKS_FOR_INDEX = 1000
    if (chunkCount < MIN_CHUNKS_FOR_INDEX) return

    // 检查是否有 vector 列（纯 FTS 模式则跳过）
    const schema = await table.schema()
    const hasVectorCol = schema.fields.some(f => f.name === 'vector')
    if (!hasVectorCol) return

    // 检查是否已有向量索引
    const existingIndices = await table.listIndices()
    const hasVectorIndex = existingIndices.some(idx => idx.name === 'vector_idx')
    if (hasVectorIndex) return

    const numPartitions = Math.max(4, Math.floor(chunkCount / 1000))
    await table.createIndex('vector', {
      config: getLanceDB().Index.ivfPq({
        numPartitions,
        numSubVectors: 64,
      }),
      replace: true,
    })
    logger.info('VectorStore', t('log.vectorStore.indexCreated')
      .replace('{chunks}', String(chunkCount))
      .replace('{partitions}', String(numPartitions)))
  } catch (e) {
    // 索引创建失败不应阻断正常流程（可能 LanceDB 版本不支持 IVF_PQ）
    logger.warn('VectorStore', t('log.vectorStore.indexCreateFailed').replace('{err}', String(e).slice(0, 200)))
  }
}

/**
 * 统一检索入口 — 自动选择 FTS / 混合模式
 *
 * @param queryText 搜索关键词/语句
 * @param queryVector 查询向量（可选，有值时启用混合检索）
 * @param topK 返回前 K 个结果
 */
export async function search(
  projectPath: string,
  queryText: string,
  queryVector?: number[],
  topK: number = 5,
): Promise<SearchResult[]> {
  return searchWithScope(projectPath, queryText, queryVector, topK)
}

/**
 * 支持章节范围限定的检索入口
 *
 * @param queryText 搜索关键词/语句
 * @param queryVector 查询向量（可选，有值时启用混合检索）
 * @param topK 返回前 K 个结果
 * @param chapterScope 可选，限定检索的章节范围 [fromChapter, toChapter]
 */
export async function searchWithScope(
  projectPath: string,
  queryText: string,
  queryVector?: number[],
  topK: number = 5,
  chapterScope?: [number, number],
): Promise<SearchResult[]> {
  try {
    const db = await getConnection(projectPath)
    const tableNames = await db.tableNames()
    if (!tableNames.includes(TABLE_NAME)) return []

    const table = await db.openTable(TABLE_NAME)

    // 构建范围过滤条件（⚠️ P0 修复：无章节元数据的文档（设定集/角色卡/大纲）纳入范围检索——
    //   NULL 不满足 BETWEEN 恒 false，此前被结构性排除在章节写作 RAG 之外）
    let scopeFilter: string | undefined
    if (chapterScope) {
      const [from, to] = chapterScope
      scopeFilter = `(chapterNumber >= ${from} AND chapterNumber <= ${to}) OR chapterNumber IS NULL`
    }

    // ⚠️ P0 修复：真混合检索——向量 + FTS 双通道并行取并集，分数取通道 max，
    //    此前向量检索有结果即 return，FTS 的精确关键词召回（人名/专有名词/原句）永不参与融合
    const candidates = new Map<string, SearchResult>()
    const pushCandidate = (text: string, fileName: string, score: number, source: 'vector' | 'fts') => {
      const cur = candidates.get(text)
      if (!cur || score > cur.score) {
        candidates.set(text, { text, fileName, score, source })
      }
    }

    // 通道 1：向量检索（查询端归一化；相似度 = 1 - d/2，归一化后 L2 距离 ∈[0,2]）
    if (queryVector && queryVector.length > 0) {
      try {
        const normQuery = normalizeVector(queryVector)
        const query = table.search(normQuery).limit(topK * 3)
        const results = await (scopeFilter ? query.where(scopeFilter) : query).toArray()
        for (const r of results as Array<{ text: string; _distance?: number; fileName: string }>) {
          const dist = r._distance ?? 0
          const similarity = Math.max(0, Math.min(1, 1 - dist / 2))
          pushCandidate(r.text, r.fileName, similarity, 'vector')
        }
      } catch {
        // 向量检索失败，降级到 FTS 通道
      }
    }

    // 通道 2：FTS（DataFusion LIKE 模糊匹配，Tantivy 不支持中文分词）
    try {
      // ⚠️ P3 修复：查询中的 %/_ 转全角（LIKE 通配符注入——'100%' 此前匹配 "100任意串"；
      //    逐字拆分产生的 % 已用于容错匹配，查询自身的通配符需消除语义）
      const escapedQuery = queryText
        .replace(/'/g, "''")
        .replace(/%/g, '％')
        .replace(/_/g, '＿')
      // 将 "搜索" 转换为 "%搜%索%" 进行容错匹配
      const likePattern = `%${escapedQuery.split('').join('%')}%`

      let q = table.query().filter(`text LIKE '${likePattern}'`).limit(topK * 3)
      if (scopeFilter) {
        q = q.where(scopeFilter)
      }
      const results = await q.toArray()

      for (const r of results as Array<{ text: string; fileName: string }>) {
        // FTS 无真实打分（0.5）——调用方对 fts 来源豁免相似度阈值（精确匹配本身保证相关性）
        pushCandidate(r.text, r.fileName, 0.5, 'fts')
      }
    } catch (e) {
      logger.warn('VectorStore', t('log.vectorStore.ftsSearchFailed').replace('{err}', String(e)))
    }

    // 融合排序（双通道取高后按分数降序）
    return [...candidates.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  } catch (error) {
    logger.error('VectorStore', t('log.vectorStore.searchFailed').replace('{err}', String(error)))
    return []
  }
}

/**
 * 列出所有已导入文档
 */
export async function listDocuments(
  projectPath: string,
): Promise<DocumentInfo[]> {
  try {
    const db = await getConnection(projectPath)
    const tableNames = await db.tableNames()
    if (!tableNames.includes(DOCS_TABLE_NAME)) return []

    const docsTable = await db.openTable(DOCS_TABLE_NAME)
    const rows = await docsTable.query().toArray()
    return rows.map((r: { id: string; fileName: string; importedAt: string; chunkCount: number; filePath?: string }) => ({
      id: r.id,
      fileName: r.fileName,
      importedAt: r.importedAt,
      chunkCount: r.chunkCount,
      filePath: r.filePath || '',
    }))
  } catch {
    return []
  }
}

/**
 * 获取知识库统计信息
 */
export async function getStats(projectPath: string): Promise<KBStats> {
  try {
    const db = await getConnection(projectPath)
    const tableNames = await db.tableNames()

    if (!tableNames.includes(TABLE_NAME)) {
      return { documentCount: 0, totalChunks: 0, vectorDimension: 0, hasVectors: false }
    }

    const docs = tableNames.includes(DOCS_TABLE_NAME)
      ? await (await db.openTable(DOCS_TABLE_NAME)).countRows()
      : 0

    const table = await db.openTable(TABLE_NAME)
    const totalChunks = await table.countRows()

    // 检测是否有向量列（通过 schema 而非运行时值判断）
    let hasVectors = false
    let vectorDimension = 0
    try {
      const schema = await table.schema()
      const vectorField = schema.fields.find(f => f.name === 'vector')
      if (vectorField) {
        hasVectors = true
        // 从 FixedSizeList 类型中提取实际维度
        const vecType = vectorField.type as { listSize?: number }
        vectorDimension = vecType.listSize ?? 0
      }
    } catch { /* 忽略 */ }

    return {
      documentCount: docs,
      totalChunks,
      vectorDimension,
      hasVectors,
    }
  } catch {
    return { documentCount: 0, totalChunks: 0, vectorDimension: 0, hasVectors: false }
  }
}

/**
 * 获取没有向量的文本块数量（用于回填检测）
 */
export async function getChunksWithoutVectors(
  projectPath: string,
): Promise<{ count: number }> {
  try {
    const db = await getConnection(projectPath)
    const tableNames = await db.tableNames()
    if (!tableNames.includes(TABLE_NAME)) return { count: 0 }

    const table = await db.openTable(TABLE_NAME)
    const schema = await table.schema()
    const hasVectorCol = schema.fields.some(f => f.name === 'vector')

    if (!hasVectorCol) {
      const total = await table.countRows()
      return { count: total }
    }

    // 有 vector 列的情况下，统计 vector 为 null 的记录
    const all = await table.query().select(['id', 'vector']).toArray()
    const missing = all.filter((r: { id: string; vector?: unknown }) => {
      if (!r.vector) return true
      const vec = r.vector as { length?: number; toArray?: () => unknown[] }
      if (typeof vec.toArray === 'function') {
        return vec.toArray().length === 0
      }
      return (vec.length ?? -1) === 0
    })
    return { count: missing.length }
  } catch (e) {
    logger.error('VectorStore', `getChunksWithoutVectors error: ${e}`)
    return { count: 0 }
  }
}

/**
 * 为缺少向量的块批量回填向量
 * 返回无向量的块列表（id + text），供调用方批量生成向量后更新
 */
export async function getChunksForBackfill(
  projectPath: string,
  batchSize: number = 50,
): Promise<Array<{ id: string; text: string }>> {
  try {
    const db = await getConnection(projectPath)
    const tableNames = await db.tableNames()
    if (!tableNames.includes(TABLE_NAME)) return []

    const table = await db.openTable(TABLE_NAME)
    const schema = await table.schema()
    const hasVectorCol = schema.fields.some(f => f.name === 'vector')

    let missing = []

    if (!hasVectorCol) {
      const all = await table.query().select(['id', 'text']).toArray()
      missing = all // 全部没有向量
    } else {
      const all = await table.query().select(['id', 'text', 'vector']).toArray()
      missing = all.filter((r: { id: string; text: string; vector?: unknown }) => {
        if (!r.vector) return true
        const vec = r.vector as { length?: number; toArray?: () => number[] }
        const len = vec.toArray ? vec.toArray().length : (vec.length ?? 0)
        return len === 0
      })
    }

    // 只返回一批
    return missing.slice(0, batchSize).map((r: { id: string; text: string; vector?: number[] }) => ({
      id: r.id,
      text: r.text,
    }))
  } catch {
    return []
  }
}

/**
 * 更新指定块的向量（回填用）
 */
export async function updateChunkVectors(
  projectPath: string,
  updates: Array<{ id: string; vector: number[] }>,
): Promise<{ success: boolean; count: number }> {
  try {
    const db = await getConnection(projectPath)
    const tableNames = await db.tableNames()
    if (!tableNames.includes(TABLE_NAME)) return { success: false, count: 0 }

    const table = await db.openTable(TABLE_NAME)
    const schema = await table.schema()
    const hasVectorCol = schema.fields.some(f => f.name === 'vector')

    if (hasVectorCol) {
      // 如果已有 vector 列，直接 update（⚠️ 统一 L2 归一化——与 addChunks 度量一致）
      for (const update of updates) {
        try {
          await table.update({
            where: `id = '${update.id}'`,
            values: { vector: normalizeVector(update.vector) },
          })
        } catch (e) {
          logger.warn('VectorStore', t('log.vectorStore.updateVectorFailed').replace('{id}', update.id).replace('{err}', String(e)))
        }
      }
      // 回填后尝试创建向量索引
      await ensureVectorIndex(projectPath)
      return { success: true, count: updates.length }
    } else {
      // 没有 vector 列，必须覆写全表以增加列
      const allRecords = await table.query().toArray()
      const newData = allRecords.map((r: { [key: string]: unknown; id: string }) => {
        const up = updates.find(u => u.id === r.id)
        if (up) return { ...r, vector: normalizeVector(up.vector) }
        return r
      })

      // 使用显式 Schema 确保 vector 列正确持久化
      // ⚠️ P1 修复：维度从实际向量探测——此前硬编码 2048，而 LLM 向量化默认 256 维
      //    → 纯 FTS 库的 LLM 回填写入 FixedSizeList(2048) 必败，回填整体失效
      const VECTOR_DIM = updates[0]?.vector?.length ?? 2048
      const vectorField = new Field('vector', new ArrowFixedSizeList(VECTOR_DIM, new Field('item', new Float32())), true)
      const schema = new ArrowSchema([
        new Field('id', new Utf8()),
        new Field('docId', new Utf8()),
        new Field('fileName', new Utf8()),
        new Field('chapterNumber', new Int32(), true),
        new Field('chapterTitle', new Utf8(), true),
        new Field('text', new Utf8()),
        vectorField,
        new Field('chunkIndex', new Int32()),
        new Field('totalChunks', new Int32()),
        new Field('importedAt', new Utf8()),
      ])

      await db.dropTable(TABLE_NAME)
      await db.createTable(TABLE_NAME, newData, { schema })

      // 重建 FTS 索引
      try {
        const newTable = await db.openTable(TABLE_NAME)
        await newTable.createIndex('text', { config: getLanceDB().Index.fts() })
      } catch (e) {
        logger.warn('VectorStore', t('log.vectorStore.ftsRebuildFailed').replace('{err}', String(e)))
      }

      // 回填后尝试创建向量索引
      await ensureVectorIndex(projectPath)

      return { success: true, count: updates.length }
    }
  } catch (error) {
    logger.error('VectorStore', t('log.vectorStore.batchUpdateFailed').replace('{err}', String(error)))
    return { success: false, count: 0 }
  }
}

/**
 * 从旧 vectors.json 迁移数据到 LanceDB
 */
export async function migrateFromJSON(
  projectPath: string,
): Promise<{ success: boolean; migrated: number; error?: string }> {
  const jsonPath = path.join(projectPath, '.vela', 'vectors.json')

  if (!fs.existsSync(jsonPath)) {
    return { success: true, migrated: 0 }
  }

  try {
    logger.info('VectorStore', t('log.vectorStore.migrationDetected'))
    const raw = fs.readFileSync(jsonPath, 'utf-8')
    const store = JSON.parse(raw) as {
      documents: Array<{ id: string; fileName: string; importedAt: string; chunkCount: number; filePath: string }>
      entries: Array<{ id: string; docId: string; text: string; vector: number[]; meta: { fileName: string; chunkIndex: number; totalChunks: number } }>
    }

    if (!store.entries || store.entries.length === 0) {
      // 空知识库，无需迁移
      fs.renameSync(jsonPath, jsonPath + '.migrated')
      return { success: true, migrated: 0 }
    }

    // 按文档分组写入
    const docMap = new Map<string, typeof store.entries>()
    for (const entry of store.entries) {
      const arr = docMap.get(entry.docId) || []
      arr.push(entry)
      docMap.set(entry.docId, arr)
    }

    let migrated = 0
    for (const [docId, entries] of docMap) {
      const docInfo = store.documents.find(d => d.id === docId)
      const fileName = docInfo?.fileName || entries[0]?.meta?.fileName || 'unknown'

      const chunks = entries.map(e => e.text)
      const vectors = entries.map(e => e.vector).filter(v => v && v.length > 0)

      await addChunks(
        projectPath,
        docId,
        fileName,
        chunks,
        vectors.length === chunks.length ? vectors : undefined,
        docInfo?.filePath,
      )
      migrated += entries.length
    }

    // 迁移完成，重命名旧文件
    fs.renameSync(jsonPath, jsonPath + '.migrated')
    logger.info('VectorStore', t('log.vectorStore.migrationDone').replace('{count}', String(migrated)))

    return { success: true, migrated }
  } catch (error) {
    logger.error('VectorStore', t('log.vectorStore.migrationFailed').replace('{err}', String(error)))
    return { success: false, migrated: 0, error: safeErrorMessage(error) }
  }
}
