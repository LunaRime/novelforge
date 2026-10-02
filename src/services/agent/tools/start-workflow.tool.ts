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

/** 区间单次最多章数（2026-10-02 评审 I1：模型幻觉大区间 → 无界静默启动的护栏） */
const MAX_RANGE_CHAPTERS = 20

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
    // null 归一（2026-10-02 复审 M1）：模型对未用的可选参数常发 null——一律视为未传（否则误报「区间无效」）
    const chapterNumber = args.chapter_number == null ? undefined : (args.chapter_number as number)
    const chapterEnd = args.chapter_end == null ? undefined : (args.chapter_end as number)

    if (!workflow) {
      return { success: false, content: '', error: t('error.missingWorkflow') }
    }

    const chapterWorkflows = ['generate_draft', 'review', 'refine', 'finalize']
    if (chapterWorkflows.includes(workflow) && chapterNumber === undefined) {
      return { success: false, content: '', error: t('tool.wfNeedChapter').replace('{workflow}', workflow) }
    }

    // 章号合法性（2026-10-02 评审 I1）：整数且 ≥1——模型可能给小数/0（此前直接透传给 starter）
    if (chapterWorkflows.includes(workflow) && chapterNumber !== undefined
      && (!Number.isInteger(chapterNumber) || chapterNumber < 1)) {
      return { success: false, content: '', error: t('tool.wfRangeInvalid') }
    }

    // 区间合法性（2026-10-02）：chapter_end 整数且 ≥ chapter_number；上限护栏防幻觉大区间无界启动
    if (chapterWorkflows.includes(workflow) && chapterEnd !== undefined
      && (!Number.isInteger(chapterEnd) || chapterEnd < chapterNumber!)) {
      return { success: false, content: '', error: t('tool.wfRangeInvalid') }
    }
    if (chapterWorkflows.includes(workflow) && chapterEnd !== undefined
      && chapterEnd - chapterNumber! + 1 > MAX_RANGE_CHAPTERS) {
      return { success: false, content: '', error: t('tool.wfRangeTooLarge').replace('{max}', String(MAX_RANGE_CHAPTERS)) }
    }

    // 打开右侧面板到 AI 输出视图
    useLayoutStore.getState().openRightPanel('ai-output')

    try {
      switch (workflow) {
        case 'generate_draft':
        case 'review':
        case 'refine':
        case 'finalize': {
          // 区间（chapter_end，2026-10-02）：串行启动闭区间每一章；
          // 中途失败按既有错误映射返回（已启动的章节不回滚——run 已进入 activeRuns；回执即返回，不等 run 结束）
          if (chapterEnd !== undefined) {
            const started: { runId: string; displayName: string; chapterTag: string }[] = []
            try {
              for (let n = chapterNumber!; n <= chapterEnd; n++) {
                started.push(await startChapterWorkflow(workflow as 'generate_draft' | 'review' | 'refine' | 'finalize', n))
              }
            } catch (e) {
              // 部分失败（2026-10-02 评审 I3）：已启动清单并入错误——否则模型会重发整个区间（重复启动/重复花费）
              if (e instanceof WorkflowStartError && started.length > 0) {
                const startedTags = started.map(r => r.chapterTag).join('、')
                throw new WorkflowStartError(e.code, `${e.message}${t('tool.wfRangePartial').replace('{started}', startedTags)}`)
              }
              throw e
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
            // 空 message 兜底回重建（仅防御——starter 抛出的 message 恒非空）
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
