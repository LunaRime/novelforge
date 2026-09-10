/**
 * NovelForge 知识库管理 — 主进程使用
 *
 * 管理文档导入、向量化和检索
 * 底层存储已从 vectors.json 迁移至 LanceDB（{projectPath}/.novelforge/lancedb/）
 *
 * 检索模式：
 * - 默认：BM25 全文检索（FTS），零配置即可用
 * - 增强：FTS + 向量近邻混合检索（需配置 Embedding 模型）
 */
import { t } from '../src/shared/locale'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { logger } from './utils/logger'
import { safeErrorMessage } from './utils/error-utils'
import { getProjectVelaDir } from './utils/config-utils'
import { Field, FixedSizeList as ArrowFixedSizeList, Float32, Int32, Utf8, Schema as ArrowSchema } from 'apache-arrow'
import { chunkText, generateEmbeddings } from './embedding'
import { tokenize } from './chinese-tokenizer'
import { getCurrentProjectPath, getProjectDb } from './database'
import {
  addChunks,
  removeDocument as removeDocFromStore,
  searchWithScope as storeSearchWithScope,
  listDocuments as storeListDocuments,
  getStats as storeGetStats,
  migrateFromJSON,
  getChunksWithoutVectors as storeGetChunksWithoutVectors,
  backfillTokens as storeBackfillTokens,
} from './vector-store'

// ===== 迁移状态跟踪 =====

/** 已执行过迁移检查的项目路径集合 */
const migratedProjects = new Set<string>()

/** 确保旧数据已迁移 */
async function ensureMigration(projectPath: string): Promise<void> {
  if (migratedProjects.has(projectPath)) return
  migratedProjects.add(projectPath)

  const jsonPath = path.join(getProjectVelaDir(projectPath), 'vectors.json')
  if (fs.existsSync(jsonPath)) {
    await migrateFromJSON(projectPath)
  }
}

// ===== 导出函数（保持旧签名，IPC 层零改动） =====

/** 核心导入逻辑（复用体）：分块 → 向量化 → 清理旧数据 → 写入 LanceDB */
async function importContent(
  projectPath: string,
  fileName: string,
  content: string,
  protocol: 'openai' | 'gemini',
  model: { baseUrl: string; apiKey: string },
  options?: { filePath?: string; onProgress?: (pct: number, msg: string) => void },
): Promise<{ success: boolean; docId?: string; chunkCount?: number; error?: string }> {
  await ensureMigration(projectPath)

  // 1. 分块
  options?.onProgress?.(10, t('kb.chunking'))
  const chunks = chunkText(content, 500, 50)
  const docId = randomUUID()

  // 2. 解析章节元数据（从文件名提取）
  const chapterMeta = parseChapterMetaFromFileName(fileName)

  // 3. 可选：生成向量（三级降级：Embedding API → LLM 向量化 → FTS-only）
  let vectors: number[][] | undefined
  const embedMethod = model.apiKey ? 'Embedding API' : 'N/A'

  if (model.apiKey) {
    try {
      options?.onProgress?.(20, t('kb.vectorizingWith')
        .replace('{method}', embedMethod)
        .replace('{count}', String(chunks.length)))
      vectors = await generateEmbeddings(chunks, protocol, model)
    } catch (e) {
      logger.warn('KB', t('log.embedding.apiFailedTryLlm').replace('{err}', String(e)))
    }
  }

  // Embedding API 失败或未配置 → 尝试 LLM 向量化
  if (!vectors || vectors.length === 0 || vectors.every(v => v.length === 0)) {
    try {
      const { embeddingService } = await import('./embedding-service')
      if (embeddingService.canUseLLMEmbedding()) {
        options?.onProgress?.(25, t('kb.vectorizingWith')
          .replace('{method}', 'LLM')
          .replace('{count}', String(chunks.length)))
        const results = await embeddingService.embedBatchWithLLM(chunks)
        vectors = results.map(r => r.vector).filter(v => v.length > 0)
        if (vectors.length > 0) {
          logger.info('KB', t('log.kb.llmVectorizeSuccess')
            .replace('{ok}', String(vectors.length))
            .replace('{total}', String(chunks.length)))
        }
      }
    } catch (e) {
      logger.warn('KB', t('log.kb.llmAlsoFailedFtsOnly').replace('{err}', String(e)))
    }
  }

  // 全部失败 → FTS-only 模式（仍可全文搜索，但无语义搜索）
  if (!vectors || vectors.length === 0) {
    options?.onProgress?.(30, t('kb.ftsFallback'))
  }

  // 4. 删除同名旧文档，确保幂等性
  options?.onProgress?.(70, t('kb.cleaning'))
  const existingDocs = await storeListDocuments(projectPath)
  const existingDoc = existingDocs.find(d => d.fileName === fileName)
  if (existingDoc) {
    await removeDocFromStore(projectPath, existingDoc.id)
  }

  // 5. 写入 LanceDB
  options?.onProgress?.(80, t('kb.saving'))
  const result = await addChunks(projectPath, docId, fileName, chunks, vectors, options?.filePath, chapterMeta)

  if (!result.success) {
    return { success: false, error: result.error }
  }

  options?.onProgress?.(100, t('kb.imported')
    .replace('{name}', fileName)
    .replace('{count}', String(chunks.length)))
  return { success: true, docId, chunkCount: chunks.length }
}

