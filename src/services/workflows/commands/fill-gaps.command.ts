import { t } from '../../../shared/locale'
import { BaseWorkflowCommand, type CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { DirectoryPromptBuilder } from '../../prompts/prompt-builder'
import { type ChapterBlueprint, parseTextBlueprints } from '../directory-workflow'
import type { BlueprintGap } from '../../blueprint-verification-service'
import type { ChapterBlueprintScope } from '../../../core'
import { assertChapterBlueprintScope, captureChapterBlueprintScope, createMissingBlueprintWriter } from '../../chapters/chapter-blueprint-adapter'

export interface FillGapsParams { gaps: BlueprintGap[]; source?: ChapterBlueprintScope }

/** AI gap filling is insert-only at the transactional write point, never full-column upsert. */
export class FillGapsCommand extends BaseWorkflowCommand<ChapterBlueprint[]> {
  private readonly source: ChapterBlueprintScope | null
  private readonly gaps: BlueprintGap[]
  constructor(params: FillGapsParams) {
    super()
    const source = params.source ?? captureChapterBlueprintScope()
    this.source = source ? { ...source } : null
    this.gaps = structuredClone(params.gaps)
  }

  async execute({ context, callbacks }: CommandExecuteParams): Promise<ChapterBlueprint[]> {
    const source = this.source
    const assertActive = () => {
      if (!source) throw new Error(t('error.noProject'))
      assertChapterBlueprintScope(source)
      if (context.cancelled) throw new Error(t('error.workflowCancelled'))
    }
    assertActive()
    const project = useProjectStore.getState().currentProject!
    const targets = this.gaps.flatMap(gap => gap.missingChapterNumbers)
    if (!targets.length || new Set(targets).size !== targets.length || this.gaps.some(gap => !gap.missingChapterNumbers.length
      || gap.gapSize !== gap.missingChapterNumbers.length || gap.missingChapterNumbers.some((chapter, index, chapters) =>
        !Number.isSafeInteger(chapter) || chapter < 1 || (index > 0 && chapter !== chapters[index - 1] + 1)))) throw new Error(t('error.prereqNotMet'))
    const totalChapters = project.novelConfig.totalChapters
    const globalGuidance = project.novelConfig.globalGuidance || ''
    const architecture = (context.data.architecture as string) || ''
    const writer = await createMissingBlueprintWriter(source!)
    assertActive()
    const allFilled: ChapterBlueprint[] = []
    const insertedChapterNumbers: number[] = []
    const skippedChapterNumbers: number[] = []
    let attempted = 0

    for (const gap of this.gaps) {
      assertActive()
      const chapters = gap.missingChapterNumbers
      const start = String(chapters[0]); const end = String(chapters[chapters.length - 1])
      callbacks.log(t('log.fillGaps.filling').replace('{start}', start).replace('{end}', end).replace('{count}', String(chapters.length)))
      const template = getPromptTemplate('chapter_blueprint_chunk')
      if (!template) throw new Error(t('error.templateMissing'))
      const systemRole = getPromptTemplate('chapter_blueprint')?.systemRole || t('role.blueprintGapFiller')
      // These existing Chinese bridging instructions are part of the prompt context contract.
      const prompt = new DirectoryPromptBuilder(template)
        .withNovelArchitecture(architecture)
        .withChapterList(gap.context || '（无相邻章节上下文）')
        .withNumberOfChapters(totalChapters).withN(chapters[0]).withM(chapters[chapters.length - 1])
        .withGlobalGuidance(globalGuidance)
        .withPacingGuidance(`请特别注意：这是填补第 ${start}–${end} 章的缺口。必须确保情节衔接流畅，承上启下。`)
        .build()
      callbacks.setProgress(Math.round((attempted / targets.length) * 90))
      try {
        assertActive()
        const text = await this.callLLM(prompt, systemRole, callbacks, { staticContext: architecture }, context)
        assertActive()
        const parsed = parseTextBlueprints(text, chapters[0], chapters[chapters.length - 1])
        if (!parsed.length) throw new Error(t('verify.gapFillEmpty'))
        const covered = new Set(parsed.map(item => item.chapterNumber))
        const missing = chapters.filter(chapter => !covered.has(chapter))
        if (missing.length) callbacks.log(t('log.fillGaps.partialCoverage').replace('{start}', start).replace('{end}', end).replace('{missing}', missing.join(',')))
        assertActive()
        const receipt = await writer.insert(chapters, parsed)
        assertActive()
        const inserted = new Set(receipt.insertedChapterNumbers)
        allFilled.push(...parsed.filter(item => inserted.has(item.chapterNumber)))
        insertedChapterNumbers.push(...receipt.insertedChapterNumbers)
        skippedChapterNumbers.push(...receipt.skippedChapterNumbers)
        context.data.gapFillReceipt = { insertedChapterNumbers: [...insertedChapterNumbers], skippedChapterNumbers: [...skippedChapterNumbers] }
        callbacks.log(t('log.fillGaps.done').replace('{start}', start).replace('{end}', end).replace('{count}', String(inserted.size)))
        if (receipt.skippedChapterNumbers.length) callbacks.log(t('verify.gapFillSkipped').replace('{chapters}', receipt.skippedChapterNumbers.join(',')))
      } catch (error) {
        assertActive()
        callbacks.log(t('log.fillGaps.failed').replace('{start}', start).replace('{end}', end).replace('{error}', () => String(error)))
        throw error
      }
      attempted += chapters.length
    }
    assertActive()
    callbacks.setProgress(100)
    callbacks.log(t('log.fillGaps.total').replace('{count}', String(allFilled.length)))
    return allFilled
  }
}
