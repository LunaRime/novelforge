/**
 * open_editor — 在编辑器中打开文件
 */
import { t } from '../../../shared/locale'
import { buildAgentTool } from '../tool-registry'
import { useEditorStore } from '../../../stores/editor-store'
import { useProjectStore } from '../../../stores/project-store'
import { ipc } from '../../ipc-client'
import { validatePath } from './safe-path'

export const openEditorTool = buildAgentTool({
  name: 'open_editor',
  description: t('tool.openEditorDesc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: t('tool.openEditorPath'),
      },
      tab_type: {
        type: 'string',
        description: t('tool.openEditorTabType'),
        enum: ['chapter', 'outline', 'character', 'config', 'arch-file'],
        default: 'chapter',
      },
    },
    required: ['file_path'],
  },
  requiresConfirmation: true,
  isReadOnly: false,
  execute: async (args) => {
    const filePath = args.file_path as string
    const tabType = (args.tab_type as string) ?? 'chapter'

    // tab_type enum 校验（LLM 传非法值会以非法 tab 类型打开编辑器，P3 修复）
    const ALLOWED_TAB_TYPES = new Set(['chapter', 'outline', 'character', 'config', 'arch-file'])
    if (!ALLOWED_TAB_TYPES.has(tabType)) {
      return { success: false, content: '', error: t('tool.openEditorInvalidTabType').replace('{value}', tabType) }
    }

    if (!filePath) {
      return { success: false, content: '', error: t('error.missingFilePath') }
    }

    const project = useProjectStore.getState().currentProject
    if (!project) {
      return { success: false, content: '', error: t('error.noProject') }
    }

    const fullPath_check = validatePath(project.path, filePath)
    if (!fullPath_check.valid) {
      return { success: false, content: '', error: fullPath_check.error }
    }
    const fullPath = fullPath_check.fullPath

    // 读取文件内容
    const result = await ipc.invoke('fs:read-file', fullPath)
    if (!result.success) {
      return { success: false, content: '', error: t('tool.openEditorReadFailed').replace('{error}', result.error ?? '') }
    }

    // 在编辑器中打开
    const fileName = filePath.split('/').pop() ?? filePath
    useEditorStore.getState().openFile({
      id: `agent-${Date.now()}`,
      name: fileName,
      type: tabType as 'chapter' | 'outline' | 'character' | 'config' | 'arch-file',
      filePath: fullPath,
      content: result.content,
    })

    return {
      success: true,
      content: t('tool.openEditorSuccess').replace('{name}', fileName),
      artifacts: [{ type: 'tab_opened', path: fullPath, name: fileName }],
    }
  },
})
