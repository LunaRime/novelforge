/**
 * 整本流水线 — 逐章串行执行「写稿 → 自审/重写 → 定稿 → 知识库/记忆」。
 *
 * 背景（2026-10-21 实例测试）：
 *   `generate_draft` 的区间模式只是把每一章独立启动；第 2 章起的前置校验要求
 *   前一章已定稿且后处理通过，于是 1–5 实际只启动了第 1 章，其余章节静默中止。
 *   本工作流把“前一章定稿完成”显式做成下一步的前置条件，避免 Agent 误报
 *   “2–5 章等待中、会自动继续”。
 *
 * 设计约束：
 *   - 严格串行：一章的 finalize 后处理（含 KB 导入、章节记忆）通过后才进入下一章；
 *   - 可恢复：已定稿章节跳过；已有未定稿草稿默认复用，避免重复生成；
 *   - 失败即停：任何一章的写稿/定稿后处理失败都会终止整条流水线，并留下明确章节号。
 */
import type {
  StepCallbacks,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowParams,
  WorkflowStep,
} from '../../stores/workflow-store'
import { t } from '../../shared/locale'
import { ipc } from '../ipc-client'
import { useProjectStore } from '../../stores/project-store'
import { computeTextStats } from '../text-stats'
import { getChapterFinalizeScope, readPostProcessStatus } from './workflow-utils'
import { registerWorkflow } from './workflow-registry'
import type { ChapterInfo } from './chapter-workflow'

export interface BookPipelineParams {
  chapterStart: number
  chapterEnd: number
  /** 是否在定稿前执行自审 + 必要时重写（默认 true） */
  autoReview?: boolean
  /** 复用已有未定稿草稿（默认 true）；false 时强制重新写稿 */
  reuseExistingDrafts?: boolean
}

interface DraftSnapshot {
  id: number
  version: number
  filePath: string
  content: string
}

/** 纯函数：生成逐章步骤计划（供测试与步骤构建共用） */
export function buildBookPipelinePlan(params: BookPipelineParams): Array<{
  chapterNumber: number
  phase: 'write' | 'review' | 'finalize'
}> {
  const plan: Array<{ chapterNumber: number; phase: 'write' | 'review' | 'finalize' }> = []
  for (let n = params.chapterStart; n <= params.chapterEnd; n++) {
    plan.push({ chapterNumber: n, phase: 'write' })
    if (params.autoReview !== false) plan.push({ chapterNumber: n, phase: 'review' })
    plan.push({ chapterNumber: n, phase: 'finalize' })
  }
  return plan
}

function draftKey(chapterNumber: number): string {
  return `book_pipeline:draft:${chapterNumber}`
}

function skipKey(chapterNumber: number): string {
  return `book_pipeline:skip:${chapterNumber}`
}

async function loadChapterInfo(chapterNumber: number): Promise<ChapterInfo> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bp = await ipc.invoke('db:blueprint-get', chapterNumber) as any
  if (!bp) {
    throw new Error(t('workflow.bookPipelineMissingBlueprint').replace('{n}', String(chapterNumber)))
  }
  return {
    chapterNumber,
    title: (bp.title as string) || t('tool.chapterTag').replace('{n}', String(chapterNumber)),
    role: (bp.role as string) || '',
    purpose: (bp.purpose as string) || '',
    characters: Array.isArray(bp.characters) ? (bp.characters as string[]) : [],
    keyEvents: (bp.keyEvents as string) || '',
    suspenseHook: bp.suspenseHook as string | undefined,
    userGuidance: bp.userGuidance as string | undefined,
  }
}

async function loadLatestDraft(chapterNumber: number): Promise<DraftSnapshot | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drafts = await ipc.invoke('db:draft-list', chapterNumber) as any[]
  if (!Array.isArray(drafts) || drafts.length === 0) return null
  const active = drafts
    .filter(d => d && d.status !== 'archived')
    .sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0))
  const latest = active[0]
  if (!latest?.id) return null
  const full = await ipc.invoke('db:draft-get-full', latest.id) as { content?: string } | null
  if (!full?.content) return null
  return {
    id: latest.id as number,
    version: Number(latest.version ?? 1),
    filePath: `vela://draft/${latest.id}`,
    content: full.content,
  }
}

