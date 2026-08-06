/**
 * write_file — 写入或修改项目文件
 */
import { t } from '../../../shared/locale'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import { validatePath } from './safe-path'

export const writeFileTool = buildAgentTool({
  name: 'write_file',
  description: t('tool.writeFileDesc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: t('tool.writeFilePath'),
      },
      content: {
        type: 'string',
        description: t('tool.writeFileContent'),
      },
    },
    required: ['file_path', 'content'],
  },
  requiresConfirmation: true,
  isReadOnly: false,
  execute: async (args) => {
    const filePath = args.file_path as string
    const content = args.content as string

    if (!filePath || content === undefined) {
      return { success: false, content: '', error: t('error.missingFilePathContent') }
    }

    const project = useProjectStore.getState().currentProject
    if (!project) {
      return { success: false, content: '', error: t('error.noProject') }
    }

    // 路径安全校验
    const pathCheck = validatePath(project.path, filePath)
    if (!pathCheck.valid) {
      return { success: false, content: '', error: pathCheck.error }
    }

    const result = await ipc.invoke('fs:write-file', pathCheck.fullPath, content)
    if (!result.success) {
      return { success: false, content: '', error: result.error ?? t('tool.writeFileFailed') }
    }

    return {
      success: true,
      content: t('tool.fileWritten').replace('{path}', filePath).replace('{length}', String(content.length)),
      artifacts: [{ type: 'file_modified', path: pathCheck.fullPath, name: filePath }],
    }
  },
})
