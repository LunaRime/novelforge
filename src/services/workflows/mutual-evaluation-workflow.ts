/**
 * AI 互评工作流 — 多视角并行评审 + 综合评分
 *
 * 流程：
 * 1. 获取草稿内容
 * 2. 多视角评审（3 个 AI 实例并行）
 * 3. 综合评分（聚合 + 共识分析）
 */

import type { WorkflowDefinition, WorkflowStep, WorkflowContext, StepCallbacks } from '../../stores/workflow-store'
import { ipc } from '../ipc-client'
import { SpawnReviewersCommand, type ReviewerOutput } from './commands/spawn-reviewers.command'
import { SynthesizeScoresCommand } from './commands/synthesize-scores.command'

export interface MutualEvaluationParams {
  draftId: number
  draftContent: string
  chapterNumber: number
}

export function createMutualEvaluationWorkflow(
  params: MutualEvaluationParams,
): WorkflowDefinition {
  return {
    type: 'post_process',
    title: `🤝 AI 互评 — 第${params.chapterNumber}章`,
    steps: [
      {
        name: '多视角评审',
        description: '从 3 个视角并行评审草稿（情节逻辑性、角色一致性、文笔流畅度）',
        executor: async (_step: WorkflowStep, context: WorkflowContext, callbacks: StepCallbacks) => {
          callbacks.log(`启动 AI 互评引擎，评审第 ${params.chapterNumber} 章...`)
          callbacks.log('评审视角: 情节逻辑性(35%) + 角色一致性(35%) + 文笔流畅度(30%)')

          const cmd = new SpawnReviewersCommand({
            draftContent: params.draftContent,
            chapterNumber: params.chapterNumber,
          })

          const outputs = await cmd.execute({
            step: _step as never,
            context,
            callbacks,
          })

          context.data.reviewerOutputs = outputs
          return `完成 ${outputs.length} 个视角的评审`
        },
      },
      {
        name: '综合评分',
        description: '加权聚合多视角评分，分析共识和分歧',
        executor: async (_step: WorkflowStep, context: WorkflowContext, callbacks: StepCallbacks) => {
          const outputs = context.data.reviewerOutputs as ReviewerOutput[]
          const cmd = new SynthesizeScoresCommand({
            reviewerOutputs: outputs,
            draftId: params.draftId,
            chapterNumber: params.chapterNumber,
          })

          const report = await cmd.execute({
            step: _step as never,
            context,
            callbacks,
          })

          context.data.mutualReviewReport = report

          // 持久化评审结果
          try {
            for (const output of outputs) {
              await ipc.invoke('db:evaluation-create', {
                draftId: params.draftId,
                perspective: output.perspective,
                scores: JSON.stringify(output.scores),
                overallScore: output.overallScore,
                strengths: JSON.stringify(output.strengths),
                weaknesses: JSON.stringify(output.weaknesses),
                suggestions: JSON.stringify(output.suggestions),
                rawResponse: output.rawResponse,
                tokensUsed: output.tokensUsed,
              })
            }
            callbacks.log('评审结果已保存到数据库')
          } catch (e) {
            callbacks.log(`⚠️ 评审结果持久化失败: ${String(e)}`)
          }

          return `综合评分: ${report.finalScore}/10 | 共识优点: ${report.consensusStrengths.length} | 问题: ${report.consensusWeaknesses.length}`
        },
      },
    ],
    onComplete: {
      mode: 'open',
      message: `✅ AI 互评完成 — 第${params.chapterNumber}章`,
      openResult: () => {
        import('../../stores/layout-store').then((m) =>
          m.useLayoutStore.getState().openRightPanel('ai-output'),
        ).catch(() => {})
      },
    },
  }
}
