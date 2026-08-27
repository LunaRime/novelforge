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

/** 读去重状态（模块级，会话无关）；agent-store 会话切换/新建/清空时调用 clearReadState 清理 */
const readState = new Map<string, { content: string }>()

/** 清空读去重状态：无参全清（会话切换/清空）；带 pathKey 单键清除（write_file 成功后失效，P0-2） */
export function clearReadState(pathKey?: string): void {
  if (pathKey) readState.delete(pathKey)
  else readState.clear()
}

/** 桩消息：文件未变化，不重发全文（省重复注入的 token）——文本走 i18n（tool.fileUnchangedStub） */
const FILE_UNCHANGED_STUB = (path: string, len: number): string =>
  t('tool.fileUnchangedStub').replace('{path}', path).replace('{len}', String(len))

export const readFileTool = buildAgentTool({
  name: 'read_file',
  description: t('tool.readFileDesc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: t('tool.readFilePath'),
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
      // 读去重：同路径已全量读过且内容未变化 → 桩（省重复注入）。
      // ⚠️ 仅「无 offset/limit 的全量读」短路（P0-1 修订）：分页/区间读必须真实读文件——
      //    桩不含文件内容，若分页读也被短路，LLM 带 offset 重读永远拿不到数据；
      //    而 read_file 是只读工具、LLM 无任何途径"先保存后重试"→ 死循环。
      //    豁免条件 = !args.offset && !args.limit（H3 的 offset/limit 解析必须先于此处执行）
      const state = readState.get(filePath)
      if (state && !args.offset && !args.limit) {
        return { success: true, content: FILE_UNCHANGED_STUB(filePath, state.content.length) }
      }
      const res = await ipc.invoke('fs:read-external-file', filePath)
      if (!res.success) {
        return { success: false, content: '', error: res.error ?? t('tool.readFileExternalFailed') }
      }
      // 读去重：记录状态；重复读同一路径返回桩（不重发全文）
      readState.set(filePath, { content: String(res.content ?? '') })
      return { success: true, content: String(res.content ?? '') }
    }

    // 项目内文件：路径安全校验
    const pathCheck = validatePath(project.path, filePath)
    if (!pathCheck.valid) {
      return { success: false, content: '', error: pathCheck.error }
    }

    // 读去重：同路径已全量读过且内容未变化 → 桩（省重复注入）。
    // ⚠️ 仅「无 offset/limit 的全量读」短路（P0-1 修订）——豁免条件同外部分支
    const state = readState.get(pathCheck.fullPath)
    if (state && !args.offset && !args.limit) {
      return { success: true, content: FILE_UNCHANGED_STUB(pathCheck.fullPath, state.content.length) }
    }

    const result = await ipc.invoke('fs:read-file', pathCheck.fullPath)
    if (!result.success) {
      return { success: false, content: '', error: result.error ?? t('tool.readFileFailed') }
    }

    // 读去重：记录状态；重复读同一路径返回桩（不重发全文）
    readState.set(pathCheck.fullPath, { content: String(result.content ?? '') })
    return { success: true, content: result.content }
  },
})
