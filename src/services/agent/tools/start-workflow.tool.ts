/**
 * start_workflow — 触发创作工作流
 *
 * 当 Agent 判断用户意图是执行某个创作任务（写稿、审稿、修稿、定稿、
 * 生成蓝图、生成架构）时，调用此 Tool 真正启动对应的多步骤工作流。
 * 工作流启动后会自动在底部任务面板和右侧 AI 输出面板中展示进度。
 *
 * 工作流构建逻辑已提取至 services/workflows/workflow-starter（与意图预路由 A3 共用）；
 * 本工具层只负责参数校验与错误语义映射（WorkflowStartError.code → 用户可见文案）。
 */
import { buildAgentTool } from '../tool-registry'
import { t } from '../../../shared/locale'
import { useLayoutStore } from '../../../stores/layout-store'
import {
  startChapterWorkflow,
  startBlueprintWorkflow,
  startArchitectureWorkflow,
  WorkflowStartError,
} from '../../workflows/workflow-starter'

export const startWorkflowTool = buildAgentTool({
  name: 'start_workflow',
  description: t('tool.startWorkflowDesc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      workflow: {
        type: 'string',
        description: t('tool.startWorkflowType'),
        enum: ['generate_draft', 'review', 'refine', 'finalize', 'generate_blueprint', 'generate_architecture'],
      },
      chapter_number: {
        type: 'number',
        description: t('tool.startWorkflowChapter'),
      },
      chapter_end: {
        type: 'number',
        description: t('tool.startWorkflowChapterEnd'),
      },
    },
    required: ['workflow'],
  },
  requiresConfirmation: true,
  isReadOnly: false,
  execute: async (args) => {
    const workflow = args.workflow as string
    const chapterNumber = args.chapter_number as number | undefined
    const chapterEnd = args.chapter_end as number | undefined

    if (!workflow) {
      return { success: false, content: '', error: t('error.missingWorkflow') }
    }

    const chapterWorkflows = ['generate_draft', 'review', 'refine', 'finalize']
    if (chapterWorkflows.includes(workflow) && chapterNumber === undefined) {
      return { success: false, content: '', error: t('tool.wfNeedChapter').replace('{workflow}', workflow) }
    }

    // 区间校验（2026-10-02）：仅章节工作流生效；chapter_end 必须与 chapter_number 组成合法闭区间
    if (chapterWorkflows.includes(workflow) && chapterEnd !== undefined
      && (!Number.isInteger(chapterEnd) || chapterEnd < chapterNumber!)) {
      return { success: false, content: '', error: t('tool.wfRangeInvalid') }
    }

    // 打开右侧面板到 AI 输出视图
    useLayoutStore.getState().openRightPanel('ai-output')

    try {
      switch (workflow) {
        case 'generate_draft':
        case 'review':
        case 'refine':
        case 'finalize': {
          // 区间（chapter_end，2026-10-02）：串行启动闭区间每一章——与旧直出行为对齐（v1 串行）；
          // 中途失败按既有错误映射返回（已启动的章节不回滚——工作流已入队列）
          if (chapterEnd !== undefined) {
            const started: { runId: string; displayName: string; chapterTag: string }[] = []
            for (let n = chapterNumber!; n <= chapterEnd; n++) {
              started.push(await startChapterWorkflow(workflow as 'generate_draft' | 'review' | 'refine' | 'finalize', n))
            }
            return {
              success: true,
              content: started.map(r =>
                t('tool.workflowStarted').replace('{name}', r.displayName).replace('{chapter}', r.chapterTag),
              ).join('\n'),
              artifacts: started.map(r => ({ type: 'workflow_started' as const, name: `${r.displayName} ${r.chapterTag}` })),
            }
          }
          const result = await startChapterWorkflow(
            workflow as 'generate_draft' | 'review' | 'refine' | 'finalize',
            chapterNumber!,
          )
          return {
            success: true,
            content: t('tool.workflowStarted').replace('{name}', result.displayName).replace('{chapter}', result.chapterTag),
            artifacts: [{ type: 'workflow_started', name: `${result.displayName} ${result.chapterTag}` }],
          }
        }
        case 'generate_blueprint': {
          const result = await startBlueprintWorkflow()
          return {
            success: true,
            content: t('tool.workflowStartedNoChapter').replace('{name}', result.displayName),
            artifacts: [{ type: 'workflow_started', name: result.displayName }],
          }
        }
        case 'generate_architecture': {
          const result = await startArchitectureWorkflow()
          return {
            success: true,
            content: t('tool.workflowStartedNoChapter').replace('{name}', result.displayName),
            artifacts: [{ type: 'workflow_started', name: result.displayName }],
          }
        }
        default:
          return { success: false, content: '', error: t('tool.wfUnsupported').replace('{workflow}', workflow) }
      }
    } catch (e) {
      if (e instanceof WorkflowStartError) {
        // P0-3 错误语义统一：按 code 映射回用户可见文案，零用户可见变化——
        // - ERR_GUARD：e.message 即 guard.message || error.prereqNotMet（保留 guard 细分文案）
        // - ERR_NO_DRAFT：按 workflow 映射回三细分键（tool.wfNoDraft 键不存在，文案保留细分）；
        // - ERR_NO_BLUEPRINT：e.message 已带 wfBlueprintDataMissing 文案（buildDraftWorkflow 内 throw）
        const msg = e.code === 'ERR_GUARD'
          ? (e.message || t('error.prereqNotMet'))
          : e.code === 'ERR_NO_DRAFT'
            // 2026-10-02（区间配套）：优先透传 e.message——workflow-starter 已按 workflow + 实际章号参数化；
            // 区间调用下 chapterNumber 只是起始章，重建文案会把「第6章无草稿」误报成「第5章」。
            // 空 message 兜底回重建（既有单章语义不变）
            ? (e.message || (workflow === 'review' ? t('tool.wfNoReviewDraft')
              : workflow === 'refine' ? t('tool.wfNoRefineDraft')
              : t('tool.wfNoFinalizeDraft')).replace('{chapter}', String(chapterNumber)))
            : e.message
        return { success: false, content: '', error: msg }
      }
      // 非 WorkflowStartError 异常继续上抛（agent-engine 负责兜底展示）
      throw e
    }
  },
})
