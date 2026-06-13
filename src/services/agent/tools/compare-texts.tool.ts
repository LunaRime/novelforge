/**
 * compare_texts — 语义相似度比较
 *
 * 让 AI 可以调用向量模块比较两段或多段文本的语义相似度。
 * 适用于一致性检查、去重检测、情节对比等场景。
 */
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useVectorConfigStore } from '../../../stores/vector-config-store'

export const compareTextsTool = buildAgentTool({
  name: 'compare_texts',
  description:
    '使用向量嵌入模型比较文本的语义相似度。\n' +
    '适用场景：\n' +
    '- 检查新写的章节是否与已有内容高度重复\n' +
    '- 验证角色描写前后是否一致\n' +
    '- 分析情节发展是否符合预期方向\n' +
    '- 比较不同版本草稿的语义差异',
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '查询文本（基准文本）',
      },
      candidates: {
        type: 'string',
        description:
          '候选文本列表，用 "|||" 分隔。例如："文本A|||文本B|||文本C"。每段文本会被分别与查询文本比较',
      },
    },
    required: ['query', 'candidates'],
  },
  requiresConfirmation: false,
  execute: async (args) => {
    const query = args.query as string
    const candidatesStr = args.candidates as string

    if (!query || !candidatesStr) {
      return {
        success: false,
        content: '',
        error: 'query 和 candidates 参数不能为空',
      }
    }

    const candidates = candidatesStr.split('|||').map((s) => s.trim()).filter(Boolean)

    if (candidates.length === 0) {
      return {
        success: false,
        content: '',
        error: 'candidates 中至少需要一段文本（用 ||| 分隔）',
      }
    }

    try {
      // 检查向量模型是否可用
      const vectorConfig = useVectorConfigStore.getState()

      if (!vectorConfig.canUseEmbeddingAPI()) {
        // 降级：使用本地启发式比较（基于字符重叠率和长度相似度）
        const localResults = candidates.map((cand, i) => {
          const overlap = computeLocalSimilarity(query, cand)
          return { text: cand, score: overlap, index: i }
        })
        localResults.sort((a, b) => b.score - a.score)

        const formatted = localResults
          .map((s, i) => {
            const bar = '█'.repeat(Math.round(s.score * 20)) + '░'.repeat(20 - Math.round(s.score * 20))
            const preview = s.text.length > 80 ? s.text.slice(0, 80) + '…' : s.text
            return `[${i + 1}] ${bar} ${(s.score * 100).toFixed(1)}%\n   "${preview}"`
          })
          .join('\n\n')

        return {
          success: true,
          content:
            `⚠️ 向量模型已关闭，使用本地文本相似度（基于关键词重叠和长度分析）\n\n` +
            `### 本地比较结果（${localResults.length} 段）\n${formatted}\n\n` +
            `_注意：本地比较精度有限，建议在设置中开启向量模型以获得准确的语义相似度。_`,
        }
      }

      const result = await ipc.invoke('embedding:compare', query, candidates)

      if (!result.success) {
        return {
          success: false,
          content: '',
          error: `语义比较失败: ${result.error || '未知错误'}`,
        }
      }

      const similarities = result.similarities || []
      if (similarities.length === 0) {
        return { success: true, content: '⚠️ 未能计算出有效的相似度分数' }
      }

      // 分析结果
      const highSimilarity = similarities.filter((s: { score: number }) => s.score >= 0.85)
      const mediumSimilarity = similarities.filter(
        (s: { score: number }) => s.score >= 0.7 && s.score < 0.85,
      )
      const best = similarities[0]

      let analysis = ''
      if (highSimilarity.length > 0) {
        analysis += `\n⚠️  ${highSimilarity.length} 段文本与查询高度相似（≥85%），可能存在重复内容。\n`
      }
      if (mediumSimilarity.length > 0) {
        analysis += `\n📊 ${mediumSimilarity.length} 段文本与查询中度相似（70-85%）。\n`
      }

      const formatted = similarities
        .map(
          (s: { text: string; score: number }, i: number) => {
            const bar = '█'.repeat(Math.round(s.score * 20)) + '░'.repeat(20 - Math.round(s.score * 20))
            const preview = s.text.length > 80 ? s.text.slice(0, 80) + '…' : s.text
            return `[${i + 1}] ${bar} ${(s.score * 100).toFixed(1)}%\n   "${preview}"`
          },
        )
        .join('\n\n')

      return {
        success: true,
        content:
          `🔬 语义相似度分析完成（共 ${similarities.length} 段）\n` +
          `最高相似度: ${(best.score * 100).toFixed(1)}%\n` +
          `${analysis}\n` +
          `### 详细结果\n${formatted}`,
      }
    } catch (error) {
      return {
        success: false,
        content: '',
        error: `比较异常: ${String(error)}`,
      }
    }
  },
})

/**
 * 本地文本相似度计算（不依赖 Embedding API）
 *
 * 基于：
 * 1. 字符 n-gram 重叠率（2-gram）
 * 2. 长度相似度
 * 3. 共同关键词比例
 *
 * 返回 0-1 之间的相似度分数。
 */
function computeLocalSimilarity(a: string, b: string): number {
  if (!a || !b) return 0

  // N-gram 重叠率
  const ngramsA = getNgrams(a, 2)
  const ngramsB = getNgrams(b, 2)
  if (ngramsA.size === 0 && ngramsB.size === 0) return 0

  let overlap = 0
  for (const ng of ngramsA) {
    if (ngramsB.has(ng)) overlap++
  }
  const ngramScore = overlap / Math.max(ngramsA.size, ngramsB.size, 1)

  // 长度相似度
  const lenScore = 1 - Math.abs(a.length - b.length) / Math.max(a.length, b.length, 1)

  // 关键词重叠
  const wordsA = new Set(a.replace(/[^一-鿿\w]/g, ' ').split(/\s+/).filter(w => w.length > 1))
  const wordsB = new Set(b.replace(/[^一-鿿\w]/g, ' ').split(/\s+/).filter(w => w.length > 1))
  let wordOverlap = 0
  for (const w of wordsA) {
    if (wordsB.has(w)) wordOverlap++
  }
  const wordScore = wordOverlap / Math.max(wordsA.size, wordsB.size, 1)

  // 加权综合
  return ngramScore * 0.4 + lenScore * 0.2 + wordScore * 0.4
}

function getNgrams(text: string, n: number): Set<string> {
  const ngrams = new Set<string>()
  for (let i = 0; i <= text.length - n; i++) {
    ngrams.add(text.slice(i, i + n))
  }
  return ngrams
}
