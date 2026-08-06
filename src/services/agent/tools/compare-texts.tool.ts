/**
 * compare_texts — 语义相似度比较
 *
 * 让 AI 可以调用向量模块比较两段或多段文本的语义相似度。
 * 适用于一致性检查、去重检测、情节对比等场景。
 */
import { t } from '../../../shared/locale'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useVectorConfigStore } from '../../../stores/vector-config-store'

export const compareTextsTool = buildAgentTool({
  name: 'compare_texts',
  description: t('tool.compareDesc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: t('tool.compareQuery'),
      },
      candidates: {
        type: 'string',
        description: t('tool.compareCandidates'),
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
        error: t('error.queryCandidatesEmpty'),
      }
    }

    const candidates = candidatesStr.split('|||').map((s) => s.trim()).filter(Boolean)

    if (candidates.length === 0) {
      return {
        success: false,
        content: '',
        error: t('error.candidatesNeedText'),
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
            t('tool.compareFallbackLocal') +
            t('tool.compareLocalResults')
              .replace('{count}', String(localResults.length))
              .replace('{formatted}', formatted) +
            t('tool.compareLocalNote'),
        }
      }

      const result = await ipc.invoke('embedding:compare', query, candidates)

      if (!result.success) {
        return {
          success: false,
          content: '',
          error: t('tool.compareFailed').replace('{error}', result.error || t('status.unknown')),
        }
      }

      const similarities = result.similarities || []
      if (similarities.length === 0) {
        return { success: true, content: t('tool.compareNoScore') }
      }

      // 分析结果
      const highSimilarity = similarities.filter((s: { score: number }) => s.score >= 0.85)
      const mediumSimilarity = similarities.filter(
        (s: { score: number }) => s.score >= 0.7 && s.score < 0.85,
      )
      const best = similarities[0]

      let analysis = ''
      if (highSimilarity.length > 0) {
        analysis += t('tool.compareHighSimilar').replace('{count}', String(highSimilarity.length))
      }
      if (mediumSimilarity.length > 0) {
        analysis += t('tool.compareMediumSimilar').replace('{count}', String(mediumSimilarity.length))
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
          t('tool.compareDone').replace('{count}', String(similarities.length)) +
          t('tool.compareBestScore').replace('{score}', (best.score * 100).toFixed(1)) +
          `${analysis}\n` +
          t('tool.compareDetailHeader') + formatted,
      }
    } catch (error) {
      return {
        success: false,
        content: '',
        error: t('tool.compareException').replace('{error}', String(error)),
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
