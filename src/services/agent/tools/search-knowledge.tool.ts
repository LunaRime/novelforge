/**
 * search_knowledge — 语义搜索知识库（向量 + FTS 混合搜索）
 *
 * 让 AI 可以主动调用向量模块检索相关上下文。
 * 支持章节范围过滤和相似度阈值控制。
 */
import { t } from '../../../shared/locale'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'

export const searchKnowledgeTool = buildAgentTool({
  name: 'search_knowledge',
  description: t('tool.searchKbDesc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: t('tool.searchKbQuery'),
      },
      top_k: {
        type: 'number',
        description: t('tool.searchKbLimit'),
        default: 5,
      },
      chapter_from: {
        type: 'number',
        description: t('tool.searchKbStart'),
      },
      chapter_to: {
        type: 'number',
        description: t('tool.searchKbEnd'),
      },
      min_score: {
        type: 'number',
        description: t('tool.searchKbThreshold'),
        default: 0.5,
      },
    },
    required: ['query'],
  },
  requiresConfirmation: false,
  execute: async (args) => {
    const query = args.query as string
    const topK = Math.min((args.top_k as number) ?? 5, 10)
    const chapterFrom = args.chapter_from as number | undefined
    const chapterTo = args.chapter_to as number | undefined
    const minScore = (args.min_score as number) ?? 0.5

    if (!query) {
      // 空查询（@知识库 预取场景）：降级为知识库概览，而不是失败——
      // 否则用户 @ 知识库时预取链路拿不到任何内容
      try {
        const [docs, stats] = await Promise.all([
          ipc.invoke('kb:list-documents'),
          ipc.invoke('kb:stats'),
        ]) as [Array<{ fileName: string; chunkCount: number; importedAt: string }> | null, { documentCount: number; totalChunks: number } | null]
        const docList = docs && docs.length > 0
          ? docs.map((d, i) => t('tool.searchKbDocItem')
            .replace('{index}', String(i + 1))
            .replace('{name}', d.fileName)
            .replace('{chunks}', String(d.chunkCount))).join('\n')
          : t('tool.searchKbEmptyHint')
        return {
          success: true,
          content: t('tool.searchKbOverview')
            .replace('{docs}', String(stats?.documentCount ?? 0))
            .replace('{chunks}', String(stats?.totalChunks ?? 0))
            .replace('{list}', docList),
        }
      } catch {
        return { success: false, content: '', error: t('error.missingQuery') }
      }
    }

    let results: Array<{ text: string; score: number; fileName: string }>

    // 根据是否有章节范围选择搜索方式
    if (chapterFrom !== undefined && chapterTo !== undefined) {
      results = await ipc.invoke(
        'kb:search-with-scope',
        query,
        chapterFrom,
        chapterTo,
        topK,
      )
    } else {
      results = await ipc.invoke('kb:search', query, topK)
    }

    if (!results || results.length === 0) {
      return {
        success: true,
        content: t('tool.searchKbNoResults'),
      }
    }

    // 按相似度过滤
    const filtered = results.filter((r) => r.score >= minScore)

    if (filtered.length === 0) {
      return {
        success: true,
        content: t('tool.searchKbBelowThreshold')
          .replace('{count}', String(results.length))
          .replace('{minScore}', String(minScore))
          .replace('{maxScore}', (results[0].score * 100).toFixed(0)),
      }
    }

    const formatted = filtered
      .map(
        (r, i) =>
          t('tool.searchKbResultItem')
            .replace('{index}', String(i + 1))
            .replace('{score}', (r.score * 100).toFixed(0))
            .replace('{fileName}', r.fileName)
            .replace('{text}', r.text),
      )
      .join('\n\n---\n\n')

    return {
      success: true,
      content: t('tool.searchKbDone')
        .replace('{filtered}', String(filtered.length))
        .replace('{total}', String(results.length))
        .replace('{dropped}', String(results.length - filtered.length))
        .replace('{formatted}', formatted),
    }
  },
})
