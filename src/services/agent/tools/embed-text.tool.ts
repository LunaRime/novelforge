/**
 * embed_text — 将文本转换为向量嵌入
 *
 * 让 AI 可以主动调用向量模型，将文本转为向量。
 * 用于语义比较、相似度分析、文本聚类等场景。
 */
import { t } from '../../../shared/locale'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useVectorConfigStore } from '../../../stores/vector-config-store'

export const embedTextTool = buildAgentTool({
  name: 'embed_text',
  description: t('tool.embedDesc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: t('tool.embedText'),
      },
    },
    required: ['text'],
  },
  requiresConfirmation: false,
  execute: async (args) => {
    const text = args.text as string

    if (!text || text.trim().length === 0) {
      return { success: false, content: '', error: t('error.textParamEmpty') }
    }

    // 检查向量模型是否可用
    const vectorConfig = useVectorConfigStore.getState()
    if (!vectorConfig.canUseEmbeddingAPI()) {
      return {
        success: true,
        content:
          t('tool.embedDisabled') +
          t('tool.embedStatus')
            .replace('{model}', vectorConfig.vectorModelEnabled ? 'ON' : 'OFF')
            .replace('{module}', vectorConfig.vectorModuleEnabled ? 'ON' : 'OFF') +
          t('tool.embedSuggestHeader') +
          t('tool.embedSuggestEnable') +
          t('tool.embedSuggestSearch'),
      }
    }

    try {
      const result = await ipc.invoke('embedding:generate', text)

      if (!result.success) {
        return {
          success: false,
          content: '',
          error: t('tool.embedFailed').replace('{error}', result.error || t('status.unknown')),
        }
      }

      const dims = result.vector?.length || 0
      const truncated = text.length > 150 ? text.slice(0, 150) + '…' : text

      return {
        success: true,
        content:
          t('tool.embedSuccessHeader') +
          t('tool.embedTextLine').replace('{text}', truncated) +
          t('tool.embedDimsLine').replace('{dims}', String(dims)) +
          t('tool.embedTokensLine').replace('{tokens}', String(result.tokens || t('common.unknownWord'))) +
          t('tool.embedCached'),
      }
    } catch (error) {
      return {
        success: false,
        content: '',
        error: t('tool.embedException').replace('{error}', String(error)),
      }
    }
  },
})
