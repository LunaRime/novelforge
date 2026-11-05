import { draftUri } from '../vela-protocol'
/**
 * Renderer workflow adapter. Concrete builders and project guards live here;
 * UI and tools use start-workflow.ts, which injects this port into the pure core.
 * The start port resolves on onStarted, without waiting for run completion.
 */
import { t } from '../../shared/locale'
import { ipc } from '../ipc-client'
import { useWorkflowStore } from '../../stores/workflow-store'
import type { WorkflowDefinition } from '../../stores/workflow-store'
import { toast } from '../../components/ui/Toast'
import { DEFAULT_WORDS_PER_CHAPTER } from '../../shared/constants'
import type { DirectoryWorkflowParams } from './directory-workflow'
import { WorkflowStartError, type WorkflowStartPort, type EditorDraft, type ArchitectureGeneration, type ConfigGenerationSize } from '../../core'
import type { NovelConfig } from '../../shared/ipc-channels'

export interface WorkflowAdapterOptions {
  onGenerated?: (config: Partial<NovelConfig>) => void
  assertProject: () => void
}

export function createWorkflowStartPort(options: WorkflowAdapterOptions): WorkflowStartPort<WorkflowDefinition> {
  const assertProject = options.assertProject

  // ---- 工作流类型到显示名的映射 ----

  function getWorkflowDisplayName(workflow: string): string {
    switch (workflow) {
      case 'generate_draft': return t('tool.wfDraft')
      case 'review': return t('tool.wfReview')
      case 'refine': return t('tool.wfRefine')
      case 'finalize': return t('tool.wfFinalize')
      case 'generate_blueprint': return t('tool.wfBlueprint')
      case 'generate_architecture': return t('tool.wfArchitecture')
      case 'config_generation': return t('tool.wfConfig')
      case 'generate_book': return t('tool.wfBook')
      default: return workflow
    }
  }

  /**
   * 启动即回执（2026-10-02 评审 C1 修复）：用 store 既有 `onStarted` 回执（D 档同款语义）——
   * run 一开始就 resolve runId，不等整个 run 跑完。run 体晚到的 rejection 在此吞掉
   * （run 失败已由 workflow-store 的状态呈现），避免 unhandledrejection。
   */
  function startWithReceipt(definition: WorkflowDefinition, stepByStep = false): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      useWorkflowStore.getState().startWorkflow(definition, stepByStep, { onStarted: resolve }).catch(reject)
    })
  }

  // ===== 章节工作流入口 =====

  /**
   * 启动章节类工作流（写稿/审稿/修稿/定稿）
   *
   * @returns 尚未启动的定义、展示名与章节标签
   * @throws WorkflowStartError
   *   - ERR_GUARD：guard 失败（如无蓝图/无角色卡/前一章未定稿）或其他未预期异常
   *   - ERR_NO_DRAFT：review/refine/finalize 无草稿（原 return null 的语义化统一）
   *   - ERR_NO_BLUEPRINT：generate_draft 蓝图数据缺失（与 guard 失败区分——提示先生成蓝图）
   */
  async function prepareChapterWorkflow(
    workflow: 'generate_draft' | 'review' | 'refine' | 'finalize',
    chapterNumber: number,
    draft?: EditorDraft,
  ) {
    const displayName = getWorkflowDisplayName(workflow)
    const chapterTag = t('tool.chapterTag').replace('{n}', String(chapterNumber))
    let definition: WorkflowDefinition | null | undefined
    try {
      if (draft) {
        const { draftIdFromPath, getDraftMeta } = await import('../draft-index')
        assertProject()
        const metadata = await getDraftMeta(draftIdFromPath(draft.draftPath))
        assertProject()
        if (!metadata || metadata.chapterNumber !== chapterNumber) throw new WorkflowStartError('ERR_NO_DRAFT', t('error.prereqNotMet'))
        const factories = await import('./chapter-workflow')
        assertProject()
        const params = { ...draft, chapterNumber }
        if (workflow === 'review') definition = factories.createReviewOnlyWorkflow(params)
        else if (workflow === 'finalize') definition = factories.createFinalizeWorkflow(params)
        else if (workflow === 'refine') definition = draft.reviewReport !== undefined
          ? factories.createRefineFromReviewWorkflow({ ...params, reviewReport: draft.reviewReport, reviewFileName: draft.reviewFileName ?? '' })
          : factories.createRefineOnlyWorkflow(params)
      } else {
        switch (workflow) {
          case 'generate_draft': definition = await buildDraftWorkflow(chapterNumber); break
          case 'review': definition = await buildReviewWorkflow(chapterNumber); break
          case 'refine': definition = await buildRefineWorkflow(chapterNumber); break
          case 'finalize': definition = await buildFinalizeWorkflow(chapterNumber); break
        }
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
    return { definition, displayName, chapterTag }
  }

  // ===== 蓝图/架构工作流入口 =====

  /** 启动蓝图（目录）工作流——guard 失败 throw ERR_GUARD */
  async function prepareBlueprintWorkflow(params?: DirectoryWorkflowParams) {
    const displayName = getWorkflowDisplayName('generate_blueprint')
    const { guardDirectoryGeneration } = await import('./workflow-guards')
    assertProject()
    const guard = await guardDirectoryGeneration()
    assertProject()
    if (!guard.ok) {
      throw new WorkflowStartError('ERR_GUARD', guard.message || t('error.prereqNotMet'))
    }
    const { createDirectoryWorkflow } = await import('./directory-workflow')
    assertProject()
    return { definition: createDirectoryWorkflow(params ?? { mode: 'full' }), displayName }
  }

  /** 启动架构生成工作流——guard 失败 throw ERR_GUARD */
  async function prepareArchitectureWorkflow(params?: ArchitectureGeneration) {
    const displayName = getWorkflowDisplayName('generate_architecture')
    const { guardArchitectureGeneration } = await import('./workflow-guards')
    assertProject()
    const guard = guardArchitectureGeneration()
    if (!guard.ok) {
      throw new WorkflowStartError('ERR_GUARD', guard.message || t('error.prereqNotMet'))
    }
    const { createArchitectureWorkflow } = await import('./architecture-workflow')
    assertProject()
    return { definition: createArchitectureWorkflow(params), displayName }
  }

  /**
   * 启动整本流水线：逐章串行「写稿 → 自审/重写 → 定稿 → KB/记忆」。
   *
   * 与 generate_draft 区间模式的本质区别：
   *   - 区间模式把每章独立启动，第 2 章会因前一章未定稿而中止；
   *   - 本入口把前一章的 finalize 后处理作为下一章写稿的硬前置，失败即停。
   */
  async function prepareBookPipelineWorkflow(params: {
    chapterStart: number
    chapterEnd: number
    autoReview?: boolean
    reuseExistingDrafts?: boolean
  }) {
    const displayName = getWorkflowDisplayName('generate_book')
    const { chapterStart, chapterEnd } = params

    const { useProjectStore } = await import('../../stores/project-store')
    assertProject()
    const project = useProjectStore.getState().currentProject
    if (!project) throw new WorkflowStartError('ERR_GUARD', t('error.noProject'))

    const totalChapters = project.novelConfig.totalChapters || 0
    if (totalChapters > 0 && chapterEnd > totalChapters) {
      throw new WorkflowStartError('ERR_GUARD', t('workflow.bookPipelineOutOfRange')
        .replace('{end}', String(chapterEnd))
        .replace('{total}', String(totalChapters)))
    }

    // 复用单章 guard：蓝图存在、角色卡存在、若 start>1 则前一章已定稿且后处理通过
    const { guardChapterWriting } = await import('./workflow-guards')
    assertProject()
    const guard = await guardChapterWriting(chapterStart)
    assertProject()
    if (!guard.ok) {
      throw new WorkflowStartError('ERR_GUARD', guard.message || t('error.prereqNotMet'))
    }

    // 范围内每一章都必须有蓝图，否则流水线跑到中间才失败，浪费前面章节的 token
    const blueprints = await ipc.invoke('db:blueprint-get-all') as Array<{ chapterNumber: number }> | null
    assertProject()
    const existing = new Set((blueprints ?? []).map(b => Number(b.chapterNumber)))
    for (let n = chapterStart; n <= chapterEnd; n++) {
      if (!existing.has(n)) {
        throw new WorkflowStartError('ERR_GUARD', t('workflow.bookPipelineMissingBlueprint').replace('{n}', String(n)))
      }
    }

    const { createBookPipelineWorkflow } = await import('./book-pipeline-workflow')
    assertProject()
    const definition = createBookPipelineWorkflow({
      chapterStart,
      chapterEnd,
      autoReview: params.autoReview,
      reuseExistingDrafts: params.reuseExistingDrafts,
    })
    return {
      definition,
      displayName,
      chapterTag: t('tool.chapterRangeTag')
        .replace('{start}', String(chapterStart))
        .replace('{end}', String(chapterEnd)),
    }
  }

  /**
   * 启动配置生成工作流（线③ 第 4 条：Agent 起 config_generation）。
   * idea = Agent 从用户意图提取的「创作脑洞」；规模参数读当前项目配置。
   * onGenerated 复用线③ 第 1 条的快照 + 应用 + 撤销出口（与 NovelConfigEditor 同款）。
   */
  async function prepareConfigGenerationWorkflow(idea: string, size: ConfigGenerationSize = {}, options: WorkflowAdapterOptions) {
    const displayName = getWorkflowDisplayName('config_generation')
    const { useProjectStore } = await import('../../stores/project-store')
    assertProject()
    const project = useProjectStore.getState().currentProject
    if (!project) {
      throw new WorkflowStartError('ERR_GUARD', t('error.noProject'))
    }
    const totalChapters = size.totalChapters ?? (project.novelConfig.totalChapters || 100)
    const wordsPerChapter = size.wordsPerChapter ?? (project.novelConfig.wordsPerChapter || DEFAULT_WORDS_PER_CHAPTER)
    const { createConfigGenerationWorkflow } = await import('./architecture-workflow')
    assertProject()
    const definition = createConfigGenerationWorkflow({
      idea,
      totalChapters,
      wordsPerChapter,
      onGenerated: (parsed) => {
        options.assertProject()
        if (options.onGenerated) { options.onGenerated(parsed); return }
        const store = useProjectStore.getState()
        store.snapshotNovelConfig()
        store.updateNovelConfig(parsed)
        toast.show({
          type: 'ai',
          message: t('novelConfig.aiApplied'),
          actions: [{
            label: t('action.undoShort'),
            onClick: () => {
              options.assertProject()
              if (store.restoreNovelConfigSnapshot()) toast.success(t('novelConfig.aiReverted'))
            },
          }],
        })
      },
    })
    return { definition, displayName }
  }

  /** Composition-only adapter: guards and concrete builders remain in the renderer. */
  return {
    chapter: prepareChapterWorkflow,
    blueprint: prepareBlueprintWorkflow,
    architecture: prepareArchitectureWorkflow,
    book: prepareBookPipelineWorkflow,
    config: (idea, size) => prepareConfigGenerationWorkflow(idea, size, options),
    write: async chapter => {
      const { guardChapterWriting } = await import('./workflow-guards')
      assertProject()
      const guard = await guardChapterWriting(chapter.chapterNumber)
      assertProject()
      if (!guard.ok) throw new WorkflowStartError('ERR_GUARD', guard.message || t('error.prereqNotMet'))
      const { createChapterWorkflow } = await import('./chapter-workflow')
      assertProject()
      return { definition: createChapterWorkflow(chapter), displayName: getWorkflowDisplayName('generate_draft'),
        chapterTag: t('tool.chapterTag').replace('{n}', String(chapter.chapterNumber)) }
    },
    importNovel: async chapters => {
      const { createImportWorkflow } = await import('./import-workflow')
      assertProject()
      return { definition: createImportWorkflow({ chapters }), displayName: t('workflow.importTitle'), stepByStep: true }
    },
    configField: async field => {
      const { createFieldGenerationWorkflow } = await import('./architecture-workflow')
      assertProject()
      return { definition: createFieldGenerationWorkflow(field), displayName: getWorkflowDisplayName('config_generation') }
    },
    extractCharacters: async params => {
      const { createArchCharacterExtractWorkflow } = await import('./architecture-workflow')
      assertProject()
      return { definition: createArchCharacterExtractWorkflow(params), displayName: t('workflow.postProcessCards') }
    },
    repairCharacters: async projectPath => {
      const { createRepairArchCharacterCardsWorkflow } = await import('./architecture-workflow')
      assertProject()
      return { definition: createRepairArchCharacterCardsWorkflow({ projectPath }), displayName: t('workflow.fixCards') }
    },
    start: startWithReceipt,
    fillGaps: async gaps => {
      const { createGapFillWorkflow } = await import('./verification-workflow')
      assertProject()
      return { definition: createGapFillWorkflow(gaps.map(gap => ({ ...gap,
        missingChapterNumbers: [...gap.missingChapterNumbers], precedingChapter: null, followingChapter: null,
      }))), displayName: t('workflow.gapFillTitle') }
    },
    repair: async chapterNumber => {
      const { guardRepairPostProcess } = await import('./workflow-guards')
      assertProject()
      const guard = await guardRepairPostProcess(chapterNumber)
      assertProject()
      if (!guard.ok) throw new WorkflowStartError('ERR_GUARD', guard.message || t('error.prereqNotMet'))
      const { createRepairFinalizeWorkflow } = await import('./chapter-workflow')
      assertProject()
      return { definition: createRepairFinalizeWorkflow(chapterNumber), displayName: getWorkflowDisplayName('finalize'),
        chapterTag: t('tool.chapterTag').replace('{n}', String(chapterNumber)) }
    },
  }

  // ===== 工作流构建辅助函数 =====

  /** 从数据库蓝图构建 ChapterInfo */
  async function getChapterInfoFromBlueprint(chapterNumber: number) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bp = await ipc.invoke('db:blueprint-get', chapterNumber) as any
      assertProject()
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
      assertProject()
      if (!drafts || drafts.length === 0) return null
      // 取最新版本
      const latest = drafts.sort((a, b) => b.version - a.version)[0]
      const full = await ipc.invoke('db:draft-get-full', latest.id) as { content: string } | null
      assertProject()
      if (!full) return null
      return {
        filePath: draftUri(latest.id),
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
      assertProject()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const drafts = await ipc.invoke('db:draft-list', chapterNumber) as any[]
      assertProject()
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
    assertProject()
    const guard = await guardChapterWriting(chapterNumber)
    assertProject()
    if (!guard.ok) {
      // guard 失败直接抛出，由 prepareChapterWorkflow 的 catch 统一转 ERR_GUARD
      throw new Error(guard.message || t('error.prereqNotMet'))
    }

    const chapterInfo = await getChapterInfoFromBlueprint(chapterNumber)
    assertProject()
    if (!chapterInfo) {
      // P0-3：蓝图缺失单独归类（ERR_NO_BLUEPRINT），避免被 catch 误归为 ERR_GUARD
      throw new WorkflowStartError(
        'ERR_NO_BLUEPRINT',
        t('tool.wfBlueprintDataMissing').replace('{chapter}', String(chapterNumber)),
      )
    }

    const { createChapterWorkflow } = await import('./chapter-workflow')
    assertProject()
    return createChapterWorkflow(chapterInfo)
  }

  /** 构建审稿工作流 */
  async function buildReviewWorkflow(chapterNumber: number) {
    const draft = await getLatestDraft(chapterNumber)
    assertProject()
    if (!draft) return null

    const { createReviewOnlyWorkflow } = await import('./chapter-workflow')
    assertProject()
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
    assertProject()
    if (!draft) return null

    const reviewReport = await getLatestReview(chapterNumber)
    assertProject()

    if (reviewReport) {
      const { createRefineFromReviewWorkflow } = await import('./chapter-workflow')
      assertProject()
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
    assertProject()
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
    assertProject()
    if (!draft) return null

    const { createFinalizeWorkflow } = await import('./chapter-workflow')
    assertProject()
    return createFinalizeWorkflow({
      chapterNumber,
      chapterTitle: draft.title,
      draftPath: draft.filePath,
      draftContent: draft.content,
    })
  }

}
