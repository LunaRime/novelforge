/**
 * read_file — 读取文件内容
 * - 相对路径：项目内文件（validatePath 防越界）
 * - 绝对路径：项目外文件（用户通过"添加外部文件"显式选择，校验可读扩展名 + 长度防御）
 *
 * C1（CC §三.9 剩余）：带 offset/limit 的读取不再「全量读回渲染层再切片」——
 * 窗口参数随 IPC 下发主进程，主进程 ≤ 上限整读切片 / > 上限流式扫描（窗口外仅计数，
 * 读 100GB 文件首行不爆 RSS），返回窗口内容 + totalChars/beyond 元数据，此处仅组提示。
 * 无 offset/limit 的全量读路径保持原样（行为兼容：读去重桩 / applyReadWindow 截断提示）。
 */
import { t } from '../../../shared/locale'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import { validatePath } from './safe-path'
import type { ReadFileRangeOptions } from '../../../shared/ipc-channels'

/** 绝对路径判定（Windows 盘符 / UNC，与 intent-router 一致） */
function isAbsolutePath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\')
}

/**
 * 读去重状态（模块级，会话无关）；agent-store 会话切换/新建/清空时调用 clearReadState 清理。
 * 只存 length：桩判定（file_unchanged）不比较内容，length 即全部所需——省一份文件内容引用
 */
const readState = new Map<string, { length: number }>()

/** 清空读去重状态：无参全清（会话切换/清空）；带 pathKey 单键清除（write_file 成功后失效，P0-2） */
export function clearReadState(pathKey?: string): void {
  if (pathKey) readState.delete(pathKey)
  else readState.clear()
}

/** 桩消息：文件未变化，不重发全文（省重复注入的 token）——文本走 i18n（tool.fileUnchangedStub） */
const FILE_UNCHANGED_STUB = (path: string, len: number): string =>
  t('tool.fileUnchangedStub').replace('{path}', path).replace('{len}', String(len))

/**
 * 单次注入上限（字符量口径，按引擎截断线校准，见 read-file.tool.test.ts「中文峰值 ≤ TOOL_RESULT_MAX_TOKENS」锁定用例）：
 * - 中文 1 字符 ≈ 1.5 token（estimateTokensHeuristic CJK ×1.5，保守上界）→ 440 全中文 ≈ 660 tokens
 * - 引擎侧 truncateResult(result.content, TOOL_RESULT_MAX_TOKENS=800) 二次兜底（agent-engine.ts），
 *   截断提示置于 content 开头（truncateResult 从头保留）→ 提示不会被二次截断吞掉
 * - 440 字符 + 截断提示 ≈ 725 tokens < 800——保证对中文（产品主语言）工具层输出先于引擎截断生效
 */
export const READ_MAX_CHARS = 440

/**
 * 应用读取窗口（全量读路径用）：只返回 [offset, offset+limit) 区间的字符（超出部分截断），
 * 截断/越界提示作为前缀置于 content 开头——引擎 truncateResult 从头保留，防提示被二次截断吞掉。
 * 未超 limit 且 offset 在文件内时原样返回（行为兼容：正常小文件路径不变）
 */
function applyReadWindow(fullText: string, offset: number, limit: number): string {
  const full = String(fullText ?? '')
  const truncated = full.length > limit ? full.slice(offset, offset + limit) : full.slice(offset)
  // {end} = offset+limit（本次窗口真正读到的结束位置；旧文案 {offset} 实收 offset+limit，语义失真）
  const notice = full.length > offset + limit
    ? `${t('tool.readFileTruncated').replace('{total}', String(full.length)).replace('{end}', String(offset + limit))}\n\n`
    : offset >= full.length
      ? `${t('tool.readFileOffsetBeyond')}\n\n`
      : ''
  return notice + truncated
}

/**
 * 组合窗口读结果（C1）：主进程已按 [offset, offset+limit) 切片返回，此处据元数据补截断/越界提示。
 * - beyond：主进程证明 offset 越界 → 越界提示（无内容）；
 * - totalChars 可知（窗口扫到文件尾 / ≤ 上限快路径）：total 越界 → 越界提示；total > 窗口尾 → 截断提示；
 * - totalChars 未知（超大文件窗口早停，主进程未扫到文件尾）：超大文件窗口提示（无精确 total，建议 offset=end 续读）
 */
