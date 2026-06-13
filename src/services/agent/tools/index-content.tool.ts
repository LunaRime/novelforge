/**
 * index_content — 将文本索引到知识库（向量化 + 存储）
 *
 * 让 AI 可以将生成的内容、提取的要点、角色设定等主动存入向量知识库，
 * 供后续的语义搜索和 RAG 管道使用。
 */
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'

export const indexContentTool = buildAgentTool({
  name: 'index_content',
  description:
    '将文本内容索引到向量知识库中，供后续的语义搜索使用。\n' +
    '适用场景：\n' +
    '- 将新生成的章节要点存入知识库\n' +
    '- 将提取的角色设定索引入库\n' +
    '- 将世界观设定片段存入知识库\n' +
    '- 将审稿发现的问题模式存入知识库\n' +
    '索引后的内容可通过 search_knowledge 工具检索。',
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: '需要索引的文本内容',
      },
      file_name: {
        type: 'string',
        description:
          '文件名标识（用于后续检索时显示来源），例如 "第5章-要点.md"、"角色-张三-设定.md"',
      },
      chapter_number: {
        type: 'number',
        description:
          '关联的章节号（可选）。如果提供，检索时可以按章节范围过滤。',
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
        error: 'content 和 file_name 参数不能为空',
      }
    }

    try {
      const project = useProjectStore.getState().currentProject
      if (!project) {
        return { success: false, content: '', error: '未打开项目' }
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
