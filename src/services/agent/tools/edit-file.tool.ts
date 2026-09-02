/**
 * edit_file — 局部编辑项目文件（CC FileEditTool 对齐，Task C2 / CC §三.3）
 *
 * 落地形态（用户 2026-08-29 裁决）：新增局部编辑工具承载 old_string→new_string 局部替换，
 * 不改造现有 write_file（整文件覆盖写，行为兼容零改动）。
 *
 * 语义：读全文（既有 fs:read-file 通道，≤5MB 整读安全网内正常工作，超限由主进程拒绝并透传错误）
 * → 纯函数三层匹配降级链定位 old_string（exact → 反脱敏 → 模型侧空格松弛 → 引号归一化，回映文件真实子串）
 * → preserveQuoteStyle 按文件引号风格回填 new_string → 尾换行语义 → fs:write-file 整文件写回
 * → 失效读去重缓存（clearReadState，与 write_file P0-2 同语义）。无新 IPC 通道。
 */
import { t } from '../../../shared/locale'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import { isProtectedRelativePath, validatePath } from './safe-path'
import { clearReadState } from './read-file.tool'
import {
  adaptTextToQuoteStyle,
  applySpanEdit,
  desanitizeText,
  detectRegionAwareQuoteStyle,
  findEditMatch,
} from './edit-file-utils'

export const editFileTool = buildAgentTool({
  name: 'edit_file',
  description: t('tool.editFileDesc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: t('tool.editFilePath'),
      },
      old_string: {
        type: 'string',
        description: t('tool.editFileOldString'),
      },
      new_string: {
        type: 'string',
        description: t('tool.editFileNewString'),
      },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  requiresConfirmation: true,
  isReadOnly: false,
  execute: async (args) => {
    // 类型归一化铁律：inputSchema 的 string 只是声明，LLM 可能传任意类型
    const filePath = typeof args.file_path === 'string' ? args.file_path : ''
    const oldString = typeof args.old_string === 'string' ? args.old_string : undefined
    const newString = typeof args.new_string === 'string' ? args.new_string : undefined

    if (!filePath) {
      return { success: false, content: '', error: t('error.missingFilePath') }
    }
    if (oldString === undefined) {
      return { success: false, content: '', error: t('tool.editMissingOldString') }
    }
    if (newString === undefined) {
      return { success: false, content: '', error: t('tool.editMissingNewString') }
    }
    if (oldString === '') {
      return { success: false, content: '', error: t('tool.editEmptyOldString') }
    }

    const project = useProjectStore.getState().currentProject
    if (!project) {
      return { success: false, content: '', error: t('error.noProject') }
    }

    // 路径安全校验（与 write_file 同源：validatePath 返回规范化相对路径 → 数据目录保护首段判定，
    // './.novelforge/x'、'x/../.novelforge/x' 等混淆形态经归一化后必命中——I-1 修复）
    const pathCheck = validatePath(project.path, filePath)
    if (!pathCheck.valid) {
      return { success: false, content: '', error: pathCheck.error }
    }
    if (isProtectedRelativePath(pathCheck.relativePath)) {
      return { success: false, content: '', error: t('tool.writeProtectedPath') }
    }

    // 读全文（既有沙箱通道；> 单次全量上限 5MB 的整读由主进程拒绝 → 错误透传，
    // edit_file 只在可整读大小内工作——正常小说/设定文件不受影响）
    const readRes = await ipc.invoke('fs:read-file', pathCheck.fullPath)
    if (!readRes.success) {
      return { success: false, content: '', error: readRes.error ?? t('tool.readFileFailed') }
    }
    const currentText = String(readRes.content ?? '')

    // 匹配降级链（纯函数；命中区永远指向文件真实子串）
    const match = findEditMatch(currentText, oldString)
    if (!match) {
      return { success: false, content: '', error: t('tool.editNotFound') }
    }

    // preserveQuoteStyle（区域感知，评审 Finding 2）：new_string 先反脱敏（空表=恒等，扩展点），
    // 再按**命中区真实文本**的引号风格回填（命中区无该族证据才回退全文件多数决）——直引号
    // JSON/代码块等少数风格区不被弯引号主文件强制转弯（old==new 逐字请求保持 no-op）
    const rawNew = desanitizeText(newString)
    const styles = detectRegionAwareQuoteStyle(match.matchedText, currentText)
    const adaptedNew = adaptTextToQuoteStyle(rawNew, styles)

    // 应用替换（尾换行语义由纯函数承载）；命中区外其余内容一字不动
    const edit = applySpanEdit(currentText, match.start, match.end, oldString, adaptedNew)

    // 无实质变更（old==new / 回填后与文件已一致）→ 不写盘，避免无意义确认消耗与 mtime 抖动
    if (edit.content === currentText) {
      return {
        success: true,
        content: t('tool.editNoChange').replace('{path}', filePath),
      }
    }

    const writeRes = await ipc.invoke('fs:write-file', pathCheck.fullPath, edit.content)
    if (!writeRes.success) {
      return { success: false, content: '', error: writeRes.error ?? t('tool.writeFileFailed') }
    }

    // ⚠️ 写盘成功后失效读去重缓存（P0-2 同 write_file）：LLM「编辑 → 重读验证」须拿到新内容
    clearReadState(pathCheck.fullPath)

    // 结果反馈：文件级摘要 + 命中层/多命中提示（保持短小——引擎侧 truncateResult(800) 兜底）
    const line = currentText.slice(0, match.start).split('\n').length
    let content = t('tool.fileEdited')
      .replace('{path}', filePath)
      .replace('{line}', String(line))
      .replace('{removed}', String(edit.removedChars))
      .replace('{added}', String(edit.addedChars))

    if (match.occurrenceTotal > 1) {
      content += '\n' + t('tool.editMatchMultiple').replace('{count}', String(match.occurrenceTotal))
    }
    if (match.layer === 'quotes') {
      content += '\n' + t('tool.editQuoteMatchNote')
    } else if (match.layer === 'whitespace') {
      content += '\n' + t('tool.editWhitespaceMatchNote')
    } else if (match.layer === 'desanitized') {
      // 反脱敏层命中：提示模型其 old_string 含脱敏形态（当前空表不会走到，条目登记后生效）
      content += '\n' + t('tool.editDesanitizedMatchNote')
    }

    return {
      success: true,
      content,
      artifacts: [{ type: 'file_modified', path: pathCheck.fullPath, name: filePath }],
    }
  },
})
