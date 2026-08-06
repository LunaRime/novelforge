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
        // ⚠️ 字段体系与主进程白名单（project-controller.ts）及 read_project_state 输出对齐：
        //    补 plotStructure/narrativePOV（此前主进程可写但工具 enum 缺失，行为与声明不符）
        enum: ['genre', 'subGenre', 'targetAudience', 'totalChapters', 'wordsPerChapter',
               'coreOutline', 'worldSetting', 'goldenFinger', 'protagonistProfile',
               'globalGuidance', 'writingStyle', 'referenceWorks',
               'plotStructure', 'narrativePOV'],
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

    // ⚠️ execute 内再次校验 field ∈ enum（LLM 可能传任意字符串——此前任意字段也会写入并返回成功）
    const ALLOWED_FIELDS = new Set([
      'genre', 'subGenre', 'targetAudience', 'totalChapters', 'wordsPerChapter',
      'coreOutline', 'worldSetting', 'goldenFinger', 'protagonistProfile',
      'globalGuidance', 'writingStyle', 'referenceWorks', 'plotStructure', 'narrativePOV',
    ])
    if (!ALLOWED_FIELDS.has(field)) {
      return { success: false, content: '', error: t('tool.updateConfigInvalidField').replace('{field}', field) }
    }

    // 数字字段归一化：LLM 传 "12" 字符串会写入字符串类型，下游数值解析 NaN（P1 修复）
    const NUMERIC_FIELDS = new Set(['totalChapters', 'wordsPerChapter'])
    let finalValue: string | number = value
    if (NUMERIC_FIELDS.has(field)) {
      const n = Number(value)
      if (value.trim() === '' || isNaN(n)) {
        return { success: false, content: '', error: t('tool.updateConfigInvalidNumber').replace('{field}', field).replace('{value}', value) }
      }
      finalValue = n
    }

    const project = useProjectStore.getState().currentProject
    if (!project) {
      return { success: false, content: '', error: t('error.noProject') }
    }

    // 构造更新数据
    const updateData = {
      novelConfig: { ...project.novelConfig, [field]: finalValue },
    }

    const result = await ipc.invoke('project:update-config', project.id, updateData)
    if (!result.success) {
      return { success: false, content: '', error: result.error ?? t('tool.updateConfigFailed') }
    }

    return {
      success: true,
      content: t('tool.configUpdated')
        .replace('{field}', field)
        .replace('{value}', typeof value === 'string' && value.length > 50 ? value.slice(0, 50) + '…' : String(value)),
    }
  },
})