function readDraftFromContext(context: WorkflowContext, chapterNumber: number): DraftSnapshot | null {
  const value = context.data[draftKey(chapterNumber)]
  if (!value || typeof value !== 'object') return null
  const draft = value as Partial<DraftSnapshot>
  if (typeof draft.id !== 'number' || typeof draft.content !== 'string' || !draft.filePath) return null
  return draft as DraftSnapshot
}

function saveDraftToContext(context: WorkflowContext, chapterNumber: number, draft: DraftSnapshot): void {
  context.data[draftKey(chapterNumber)] = draft
}

/** 已定稿章节的空洞/失配后处理不能直接跳过——否则下一章 guard 会以更难懂的方式失败 */
async function assertFinalizedChapterHealthy(chapterNumber: number): Promise<void> {
  const status = await readPostProcessStatus('', getChapterFinalizeScope(chapterNumber))
  // 旧版定稿可能没有状态文件：与 workflow-guards 的兼容口径一致，缺失时放行
  if (status && !status.allCriticalPassed) {
    throw new Error(t('workflow.bookPipelineFinalizeUnhealthy').replace('{n}', String(chapterNumber)))
  }
}

function logDraftLength(callbacks: StepCallbacks, chapterNumber: number, content: string): void {
  const project = useProjectStore.getState().currentProject
  const target = project?.novelConfig.wordsPerChapter ?? 0
  const words = computeTextStats(content).novelWordCount
  if (target > 0) {
    callbacks.log(t('workflow.bookPipelineDraftDone')
      .replace('{n}', String(chapterNumber))
      .replace('{words}', String(words))
      .replace('{target}', String(target)))
  }
}

async function executeWriteStep(
  chapterNumber: number,
  params: BookPipelineParams,
  step: WorkflowStep,
  context: WorkflowContext,
  callbacks: StepCallbacks,
): Promise<void> {
  const finalized = await ipc.invoke('db:draft-get-finalized', chapterNumber)
  if (finalized) {
    await assertFinalizedChapterHealthy(chapterNumber)
    context.data[skipKey(chapterNumber)] = true
    callbacks.log(t('workflow.bookPipelineSkipFinalized').replace('{n}', String(chapterNumber)))
    return
  }

  if (params.reuseExistingDrafts !== false) {
    const existing = await loadLatestDraft(chapterNumber)
    if (existing) {
      saveDraftToContext(context, chapterNumber, existing)
      callbacks.log(t('workflow.bookPipelineReuseDraft')
        .replace('{n}', String(chapterNumber))
        .replace('{version}', String(existing.version)))
      return
    }
  }

  const info = await loadChapterInfo(chapterNumber)
  const { GenerateDraftCommand } = await import('./commands/generate-draft.command')
  await new GenerateDraftCommand(info).execute({ step, context, callbacks })

  const draft = await loadLatestDraft(chapterNumber)
  if (!draft) {
    throw new Error(t('workflow.bookPipelineDraftMissing').replace('{n}', String(chapterNumber)))
  }
  saveDraftToContext(context, chapterNumber, draft)
  logDraftLength(callbacks, chapterNumber, draft.content)
}

async function executeReviewStep(
  chapterNumber: number,
  params: BookPipelineParams,
  step: WorkflowStep,
  context: WorkflowContext,
  callbacks: StepCallbacks,
): Promise<void> {
  if (context.data[skipKey(chapterNumber)] === true) return
  if (params.autoReview === false) {
    callbacks.log(t('workflow.bookPipelineReviewSkipped').replace('{n}', String(chapterNumber)))
    return
  }

  const draft = readDraftFromContext(context, chapterNumber) ?? await loadLatestDraft(chapterNumber)
  if (!draft) {
    throw new Error(t('workflow.bookPipelineDraftMissing').replace('{n}', String(chapterNumber)))
  }
  const info = await loadChapterInfo(chapterNumber)
  const { SelfReviewCommand } = await import('./commands/self-review.command')
  await new SelfReviewCommand({
    chapterNumber,
    chapterTitle: info.title,
    draftId: draft.id,
  }).execute({ step, context, callbacks })

  // 自审可能产出新版本；后续定稿必须使用最新版本
  const latest = await loadLatestDraft(chapterNumber)
  if (latest) saveDraftToContext(context, chapterNumber, latest)
}

