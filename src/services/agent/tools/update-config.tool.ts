/**
 * update_config — 更新小说配置
 */
import { t } from '../../../shared/locale'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'

export const updateConfigTool = buildAgentTool({
  name: 'update_config',
  description: t('tool.updateConfigDesc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      field: {
        type: 'string',
        description: t('tool.updateConfigField'),
        enum: ['genre', 'subGenre', 'targetAudience', 'totalChapters', 'wordsPerChapter',
               'coreOutline', 'worldSetting', 'goldenFinger', 'protagonistProfile',
               'globalGuidance', 'writingStyle', 'referenceWorks'],
      },
      value: {
        type: 'string',
        description: t('tool.updateConfigValue'),
      },
    },
    required: ['field', 'value'],
  },
  requiresConfirmation: true,
  isReadOnly: false,
  execute: async (args) => {
    const field = args.field as string
    const value = args.value as string

    if (!field || value === undefined) {
      return { success: false, content: '', error: t('error.missingFieldValue') }
    }

    const project = useProjectStore.getState().currentProject
    if (!project) {
      return { success: false, content: '', error: t('error.noProject') }
    }

    // 构造更新数据
    const updateData = {
      novelConfig: { ...project.novelConfig, [field]: value },
    }

    const result = await ipc.invoke('project:update-config', project.id, updateData)
    if (!result.success) {
      return { success: false, content: '', error: result.error ?? '配置更新失败' }
    }

    return {
      success: true,
      content: `✅ 配置已更新：${field} = "${typeof value === 'string' && value.length > 50 ? value.slice(0, 50) + '…' : value}"`,
    }
  },
})