/**
 * 导入文档到知识库（单文件，从磁盘读取）
 * 始终建立 FTS 索引；有 Embedding 配置时额外生成向量
 */
export async function importDocument(
  filePath: string,
  projectPath: string,
  protocol: 'openai' | 'gemini',
  model: { baseUrl: string; apiKey: string },
  onProgress?: (progress: number, message: string) => void,
): Promise<{ success: boolean; docId?: string; chunkCount?: number; error?: string }> {
  try {
    // 1. 读取并校验文件
    const fileName = path.basename(filePath)
    const ext = path.extname(filePath).toLowerCase()
    if (!['.txt', '.md', '.markdown'].includes(ext)) {
      return { success: false, error: t('kb.unsupportedType').replace('{ext}', ext) }
    }

    onProgress?.(5, t('kb.reading').replace('{name}', fileName))
    // 文件大小检查：超过 50MB 的文件拒绝导入，防止 OOM
    const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB
    const stat = fs.statSync(filePath)
    if (stat.size > MAX_FILE_SIZE) {
      const sizeMB = (stat.size / (1024 * 1024)).toFixed(1)
      return { success: false, error: t('kb.fileTooLarge').replace('{size}', sizeMB) }
    }
    if (stat.size === 0) {
      return { success: false, error: t('error.fileEmpty') }
    }
    const content = fs.readFileSync(filePath, 'utf-8')

    // 2. 委托核心导入逻辑
    return importContent(projectPath, fileName, content, protocol, model, { filePath, onProgress })
  } catch (error) {
    return { success: false, error: safeErrorMessage(error) }
  }
}

// ===== L3 T5：查询改写（角色别名扩展） =====

/**
 * 别名 JSON 解析（`characters.aliases` 列，v14 起为 TEXT 承载的 JSON 数组）。
 *
 * 返回 `null` 表示**解析失败**（非字符串 / 空串 / 非法 JSON / 非数组）——调用方据此跳过该角色；
 * 返回 `[]` 是合法结果（该角色暂无别名，扩展时天然零动作）。
 */
function parseCharacterAliases(raw: unknown): string[] | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed
      .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      .map(v => v.trim())
  } catch {
    return null
  }
}

/**
 * characters 行 → 别名映射（纯函数）：键 = 角色正名，值 = 该角色别名列表。
 *
 * 容错：`name` 为空或别名解析失败的行**跳过该角色**（不抛）——查询改写只是检索链路上的增强，
 * 单行脏数据不应让检索失败，更不应让整库降级。
 */
