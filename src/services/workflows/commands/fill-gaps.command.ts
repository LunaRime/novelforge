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
    if (!project) throw new Error('未打开项目')

    const architecture = (context.data.architecture as string) || ''
    const totalChapters = project.novelConfig.totalChapters
    const globalGuidance = project.novelConfig.globalGuidance || ''
    const allFilled: ChapterBlueprint[] = []

    const totalGaps = this.params.gaps.reduce((s, g) => s + g.gapSize, 0)
    let filledCount = 0

    for (const gap of this.params.gaps) {
      if (context.cancelled) {
        callbacks.log('已取消补全')
        break
      }

      const { missingChapterNumbers: chapters, context: gapContext } = gap
      callbacks.log(
        `正在补全第 ${chapters[0]}–${chapters[chapters.length - 1]} 章（${chapters.length} 章）...`,
      )

      const template = getPromptTemplate('chapter_blueprint_chunk')
      if (!template) throw new Error('模板丢失')

      const systemRole =
        getPromptTemplate('chapter_blueprint')?.systemRole ||
        '你是一位经验丰富的网文架构师，擅长根据前后章节的剧情上下文，填补中间缺失的蓝图。'

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
        const resultText = await this.callLLM(prompt, systemRole, callbacks)
        const parsed = parseTextBlueprints(resultText, chapters[0], chapters[chapters.length - 1])

        if (parsed.length > 0) {
          await saveAllBlueprints(parsed)
          allFilled.push(...parsed)
          callbacks.log(
            `  ✅ 已补全第 ${chapters[0]}–${chapters[chapters.length - 1]} 章（${parsed.length} 章）`,
          )
        } else {
          callbacks.log(
            `  ⚠️ 第 ${chapters[0]}–${chapters[chapters.length - 1]} 章补全结果为空，需要重试`,
          )
        }
      } catch (error) {
        callbacks.log(
          `  ❌ 第 ${chapters[0]}–${chapters[chapters.length - 1]} 章补全失败: ${String(error)}`,
        )
      }

      filledCount += chapters.length
    }

    callbacks.setProgress(100)
    callbacks.log(`✅ 共补全 ${allFilled.length} 章蓝图`)

    return allFilled
  }
}
