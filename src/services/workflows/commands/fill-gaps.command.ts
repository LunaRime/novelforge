import { t } from '../../../shared/locale'
/**
 * FillGapsCommand — AI 补全缺失的章节蓝图
 *
 * 利用相邻章节上下文，让 AI 生成桥接的蓝图。
 * 复用 DirectoryPromptBuilder 的 prompt 构建逻辑。
 */

import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { DirectoryPromptBuilder } from '../../prompts/prompt-builder'
import {
  type ChapterBlueprint,
  parseTextBlueprints,
  saveAllBlueprints,
} from '../directory-workflow'
import { type BlueprintGap } from '../../blueprint-verification-service'

export interface FillGapsParams {
  gaps: BlueprintGap[]
}

export class FillGapsCommand extends BaseWorkflowCommand<ChapterBlueprint[]> {
  constructor(private params: FillGapsParams) {
    super()
  }

  async execute({ context, callbacks }: CommandExecuteParams): Promise<ChapterBlueprint[]> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(t('error.noProject'))

    const architecture = (context.data.architecture as string) || ''
    const totalChapters = project.novelConfig.totalChapters
    const globalGuidance = project.novelConfig.globalGuidance || ''
    const allFilled: ChapterBlueprint[] = []

    const totalGaps = this.params.gaps.reduce((s, g) => s + g.gapSize, 0)
    let filledCount = 0

    for (const gap of this.params.gaps) {
      if (context.cancelled) {
        callbacks.log(t('log.fillGaps.cancelled'))
        break
      }

      const { missingChapterNumbers: chapters, context: gapContext } = gap
      callbacks.log(
        t('log.fillGaps.filling')
          .replace('{start}', String(chapters[0]))
          .replace('{end}', String(chapters[chapters.length - 1]))
          .replace('{count}', String(chapters.length)),
      )

      const template = getPromptTemplate('chapter_blueprint_chunk')
      if (!template) throw new Error(t('error.templateMissing'))

      const systemRole =
        getPromptTemplate('chapter_blueprint')?.systemRole ||
        t('role.blueprintGapFiller')

      const prompt = new DirectoryPromptBuilder(template)
        .withNovelArchitecture(architecture)
        .withChapterList(gapContext || '（无相邻章节上下文）')
        .withNumberOfChapters(totalChapters)
        .withN(chapters[0])
        .withM(chapters[chapters.length - 1])
        .withGlobalGuidance(globalGuidance)
        .withPacingGuidance(
          `请特别注意：这是填补第 ${chapters[0]}–${chapters[chapters.length - 1]} 章的缺口。必须确保情节衔接流畅，承上启下。`,
        )
        .build()

      const progressBase = Math.round((filledCount / totalGaps) * 90)
      callbacks.setProgress(progressBase)

      try {
        // staticContext：架构入 system 前缀（同 directory/generate-draft）——批次间前缀稳定命中 + system 遵从度更高
        const resultText = await this.callLLM(prompt, systemRole, callbacks, { staticContext: architecture })
        const parsed = parseTextBlueprints(resultText, chapters[0], chapters[chapters.length - 1])

        if (parsed.length > 0) {
          // ⚠️ M 级修复（轻量确定性闸门）：确认覆盖请求区间——LLM 补写可能漏章，
          //   缺口残留会让后续写作在该章仍无蓝图锚点（写稿/自审都读蓝图，错误逐级放大）
          const requested = new Set<number>()
          for (let n = chapters[0]; n <= chapters[chapters.length - 1]; n++) requested.add(n)
          const covered = new Set(parsed.map(p => p.chapterNumber))
          const missingNums = [...requested].filter(n => !covered.has(n))
          if (missingNums.length > 0) {
            callbacks.log(t('log.fillGaps.partialCoverage')
              .replace('{start}', String(chapters[0]))
              .replace('{end}', String(chapters[chapters.length - 1]))
              .replace('{missing}', missingNums.join(',')))
          }
          await saveAllBlueprints(parsed)
          allFilled.push(...parsed)
          callbacks.log(
            t('log.fillGaps.done')
              .replace('{start}', String(chapters[0]))
              .replace('{end}', String(chapters[chapters.length - 1]))
              .replace('{count}', String(parsed.length)),
          )
        } else {
          callbacks.log(
            t('log.fillGaps.empty')
              .replace('{start}', String(chapters[0]))
              .replace('{end}', String(chapters[chapters.length - 1])),
          )
        }
      } catch (error) {
        callbacks.log(
          t('log.fillGaps.failed')
            .replace('{start}', String(chapters[0]))
            .replace('{end}', String(chapters[chapters.length - 1]))
            .replace('{error}', () => String(error)),
        )
      }

      filledCount += chapters.length
    }

    callbacks.setProgress(100)
    callbacks.log(t('log.fillGaps.total').replace('{count}', String(allFilled.length)))

    return allFilled
  }
}
