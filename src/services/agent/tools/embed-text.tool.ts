/**
 * embed_text — 将文本转换为向量嵌入
 *
 * 让 AI 可以主动调用向量模型，将文本转为向量。
 * 用于语义比较、相似度分析、文本聚类等场景。
 */
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useVectorConfigStore } from '../../../stores/vector-config-store'

export const embedTextTool = buildAgentTool({
  name: 'embed_text',
  description:
    '调用向量嵌入模型，将文本转换为向量表示。' +
    '适用于：\n' +
    '- 需要精确比较两段文本的语义相似度时\n' +
    '- 分析角色描述的相似性\n' +
    '- 检查情节是否与已有内容重复\n' +
    '- 对生成的内容进行质量评估（与参考文本对比）',
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: '需要嵌入的文本内容',
      },
    },
    required: ['text'],
  },
  requiresConfirmation: false,
  execute: async (args) => {
    const text = args.text as string

    if (!text || text.trim().length === 0) {
      return { success: false, content: '', error: 'text 参数不能为空' }
    }

    // 检查向量模型是否可用
    const vectorConfig = useVectorConfigStore.getState()
    if (!vectorConfig.canUseEmbeddingAPI()) {
      return {
        success: true,
        content:
          `⚠️ 向量模型（Embedding API）已关闭，无法生成精确向量嵌入。\n\n` +
          `当前状态: 向量模型=${vectorConfig.vectorModelEnabled ? 'ON' : 'OFF'}, ` +
          `本地模块=${vectorConfig.vectorModuleEnabled ? 'ON' : 'OFF'}\n\n` +
          `建议:\n` +
          `- 在「设置 → 向量模型」中开启向量模型\n` +
          `- 如果不需要精确语义搜索，可使用 search_knowledge 进行全文搜索`,
      }
    }

    try {
      const result = await ipc.invoke('embedding:generate', text)

      if (!result.success) {
        return {
          success: false,
          content: '',
          error: `向量嵌入失败: ${result.error || '未知错误'}`,
        }
      }

      const dims = result.vector?.length || 0
      const truncated = text.length > 150 ? text.slice(0, 150) + '…' : text

      return {
        success: true,
        content:
          `✅ 文本已向量化\n` +
          `- 文本: "${truncated}"\n` +
          `- 向量维度: ${dims}\n` +
          `- Token 消耗: ${result.tokens || '未知'}\n` +
          `- 嵌入模型已缓存此向量，可高效复用`,
      }
    } catch (error) {
      return {
        success: false,
        content: '',
        error: `嵌入生成异常: ${String(error)}`,
      }
    }
  },
})