export function buildCharacterAliasMap(
  rows: Array<{ name?: unknown; aliases?: unknown }>,
): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const row of rows) {
    const name = typeof row?.name === 'string' ? row.name.trim() : ''
    if (!name) continue
    const aliases = parseCharacterAliases(row?.aliases)
    if (aliases === null) continue
    map.set(name, aliases)
  }
  return map
}

/** 子串匹配最短长度：单字变体只在**分词 token 精确相等**时命中（避免「云」误命中「云海」） */
const MIN_SUBSTRING_MATCH_LENGTH = 2

/**
 * 查询改写：query 命中角色名/别名 → 并入该角色的**正名 + 别名**（空格拼接）。
 *
 * 命中判定（两者取并集）：
 * - **分词 token 精确相等**（T1 jieba，大小写不敏感）——query 里该形态独立成词时命中；
 * - **原文子串包含**（长度 ≥ 2，大小写不敏感）——jieba 把 OOV 名字切碎时 token 判定会漏，
 *   子串判定补上（与 T3 跨 token 边界漏成同类问题的查询侧镜像）。
 *
 * 语义保证（brief 契约）：
 * - 无命中 / 无可并入形态 → **逐字原样返回**（零改动）；
 * - 已在 query 中出现的形态不重复并入（扩展幂等：`rewriteQuery(rewriteQuery(q)) === rewriteQuery(q)`）；
 * - `tokenize` 不可用（wasm 加载失败）→ 退回纯子串匹配，不抛；
 * - aliasMap 脏值（值非数组）→ 该角色等价于无别名，不抛。
 */
export function rewriteQuery(query: string, aliasMap: Map<string, string[]>): string {
  if (!query || !query.trim() || aliasMap.size === 0) return query

  let tokens: string[] = []
  try {
    tokens = tokenize(query)
  } catch {
    // 分词器不可用：token 命中不可用，子串命中仍然生效（检索侧同样有 LIKE 兜底）
  }
  const tokenSet = new Set(tokens.map(w => w.toLowerCase()))
  const lowerQuery = query.toLowerCase()
  // 已出现形态（token 或原文子串）→ 不再并入，保证扩展幂等
  const alreadyPresent = new Set(tokenSet)
  const appended: string[] = []

  const isHit = (variant: string): boolean =>
    tokenSet.has(variant.toLowerCase())
    || (variant.length >= MIN_SUBSTRING_MATCH_LENGTH && lowerQuery.includes(variant.toLowerCase()))

  for (const [name, aliases] of aliasMap) {
    const variants = [name, ...(Array.isArray(aliases) ? aliases : [])]
      .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      .map(v => v.trim())
    if (!variants.some(isHit)) continue
    for (const variant of variants) {
      const key = variant.toLowerCase()
      if (alreadyPresent.has(key) || lowerQuery.includes(key)) continue
      alreadyPresent.add(key)
      appended.push(variant)
    }
  }

  return appended.length > 0 ? `${query} ${appended.join(' ')}` : query
}

/**
 * 读取当前项目 characters 的角色名 + 别名 → 别名映射。
 *
 * 失败降级（零损失）：未打开项目库 / 无 characters 表 / 读取异常 / 项目不匹配 → 空 map，
 * 调用方据此得到原样 query（检索行为与改造前完全一致），且不阻塞检索。
 */
function readCharacterAliasMap(projectPath: string): Map<string, string[]> {
  try {
    // 项目边界：别名只属于**检索目标项目**。getProjectDb() 无项目身份，
    // 用当前打开项目路径校验，避免检索 B 项目时并入 A 项目的角色别名（跨项目污染）
    if (getCurrentProjectPath() !== projectPath) return new Map()
    const db = getProjectDb()
    if (!db) return new Map()
    const rows = db.prepare('SELECT name, aliases FROM characters').all() as Array<{ name: string; aliases: string }>
    return buildCharacterAliasMap(rows)
  } catch (e) {
    logger.warn('KB', `character alias read failed, query kept as-is: ${safeErrorMessage(e)}`)
    return new Map()
  }
}

