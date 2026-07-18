/**
 * Vela 风格 A/B 测试 — 同一场景多种风格并行生成，对比效果
 *
 * 利用现有多稿框架，为同一段落/场景生成 3 种不同风格版本，
 * AI 自动评分 + 段落级差异对比。
 */

import { llmStore, usageStore } from './store-facade'
import type { useLLMStore } from '../stores/llm-store'

// ===== 类型定义 =====

export interface StyleVariant {
  id: string
  name: string
  description: string
  content: string
  score: number
  tokensUsed: number
}

export interface ABTestResult {
  /** 原始文本 */
  original: string
  /** 各风格变体 */
  variants: StyleVariant[]
  /** 最佳变体 */
  best: StyleVariant | null
  /** 评分对比摘要 */
  comparison: string
}

/** 预定义的风格变体 */
export const STYLE_PRESETS = [
  {
    id: 'hot_blood',
    name: '热血版',
    description: '节奏紧凑，短句为主，大量动作词和感叹，适合战斗/高潮场景',
    systemPrompt: '你是热血流派小说家。用短句和大量动作词写作，节奏紧凑，充满燃点和爆发力。',
  },
  {
    id: 'refined',
    name: '精炼版',
    description: '语言优雅细腻，注重心理描写和环境渲染，适合情感/日常场景',
    systemPrompt: '你是精炼流派小说家。语言优雅细腻，注重心理描写和环境渲染，节奏舒缓而有力。',
  },
  {
    id: 'suspense',
    name: '悬疑版',
    description: '冷峻克制，信息释放有节制，营造紧张感和悬念',
    systemPrompt: '你是悬疑流派小说家。冷峻克制地叙事，有节制地释放信息，营造持续的紧张感和悬念。',
  },
  {
    id: 'humorous',
    name: '诙谐版',
    description: '轻松幽默，加入吐槽和反差，适合日常/搞笑场景',
    systemPrompt: '你是幽默流派小说家。用轻松诙谐的笔调写作，加入适当的吐槽和反差萌。',
  },
]

/**
 * 为指定文本生成多种风格变体并进行 A/B 对比
 */
export async function runStyleABTest(
  originalText: string,
  selectedStyles: string[] = ['hot_blood', 'refined', 'suspense'],
): Promise<ABTestResult> {
  const llmState = llmStore.getState()
  const modelId = llmState.getModelForPurpose('refine_chapter')
  if (!modelId) throw new Error('无可用模型')

  const styleConfigs = STYLE_PRESETS.filter(s => selectedStyles.includes(s.id))
  const variants: StyleVariant[] = []

  // 并行生成所有风格变体
  const promises = styleConfigs.map(async (style) => {
    try {
      const response = await llmState.generate(
        [
          { role: 'system', content: style.systemPrompt },
          {
            role: 'user',
            content: `请用你的风格重写以下段落，保持核心情节不变：\n\n${originalText.slice(0, 2000)}`,
          },
        ],
        modelId,
        { priority: 4 },
      )

      if (response.success && response.content) {
        // AI 评分
        const score = await scoreVariant(originalText, response.content, style.name, llmState, modelId)

        usageStore.recordCall({
          model: llmState.models.find(m => m.id === modelId)!,
          promptTokens: response.usage?.promptTokens || 0,
          completionTokens: response.usage?.completionTokens || 0,
          tier: 'standard',
        })

        return {
          id: style.id,
          name: style.name,
          description: style.description,
          content: response.content,
          score,
          tokensUsed: response.usage?.totalTokens || 0,
        }
      }
    } catch { /* skip failed */ }
    return null
  })

  const results = await Promise.all(promises)
  for (const r of results) {
    if (r) variants.push(r)
  }

  // 排序
  variants.sort((a, b) => b.score - a.score)

  const comparison = variants
    .map((v, i) => `${i + 1}. ${v.name}: ${v.score}/10 — ${v.description}`)
    .join('\n')

  return {
    original: originalText,
    variants,
    best: variants[0] || null,
    comparison,
  }
}

/**
 * AI 评分：从多个维度评估变体质量
 */
async function scoreVariant(
  original: string,
  variant: string,
  _styleName: string,
  llmStore: ReturnType<typeof useLLMStore.getState>,
  modelId: string,
): Promise<number> {
  try {
    const response = await llmStore.generate(
      [
        { role: 'system', content: '你是专业评审。从1-10评分：情节保留度、文笔质量、读者吸引力。只输出一个数字。' },
        {
          role: 'user',
          content: `原文: ${original.slice(0, 500)}\n\n改写: ${variant.slice(0, 500)}\n\n综合评分(1-10):`,
        },
      ],
      modelId,
      { priority: 5 },
    )
    if (response.success) {
      const match = response.content.match(/(\d+(\.\d+)?)/)
      if (match) return Math.min(10, Math.max(1, parseFloat(match[1])))
    }
  } catch { /* ignore */ }
  return 5
}