function composeWindowedRead(
  windowText: string,
  meta: { totalChars?: number; beyond?: boolean },
  offset: number,
  limit: number,
): string {
  const end = offset + limit
  if (meta.beyond) return `${t('tool.readFileOffsetBeyond')}\n\n`
  if (meta.totalChars !== undefined) {
    if (offset >= meta.totalChars) return `${t('tool.readFileOffsetBeyond')}\n\n`
    if (meta.totalChars > end) {
      return `${t('tool.readFileTruncated').replace('{total}', String(meta.totalChars)).replace('{end}', String(end))}\n\n${windowText}`
    }
    return windowText
  }
  // 超大文件（> 单次全量上限）：{end} 出现两次（区间 + offset 续读建议），全局替换
  return `${t('tool.readFileHugeWindow').replace('{start}', String(offset)).replaceAll('{end}', String(end))}\n\n${windowText}`
}

/** 解析 offset/limit（LLM 传参清洗），并判断是否为窗口读（raw 参数存在性——与去重豁免条件一致） */
function parseReadRange(args: Record<string, unknown>): {
  windowed: boolean
  offset: number
  limit: number
  rangeOptions: ReadFileRangeOptions | undefined
} {
  // 病态参数防御：limit<1（0/0.5/负数）视为未指定 → 默认上限（旧 Math.floor(0.5)=0 → 空串+误报截断提示）；
  // offset<0 视为 0（旧实现负值过 args truthy 检查却解析为 0，静默跳过读去重）
  const offset = typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0
  const limit = typeof args.limit === 'number' && args.limit >= 1 ? Math.floor(args.limit) : READ_MAX_CHARS
  // 窗口读判定：与读去重豁免同一 raw truthiness（null/0/undefined 视为未指定）
  const windowed = !(!args.offset && !args.limit)
  return {
    windowed,
    offset,
    limit,
    rangeOptions: windowed ? { offset, limit } : undefined,
  }
}

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
      offset: {
        type: 'number',
        description: t('tool.readFileOffset'),
      },
      limit: {
        type: 'number',
        description: t('tool.readFileLimit'),
      },
    },
    required: ['file_path'],
  },
  requiresConfirmation: false,
  execute: async (args) => {
    const filePath = args.file_path as string
    // offset/limit 解析必须先于去重短路判断（P0-1 契约：短路豁免条件 = !args.offset && !args.limit）
    const { windowed, offset, limit, rangeOptions } = parseReadRange(args)
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
      if (!windowed) {
        const state = readState.get(filePath)
        if (state) {
          return { success: true, content: FILE_UNCHANGED_STUB(filePath, state.length) }
        }
      }
      // C1：窗口读把 offset/limit 下发主进程（超大文件主进程流式扫描，不再全量回传）
      const res = rangeOptions
        ? await ipc.invoke('fs:read-external-file', filePath, rangeOptions)
        : await ipc.invoke('fs:read-external-file', filePath)
      if (!res.success) {
        return { success: false, content: '', error: res.error ?? t('tool.readFileExternalFailed') }
      }
      if (!windowed) {
        // 读去重：仅「无 offset/limit 的全量读」记录状态（P0-1 修订：分页读不覆盖「全量已读」语义）——
        // 否则分页读把 Map 覆盖为部分内容，后续全量读命中桩时桩长度=分页长度，LLM 拿不到全文
        readState.set(filePath, { length: String(res.content ?? '').length })
        return { success: true, content: applyReadWindow(String(res.content ?? ''), offset, limit) }
      }
      return { success: true, content: composeWindowedRead(String(res.content ?? ''), res, offset, limit) }
    }

    // 项目内文件：路径安全校验
    const pathCheck = validatePath(project.path, filePath)
    if (!pathCheck.valid) {
      return { success: false, content: '', error: pathCheck.error }
    }

    // 读去重：同路径已全量读过且内容未变化 → 桩（省重复注入）。
    // ⚠️ 仅「无 offset/limit 的全量读」短路（P0-1 修订）——豁免条件同外部分支
    if (!windowed) {
      const state = readState.get(pathCheck.fullPath)
      if (state) {
        return { success: true, content: FILE_UNCHANGED_STUB(pathCheck.fullPath, state.length) }
      }
    }

    const result = rangeOptions
      ? await ipc.invoke('fs:read-file', pathCheck.fullPath, rangeOptions)
      : await ipc.invoke('fs:read-file', pathCheck.fullPath)
    if (!result.success) {
      return { success: false, content: '', error: result.error ?? t('tool.readFileFailed') }
    }

    if (!windowed) {
      // 读去重：仅「无 offset/limit 的全量读」记录状态（P0-1 修订：分页读不覆盖「全量已读」语义）——
      // 否则分页读把 Map 覆盖为部分内容，后续全量读命中桩时桩长度=分页长度，LLM 拿不到全文
      readState.set(pathCheck.fullPath, { length: String(result.content ?? '').length })
      return { success: true, content: applyReadWindow(String(result.content ?? ''), offset, limit) }
    }
    return { success: true, content: composeWindowedRead(String(result.content ?? ''), result, offset, limit) }
  },
})
