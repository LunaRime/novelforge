import { t } from '../../../shared/locale'
/**
 * 路径安全校验工具
 *
 * 防止路径遍历攻击（../../ 等），确保所有文件操作都在项目根目录内。
 * 数据目录保护（isProtectedRelativePath）与 validatePath 共用同一解析链——
 * 判定对象必须是「规范化后的相对路径」，否则 './.novelforge/x'、'x/../.novelforge/x' 等
 * 常见混淆形态可绕过前缀判定（I-1 修复，见 write-file/edit-file 调用点）。
 */

/**
 * 解析「项目根相对」的规范化相对路径（POSIX '/' 分隔；去除空段与 './'、解析 '..'）。
 * 与 safePath 完全同一条解析链，供数据目录保护判定与落盘路径共用。
 * @returns 越界（.. 溢出）返回 null
 */
export function resolveSafeRelativePath(relativePath: string): string | null {
  // 规范化路径分隔符
  const normalized = relativePath.replace(/\\/g, '/')

  // 拆分路径段并手动 resolve（不依赖 Node path 模块，因为运行在渲染进程）
  const segments = normalized.split('/')
  const resolvedSegments: string[] = []

  for (const seg of segments) {
    if (seg === '' || seg === '.') {
      continue
    }
    if (seg === '..') {
      if (resolvedSegments.length === 0) {
        // 已经越界
        return null
      }
      resolvedSegments.pop()
    } else {
      resolvedSegments.push(seg)
    }
  }

  return resolvedSegments.join('/')
}

/** 解析结果：规范化相对路径 + 由项目根拼接的绝对路径 */
function computeSafePath(projectRoot: string, relativePath: string): { relativePath: string; fullPath: string } | null {
  const resolvedRelative = resolveSafeRelativePath(relativePath)
  if (resolvedRelative === null) return null

  const fullPath = `${projectRoot}/${resolvedRelative}`
  // 最终检查：确保完整路径以项目根目录开头
  if (!fullPath.startsWith(projectRoot)) {
    return null
  }

  return { relativePath: resolvedRelative, fullPath }
}

/**
 * 校验并 resolve 相对路径，确保不会越出项目根目录
 *
 * @param projectRoot 项目根目录（绝对路径）
 * @param relativePath 用户/LLM 提供的相对路径
 * @returns 安全的绝对路径，如果越界则返回 null
 */
export function safePath(projectRoot: string, relativePath: string): string | null {
  return computeSafePath(projectRoot, relativePath)?.fullPath ?? null
}

/** 项目内部数据目录（首段判定白名单；见 tool.writeProtectedPath 文案） */
export const PROJECT_DATA_DIR_SEGMENTS = ['.novelforge', '.vela', '.git', 'node_modules'] as const

/**
 * 数据目录保护：规范化相对路径的首段 ∈ {.novelforge, .vela, .git, node_modules} → true。
 *
 * ⚠️ 入参必须是 resolveSafeRelativePath / validatePath 产出的**规范化相对路径**——
 *    对原始 LLM 串做前缀判定可被 './'、'x/../' 等形态绕过（I-1）。
 *    首段精确匹配（非前缀子串）：'.novelforge-backup/x' 等相似名不误伤。
 */
export function isProtectedRelativePath(canonicalRelative: string): boolean {
  const first = canonicalRelative.split('/')[0]
  return (PROJECT_DATA_DIR_SEGMENTS as readonly string[]).includes(first)
}

/**
 * 校验路径安全性的便捷包装
 * 如果不安全，直接返回 ToolResult 错误
 *
 * valid 分支附带 relativePath（规范化相对路径）——写工具用 isProtectedRelativePath 判定数据目录，
 * 与落盘 fullPath 出自同一解析链，杜绝「校验通过但保护判定看的是未归一化串」的缝隙。
 */
export function validatePath(
  projectRoot: string,
  relativePath: string,
): { valid: true; fullPath: string; relativePath: string } | { valid: false; error: string } {
  if (!relativePath) {
    return { valid: false, error: t('error.missingFilePath') }
  }

  const result = computeSafePath(projectRoot, relativePath)
  if (result === null) {
    // i18n（此前硬编码中文，切 en/ru 后 LLM 收到中文错误而工具描述是英文，诊断一致性受损）
    return { valid: false, error: t('error.pathEscape').replace('{path}', relativePath) }
  }

  return { valid: true, fullPath: result.fullPath, relativePath: result.relativePath }
}
