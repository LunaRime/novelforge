/**
 * search_knowledge — 语义搜索知识库（向量 + FTS 混合搜索）
 *
 * 让 AI 可以主动调用向量模块检索相关上下文。
 * 支持章节范围过滤和相似度阈值控制。
 */
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'

export const searchKnowledgeTool = buildAgentTool({
  name: 'search_knowledge',
  description:
    '在知识库中进行语义搜索（基于向量嵌入的混合搜索），查找与查询相关的参考资料、设定文档、角色档案等。' +
    '支持按章节范围过滤结果，适用于查找特定区间的上下文。' +
    '返回结果包含相似度分数，分数越高越相关。',
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索查询语句，例如 "主角的金手指设定"、"第3章的战斗场景"',
      },
      top_k: {
        type: 'number',
        description: '返回结果数量（默认 5，最大 10）',
        default: 5,
      },
      chapter_from: {
        type: 'number',
        description: '章节范围起始（可选）。例如搜索第 1-10 章的内容，填 1',
      },
      chapter_to: {
        type: 'number',
        description: '章节范围结束（可选）。例如搜索第 1-10 章的内容，填 10',
      },
      min_score: {
        type: 'number',
        description: '最低相似度阈值（0-1，默认 0.5）。低于此值的结果会被过滤。',
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
      return { success: false, content: '', error: '缺少 query 参数' }
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
        content:
          '🔍 未找到相关结果。\n\n' +
          '建议：\n' +
          '- 尝试使用更短的关键词\n' +
          '- 使用 read_architecture 直接读取故事架构\n' +
          '- 使用 read_characters 查看角色卡\n' +
          '- 如果知识库为空，可以先将相关文档导入知识库',
      }
    }

    // 按相似度过滤
    const filtered = results.filter((r) => r.score >= minScore)

    if (filtered.length === 0) {
      return {
        success: true,
        content:
          `⚠️ 找到 ${results.length} 条结果，但相似度均低于阈值 ${minScore}。\n` +
          `最高相似度: ${(results[0].score * 100).toFixed(0)}%。\n` +
          `建议降低 min_score 参数重试。`,
      }
    }

    const formatted = filtered
      .map(
        (r, i) =>
          `### 📖 结果 ${i + 1} (相关度: ${(r.score * 100).toFixed(0)}%)\n` +
          `**来源**: ${r.fileName}\n\n${r.text}`,
      )
      .join('\n\n---\n\n')

    return {
      success: true,
      content:
        `🔍 语义搜索完成：找到 ${filtered.length} 条相关结果（共 ${results.length} 条，过滤 ${results.length - filtered.length} 条低相关度）\n\n${formatted}`,
    }
  },
})
