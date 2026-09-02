/**
 * write_file — 写入或修改项目文件
 */
import { t } from '../../../shared/locale'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import { isProtectedRelativePath, validatePath } from './safe-path'
import { clearReadState } from './read-file.tool'

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

    // ⚠️ 数据文件保护：拒绝写入项目内部数据目录（.novelforge/.vela 含 SQLite 库/向量库/白名单、
    // .git/、node_modules）——一次误写即可用文本覆盖二进制 DB，损坏整个项目（P0 修复）。
    // 判定对象 = validatePath 产出的**规范化相对路径**（首段 ∈ 数据目录）——原始 LLM 串的
    // './.novelforge/x'、'x/../.novelforge/x' 等混淆形态经 resolveSafeRelativePath 归一化后必命中（I-1）
    if (isProtectedRelativePath(pathCheck.relativePath)) {
      return { success: false, content: '', error: t('tool.writeProtectedPath') }
    }

    const result = await ipc.invoke('fs:write-file', pathCheck.fullPath, content)
    if (!result.success) {
      return { success: false, content: '', error: result.error ?? t('tool.writeFileFailed') }
    }

    // ⚠️ 写盘成功后失效读去重缓存（P0-2）：LLM「写盘 → 重读验证」是 ReAct 常见模式，
    //    不清除则重读仍命中桩，LLM 无法确认写入结果
    clearReadState(pathCheck.fullPath)  // key 与 read_file 项目内分支的 pathKey（validatePath.fullPath）一致

    return {
      success: true,
      content: t('tool.fileWritten').replace('{path}', filePath).replace('{length}', String(content.length)),
      artifacts: [{ type: 'file_modified', path: pathCheck.fullPath, name: filePath }],
    }
  },
})
