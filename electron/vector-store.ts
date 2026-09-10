/**
 * NovelForge 向量数据库封装 — 基于 LanceDB
 *
 * 提供本地嵌入式向量数据库能力，替代旧的 vectors.json 方案。
 * 支持两种检索模式：
 * - FTS-only（BM25 全文检索，零配置默认可用）
 * - 混合检索（FTS + 向量近邻，需要 Embedding 模型）
 *
 * 存储位置：{projectPath}/.novelforge/lancedb/
 */
import type * as LanceDB from '@lancedb/lancedb'
import { Field, FixedSizeList as ArrowFixedSizeList, Float32, Int32, Utf8, Schema as ArrowSchema } from 'apache-arrow'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { logger } from './utils/logger'
import { safeErrorMessage } from './utils/error-utils'
import { t } from '../src/shared/locale'
import { getProjectVelaDir } from './utils/config-utils'
import { tokenize, tokenizeToSpaceSeparated } from './chinese-tokenizer'

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
  /** jieba 分词结果（空格分隔，L3 中文词级 FTS 检索用；缺失时检索侧退回逐字 LIKE） */
  tokens?: string
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

/** 从既有表 schema 的 vector 列解析维度（FixedSizeList listSize）；无该列返回 0 */
function detectVectorDimFromSchema(fields: Array<{ name: string; type: unknown }>): number {
  const vectorField = fields.find(f => f.name === 'vector')
  if (!vectorField) return 0
  const listSize = (vectorField.type as { listSize?: number }).listSize
  return typeof listSize === 'number' ? listSize : 0
}

/**
 * 补列（L3 T2 实证修复）：必须用 addColumns 的 **SQL 表达式** 形式，不能用 `[new Field(...)]`。
 *
 * `Table.addColumns` 内部以 `instanceof Field/Schema` 判定入参类型，而打包产物中主进程那份
 * apache-arrow 是 **Rolldown 内联的 ESM 副本**（`//#region node_modules/.../apache-arrow/*.mjs`），
 * 与 external 的 `@lancedb/lancedb` 自己 `require('apache-arrow')` 的 CJS 副本**不是同一实例**——
 * instanceof 恒 false，入参被当作 SQL 表达式数组处理而报 "Missing field `valueSql`"，
 * 迁移静默失效（vitest 下同样复现；`createTable({schema})` 无此问题——lancedb 内部有
 * `sanitizeSchema` 专门处理多副本，addColumns 没有）。SQL 形式走 napi 侧、不做 instanceof。
 */
async function addNullableColumn(
  table: LanceDB.Table,
  name: string,
  sqlType: 'string' | 'int',
): Promise<void> {
  await table.addColumns([{ name, valueSql: `cast(NULL as ${sqlType})` }])
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
    // L3 T2：中文分词结果列（Utf8，空格分隔词串；可空——存量行回填前为 NULL，检索侧退回 LIKE）
    new Field('tokens', new Utf8(), true),
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
  const dbPath = path.join(getProjectVelaDir(projectPath), 'lancedb')

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
  const dbPath = path.join(getProjectVelaDir(projectPath), 'lancedb')
  const conn = connectionPool.get(dbPath)
  if (conn) {
    try { await conn.close() } catch { /* 忽略关闭失败 */ }
    connectionPool.delete(dbPath)
  }
}


// ===== 存量 schema 自检迁移（P2） =====

/**
 * 存量表回填章节号解析（匹配真实定稿导入文件名 `第N章 标题.txt`；无匹配 null）
 * 宽松形式 `第\s*(\d+)\s*章`：定稿文件名 `第9章 标题.txt` 与带空格形式均匹配；
 * `.md` 后缀（旧格式 正文/要点/蓝图）不匹配，返回 null
 */
export function parseChapterNumberForBackfill(fileName: string): number | null {
  const m = fileName.match(/^第\s*(\d+)\s*章\s*(.+?)\.txt$/)
  return m ? parseInt(m[1], 10) : null
}