/**
 * 检索知识库
 * 有 Embedding 配置时 → 混合检索（FTS + 向量）
 * 无 Embedding 配置时 → 纯 FTS 检索
 *
 * L3 T5：本入口**做**查询改写（角色别名扩展）——query 命中 characters 的角色名/别名时，
 * 并入该角色的正名 + 别名后再向量化；扩展只喂语义通道，词法通道沿用原 query，
 * 失败路径（无 characters / 别名缺失 / 解析失败 / 项目不匹配）一律退回原 query；
 * 分词器不可用时退化为子串命中判定（仍可扩展，只是不再按词匹配）。
 * 收益边界（只保证词法通道与候选池不减；结果集排序/top-K 成员仍可能被替换）见函数内注释。
 */
export async function searchKnowledge(
  query: string,
  projectPath: string,
  protocol: 'openai' | 'gemini',
  model: { baseUrl: string; apiKey: string },
  topK: number = 5,
  chapterScope?: [number, number],
): Promise<Array<{ text: string; score: number; fileName: string }>> {
  await ensureMigration(projectPath)

  // 可选：生成查询向量
  let queryVector: number[] | undefined
  if (model.apiKey && query.trim()) {
    // L3 T5：角色别名扩展——query 命中角色名/别名时，并入该角色的正名 + 别名后再向量化，
    //   使「角色在不同章节以别名出现」的 chunk 也能被召回到（正名与别名都参与检索）。
    //
    // ⚠️ 扩展**只喂语义通道**：`storeSearchWithScope` 的 queryText 仅被 FTS 通道消费，而 T3 的
    //   词级检索是 **AND**——把变体并进 query 等于追加 AND 约束，候选集只会收紧
    //   （query「阿晚」→ 并入 苏晚/晚儿 后要求 chunk 同时含三种形态），反向丢失既有召回。
    //   故词法通道沿用原 query；任何失败（无 characters / 别名缺失 / 解析失败 / 项目不匹配）
    //   都退回原 query。
    //
    // ⚠️ 收益边界（T5 review Important-1 收窄，勿再表述为「纯增益」）：上述保证只到
    //   **「词法通道不变、候选池不减」**。扩展后的 query 向量会改变语义通道的候选与品秩，
    //   而 T4 的 RRF 融合是在**融合排序之后**才 `slice(topK)`——因此 **结果集排序与 top-K
    //   成员可能被替换**（同一 query、topK=1 时 top1 就可能换块），并非「只增不减」。
    //   带硬阈值的消费者（rag-context-provider 的 vector ≥0.6、search-knowledge.tool 的
    //   min_score 0.5）因此可能丢弃改造前会注入的 chunk。该风险只能在**有 API Key 的真实
    //   embedding 环境**复测确认（发布前置项：真实 embedding 下别名 query 的 top-K 与
    //   阈值命中率不得低于改造前）。
    const effectiveQuery = rewriteQuery(query, readCharacterAliasMap(projectPath))
    try {
      const [vec] = await generateEmbeddings([effectiveQuery], protocol, model)
      if (vec && vec.length > 0) {
        queryVector = vec
      }
    } catch {
      // Embedding 不可用，降级为 FTS
    }
  }

  return storeSearchWithScope(projectPath, query, queryVector, topK, chapterScope)
}

/**
 * 列出已导入文档
 */
export function listDocuments(projectPath: string) {
  return storeListDocuments(projectPath)
}

/**
 * 删除文档
 */
export async function removeDocument(docId: string, projectPath: string): Promise<boolean> {
  return removeDocFromStore(projectPath, docId)
}

/**
 * 获取知识库统计
 */
export async function getKnowledgeStats(projectPath: string): Promise<{
  documentCount: number
  totalChunks: number
  vectorDimension: number
}> {
  const stats = await storeGetStats(projectPath)
  return {
    documentCount: stats.documentCount,
    totalChunks: stats.totalChunks,
    vectorDimension: stats.vectorDimension,
  }
}

/**
 * 批量导入文件夹到知识库（递归扫描所有 .txt / .md 文件）
 */
