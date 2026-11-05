import { t } from '../../../shared/locale'
import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { ChapterPromptBuilder } from '../../prompts/prompt-builder'
import { computeTextStats } from '../../text-stats'
import { ipc } from '../../ipc-client'
import { assertDraftWrite, captureDraftProject } from '../../draft-index'


export interface RefineFromReviewParams {
  draftPath: string
  draftContent: string
  reviewReport: string
  reviewFileName?: string
  chapterNumber: number
  userRefinePrompt?: string
}

export class RefineFromReviewCommand extends BaseWorkflowCommand<string> {
  constructor(private params: RefineFromReviewParams) {
    super()
  }

  async execute({ callbacks }: CommandExecuteParams): Promise<string> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(t('error.noProject'))
    const assertProject = captureDraftProject(project.path)

    callbacks.log(t('log.refineFromReview.starting'))

    const template = getPromptTemplate('refine_from_review')
    if (!template) throw new Error(t('error.templateNotFound').replace('{name}', '审稿修复'))

    const userPromptBlock = this.params.userRefinePrompt?.trim()
      ? `★【用户额外修稿指导（绝对优先级）】★：\n${this.params.userRefinePrompt}`
      : ''

    const promptBuilder = new ChapterPromptBuilder(template)
      .withReviewReport(this.params.reviewReport)
      .withDraftContent(this.params.draftContent)
      .withGlobalGuidance(project.novelConfig.globalGuidance || '')
      .withUserRefinePrompt(userPromptBlock)

    const refined = await this.callLLMWithBuilder(promptBuilder, callbacks, { purpose: 'refine_chapter' })
    const cleanRefined = this.stripThinkingTags(refined)

    assertProject()
    const { parseDraftMeta } = await import('../chapter-workflow')
    assertProject()
    const baseDraft = await parseDraftMeta(this.params.draftPath)
    assertProject()
    if (!baseDraft) throw new Error(t('error.noBaseDraft'))

    const revIndex = await ipc.invoke('db:revision-next-index', baseDraft.id)
    assertProject()

    // Read existing revisions first; discard only after the replacement is persisted.
    const pendingRevs = await ipc.invoke('db:revision-get-pending', baseDraft.id)
    assertProject()

    const createRes = await ipc.invoke('db:revision-create', {
      baseDraftId: baseDraft.id,
      revisionIndex: revIndex,
      revisionType: 'review-fix',
      content: cleanRefined,
      wordCount: computeTextStats(cleanRefined).novelWordCount,
      userPrompt: this.params.userRefinePrompt,
    })
    assertDraftWrite(createRes)
    assertProject()
    if (!createRes.id) throw new Error(t('error.noBaseDraft'))
    for (const rev of pendingRevs) {
      assertProject()
      assertDraftWrite(await ipc.invoke('db:revision-mark-discarded', rev.id))
    }

    const { useEditorStore } = await import('../../../stores/editor-store')
    assertProject()
    useEditorStore.getState().openFile({
      id: `diff-${this.params.draftPath}-${createRes.id}`,
      name: t('workflow.reviewFix').replace('{n}', String(this.params.chapterNumber)),
      type: 'diff',
      filePath: this.params.draftPath,
      originalContent: this.params.draftContent,
      content: cleanRefined,
      revisionPath: String(createRes.id),
      chapterNumber: this.params.chapterNumber,    })

    callbacks.log(t('log.refineFromReview.done')
      .replace('{chars}', String(cleanRefined.length))
      .replace('{revision}', String(revIndex)))
    return refined
  }
}
