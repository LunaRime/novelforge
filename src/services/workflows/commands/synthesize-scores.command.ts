/**
 * SynthesizeScoresCommand — 聚合并合成多个评审者的评分
 *
 * 输入：多个 ReviewerOutput
 * 输出：MutualReviewReport（聚合评分 + 共识分析 + 分歧标注）
 */

import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import {
  type ReviewerOutput,
  DEFAULT_PERSPECTIVES,
} from './spawn-reviewers.command'

// ===== 类型定义 =====

export interface MutualReviewReport {
  draftId: number
  chapterNumber: number
  reviewerOutputs: ReviewerOutput[]
  /** 各维度加权平均分 */
  aggregatedScores: Record<string, number>
  /** 综合最终分 */
  finalScore: number
  /** 共识优点（>=2 个评审者提到） */
  consensusStrengths: string[]
  /** 共识缺点（>=2 个评审者提到） */
  consensusWeaknesses: string[]
  /** 分歧标注（评审者意见不一的维度） */
  divergenceNotes: string[]
  /** 综合建议 */
  mergedSuggestions: string[]
  /** 生成时间 */
  generatedAt: string
}

export interface SynthesizeScoresParams {
  reviewerOutputs: ReviewerOutput[]
  draftId: number
  chapterNumber: number
}

export class SynthesizeScoresCommand extends BaseWorkflowCommand<MutualReviewReport> {
  constructor(private params: SynthesizeScoresParams) {
    super()
  }

  async execute({ callbacks }: CommandExecuteParams): Promise<MutualReviewReport> {
    const { reviewerOutputs, draftId, chapterNumber } = this.params
    const perspectives = DEFAULT_PERSPECTIVES

    callbacks.log('正在合成多视角评审结果...')

    // 1. 加权平均各维度评分
    const allCriteria = perspectives.flatMap((p) => p.evaluationCriteria)
    const uniqueCriteria = [...new Set(allCriteria)]
    const aggregatedScores: Record<string, number> = {}
    const criterionVariances: Record<string, number> = {}

    for (const criterion of uniqueCriteria) {
      const scores: number[] = []
      for (const output of reviewerOutputs) {
        const score = output.scores[criterion]
        if (typeof score === 'number') {
          scores.push(score)
        }
      }

      if (scores.length > 0) {
        aggregatedScores[criterion] =
          scores.reduce((a, b) => a + b, 0) / scores.length

        // 计算方差（用于检测分歧）
        const mean = aggregatedScores[criterion]
        criterionVariances[criterion] =
          scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scores.length
      }
    }

    // 2. 加权最终分
    let weightedSum = 0
    let totalWeight = 0
    for (const output of reviewerOutputs) {
      const perspective = perspectives.find((p) => p.name === output.perspective)
      const weight = perspective?.weight || 1 / perspectives.length
      weightedSum += output.overallScore * weight
      totalWeight += weight
    }
    const finalScore = totalWeight > 0
      ? Math.round((weightedSum / totalWeight) * 10) / 10
      : 0

    // 3. 共识分析
    const strengthCounts = new Map<string, number>()
    const weaknessCounts = new Map<string, number>()
    const allSuggestions: string[] = []

    for (const output of reviewerOutputs) {
      for (const s of output.strengths) {
        strengthCounts.set(s, (strengthCounts.get(s) || 0) + 1)
      }
      for (const w of output.weaknesses) {
        weaknessCounts.set(w, (weaknessCounts.get(w) || 0) + 1)
      }
      allSuggestions.push(
        ...output.suggestions.map(
          (s) => `[${output.perspective}] ${s}`,
        ),
      )
    }

    const consensusStrengths = [...strengthCounts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([item]) => item)

    const consensusWeaknesses = [...weaknessCounts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([item]) => item)

    // 4. 分歧标注
    const divergenceNotes: string[] = []
    const HIGH_VARIANCE_THRESHOLD = 2.0

    for (const [criterion, variance] of Object.entries(criterionVariances)) {
      if (variance >= HIGH_VARIANCE_THRESHOLD) {
        const scores = reviewerOutputs
          .map((o) => `  - ${o.perspective}: ${o.scores[criterion] ?? 'N/A'}/10`)
          .join('\n')
        divergenceNotes.push(
          `「${criterion}」评审意见分歧较大（方差: ${variance.toFixed(1)}）：\n${scores}`,
        )
      }
    }

    // 去重建议
    const uniqueSuggestions = [...new Set(allSuggestions)]

    callbacks.setProgress(100)
    callbacks.log(
      `综合评分: ${finalScore}/10 | 共识优点: ${consensusStrengths.length} | 共识问题: ${consensusWeaknesses.length} | 分歧: ${divergenceNotes.length}`,
    )

    return {
      draftId,
      chapterNumber,
      reviewerOutputs,
      aggregatedScores,
      finalScore,
      consensusStrengths,
      consensusWeaknesses,
      divergenceNotes,
      mergedSuggestions: uniqueSuggestions,
      generatedAt: new Date().toISOString(),
    }
  }
}
