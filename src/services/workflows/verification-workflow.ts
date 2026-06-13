/**
 * 蓝图校验工作流 — 扫描缺口 + AI 补全
 *
 * 触发方式：
 * 1. ChapterCardEditor 中的"校验"按钮 → 仅扫描
 * 2. "补全"按钮 → 运行本工作流（扫描 + 自动补全）
 */

import type { WorkflowDefinition, WorkflowStep, WorkflowContext, StepCallbacks } from '../../stores/workflow-store'
import { useProjectStore } from '../../stores/project-store'
import { loadDirectoryBlueprints, type ChapterBlueprint } from './directory-workflow'
import { FillGapsCommand } from './commands/fill-gaps.command'
import { generateVerificationReport, type BlueprintGap } from '../blueprint-verification-service'

export interface VerificationWorkflowParams {
  /** 是否自动补全缺口（true = 扫描 + 补全，false = 仅扫描） */
  autoFill?: boolean
}

export function createVerificationWorkflow(
  params: VerificationWorkflowParams = { autoFill: false },
): WorkflowDefinition {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const steps: WorkflowDefinition['steps'] = [
    {
      name: '加载蓝图',
      description: '从数据库加载已有蓝图',
      executor: async (_step: WorkflowStep, context: WorkflowContext, callbacks: StepCallbacks) => {
        const project = useProjectStore.getState().currentProject
        if (!project) throw new Error('未打开项目')

        // 加载架构（用于补全时提供上下文）
        try {
          const { ipc } = await import('../ipc-client')
          const core = await ipc.invoke('db:project-core-get')
          if (core) {
            const parts: string[] = []
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const c = core as any
            if (c.premise?.length > 50) parts.push(c.premise)
            if (c.charactersArch?.length > 50) parts.push(c.charactersArch)
            if (c.worldbuilding?.length > 50) parts.push(c.worldbuilding)
            if (c.synopsis?.length > 50) parts.push(c.synopsis)
            context.data.architecture = parts.join('\n\n---\n\n')
          }
        } catch { /* 架构加载失败不阻塞 */ }

        callbacks.log('加载已有蓝图...')
        const blueprints = await loadDirectoryBlueprints()
        context.data.blueprints = blueprints
        context.data.totalChapters = project.novelConfig.totalChapters
        callbacks.log(`已加载 ${blueprints.length} 章蓝图`)
        return `已加载 ${blueprints.length} 章`
      },
    },
    {
      name: '扫描缺口',
      description: '检测缺失的章节蓝图',
      executor: async (_step: WorkflowStep, context: WorkflowContext, callbacks: StepCallbacks) => {
        const blueprints = context.data.blueprints as ChapterBlueprint[]
        const totalChapters = context.data.totalChapters as number

        callbacks.log('正在分析蓝图完整性...')
        const report = await generateVerificationReport(totalChapters, blueprints)

        context.data.verificationReport = report
        context.data.gaps = report.gaps

        callbacks.setProgress(30)
        callbacks.log(report.summary)

        return report.summary
      },
    },
  ]

  // 如果启用自动补全，添加补全步骤
  if (params.autoFill) {
    steps.push({
      name: 'AI 补全',
      description: '使用相邻章节上下文生成缺失蓝图',
      executor: async (_step: WorkflowStep, context: WorkflowContext, callbacks: StepCallbacks) => {
        const gaps = context.data.gaps as BlueprintGap[]

        if (!gaps || gaps.length === 0) {
          callbacks.log('✅ 无缺口，无需补全')
          callbacks.setProgress(100)
          return '无缺口'
        }

        const cmd = new FillGapsCommand({ gaps })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const filled = await cmd.execute({
          step: _step as any,
          context,
          callbacks,
        })

        context.data.filledBlueprints = filled
        return `已补全 ${filled.length} 章`
      },
    })
  }

  return {
    type: 'post_process',
    title: params.autoFill ? '🔍 蓝图校验与补全' : '🔍 蓝图完整性校验',
    steps,
    onComplete: {
      mode: 'silent',
      message: params.autoFill
        ? '✅ 蓝图校验与补全完成'
        : '✅ 蓝图完整性校验完成',
    },
  }
}