async function executeFinalizeStep(
  chapterNumber: number,
  step: WorkflowStep,
  context: WorkflowContext,
  callbacks: StepCallbacks,
): Promise<void> {
  if (context.data[skipKey(chapterNumber)] === true) return
  const draft = readDraftFromContext(context, chapterNumber) ?? await loadLatestDraft(chapterNumber)
  if (!draft) {
    throw new Error(t('workflow.bookPipelineDraftMissing').replace('{n}', String(chapterNumber)))
  }
  const info = await loadChapterInfo(chapterNumber)

  const { FinalizeChapterCommand } = await import('./commands/finalize-chapter.command')
  await new FinalizeChapterCommand({
    draftPath: draft.filePath,
    draftContent: draft.content,
    chapterNumber,
    chapterInfo: info,
  }).execute({ step, context, callbacks })

  const status = await readPostProcessStatus('', getChapterFinalizeScope(chapterNumber))
  if (status && !status.allCriticalPassed) {
    throw new Error(t('workflow.bookPipelineFinalizeUnhealthy').replace('{n}', String(chapterNumber)))
  }
  const finalized = await ipc.invoke('db:draft-get-finalized', chapterNumber)
  if (!finalized) {
    throw new Error(t('workflow.bookPipelineFinalizeMissing').replace('{n}', String(chapterNumber)))
  }
  callbacks.log(t('workflow.bookPipelineChapterDone').replace('{n}', String(chapterNumber)))
}

export function createBookPipelineWorkflow(params: BookPipelineParams): WorkflowDefinition {
  const plan = buildBookPipelinePlan(params)
  const total = params.chapterEnd - params.chapterStart + 1
  const steps = plan.map((item) => {
    const n = item.chapterNumber
    if (item.phase === 'write') {
      return {
        name: t('workflow.bookPipelineWrite').replace('{n}', String(n)),
        description: t('workflow.bookPipelineWriteDesc').replace('{n}', String(n)),
        executor: async (step: WorkflowStep, context: WorkflowContext, callbacks: StepCallbacks) =>
          executeWriteStep(n, params, step, context, callbacks),
      }
    }
    if (item.phase === 'review') {
      return {
        name: t('workflow.bookPipelineReview').replace('{n}', String(n)),
        description: t('workflow.bookPipelineReviewDesc').replace('{n}', String(n)),
        executor: async (step: WorkflowStep, context: WorkflowContext, callbacks: StepCallbacks) =>
          executeReviewStep(n, params, step, context, callbacks),
      }
    }
    return {
      name: t('workflow.bookPipelineFinalize').replace('{n}', String(n)),
      description: t('workflow.bookPipelineFinalizeDesc').replace('{n}', String(n)),
      executor: async (step: WorkflowStep, context: WorkflowContext, callbacks: StepCallbacks) =>
        executeFinalizeStep(n, step, context, callbacks),
    }
  })

  return {
    type: 'book_pipeline',
    title: t('workflow.bookPipelineTitle')
      .replace('{start}', String(params.chapterStart))
      .replace('{end}', String(params.chapterEnd)),
    steps,
    rehydrateParams: { ...params } as WorkflowParams,
    onComplete: {
      mode: 'open',
      message: t('workflow.bookPipelineDone')
        .replace('{start}', String(params.chapterStart))
        .replace('{end}', String(params.chapterEnd))
        .replace('{total}', String(total)),
    },
  }
}

// 顶层自注册（checkpoint 恢复时需要）
registerWorkflow('book_pipeline', (p) => createBookPipelineWorkflow(p as unknown as BookPipelineParams))
