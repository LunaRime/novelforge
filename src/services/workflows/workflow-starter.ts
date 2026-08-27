/**
 * 工作流启动器（workflow-starter）
 *
 * 原 start_workflow 工具内部的构建逻辑（buildDraftWorkflow 等）提取为独立服务层模块，
 * 供工具层（start-workflow.tool.ts）与意图预路由（A3）共用：
 * - 成功路径不变：startChapterWorkflow 返回 { runId, displayName, chapterTag }，
 *   蓝图/架构返回 { runId, displayName }
 * - 失败语义统一：所有异常路径 throw WorkflowStartError
 *   （ERR_GUARD / ERR_NO_DRAFT / ERR_NO_BLUEPRINT），调用方按 code 映射用户可见文案
 *
 * 语义约定（P0-3）：
 * - buildDraftWorkflow 从不返回 null——guard 失败 throw（catch 转 ERR_GUARD）、
 *   蓝图缺失 throw WorkflowStartError('ERR_NO_BLUEPRINT')（防止被 catch 误归 ERR_GUARD）
 * - review/refine/finalize 无草稿 return null → startChapterWorkflow 统一转 ERR_NO_DRAFT
 */
import { t } from '../../shared/locale'
import { ipc } from '../ipc-client'
import { useWorkflowStore } from '../../stores/workflow-store'
import type { WorkflowDefinition } from '../../stores/workflow-store'

/** 工作流启动失败：带错误 code，供调用方语义化映射文案 */
export class WorkflowStartError extends Error {
  readonly code: 'ERR_GUARD' | 'ERR_NO_DRAFT' | 'ERR_NO_BLUEPRINT'

  constructor(code: 'ERR_GUARD' | 'ERR_NO_DRAFT' | 'ERR_NO_BLUEPRINT', message: string) {
    super(message)
    this.name = 'WorkflowStartError'
    this.code = code
  }
}

// ---- 工作流类型到显示名的映射 ----

function getWorkflowDisplayName(workflow: string): string {
  switch (workflow) {
    case 'generate_draft': return t('tool.wfDraft')
    case 'review': return t('tool.wfReview')
    case 'refine': return t('tool.wfRefine')
    case 'finalize': return t('tool.wfFinalize')
    case 'generate_blueprint': return t('tool.wfBlueprint')
    case 'generate_architecture': return t('tool.wfArchitecture')
    default: return workflow
  }
}

// ===== 章节工作流入口 =====

/**
 * 启动章节类工作流（写稿/审稿/修稿/定稿）
 *
 * @returns 工作流实例信息（runId + 展示名 + 章节标签），成功语义与工具层原行为一致
 * @throws WorkflowStartError
 *   - ERR_GUARD：guard 失败（如无蓝图/无角色卡/前一章未定稿）或其他未预期异常
 *   - ERR_NO_DRAFT：review/refine/finalize 无草稿（原 return null 的语义化统一）
 *   - ERR_NO_BLUEPRINT：generate_draft 蓝图数据缺失（与 guard 失败区分——提示先生成蓝图）
 */
export async function startChapterWorkflow(
  workflow: 'generate_draft' | 'review' | 'refine' | 'finalize',
  chapterNumber: number,
): Promise<{ runId: string; displayName: string; chapterTag: string }> {
  const displayName = getWorkflowDisplayName(workflow)
  const chapterTag = t('tool.chapterTag').replace('{n}', String(chapterNumber))
  let definition: WorkflowDefinition | null | undefined
  try {
    switch (workflow) {
      case 'generate_draft': definition = await buildDraftWorkflow(chapterNumber); break
      case 'review': definition = await buildReviewWorkflow(chapterNumber); break
      case 'refine': definition = await buildRefineWorkflow(chapterNumber); break
      case 'finalize': definition = await buildFinalizeWorkflow(chapterNumber); break
    }
  } catch (e) {
    // P0-3 语义归类：WorkflowStartError 透传（ERR_NO_BLUEPRINT 由 buildDraftWorkflow 内 throw）；
    // guard 失败与其他异常 → ERR_GUARD
    throw e instanceof WorkflowStartError
      ? e
      : new WorkflowStartError('ERR_GUARD', e instanceof Error ? e.message : String(e))
  }
  // 仅 review/refine/finalize 可达（generate_draft 从不返回 null——蓝图缺失已在 buildDraftWorkflow 内 throw ERR_NO_BLUEPRINT）
  if (!definition) {
    // 评审修复（I1）：按 workflow 参数化 ERR_NO_DRAFT 文案——意图层（agent-store handleWritingIntent）
    // 对 ERR_NO_DRAFT 透传 e.message（「润色第3章」无草稿曾收到「第{n}章没有可审稿的草稿」）；
    // 工具层按 workflow 重映射仍保留（无害，文案一致）
    const noDraftMsg = workflow === 'refine'
      ? t('tool.wfNoRefineDraft')
      : workflow === 'finalize'
        ? t('tool.wfNoFinalizeDraft')
        : t('tool.wfNoReviewDraft')
    throw new WorkflowStartError('ERR_NO_DRAFT', noDraftMsg.replace('{chapter}', String(chapterNumber)))
  }
  const runId = await useWorkflowStore.getState().startWorkflow(definition)
  return { runId, displayName, chapterTag }
}

