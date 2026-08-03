/**
 * read_file — 读取文件内容
 * - 相对路径：项目内文件（validatePath 防越界）
 * - 绝对路径：项目外文件（用户通过"添加外部文件"显式选择，校验可读扩展名 + 长度防御）
 */
import { t } from '../../../shared/locale'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import { validatePath } from './safe-path'

/** 绝对路径判定（Windows 盘符 / UNC，与 intent-router 一致） */
function isAbsolutePath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\')
}

export const readFileTool = buildAgentTool({
  name: 'read_file',
  description: '读取项目内指定文件的内容。支持读取架构文件、蓝图、角色卡、草稿、配置等任意文本文件。',
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: '相对于项目根目录的文件路径，例如 "02_architecture/世界观.md"',
      },
    },
    required: ['file_path'],
  },
  requiresConfirmation: false,
  execute: async (args) => {
    const filePath = args.file_path as string
    const project = useProjectStore.getState().currentProject
    if (!project) {
      return { success: false, content: '', error: t('error.noProject') }
    }

    // 项目外文件：用户显式提供的绝对路径（"添加外部文件"对话框选择），
    // 走专用只读通道 fs:read-external-file——fs:read-file 有沙箱（项目/主目录内），
    // 任意磁盘的外部文件会被拒绝；专用通道无沙箱但有扩展名 + 1MB 限制
    if (isAbsolutePath(filePath)) {
      const res = await ipc.invoke('fs:read-external-file', filePath)
      if (!res.success) {
        return { success: false, content: '', error: res.error ?? '外部文件读取失败' }
      }
      return { success: true, content: String(res.content ?? '') }
    }

    // 项目内文件：路径安全校验
    const pathCheck = validatePath(project.path, filePath)
    if (!pathCheck.valid) {
      return { success: false, content: '', error: pathCheck.error }
    }

    const result = await ipc.invoke('fs:read-file', pathCheck.fullPath)
    if (!result.success) {
      return { success: false, content: '', error: result.error ?? '文件读取失败' }
    }

    return { success: true, content: result.content }
  },
})
