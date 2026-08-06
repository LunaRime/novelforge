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
          error: `索引失败: ${result.error || '未知错误'}`,
        }
      }

      const chunkCount = result.chunkCount || 0
      const chapterInfo = args.chapter_number
        ? `\n- 关联章节: 第${args.chapter_number}章`
        : ''

      return {
        success: true,
        content:
          `✅ 内容已索引到向量知识库\n` +
          `- 文档名: ${fileName}\n` +
          `- 文本块数: ${chunkCount}\n` +
          `- 内容长度: ${content.length} 字符${chapterInfo}\n` +
          `- 后续可通过 search_knowledge 工具检索此内容`,
      }
    } catch (error) {
      return {
        success: false,
        content: '',
        error: `索引异常: ${String(error)}`,
      }
    }
  },
})