export async function importFolder(
  folderPath: string,
  projectPath: string,
  protocol: 'openai' | 'gemini',
  model: { baseUrl: string; apiKey: string },
  onProgress?: (current: number, total: number, fileName: string) => void,
): Promise<{
  success: boolean
  importedCount: number
  failedFiles: string[]
  error?: string
}> {
  try {
    // 递归收集所有 .txt / .md 文件
    const collectFiles = (dir: string): string[] => {
      const result: string[] = []
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          result.push(...collectFiles(fullPath))
        } else if (/\.(txt|md|markdown)$/i.test(entry.name)) {
          result.push(fullPath)
        }
      }
      return result
    }

    const files = collectFiles(folderPath)
    if (files.length === 0) return { success: true, importedCount: 0, failedFiles: [] }

    const failedFiles: string[] = []
    let importedCount = 0

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i]
      const fileName = path.basename(filePath)
      onProgress?.(i + 1, files.length, fileName)

      const result = await importDocument(filePath, projectPath, protocol, model)
      if (result.success) {
        importedCount++
      } else {
        failedFiles.push(fileName)
      }
    }

    return { success: true, importedCount, failedFiles }
  } catch (error) {
    return { success: false, importedCount: 0, failedFiles: [], error: safeErrorMessage(error) }
  }
}

/**
 * 直接将文本字符串内容导入知识库
 * 用于定稿后自动导入、按章推演等无文件场景
 */
/**
 * 从文件名解析章节元数据
 * 支持格式：第{N}章 {title} xxx.md
 */
function parseChapterMetaFromFileName(fileName: string): { chapterNumber?: number; chapterTitle?: string } | undefined {
  const match = fileName.match(/^第(\d+)章\s+(.+?)\s+(正文|要点|蓝图)\.md$/)
  if (match) {
    return {
      chapterNumber: parseInt(match[1]),
      chapterTitle: match[2],
    }
  }
  return undefined
}

export async function importText(
  text: string,
  fileName: string,
  projectPath: string,
  protocol: 'openai' | 'gemini',
  model: { baseUrl: string; apiKey: string },
): Promise<{ success: boolean; docId?: string; chunkCount?: number; error?: string }> {
  try {
    if (!text.trim()) return { success: false, error: t('error.textEmpty') }
    return importContent(projectPath, fileName, text, protocol, model)
  } catch (error) {
    return { success: false, error: safeErrorMessage(error) }
  }
}

// ===== 向量回填相关 =====

/**
 * 获取缺少向量的块数量
 */
export async function getVectorlessCount(projectPath: string): Promise<{ count: number }> {
  return storeGetChunksWithoutVectors(projectPath)
}

/**
 * 批量回填向量（为无向量的块生成 Embedding 并写回）
 * 单次全量加载→生成→写回，避免循环中的 schema 状态问题
 */
