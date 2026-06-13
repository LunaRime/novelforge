/**
 * SpawnReviewersCommand — 并行发起多个评审者 AI 实例
 *
 * 每个评审者从不同视角（情节逻辑性、角色一致性、文笔流畅度）评审同一草稿。
 * 使用并发控制器并行执行所有评审调用。
 */

import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useLLMStore } from '../../../stores/llm-store'

// ===== 类型定义 =====

/** 评审者视角定义 */
export interface ReviewerPerspective {
  id: string
  name: string
  systemPrompt: string
  evaluationCriteria: string[]
  weight: number
}

/** 单个评审者的输出 */
export interface ReviewerOutput {
  perspective: string
  scores: Record<string, number>
  overallScore: number
  strengths: string[]
  weaknesses: string[]
  suggestions: string[]
  rawResponse: string
  tokensUsed: number
}

// ===== 默认评审视角 =====

export const DEFAULT_PERSPECTIVES: ReviewerPerspective[] = [
  {
    id: 'plot_logic',
    name: '情节逻辑性',
    systemPrompt: `你是一位严格的情节逻辑审查员。请从以下维度评审草稿：
1. 因果链是否完整（每件事是否有前因后果）
2. 时间线是否一致（是否有时序矛盾）
3. 伏笔设置是否合理（是否有明显的坑未填）
4. 冲突升级是否自然（张力是否逐级递增）

请以 JSON 格式输出评审结果：
{
  "scores": { "因果链": 8, "时间线": 8, "伏笔": 7, "冲突升级": 7 },
  "overallScore": 7.5,
  "strengths": ["优点1", "优点2"],
  "weaknesses": ["问题1", "问题2"],
  "suggestions": ["建议1", "建议2"]
}`,
    evaluationCriteria: ['因果链完整', '时间线无矛盾', '伏笔设置合理', '冲突升级自然'],
    weight: 0.35,
  },
  {
    id: 'character_consistency',
    name: '角色一致性',
    systemPrompt: `你是一位关注角色塑造的审稿人。请从以下维度评审草稿：
1. 角色行为是否符合其既定人设
2. 角色弧光是否有推进
3. 对话是否符合角色性格
4. 角色关系变化是否合理

请以 JSON 格式输出评审结果：
{
  "scores": { "行为符合人设": 8, "角色弧光推进": 7, "对话符合性格": 8, "关系变化合理": 7 },
  "overallScore": 7.5,
  "strengths": ["优点1", "优点2"],
  "weaknesses": ["问题1", "问题2"],
  "suggestions": ["建议1", "建议2"]
}`,
    evaluationCriteria: ['角色行为符合人设', '角色弧光推进', '对话符合性格', '关系变化合理'],
    weight: 0.35,
  },
  {
    id: 'prose_quality',
    name: '文笔流畅度',
    systemPrompt: `你是一位文笔编辑。请从以下维度评审草稿：
1. 语言是否流畅易读
2. 描写是否生动有画面感
3. 对话是否自然不做作
4. 节奏把控是否得当

请以 JSON 格式输出评审结果：
{
  "scores": { "语言流畅": 8, "描写生动": 7, "对话自然": 8, "节奏把控": 7 },
  "overallScore": 7.5,
  "strengths": ["优点1", "优点2"],
  "weaknesses": ["问题1", "问题2"],
  "suggestions": ["建议1", "建议2"]
}`,
    evaluationCriteria: ['语言流畅', '描写生动', '对话自然', '节奏把控'],
    weight: 0.30,
  },
]

// ===== 命令实现 =====

export interface SpawnReviewersParams {
  draftContent: string
  chapterNumber: number
  perspectives?: ReviewerPerspective[]
}

export class SpawnReviewersCommand extends BaseWorkflowCommand<ReviewerOutput[]> {
  constructor(private params: SpawnReviewersParams) {
    super()
  }

  async execute({ callbacks }: CommandExecuteParams): Promise<ReviewerOutput[]> {
    const perspectives = this.params.perspectives || DEFAULT_PERSPECTIVES
    const { draftContent, chapterNumber } = this.params

    if (!draftContent) throw new Error('无草稿内容')

    callbacks.log(
      `启动 ${perspectives.length} 个评审视角并行评审第 ${chapterNumber} 章...`,
    )

    const outputs: ReviewerOutput[] = []
    const llmStore = useLLMStore.getState()

    // 并行启动所有评审者（由并发控制器管理实际并发数）
    const reviewPromises = perspectives.map(async (perspective, index) => {
      callbacks.log(`  🤖 ${perspective.name} 评审中... (${index + 1}/${perspectives.length})`)

      try {
        const response = await llmStore.generate(
          [
            { role: 'system', content: perspective.systemPrompt },
            { role: 'user', content: `请评审以下第${chapterNumber}章草稿：\n\n${draftContent.slice(0, 6000)}` },
          ],
          undefined,
          {
            responseFormat: { type: 'json_object' },
            priority: 5, // 高优先级
          },
        )

        if (!response.success) {
          callbacks.log(`  ❌ ${perspective.name} 评审失败: ${response.error}`)
          return null
        }

        const parsed = this.parseJSON<ReviewerOutput>(response.content)
        parsed.perspective = perspective.name
        parsed.tokensUsed = response.usage?.totalTokens || 0

        callbacks.log(
          `  ✅ ${perspective.name} 完成，综合评分: ${parsed.overallScore}/10`,
        )

        return parsed
      } catch (error) {
        callbacks.log(`  ❌ ${perspective.name} 评审异常: ${String(error)}`)
        return null
      }
    })

    const results = await Promise.all(reviewPromises)

    for (const result of results) {
      if (result) {
        outputs.push(result)
      }
    }

    callbacks.log(`✅ 互评完成：${outputs.length}/${perspectives.length} 个视角成功`)

    return outputs
  }
}
