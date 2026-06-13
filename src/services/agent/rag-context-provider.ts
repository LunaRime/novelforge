/**
 * Vela RAG 上下文提供器 — 向量检索增强生成
 *
 * 将 LanceDB 向量搜索与 LLM 上下文组装桥接起来：
 * 1. 根据用户查询自动检索相关知识库片段
 * 2. 格式化并注入到系统提示词中
 * 3. 显著减少 prompt tokens（不再需要全量注入架构/角色/世界观）
 *
 * 与 LLM 结合后：提示词中的详细数据被替换为 top-K 相关片段，节省 40-60% tokens。
 */

import { ipc } from '../ipc-client'
import { estimateTokens } from './token-budget'

// ===== 类型定义 =====

export interface RAGInjectionConfig {
  /** 是否启用 RAG */
  enabled: boolean
  /** 最多获取多少个文本块 */
  maxChunks: number
  /** RAG 内容的最大 token 数 */
  maxTokens: number
  /** 最低相似度阈值（低于此值的结果被丢弃） */
  similarityThreshold: number
  /** 章节范围过滤（可选） */
  chapterScope?: [number, number]
}

export interface RAGChunk {
  text: string
  score: number
  fileName: string
  docId: string
}

export interface RAGInjectionResult {
  chunks: RAGChunk[]
  /** 格式化后可直接注入提示词的上下文文本 */
  formattedContext: string
  /** 格式化后上下文的 token 数 */
  tokenCount: number
}

export const DEFAULT_RAG_CONFIG: RAGInjectionConfig = {
  enabled: true,
  maxChunks: 5,
  maxTokens: 800,
  similarityThreshold: 0.6,
}

// ===== 核心函数 =====

/**
 * 为用户查询检索相关知识库上下文。
 *
 * @param userQuery 用户查询文本（用于向量化并搜索）
 * @param config RAG 配置
 * @param chapterNumber 当前章节号（用于范围过滤，可选）
 * @returns 检索结果（可能为空）
 */
export async function retrieveContextForQuery(
  userQuery: string,
  config: RAGInjectionConfig = DEFAULT_RAG_CONFIG,
  chapterNumber?: number,
): Promise<RAGInjectionResult | null> {
  if (!config.enabled || !userQuery.trim()) return null

  try {
    // 构建搜索参数
    const searchParams: Record<string, unknown> = {
      query: userQuery,
      topK: config.maxChunks,
    }

    // 按章节范围过滤（如果提供）
    if (chapterNumber && config.chapterScope) {
      searchParams.chapterScope = config.chapterScope
    } else if (chapterNumber) {
      // 默认搜索范围：当前章节 ± 10 章
      searchParams.chapterScope = [
        Math.max(1, chapterNumber - 10),
        chapterNumber + 10,
      ]
    }

    // 执行搜索
    let results: RAGChunk[] = []
    if (searchParams.chapterScope) {
      results = await ipc.invoke(
        'kb:search-with-scope',
        userQuery,
        (searchParams.chapterScope as [number, number])[0],
        (searchParams.chapterScope as [number, number])[1],
        config.maxChunks,
      )
    } else {
      results = await ipc.invoke('kb:search', userQuery, config.maxChunks)
    }

    if (!results || results.length === 0) {
      return null
    }

    // 过滤低相关度结果
    const filtered = results.filter(
      (r) => r.score >= config.similarityThreshold,
    )

    if (filtered.length === 0) return null

    // 格式化上下文
    const contextParts: string[] = []
    let totalTokens = 0

    for (let i = 0; i < filtered.length; i++) {
      const chunk = filtered[i]
      // 限制每个 chunk 的 token 数
      const chunkTokens = estimateTokens(chunk.text)
      const budget = config.maxTokens - totalTokens
      if (budget <= 0) break

      let displayText = chunk.text
      if (chunkTokens > budget) {
        // 简单截断（这里用字符近似，因为我们需要快速）
        const ratio = budget / chunkTokens
        const cutPoint = Math.floor(chunk.text.length * ratio)
        displayText = chunk.text.slice(0, cutPoint) + '…'
      }

      contextParts.push(
        `[${i + 1}] (${chunk.fileName}, 相关度 ${(chunk.score * 100).toFixed(0)}%)\n${displayText}`,
      )
      totalTokens += estimateTokens(displayText)
    }

    const formattedContext = contextParts.join('\n\n')

    return {
      chunks: filtered,
      formattedContext,
      tokenCount: totalTokens,
    }
  } catch (error) {
    console.warn('[RAG] 检索失败，降级为无 RAG 模式:', error)
    return null
  }
}

/**
 * 为章节写作构建专用的 RAG 查询。
 *
 * 组合多个信息源以提升检索精度。
 */
export function buildChapterRAGQuery(params: {
  chapterNumber: number
  title: string
  keyEvents: string
  characters: string[]
  userGuidance?: string
}): string {
  const parts: string[] = []

  if (params.title) parts.push(params.title)
  if (params.keyEvents) parts.push(params.keyEvents.slice(0, 200))
  if (params.characters.length > 0) {
    parts.push(`角色: ${params.characters.slice(0, 3).join(', ')}`)
  }
  if (params.userGuidance) {
    parts.push(params.userGuidance.slice(0, 150))
  }

  return parts.join(' ') || `第${params.chapterNumber}章`
}

/**
 * 获取配置的简短摘要（供日志显示）
 */
export function getRAGSummary(result: RAGInjectionResult | null): string {
  if (!result || result.chunks.length === 0) {
    return 'RAG: 无相关上下文'
  }
  return `RAG: ${result.chunks.length} 个片段, ${result.tokenCount} tokens, 最高相关度 ${(result.chunks[0].score * 100).toFixed(0)}%`
}
