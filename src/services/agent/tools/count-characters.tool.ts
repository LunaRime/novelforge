/**
 * count_characters — 文本字数统计工具
 *
 * LLM 生成小说/修订/审稿时遇到字数限制（如"每章约 3000 字"）不应逐字计数，
 * 直接调用本工具获取准确统计：
 * - text：直接统计传入文本
 * - chapter_number：统计某章最新草稿
 */
import { t } from '../../../shared/locale'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import { computeTextStats, formatTextStats } from '../../text-stats'

export const countCharactersTool = buildAgentTool({
  name: 'count_characters',
  description: t('tool.countDesc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: t('tool.countText'),
      },
      chapter_number: {
        type: 'number',
        description: t('tool.countChapter'),
      },
    },
  },
  requiresConfirmation: false,
  execute: async (args) => {
    const textArg = args.text as string | undefined
    const chapterNum = args.chapter_number as number | undefined

    // 直接统计传入文本
    if (textArg !== undefined && textArg.trim() !== '') {
      return {
        success: true,
        content: formatTextStats(computeTextStats(textArg), t('tool.countTextLabel')),
      }
    }

    // 按章节号读取最新草稿统计
    if (chapterNum !== undefined) {
      const project = useProjectStore.getState().currentProject
      if (!project) {
        return { success: false, content: '', error: t('error.noProject') }
      }
      try {
        const latest = await ipc.invoke('db:draft-get-latest', chapterNum) as { id?: number; version?: number } | null
        if (!latest || latest.id === undefined) {
          return { success: true, content: t('tool.countNoDraft').replace('{chapter}', String(chapterNum)) }
        }
        const full = await ipc.invoke('db:draft-get-full', latest.id) as { content?: string } | null
        if (!full) {
          return { success: false, content: '', error: t('tool.countDraftReadFailed').replace('{chapter}', String(chapterNum)) }
        }
        return {
          success: true,
          content: formatTextStats(
            computeTextStats(full.content ?? ''),
            t('tool.countChapterDraftLabel')
              .replace('{chapter}', String(chapterNum))
              .replace('{version}', String(latest.version ?? '?')),
          ),
        }
      } catch (error) {
        return { success: false, content: '', error: t('tool.countFailed').replace('{error}', String(error)) }
      }
    }

    return {
      success: false,
      content: '',
      error: t('tool.countMissingParam'),
    }
  },
})