export async function backfillVectors(
  projectPath: string,
  protocol: 'openai' | 'gemini',
  model: { baseUrl: string; apiKey: string },
): Promise<{ success: boolean; processed: number; failed: number; error?: string }> {
  try {
    const { count: total } = await storeGetChunksWithoutVectors(projectPath)
    if (total === 0) return { success: true, processed: 0, failed: 0 }

    // 全量加载所有需要向量的块
    const { getConnection } = await import('./vector-store')
    const db = await getConnection(projectPath)
    const tableNames = await db.tableNames()
    if (!tableNames.includes('chunks')) {
      return { success: false, processed: 0, failed: total, error: t('error.chunksTableMissing') }
    }

    const table = await db.openTable('chunks')
    const schema = await table.schema()
    const hasVectorCol = schema.fields.some(f => f.name === 'vector')

    let allRecords: Array<{ id: string; text: string; vector?: number[] }> = []
    if (hasVectorCol) {
      const rows = await table.query().select(['id', 'text', 'vector']).toArray()
      allRecords = rows.filter((r: { id: string; text: string; vector?: number[] }) =>
        !r.vector || !Array.isArray(r.vector) || r.vector.length === 0
      )
    } else {
      const rows = await table.query().select(['id', 'text']).toArray()
      allRecords = rows.map((r: { id: string; text: string }) => ({ id: r.id, text: r.text }))
    }

    if (allRecords.length === 0) {
      return { success: true, processed: 0, failed: 0 }
    }

    // 批量生成向量（三级降级：Embedding API → LLM 向量化 → FTS-only）
    const texts = allRecords.map(r => r.text)
    let vectors: number[][] = []

    // 尝试 1：专用 Embedding API
    try {
      vectors = await generateEmbeddings(texts, protocol, model)
    } catch (e) {
      logger.warn('KB', t('log.kb.backfillApiFailed').replace('{err}', String(e)))
    }

    // 尝试 2：LLM 向量化（Embedding API 失败或无有效结果时自动降级）
    if (vectors.length === 0 || vectors.every(v => v.length === 0)) {
      try {
        const { embeddingService } = await import('./embedding-service')
        if (embeddingService.canUseLLMEmbedding()) {
          logger.info('KB', t('log.kb.apiUnavailableDegradeLlm').replace('{count}', String(texts.length)))
          const llmResults = await embeddingService.embedBatchWithLLM(texts)
          vectors = llmResults.map(r => r.vector)
          const validCount = vectors.filter(v => v.length > 0).length
          logger.info('KB', t('log.kb.llmVectorizeDone')
            .replace('{ok}', String(validCount))
            .replace('{total}', String(texts.length)))
        } else {
          logger.info('KB', t('log.kb.llmNotEnabledSkipVectors'))
        }
      } catch (e2) {
        logger.warn('KB', t('log.kb.llmAlsoFailedFtsMode').replace('{err}', String(e2)))
      }
    }

    // 构建更新后的完整数据
    const idToVector = new Map<string, number[]>()
    allRecords.forEach((r, i) => {
      if (vectors[i] && vectors[i].length > 0) {
        idToVector.set(r.id, vectors[i])
      }
    })

    // 全量读出 + 合并更新
    // ⚠️ P1 修复：非回填行的 vector 是 Arrow FixedSizeList 对象，与回填行的纯 number[]
    //    混写同一列会干扰 schema 校验（addChunks 注释明确要求纯数组）——统一转换
    const fullTable = await db.openTable('chunks')
    const allRows = await fullTable.query().toArray()
    const toPlainArray = (v: unknown): unknown => {
      if (v && typeof v === 'object' && typeof (v as { toArray?: unknown }).toArray === 'function') {
        try { return (v as { toArray: () => number[] }).toArray() } catch { /* fallthrough */ }
      }
      return v
    }
    const updatedRows = allRows.map((r: { [key: string]: unknown }) => {
      const v = idToVector.get(r.id as string)
      return v ? { ...r, vector: v } : { ...r, vector: toPlainArray(r.vector) }
    })

    // 使用显式 Arrow Schema 确保 vector 列正确持久化
    // LanceDB 自动推断无法正确识别 number[] 为 FixedSizeList 向量类型
    // 从实际生成的向量中检测维度
    const VECTOR_DIM = vectors.length > 0 && vectors[0].length > 0 ? vectors[0].length : 0
    const arrowFields: Field[] = [
      new Field('id', new Utf8()),
      new Field('docId', new Utf8()),
      new Field('fileName', new Utf8()),
      new Field('chapterNumber', new Int32(), true),
      new Field('chapterTitle', new Utf8(), true),
      new Field('text', new Utf8()),
      // L3 T2：显式 schema 重建时必须带上 tokens 列，否则回填向量时中文分词结果被整体丢弃
      new Field('tokens', new Utf8(), true),
    ]
    if (VECTOR_DIM > 0) {
      arrowFields.push(new Field('vector', new ArrowFixedSizeList(VECTOR_DIM, new Field('item', new Float32())), true))
    }
    arrowFields.push(
      new Field('chunkIndex', new Int32()),
      new Field('totalChunks', new Int32()),
      new Field('importedAt', new Utf8()),
    )
    const arrowSchema = new ArrowSchema(arrowFields)

    // 先写入临时表，写入成功后再替换，防止 drop→create 中间中断导致数据丢失
    const TEMP_TABLE = 'chunks_backfill'
    try { await db.dropTable(TEMP_TABLE) } catch { /* 临时表不存在，忽略 */ }
    await db.createTable(TEMP_TABLE, updatedRows, { schema: arrowSchema })

    // 验证临时表写入成功
    const tempTable = await db.openTable(TEMP_TABLE)
    const tempCount = await tempTable.countRows()
    if (tempCount === 0) {
      return { success: false, processed: 0, failed: total, error: t('error.tempTableEmpty') }
    }

    // 临时表写入成功 → 替换正式表（⚠️ P1 修复：替换失败时从临时表恢复——
    //    此前 drop chunks 后 createTable 失败则 chunks 表彻底消失，直到下次导入）
    await db.dropTable('chunks')
    try {
      await db.createTable('chunks', updatedRows, { schema: arrowSchema })
    } catch (e) {
      try {
        const tempRows = await (await db.openTable(TEMP_TABLE)).query().toArray()
        await db.createTable('chunks', tempRows, { schema: arrowSchema })
        logger.warn('KB', t('log.kb.backfillRecovered'))
      } catch { /* 尽力恢复失败 */ }
      throw e
    } finally {
      await db.dropTable(TEMP_TABLE).catch(() => {})
    }

    // 重建 FTS 索引
    const newTable = await db.openTable('chunks')
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Index } = require('@lancedb/lancedb')
      await newTable.createIndex('text', { config: Index.fts() })
    } catch { /* 索引可能已存在 */ }

    // 验证
    const verifyRows = await newTable.query().select(['id', 'vector']).limit(5).toArray()
    const withVectors = verifyRows.filter((r: { vector?: unknown }) => {
      if (!r.vector) return false
      const vec = r.vector as { length?: number; toArray?: () => unknown[] }
      if (typeof vec.toArray === 'function') return vec.toArray().length > 0
      return (vec.length ?? 0) > 0
    }).length
    if (withVectors === 0) {
      return { success: false, processed: 0, failed: total, error: t('error.vectorBackfillEmpty') }
    }

    return { success: true, processed: idToVector.size, failed: total - idToVector.size }
  } catch (error) {
    logger.error('KB', t('log.kb.backfillError').replace('{err}', String(error)))
    return { success: false, processed: 0, failed: 0, error: safeErrorMessage(error) }
  }
}

