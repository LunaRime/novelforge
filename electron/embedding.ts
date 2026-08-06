/**
 * NovelForge 嵌入服务 — 主进程使用
 *
 * 提供文本向量化能力（调用远程 Embedding API）
 * 支持 OpenAI 和 Gemini 两种 Embedding API
 *
 * 注意：向量存储和检索能力已迁移至 vector-store.ts (LanceDB)
 * 本模块仅保留 Embedding API 调用和文本分块功能
 */

import { t } from '../src/shared/locale'
import { buildOpenAIUrl } from './llm/url-utils'

/** ⚠️ P2 修复：查询向量 LRU 缓存——RAG 是每次章节写作/对话的必经路径，同一查询重复向量化
 *  （此前每次检索都发一次 Embedding API 请求，无缓存） */
const queryCache = new Map<string, { vector: number[]; ts: number }>()
const QUERY_CACHE_MAX = 500
const QUERY_CACHE_TTL = 30 * 60 * 1000 // 30 分钟

/** Embedding API fetch 超时（此前无 AbortController——API 挂起时章节写作被无限阻塞） */
const EMBEDDING_TIMEOUT_MS = 10_000

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS)
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

// ===== Embedding API 调用 =====

/** OpenAI Embedding API */
export async function embedOpenAI(
  texts: string[],
  model: { baseUrl: string; apiKey: string; modelName?: string },
): Promise<number[][]> {
  const embeddingModel = model.modelName || 'text-embedding-3-small'
  const url = buildOpenAIUrl(model.baseUrl, 'embedding')
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${model.apiKey}`,
    },
    body: JSON.stringify({
      model: embeddingModel,
      input: texts,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(t('error.embeddingApiFailed').replace('{provider}', 'OpenAI').replace('{status}', String(res.status)).replace('{err}', text))
  }

  const data = await res.json() as {
    data: Array<{ embedding: number[]; index: number }>
  }

  // 按 index 排序确保顺序一致
  return data.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding)
}

/** Gemini Embedding API */
export async function embedGemini(
  texts: string[],
  model: { baseUrl: string; apiKey: string; modelName?: string },
): Promise<number[][]> {
  const embeddingModel = model.modelName || 'text-embedding-004'
  const baseUrl = model.baseUrl.replace(/\/$/, '')

  // Gemini batchEmbedContents 支持批量
  const url = `${baseUrl}/v1beta/models/${embeddingModel}:batchEmbedContents`
  const requests = texts.map((text) => ({
    model: `models/${embeddingModel}`,
    content: { parts: [{ text }] },
    taskType: 'RETRIEVAL_DOCUMENT',
  }))

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': model.apiKey,
    },
    body: JSON.stringify({ requests }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(t('error.embeddingApiFailed').replace('{provider}', 'Gemini').replace('{status}', String(res.status)).replace('{err}', text))
  }

  const data = await res.json() as {
    embeddings: Array<{ values: number[] }>
  }

  return data.embeddings.map((e) => e.values)
}

/** 统一的 Embedding 调用接口（单文本查询走 LRU 缓存——RAG 热路径） */
export async function generateEmbeddings(
  texts: string[],
  protocol: 'openai' | 'gemini',
  model: { baseUrl: string; apiKey: string; modelName?: string },
): Promise<number[][]> {
  // 空文本处理
  if (texts.length === 0) return []

  // ⚠️ P2 修复：单文本（查询向量）走缓存——同一查询重复向量化此前每次都发 API 请求
  if (texts.length === 1) {
    const key = texts[0]
    const hit = queryCache.get(key)
    if (hit && Date.now() - hit.ts < QUERY_CACHE_TTL) {
      return [hit.vector]
    }
    const result = await doGenerate(texts, protocol, model)
    if (result[0] && result[0].length > 0) {
      queryCache.set(key, { vector: result[0], ts: Date.now() })
      if (queryCache.size > QUERY_CACHE_MAX) {
        const oldest = queryCache.keys().next().value
        if (oldest !== undefined) queryCache.delete(oldest)
      }
    }
    return result
  }

  return doGenerate(texts, protocol, model)
}

/** 实际批量生成（批量限制 + 分批循环 + 指数退避重试） */
async function doGenerate(
  texts: string[],
  protocol: 'openai' | 'gemini',
  model: { baseUrl: string; apiKey: string; modelName?: string },
): Promise<number[][]> {
  // 批量限制：每次最多 50 条
  const batchSize = protocol === 'gemini' ? 100 : 50
  const results: number[][] = []

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)
    // ⚠️ P2 修复：批次级指数退避重试（此前一批失败整体抛出——10 万 chunk 第 30 批失败
    //    → 前 29 批作废，整次导入降级到 LLM 向量化，成本 ×100）
    let embeddings: number[][] | null = null
    for (let attempt = 0; attempt < 3 && !embeddings; attempt++) {
      try {
        embeddings = protocol === 'gemini'
          ? await embedGemini(batch, model)
          : await embedOpenAI(batch, model)
      } catch (e) {
        if (attempt >= 2) throw e
        await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)))
      }
    }
    results.push(...(embeddings ?? []))
  }

  return results
}

// ===== 文本分块 =====

/** 将文本按段落分块，每块约 maxChars 字符 */
export function chunkText(
  text: string,
  maxChars: number = 500,
  overlap: number = 50,
): string[] {
  // 先按段落分割
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0)

  const chunks: string[] = []
  let currentChunk = ''

  for (const para of paragraphs) {
    // 如果段落本身就超过 maxChars，按句号分割
    if (para.length > maxChars) {
      if (currentChunk) {
        chunks.push(currentChunk.trim())
        currentChunk = ''
      }
      // 按句号分割长段落
      const sentences = para.split(/(?<=[。！？.!?])\s*/)
      let sentenceChunk = ''
      for (const sentence of sentences) {
        if (sentenceChunk.length + sentence.length > maxChars && sentenceChunk.length > 0) {
          chunks.push(sentenceChunk.trim())
          // 保留 overlap
          sentenceChunk = sentenceChunk.slice(-overlap) + sentence
        } else {
          sentenceChunk += sentence
        }
      }
      if (sentenceChunk.trim()) {
        currentChunk = sentenceChunk
      }
      continue
    }

    // 累积段落
    if (currentChunk.length + para.length > maxChars && currentChunk.length > 0) {
      chunks.push(currentChunk.trim())
      // 保留 overlap
      currentChunk = currentChunk.slice(-overlap) + '\n\n' + para
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim())
  }

  return chunks.length > 0 ? chunks : [text.trim()]
}
