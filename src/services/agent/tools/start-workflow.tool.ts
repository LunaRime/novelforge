/**
 * start_workflow — 触发创作工作流
 *
 * 当 Agent 判断用户意图是执行某个创作任务（写稿、审稿、修稿、定稿、
 * 生成蓝图、生成架构）时，调用此 Tool 真正启动对应的多步骤工作流。
 * 工作流启动后会自动在底部任务面板和右侧 AI 输出面板中展示进度。
 */
import { buildAgentTool } from '../tool-registry'
import { useLayoutStore } from '../../../stores/layout-store'
import { useWorkflowStore } from '../../../stores/workflow-store'
import { ipc } from '../../ipc-client'
import { t } from '../../../shared/locale'

// ---- 工作流类型到显示名的映射 ----
const WORKFLOW_NAMES: Record<string, string> = {
  generate_draft: '写稿',
  review: '审稿',
  refine: '修稿',
  finalize: '定稿',
  generate_blueprint: '生成蓝图',
  generate_architecture: '生成架构',
}

export const startWorkflowTool = buildAgentTool({
  name: 'start_workflow',
  description:
    '触发 NovelForge 创作工作流。支持写稿、修稿、审稿、定稿、生成蓝图、生成架构等工作流。' +
    '调用此工具后，工作流将在 AI 输出面板中自动执行，并在底部任务面板显示进度。',
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      workflow: {
        type: 'string',
        description: '工作流类型',
        enum: ['generate_draft', 'review', 'refine', 'finalize', 'generate_blueprint', 'generate_architecture'],
      },
      chapter_number: {
        type: 'number',
        description: '章节号（写稿/修稿/审稿/定稿必填）',
      },
    },
    required: ['workflow'],
  },
  requiresConfirmation: true,
  isReadOnly: false,
  execute: async (args) => {
    const workflow = args.workflow as string
    const chapterNumber = args.chapter_number as number | undefined

    if (!workflow) {
      return { success: false, content: '', error: '缺少 workflow 参数' }
    }

    const chapterWorkflows = ['generate_draft', 'review', 'refine', 'finalize']
    if (chapterWorkflows.includes(workflow) && chapterNumber === undefined) {
      return { success: false, content: '', error: `${workflow} 工作流需要指定 chapter_number 参数` }
    }

    // 打开右侧面板到 AI 输出视图
    useLayoutStore.getState().openRightPanel('ai-output')

    try {
      const displayName = WORKFLOW_NAMES[workflow] ?? workflow
      const chapterTag = chapterNumber !== undefined ? `第${chapterNumber}章` : ''

      // ===== 分发到具体工作流创建逻辑 =====
      switch (workflow) {
        case 'generate_draft': {
          const definition = await buildDraftWorkflow(chapterNumber!)
          if (!definition) {
            return { success: false, content: '', error: '无法创建写稿工作流：请检查章节蓝图和前置条件' }
          }
          const runId = await useWorkflowStore.getState().startWorkflow(definition)
          void runId // 保留 runId 供调试
          return { success: true, content: `✅ 已启动「${displayName}」工作流（${chapterTag}），请在 AI 输出面板查看进度。`, artifacts: [{ type: 'workflow_started', name: `${displayName} ${chapterTag}` }] }
        }
        case 'review': {
          const definition = await buildReviewWorkflow(chapterNumber!)
          if (!definition) return { success: false, content: '', error: `第${chapterNumber}章没有可审稿的草稿` }
          await useWorkflowStore.getState().startWorkflow(definition)
          return { success: true, content: `✅ 已启动「${displayName}」工作流（${chapterTag}），请在 AI 输出面板查看进度。`, artifacts: [{ type: 'workflow_started', name: `${displayName} ${chapterTag}` }] }
        }
        case 'refine': {
          const definition = await buildRefineWorkflow(chapterNumber!)
          if (!definition) return { success: false, content: '', error: `第${chapterNumber}章没有可修稿的草稿` }
          await useWorkflowStore.getState().startWorkflow(definition)
          return { success: true, content: `✅ 已启动「${displayName}」工作流（${chapterTag}），请在 AI 输出面板查看进度。`, artifacts: [{ type: 'workflow_started', name: `${displayName} ${chapterTag}` }] }
        }
        case 'finalize': {
          const definition = await buildFinalizeWorkflow(chapterNumber!)
          if (!definition) return { success: false, content: '', error: `第${chapterNumber}章没有可定稿的草稿` }
          await useWorkflowStore.getState().startWorkflow(definition)
          return { success: true, content: `✅ 已启动「${displayName}」工作流（${chapterTag}），请在 AI 输出面板查看进度。`, artifacts: [{ type: 'workflow_started', name: `${displayName} ${chapterTag}` }] }
        }
        case 'generate_blueprint': {
          const { createDirectoryWorkflow } = await import('../../workflows/directory-workflow')
          const { guardDirectoryGeneration } = await import('../../workflow-guards')
          const guard = await guardDirectoryGeneration()
          if (!guard.ok) {
            return { success: false, content: '', error: guard.message || '前置条件不满足' }
          }
          const definition = createDirectoryWorkflow({ mode: 'full' })
          await useWorkflowStore.getState().startWorkflow(definition)
          return { success: true, content: `✅ 已启动「${displayName}」工作流，请在 AI 输出面板查看进度。`, artifacts: [{ type: 'workflow_started', name: displayName }] }
        }
        case 'generate_architecture': {
          const { createArchitectureWorkflow } = await import('../../workflows/architecture-workflow')
          const { guardArchitectureGeneration } = await import('../../workflow-guards')
          const guard = guardArchitectureGeneration()
          if (!guard.ok) {
            return { success: false, content: '', error: guard.message || '前置条件不满足' }
          }
          const definition = createArchitectureWorkflow()
          await useWorkflowStore.getState().startWorkflow(definition)
          return { success: true, content: `✅ 已启动「${displayName}」工作流，请在 AI 输出面板查看进度。`, artifacts: [{ type: 'workflow_started', name: displayName }] }
        }
        default:
          return { success: false, content: '', error: `不支持的工作流类型: ${workflow}` }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, content: '', error: `启动工作流失败: ${msg}` }
    }
  },
})

