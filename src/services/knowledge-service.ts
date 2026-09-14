/**
 * knowledge-service — 知识库数据访问服务
 *
 * 封装 KnowledgeOverview 和 KnowledgePanel 中的 IPC 调用，
 * 避免组件直接与 IPC 通信。
 */

import { ipc } from './ipc-client'

/** 已导入文档 */
export interface KBDocument {
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
}

/** 知识库统计 */
export interface KBStatsData {
  documentCount: number
  totalChunks: number
  vectorDimension: number
}

/** 加载文档列表 */
export async function listDocuments(): Promise<KBDocument[]> {
  return ipc.invoke('kb:list-documents')
}

/** 获取知识库统计 */
export async function getStats(): Promise<KBStatsData> {
  return ipc.invoke('kb:stats')
}

/** 同时加载文档列表和统计（常用组合） */
export async function loadKBData(): Promise<{ documents: KBDocument[]; stats: KBStatsData }> {
  const [documents, stats] = await Promise.all([
    ipc.invoke('kb:list-documents'),
    ipc.invoke('kb:stats'),
  ])
  return { documents, stats }
}

/** 获取缺失向量的文档块数量 */
export async function getVectorlessCount(): Promise<number> {
  const result = await ipc.invoke('kb:get-vectorless-count') as { count: number }
  return result.count
}

/** 执行语义检索 */
export async function searchKB(query: string, topK: number): Promise<SearchResult[]> {
  return ipc.invoke('kb:search', query, topK)
}

/**
 * 执行向量回填。
 *
 * ⚠️ final wave W8：返回类型**保留 `errorCode`**。`ipc.invoke('kb:backfill-vectors')` 本身就推导出
 * `{ success; processed; failed; error?; errorCode?: 'dim-mismatch' }`（`ipc-channels.ts:644`），
 * 原实现的 `as Promise<{… error?: string }>` 是**比推导结果更窄**的断言 —— 它把 T4/A4.2 新增的
 * `errorCode` 从下游视野里抹掉（将来有人按 `errorCode === 'dim-mismatch'` 分支就会踩到「类型里没有」）。
 * 现在直接沿用推导类型，**零运行时影响**（断言本来就只是类型层）。
 *
 * 现状说明：唯一的渲染层调用方 `KnowledgeOverview.tsx:157` 目前**不读** `errorCode`，
 * 只展示随错误一起返回的 `error` 文案（维度拒绝的文案里已含「重建知识库索引」指引）
 * —— 即本次加宽是「别把契约信息弄丢」，不是新功能接线。
 */
export async function backfillVectors(): Promise<{ success: boolean; processed: number; failed: number; error?: string; errorCode?: 'dim-mismatch' }> {
  return ipc.invoke('kb:backfill-vectors')
}

/**
 * 执行中文分词回填（L3 T2 / IMP-2：为存量 chunks 补齐 tokens，纯本地分词、无需 Embedding 配置）
 *
 * 幂等：只处理 tokens 为 NULL/空串的行，重复执行零动作（见 vector-store.backfillTokens）。
 */
export async function backfillTokens(): Promise<{ success: boolean; processed: number; failed: number; error?: string }> {
  return ipc.invoke('kb:backfill-tokens') as Promise<{ success: boolean; processed: number; failed: number; error?: string }>
}