// ===== 蓝图/架构工作流入口 =====

/** 启动蓝图（目录）工作流——guard 失败 throw ERR_GUARD */
export async function startBlueprintWorkflow(): Promise<{ runId: string; displayName: string }> {
  const displayName = getWorkflowDisplayName('generate_blueprint')
  const { guardDirectoryGeneration } = await import('./workflow-guards')
  const guard = await guardDirectoryGeneration()
  if (!guard.ok) {
    throw new WorkflowStartError('ERR_GUARD', guard.message || t('error.prereqNotMet'))
  }
  const { createDirectoryWorkflow } = await import('./directory-workflow')
  const runId = await useWorkflowStore.getState().startWorkflow(createDirectoryWorkflow({ mode: 'full' }))
  return { runId, displayName }
}

/** 启动架构生成工作流——guard 失败 throw ERR_GUARD */
export async function startArchitectureWorkflow(): Promise<{ runId: string; displayName: string }> {
  const displayName = getWorkflowDisplayName('generate_architecture')
  const { guardArchitectureGeneration } = await import('./workflow-guards')
  const guard = guardArchitectureGeneration()
  if (!guard.ok) {
    throw new WorkflowStartError('ERR_GUARD', guard.message || t('error.prereqNotMet'))
  }
  const { createArchitectureWorkflow } = await import('./architecture-workflow')
  const runId = await useWorkflowStore.getState().startWorkflow(createArchitectureWorkflow())
  return { runId, displayName }
}

// ===== 工作流构建辅助函数 =====

/** 从数据库蓝图构建 ChapterInfo */
async function getChapterInfoFromBlueprint(chapterNumber: number) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bp = await ipc.invoke('db:blueprint-get', chapterNumber) as any
    if (!bp) return null
    return {
      chapterNumber,
      title: (bp.title as string) || t('tool.chapterTag').replace('{n}', String(chapterNumber)),
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
    const latest = drafts.sort((a, b) => b.version - a.version)[0]
    const full = await ipc.invoke('db:draft-get-full', latest.id) as { content: string } | null
    if (!full) return null
    return {
      filePath: `vela://draft/${latest.id}`,
      content: full.content,
      title: (latest.title as string) || t('tool.chapterTag').replace('{n}', String(chapterNumber)),
      meta: latest,
    }
  } catch {
    return null
  }
}

/** 获取章节的最新审稿报告 */
async function getLatestReview(chapterNumber: number): Promise<string | null> {
  try {
    const { VELA, readVelaContent } = await import('../vela-protocol')
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
  const { guardChapterWriting } = await import('./workflow-guards')
  const guard = await guardChapterWriting(chapterNumber)
  if (!guard.ok) {
    // guard 失败直接抛出，由 startChapterWorkflow 的 catch 统一转 ERR_GUARD
    throw new Error(guard.message || t('error.prereqNotMet'))
  }

  const chapterInfo = await getChapterInfoFromBlueprint(chapterNumber)
  if (!chapterInfo) {
    // P0-3：蓝图缺失单独归类（ERR_NO_BLUEPRINT），避免被 catch 误归为 ERR_GUARD
    throw new WorkflowStartError(
      'ERR_NO_BLUEPRINT',
      t('tool.wfBlueprintDataMissing').replace('{chapter}', String(chapterNumber)),
    )
  }

  const { createChapterWorkflow } = await import('./chapter-workflow')
  return createChapterWorkflow(chapterInfo)
}

/** 构建审稿工作流 */
async function buildReviewWorkflow(chapterNumber: number) {
  const draft = await getLatestDraft(chapterNumber)
  if (!draft) return null

  const { createReviewOnlyWorkflow } = await import('./chapter-workflow')
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
    const { createRefineFromReviewWorkflow } = await import('./chapter-workflow')
    return createRefineFromReviewWorkflow({
      chapterNumber,
      chapterTitle: draft.title,
      draftPath: draft.filePath,
      draftContent: draft.content,
      reviewReport,
      reviewFileName: `review_ch${chapterNumber}`,
    })
  }

  const { createRefineOnlyWorkflow } = await import('./chapter-workflow')
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

  const { createFinalizeWorkflow } = await import('./chapter-workflow')
  return createFinalizeWorkflow({
    chapterNumber,
    chapterTitle: draft.title,
    draftPath: draft.filePath,
    draftContent: draft.content,
  })
}
