/**
 * index_content — 将文本索引到知识库（向量化 + 存储）
 *
 * 让 AI 可以将生成的内容、提取的要点、角色设定等主动存入向量知识库，
 * 供后续的语义搜索和 RAG 管道使用。
 */
import { t } from '../../../shared/locale'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'

export const indexContentTool = buildAgentTool({
  name: 'index_content',
  description: t('tool.indexDesc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: t('tool.indexText'),
      },
      file_name: {
        type: 'string',
        description: t('tool.indexFileName'),
      },
      chapter_number: {
        type: 'number',
        description: t('tool.indexChapter'),
      },
    },
    required: ['content', 'file_name'],
  },
  requiresConfirmation: true,
  execute: async (args) => {
    const content = args.content as string
    const fileName = args.file_name as string

    if (!content || !fileName) {
      return {
        success: false,
        content: '',
        error: t('error.contentFileNameEmpty'),
      }
    }

    // 长度上限（P3）：超大文本直送 embedding API，token 成本不可控
    const MAX_INDEX_LENGTH = 50_000
    if (content.length > MAX_INDEX_LENGTH) {
      return { success: false, content: '', error: t('tool.embedTextTooLong').replace('{limit}', String(MAX_INDEX_LENGTH)) }
    }

    try {
      const project = useProjectStore.getState().currentProject
      if (!project) {
        return { success: false, content: '', error: t('error.noProject') }
      }

      const result = await ipc.invoke(
        'kb:import-text',
        content,
        fileName,
        project.path,
      )

      if (!result.success) {
        return {
          success: false,
          content: '',
          error: t('tool.indexFailed').replace('{error}', result.error || t('status.unknown')),
        }
      }

      const chunkCount = result.chunkCount || 0
      const chapterInfo = args.chapter_number
        ? t('tool.indexChapterInfo').replace('{chapter}', String(args.chapter_number))
        : ''

      return {
        success: true,
        content:
          t('tool.indexSuccessHeader') +
          t('tool.indexDocName').replace('{name}', fileName) +
          t('tool.indexChunks').replace('{count}', String(chunkCount)) +
          t('tool.indexLength')
            .replace('{length}', String(content.length))
            .replace('{chapter}', chapterInfo) +
          t('tool.indexRetrievable'),
      }
    } catch (error) {
      return {
        success: false,
        content: '',
        error: t('tool.indexException').replace('{error}', String(error)),
      }
    }
  },
})