/**
 * chunks 表 schema 自检 + 迁移（P2：存量表缺 chapterNumber 列——导入路径已有重建自愈
 * （requiredFields 检查），检索/启动路径此前无修复，纯文本检索因 scopeFilter 查询
 * 不存在列而失败降级。add_columns 优先：不 drop 重建，避免向量数据重嵌入）。
 * L3 T2 追加：tokens 列同法自检补列（旧库升级后既可被检索侧 LIKE 兜底，
 * 也可被 kb:backfill-tokens 回填；列必须在任何 add/select 之前存在，
 * 否则 LanceDB 对含 tokens 键的记录直接报 "Found field not in schema"）。
 * 幂等：两列均已存在时零动作；调用方可安全地在检索/导入入口前置调用。
 */
export async function ensureChunksSchema(db: LanceDB.Connection): Promise<{ migrated: boolean; error?: string }> {
  try {
    const tableNames = await db.tableNames()
    if (!tableNames.includes(TABLE_NAME)) return { migrated: false }
    const table = await db.openTable(TABLE_NAME)
    const fields = (await table.schema()).fields.map(f => f.name)
    let migrated = false

    if (!fields.includes('chapterNumber')) {
      // add_columns 优先：不 drop 重建，存量向量数据原样保留
      await addNullableColumn(table, 'chapterNumber', 'int')
      // 从 fileName 解析回填（仅解析成功的行；无匹配保持默认 NULL——scopeFilter 已容忍 NULL）
      const rows = await table.query().select(['id', 'fileName']).toArray()
      for (const r of rows as Array<{ id: string; fileName?: string }>) {
        const chapterNumber = r.fileName ? parseChapterNumberForBackfill(r.fileName) : null
        if (chapterNumber === null) continue
        await table.update({
          where: `id = '${r.id}'`,
          values: { chapterNumber },
        }).catch(() => { /* 单行失败跳过 */ })
      }
      migrated = true
    }

    if (!fields.includes('tokens')) {
      // L3 T2：仅补列不在此处分词——存量行保持 NULL 由 backfillTokens 显式回填
      //（检索入口前置调用本函数，全表分词会阻塞首次检索；设计 §3.1 明确 NULL → LIKE 兜底）
      await addNullableColumn(table, 'tokens', 'string')
      migrated = true
    }

    return { migrated }
  } catch (e) {
    return { migrated: false, error: String(e) }
  }
}

// ===== 中文分词辅助（L3 T2） =====

/** 分词失败只告警一次，避免大库逐块刷屏 */
let tokenizerFailureLogged = false

/**
 * 对 chunk 文本分词，产出写入 chunks.tokens 的空格分隔词串。
 *
 * 惰性降级（设计 §3.1）：分词器不可用（wasm 加载失败等）或文本无有效词 → 返回 undefined，
 * 该行 tokens 写空 → 检索侧退回既有 LIKE 逐字匹配，导入流程不因分词失败而整体失败。
 */
export function buildChunkTokens(text: string): string | undefined {
  try {
    const tokens = tokenizeToSpaceSeparated(text)
    return tokens.trim() !== '' ? tokens : undefined
  } catch (e) {
    if (!tokenizerFailureLogged) {
      tokenizerFailureLogged = true
      // 非用户可见文本（仅落日志文件，与下方 getChunksWithoutVectors 的 raw 日志同例），
      // 故不引入新的 i18n 键（本任务文件范围不含 locale-data.ts）
      logger.warn('VectorStore', `tokenize failed, tokens written empty (LIKE fallback): ${safeErrorMessage(e)}`)
    }
    return undefined
  }
}

/** tokens 缺失判定：null / undefined / 空串 / 纯空白（旧表无该列时读出 undefined） */
function isMissingTokens(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === ''
}

/**
 * 筛出缺 tokens 的行（纯函数，供 getChunksWithoutTokens / backfillTokens 共用）。
 * 抽出为纯函数以便在无 LanceDB 环境下用 mock 数据断言回填选择与幂等语义。
 */