// ===== 工作流构建辅助函数 =====

/** 从数据库蓝图构建 ChapterInfo */
async function getChapterInfoFromBlueprint(chapterNumber: number) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bp = await ipc.invoke('db:blueprint-get', chapterNumber) as any
    if (!bp) return null
    return {
      chapterNumber,
      title: (bp.title as string) || `第${chapterNumber}章`,
      role: (bp.role as string) || '',
      purpose: (bp.purpose as string) || '',
      characters: Array.isArray(bp.characters)
        ? (bp.characters as string[])
        : [],
      keyEvents: (bp.keyEvents as string) || '',
      suspenseHook: bp.suspenseHook as string | undefined,
      userGuidance: bp.userGuidance as string | undefined,
    }
  } catch {
    return null
  }
}

/** 获取章节的最新草稿内容 */
async function getLatestDraft(chapterNumber: number): Promise<{
  filePath: string
  content: string
  title: string
  meta: Record<string, unknown>
} | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const drafts = await ipc.invoke('db:draft-list', chapterNumber) as any[]
    if (!drafts || drafts.length === 0) return null
    // 取最新版本
    const latest = drafts.sort((a: any, b: any) => (b.version as number) - (a.version as number))[0]
    const full = await ipc.invoke('db:draft-get-full', latest.id) as { content: string } | null
    if (!full) return null
    return {
      filePath: `vela://draft/${latest.id}`,
      content: full.content,
      title: (latest.title as string) || `第${chapterNumber}章`,
      meta: latest,
    }
  } catch {
    return null
  }
}

/** 获取章节的最新审稿报告 */
async function getLatestReview(chapterNumber: number): Promise<string | null> {
  try {
    const { VELA, readVelaContent } = await import('../../vela-protocol')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const drafts = await ipc.invoke('db:draft-list', chapterNumber) as any[]
    // 找带 review 的版本
    const withReviews = drafts.filter(d => (d.hasReview as boolean) || (d.reviewId as number))
    if (withReviews.length === 0) return null
    const latest = withReviews.sort((a, b) => (b.version as number) - (a.version as number))[0]
    const reviewId = (latest.reviewId as number) || (latest.id as number)
    try {
      return await readVelaContent(`${VELA.REVIEW}${reviewId}`)
    } catch {
      return null
    }
  } catch {
    return null
  }
}

/** 构建写稿工作流 */
async function buildDraftWorkflow(chapterNumber: number) {
  const { guardChapterWriting } = await import('../../workflow-guards')
  const guard = await guardChapterWriting(chapterNumber)
  if (!guard.ok) {
    // guard 失败时返回 null，由调用方处理
    throw new Error(guard.message || t('error.prereqNotMet'))
  }

  const chapterInfo = await getChapterInfoFromBlueprint(chapterNumber)
  if (!chapterInfo) {
    throw new Error(`未找到第${chapterNumber}章的蓝图数据，请先生成章节蓝图`)
  }

  const { createChapterWorkflow } = await import('../../workflows/chapter-workflow')
  return createChapterWorkflow(chapterInfo)
}

/** 构建审稿工作流 */
async function buildReviewWorkflow(chapterNumber: number) {
  const draft = await getLatestDraft(chapterNumber)
  if (!draft) return null

  const { createReviewOnlyWorkflow } = await import('../../workflows/chapter-workflow')
  return createReviewOnlyWorkflow({
    chapterNumber,
    chapterTitle: draft.title,
    draftPath: draft.filePath,
    draftContent: draft.content,
  })
}

/** 构建修稿工作流 */
async function buildRefineWorkflow(chapterNumber: number) {
  const draft = await getLatestDraft(chapterNumber)
  if (!draft) return null

  const reviewReport = await getLatestReview(chapterNumber)

  if (reviewReport) {
    const { createRefineFromReviewWorkflow } = await import('../../workflows/chapter-workflow')
    return createRefineFromReviewWorkflow({
      chapterNumber,
      chapterTitle: draft.title,
      draftPath: draft.filePath,
      draftContent: draft.content,
      reviewReport,
      reviewFileName: `review_ch${chapterNumber}`,
    })
  }

  const { createRefineOnlyWorkflow } = await import('../../workflows/chapter-workflow')
  return createRefineOnlyWorkflow({
    chapterNumber,
    chapterTitle: draft.title,
    draftPath: draft.filePath,
    draftContent: draft.content,
  })
}

/** 构建定稿工作流 */
async function buildFinalizeWorkflow(chapterNumber: number) {
  const draft = await getLatestDraft(chapterNumber)
  if (!draft) return null

  const { createFinalizeWorkflow } = await import('../../workflows/chapter-workflow')
  return createFinalizeWorkflow({
    chapterNumber,
    chapterTitle: draft.title,
    draftPath: draft.filePath,
    draftContent: draft.content,
  })
}