/**
 * 批量回填中文分词（L3 T2：为缺 tokens 的块补 jieba 分词结果）
 *
 * 与 backfillVectors 不同：不依赖 Embedding 配置（纯本地分词，零成本、零网络），
 * 故无三级降级逻辑——直接委托 vector-store（幂等：只处理 tokens 为空的行）。
 */
export async function backfillTokens(
  projectPath: string,
): Promise<{ success: boolean; processed: number; failed: number; error?: string }> {
  try {
    return await storeBackfillTokens(projectPath)
  } catch (error) {
    logger.error('KB', t('log.kb.backfillError').replace('{err}', String(error)))
    return { success: false, processed: 0, failed: 0, error: safeErrorMessage(error) }
  }
}

/**
 * FTS-only 检索（不需要 Embedding 配置）
 * 用于 IPC 层在无 Embedding 模型时直接调用
 *
 * L3 T5：本入口**不做**角色别名扩展——它只有词法通道，而 T3 的词级检索是 AND，并入别名变体
 * 只会追加 AND 约束、收紧候选集（别名查询可能被清零）。扩展只在 `searchKnowledge` 的语义通道
 * 生效；要让词法通道也吃到别名增益，需要 T3 支持「同角色变体 OR 成组」的放宽——该放宽会重演
 * Critical-1 的候选池泛滥，本任务明确不做。
 */
export async function searchKnowledgeFTS(
  query: string,
  projectPath: string,
  topK: number = 5,
  chapterScope?: [number, number],
): Promise<Array<{ text: string; score: number; fileName: string }>> {
  await ensureMigration(projectPath)
  return storeSearchWithScope(projectPath, query, undefined, topK, chapterScope)
}