export function selectRowsMissingTokens<T extends { tokens?: unknown }>(rows: T[]): T[] {
  return rows.filter(r => isMissingTokens(r.tokens))
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

    // L3 T2：写入前先自检补列（tokens）——add_columns 幂等且不重建表（存量向量保留）。
    // 否则存量表缺 tokens 列时，下方 table.add(records) 会因记录含 tokens 键而
    // 报 "Found field not in schema: tokens" 导致整个导入失败
    const schemaCheck = await ensureChunksSchema(db)
    if (schemaCheck.error) {
      logger.warn('VectorStore', `ensureChunksSchema before add failed: ${schemaCheck.error.slice(0, 200)}`)
    }

    // 构建记录
    const records: ChunkRecord[] = chunks.map((text, i) => {
      const record: ChunkRecord = {
        id: randomUUID(),
        docId,
        fileName,
        text,
        // L3 T2：中文分词（空格分隔词串）；分词不可用时为 undefined → 检索侧退回 LIKE
        tokens: buildChunkTokens(text),
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
      const requiredFields = ['id', 'docId', 'fileName', 'text', 'chunkIndex', 'totalChunks', 'importedAt', 'chapterNumber', 'chapterTitle', 'tokens', 'vector']
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
        // L3 T2 加固：本次导入无向量而旧表已有 vector 列时，重建 schema 必须保留该列
        //（沿用旧列维度）——否则存量行的 vector 字段会让 makeArrowTable 报
        //"Found field not in schema: vector" 使整个导入失败、且向量列被整体丢弃
        const rebuildSchema = VECTOR_DIM > 0
          ? targetSchema
          : buildChunksSchema(detectVectorDimFromSchema(existingSchema.fields))
        await db.createTable(TABLE_NAME, [...cleanRows, ...records], { schema: rebuildSchema })
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
 * FTS 相关性启发式打分（P1-1）：纯 FTS 模式（无 Embedding 配置）的排序依据。
 *
 * 背景：DataFusion LIKE 逐字匹配没有真实打分（恒 0.5）——无向量时全部候选同分，
 * 融合排序退化为表扫描顺序，"最相关"不保证排前。此处给 FTS 命中加启发式分数。
 *
 * 范围 [0.5, 1.0]：FTS 命中本身保证相关性（调用方对 fts 来源豁免相似度阈值），
 * 分数只用于**排序**。加分项（各带权重）：
 * - 逐字命中率：query 去重字符中出现在 text 里的比例（0.5 权重）
 * - 最长连续命中片段：query 中最长连续 n-gram（2-4 字）能在 text 中找到的长度占比（0.3 权重）
 * - 首个命中位置靠前（0.2 权重）
 */
export function computeFTSRelevance(text: string, query: string): number {
  if (!text || !query) return 0.5
  const lowerText = text.toLowerCase()
  const q = query.toLowerCase()

  // 1. 逐字命中率（query 去重字符）
  const uniqueChars = new Set(q)
  let hitCount = 0
  for (const ch of uniqueChars) {
    if (lowerText.includes(ch)) hitCount++
  }
  const charHitRatio = uniqueChars.size > 0 ? hitCount / uniqueChars.size : 0

  // 2. 最长连续命中 n-gram（2-4 字窗口，取最长能在 text 中找到的）
  let longestRun = 0
  const maxN = Math.min(4, q.length)
  for (let n = maxN; n >= 2; n--) {
    let found = false
    for (let i = 0; i + n <= q.length; i++) {
      if (lowerText.includes(q.slice(i, i + n))) {
        found = true
        break
      }
    }
    if (found) {
      longestRun = n
      break
    }
  }
  const runRatio = q.length > 0 ? longestRun / q.length : 0

  // 3. 首个命中位置靠前
  const firstHit = lowerText.indexOf(q[0])
  const positionScore = firstHit === -1 ? 0 : 1 - firstHit / text.length

  const score = 0.5 + charHitRatio * 0.25 + runRatio * 0.15 + positionScore * 0.1
  return Math.min(1, Math.max(0.5, score))
}

/**
 * FTS 查询侧分词（L3 T3）——必须与写入 `chunks.tokens` 时使用**同一**分词器（T1 jieba），
 * 否则词边界不一致会导致查不到。分词器不可用（wasm 加载失败等）→ 返回空数组，
 * 调用方据此退回逐字 LIKE（行为与改造前一致，检索不因分词失败而失效）。
 */
export function tokenizeQueryWords(queryText: string): string[] {
  try {
    return tokenize(queryText)
  } catch (e) {
    if (!tokenizerFailureLogged) {
      tokenizerFailureLogged = true
      logger.warn('VectorStore', `query tokenize failed, fallback to char LIKE: ${safeErrorMessage(e)}`)
    }
    return []
  }
}

/** 词级表达式不可用（tokens 列缺失/类型不符）退回逐字 LIKE 只告警一次，避免每次检索刷屏 */
let ftsCharFallbackLogged = false

/** LIKE 字面量转义：' → ''（字符串闭合）、%/_ → 全角（消除通配符语义注入） */
function escapeLikeLiteral(s: string): string {
  return s.replace(/'/g, "''").replace(/%/g, '％').replace(/_/g, '＿')
}

/**
 * 单字功能词表（L3 T3 Fix round 1）——检索前丢弃，避免高频虚词（的/是/在…）主导匹配。
 * ⚠️ 只收**虚词**，不收实义单字（剑/盾/光…）：丢弃实义单字会把 query 退化成更宽的词
 *    （如「主角的剑」→「主角」），反而重演候选池泛滥（有 e2e 用例锁定）。
 *    纯虚词/标点 query（如「的」「，。」）过滤后为空 → 调用方退回逐字 LIKE，单词查询能力不丢。
 */
const QUERY_STOP_WORDS = new Set([
  // 中文虚词
  '的', '了', '是', '在', '和', '与', '及', '或', '也', '就', '都', '而', '被', '把', '对', '为',
  '着', '过', '之', '其', '这', '那', '我', '你', '他', '她', '它', '们', '个', '有', '不', '没',
  '很', '更', '最', '会', '能', '要', '从', '向', '于', '等', '并', '则', '因', '由', '以', '所',
  '但', '若', '如', '将', '已', '又', '再', '还', '只', '才', '使', '让', '给', '上', '下', '中',
  '里', '时', '后', '前', '吗', '呢', '啊', '吧', '嘛', '呀', '哦',
  // 英文虚词（中英混排 query）
  'a', 'an', 'the', 'of', 'and', 'or', 'to', 'in', 'on', 'at', 'by', 'for', 'is', 'are', 'was',
  'were', 'be', 'it', 'this', 'that', 'with', 'as',
])

/** 纯标点/符号/空白 token 判定（jieba 保留标点，T1 遗留；此处统一丢弃） */
const PUNCTUATION_ONLY = /^[\p{P}\p{S}\s]+$/u

/**
 * 查询词过滤（L3 T3 Fix round 1，纯函数）：标点/符号/空白 + 单字虚词丢弃；
 * 实义单字（剑/盾）保留——保留选择性，避免多词查询被高频虚词淹没。
 */
export function selectQueryTerms(words: string[]): string[] {
  return words.filter(w => {
    if (!w || w.trim() === '') return false
    if (PUNCTUATION_ONLY.test(w)) return false
    return !QUERY_STOP_WORDS.has(w.toLowerCase())
  })
}

/**
 * 构造 chunks 检索过滤表达式（L3 T3，纯函数便于断言）。
 *
 * 词级为主：query 分词**并过滤噪声词**后，每词一个 `tokens LIKE '%词%'` 片段，
 *   **多词用 AND**（chunk 须含全部词）——选择性回到改造前水平，避免高频词 OR 命中近乎全表
 *   后在 `limit` 处被截断（改造引入的静默丢召回，见 Fix round 1 / Critical-1）。
 * 逐字兜底：`tokens` 缺失（NULL / 空串——存量未回填库、回填失败行、旧表无该列）的行走
 *   改造前的逐字容错 `text LIKE '%搜%索%'`，保证存量库不因改造而检不到。
 * 分词/词表不可用（words 为空）→ 全量退回逐字 LIKE，行为与改造前完全一致。
 */
export function buildChunkFTSFilter(queryText: string, words: string[]): string {
  // ⚠️ P3 修复保留：查询中的 %/_ 转全角（LIKE 通配符注入——'100%' 此前匹配 "100任意串"；
  //    逐字拆分产生的 % 已用于容错匹配，查询自身的通配符需消除语义）
  // ⚠️ 转义必须在**逐字符拆分之后**：先转义整串再 split('') 会把 `''` 拆成 `'%'`，
  //    单引号转义随之失效 → 含 ' 的 query 生成非法 SQL（FTS 通道整体抛错降级）
  const charPattern = `%${queryText.split('').map(escapeLikeLiteral).join('%')}%`
  const fallbackClause = `text LIKE '${charPattern}'`
  if (words.length === 0) return fallbackClause

  const wordClauses = words.map(w => `tokens LIKE '%${escapeLikeLiteral(w)}%'`)
  const missingTokens = `(tokens IS NULL OR tokens = '')`
  return `((${wordClauses.join(' AND ')}) OR (${missingTokens} AND ${fallbackClause}))`
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
    // P2 修复：检索前自检 chunks 表 schema —— 存量表缺 chapterNumber 列时
    //   （导入路径自愈外的旧数据）清理 add_columns + 回填；幂等，迁移过一次后零开销
    const schemaCheck = await ensureChunksSchema(db)
    if (schemaCheck.error) {
      // Fix round 1 / Important-2：补列失败（此前 error 被丢弃）时 tokens 列可能不存在，
      //   下方词级表达式会抛错并由通道 2 内部退回逐字 LIKE；此处留痕便于排查根因
      logger.warn('VectorStore', `ensureChunksSchema before search failed: ${schemaCheck.error.slice(0, 200)}`)
    }
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

    // 通道 2：FTS（L3 T3：query 分词 → 过滤噪声词 → tokens 词级 AND 匹配；tokens 缺失行退回逐字 LIKE 兜底）
    try {
      const words = selectQueryTerms(tokenizeQueryWords(queryText))
      // Fix round 1 / ③ 候选先取足量再打分：打分在下方（computeFTSRelevance），
      //   原 limit(topK*3) 会在打分前按表扫描顺序截断 —— 多词命中面较大时真命中被挤出候选池
      const candidateLimit = Math.max(topK * 10, 50)
      const runFilter = async (filterExpr: string) => {
        const q = table.query().filter(filterExpr).limit(candidateLimit)
        return await (scopeFilter ? q.where(scopeFilter) : q).toArray() as Array<{ text: string; fileName: string }>
      }

      let rows: Array<{ text: string; fileName: string }>
      try {
        rows = await runFilter(buildChunkFTSFilter(queryText, words))
      } catch (inner) {
        if (words.length === 0) throw inner
        // Fix round 1 / Important-2：词级表达式不可用（tokens 列缺失或类型不符 → 补列失败）时，
        //   原实现被外层 catch 吞掉 → FTS 通道静默归零（改造前靠 text LIKE 仍能召回）；
        //   此处退回纯逐字 LIKE 重试一次，保持改造前的召回能力。
        if (!ftsCharFallbackLogged) {
          ftsCharFallbackLogged = true
          logger.warn('VectorStore', `word-level FTS filter failed, fallback to char LIKE: ${safeErrorMessage(inner)}`)
        }
        rows = await runFilter(buildChunkFTSFilter(queryText, []))
      }

      for (const r of rows) {
        // P1-1：FTS 命中给启发式相关性分数（不再恒 0.5）——纯 FTS 模式排序有据；
        //   调用方对 fts 来源豁免相似度阈值（精确匹配本身保证相关性）
        pushCandidate(r.text, r.fileName, computeFTSRelevance(r.text, queryText), 'fts')
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
 * 获取缺少 tokens 的文本块（L3 T2：回填检测与驱动）
 *
 * tokens 缺失 = NULL / 空串 / 纯空白 / 旧表尚无该列；返回 text + fileName。
 */
export async function getChunksWithoutTokens(
  projectPath: string,
): Promise<Array<{ text: string; fileName: string }>> {
  try {
    const db = await getConnection(projectPath)
    const tableNames = await db.tableNames()
    if (!tableNames.includes(TABLE_NAME)) return []

    const table = await db.openTable(TABLE_NAME)
    const hasTokensCol = (await table.schema()).fields.some(f => f.name === 'tokens')
    // 无 tokens 列的存量表：全部行都缺 tokens（不在此处写库——补列由 ensureChunksSchema / backfillTokens 负责）
    const rows = hasTokensCol
      ? await table.query().select(['text', 'fileName', 'tokens']).toArray()
      : await table.query().select(['text', 'fileName']).toArray()

    return selectRowsMissingTokens(rows as Array<{ text: string; fileName: string; tokens?: unknown }>)
      .map(r => ({ text: r.text, fileName: r.fileName }))
  } catch (e) {
    logger.error('VectorStore', `getChunksWithoutTokens error: ${e}`)
    return []
  }
}

/**
 * 为缺少 tokens 的块批量回填中文分词（L3 T2）
 *
 * 幂等：只处理 tokens 为 NULL/空串/纯空白的行，已有 tokens 一律不改写，重复调用零动作。
 * 逐行 update（非 drop+create 全表重写），中断不会丢数据；单行失败计入 failed 不中断整体。
 * 回填后 LanceDB 侧的 tokens 词级 FTS 索引重建由检索侧任务负责（本函数只保证数据就位）。
 */
export async function backfillTokens(
  projectPath: string,
  onProgress?: (pct: number, msg: string) => void,
): Promise<{ success: boolean; processed: number; failed: number; error?: string }> {
  try {
    const db = await getConnection(projectPath)
    const tableNames = await db.tableNames()
    if (!tableNames.includes(TABLE_NAME)) return { success: true, processed: 0, failed: 0 }

    const table = await db.openTable(TABLE_NAME)
    // 存量表可能尚无 tokens 列（升级后未走过导入/检索入口）→ 先补列（幂等）
    if (!(await table.schema()).fields.some(f => f.name === 'tokens')) {
      await addNullableColumn(table, 'tokens', 'string')
    }

    const rows = await table.query().select(['id', 'text', 'tokens']).toArray()
    const missing = selectRowsMissingTokens(rows as Array<{ id: string; text: string; tokens?: unknown }>)
    if (missing.length === 0) return { success: true, processed: 0, failed: 0 }

    let processed = 0
    let failed = 0
    for (let i = 0; i < missing.length; i++) {
      const row = missing[i]
      try {
        const tokens = buildChunkTokens(String(row.text ?? ''))
        if (!tokens) {
          failed++
        } else {
          await table.update({
            where: `id = '${sanitizeFilterValue(row.id, 'id')}'`,
            values: { tokens },
          })
          processed++
        }
      } catch (e) {
        failed++
        logger.warn('VectorStore', `backfillTokens row failed (id=${row.id}): ${safeErrorMessage(e)}`)
      }
      // 进度消息复用既有 i18n 键（本任务文件范围不含 locale-data.ts，不新增键）
      onProgress?.(
        Math.round(((i + 1) / missing.length) * 100),
        t('knowledge.chunks').replace('{n}', String(processed)),
      )
    }

    return { success: true, processed, failed }
  } catch (error) {
    logger.error('VectorStore', `backfillTokens error: ${safeErrorMessage(error)}`)
    return { success: false, processed: 0, failed: 0, error: safeErrorMessage(error) }
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
        // L3 T2：显式 schema 重建时必须带上 tokens 列，否则分词结果被整体丢弃
        new Field('tokens', new Utf8(), true),
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
  const jsonPath = path.join(getProjectVelaDir(projectPath), 'vectors.json')

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
