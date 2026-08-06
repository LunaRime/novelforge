import { t } from '../../../shared/locale'
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
    name: t('workflow.reviewerPlotLogic'),
    systemPrompt: t('prompt.spawnReviewers.plotLogicSystem'),
    evaluationCriteria: ['因果链完整', '时间线无矛盾', '伏笔设置合理', '冲突升级自然'],
    weight: 0.35,
  },
  {
    id: 'character_consistency',
    name: t('workflow.reviewerCharConsistency'),
    systemPrompt: t('prompt.spawnReviewers.characterSystem'),
    evaluationCriteria: ['角色行为符合人设', '角色弧光推进', '对话符合性格', '关系变化合理'],
    weight: 0.35,
  },
  {
    id: 'prose_quality',
    name: t('workflow.reviewerStyle'),
    systemPrompt: t('prompt.spawnReviewers.proseSystem'),
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

    if (!draftContent) throw new Error(t('error.noDraft'))

    callbacks.log(
      t('log.spawnReviewers.starting')
        .replace('{count}', String(perspectives.length))
        .replace('{chapter}', String(chapterNumber)),
    )

    const outputs: ReviewerOutput[] = []
    const llmStore = useLLMStore.getState()

    // 并行启动所有评审者（由并发控制器管理实际并发数）
    const reviewPromises = perspectives.map(async (perspective, index) => {
      callbacks.log(t('log.spawnReviewers.reviewing')
        .replace('{name}', perspective.name)
        .replace('{index}', String(index + 1))
        .replace('{total}', String(perspectives.length)))

      try {
        const response = await llmStore.generate(
          [
            { role: 'system', content: perspective.systemPrompt },
            { role: 'user', content: t('prompt.spawnReviewers.userRequest')
              .replace('{chapter}', String(chapterNumber))
              .replace('{draft}', () => draftContent.slice(0, 6000)) },
          ],
          undefined,
          {
            responseFormat: { type: 'json_object' },
            priority: 5, // 高优先级
          },
        )

        if (!response.success) {
          callbacks.log(t('log.spawnReviewers.failed')
            .replace('{name}', perspective.name)
            .replace('{error}', () => response.error ?? ''))
          return null
        }

        const parsed = this.parseJSON<ReviewerOutput>(response.content)
        parsed.perspective = perspective.name
        parsed.tokensUsed = response.usage?.totalTokens || 0

        callbacks.log(
          t('log.spawnReviewers.done')
            .replace('{name}', perspective.name)
            .replace('{score}', String(parsed.overallScore)),
        )

        return parsed
      } catch (error) {
        callbacks.log(t('log.spawnReviewers.exception')
          .replace('{name}', perspective.name)
          .replace('{error}', () => String(error)))
        return null
      }
    })

    const results = await Promise.all(reviewPromises)

    for (const result of results) {
      if (result) {
        outputs.push(result)
      }
    }

    callbacks.log(t('log.spawnReviewers.allDone')
      .replace('{ok}', String(outputs.length))
      .replace('{total}', String(perspectives.length)))

    return outputs
  }
}
