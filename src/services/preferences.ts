/**
 * preferences — 偏好记忆（渲染层服务）
 *
 * 检测"用户把 AI 文本的 X 改成 Y"：AI 预览接受后用户手动修改，
 * 通过前后缀匹配提取替换对，记录到 preferences 表；写稿前检索注入。
 */
import { ipc } from './ipc-client'
import type { PreferenceData } from '../../electron/repositories/preference-repository'

/** 记录一个替换对（防抖由调用方控制） */
export async function recordPreference(aiText: string, userText: string): Promise<void> {
  try {
    await ipc.invoke('db:preference-record', aiText, userText)
  } catch { /* 记录失败不阻塞编辑 */ }
}

/** 获取 Top 偏好（供写稿注入） */
export async function getTopPreferences(limit = 5): Promise<PreferenceData[]> {
  try {
    return await ipc.invoke('db:preference-get-top', limit)
  } catch {
    return []
  }
}

/**
 * 从 AI 原文与用户改后文本中提取替换对。
 * 算法：前缀/后缀匹配 → 中间差异段；差异段必须为 2-12 字纯中文
 * （排除结构性增删/整段重写——那不算词汇偏好，误记会污染注入）。
 */
export function extractPreferencePair(
  aiText: string,
  userText: string,
): { ai: string; user: string } | null {
  if (!aiText || !userText || aiText === userText) return null

  // 前缀匹配
  const maxLen = Math.min(aiText.length, userText.length)
  let prefix = 0
  while (prefix < maxLen && aiText[prefix] === userText[prefix]) prefix++
  // 后缀匹配（从前缀之后开始，避免重复计算）
  let suffix = 0
  while (
    suffix < maxLen - prefix &&
    aiText[aiText.length - 1 - suffix] === userText[userText.length - 1 - suffix]
  ) {
    suffix++
  }

  const aiDiff = aiText.slice(prefix, aiText.length - suffix)
  const userDiff = userText.slice(prefix, userText.length - suffix)

  if (!isValidDiff(aiDiff) || !isValidDiff(userDiff)) return null
  return { ai: aiDiff, user: userDiff }
}

/** 差异段有效判定：2-12 字纯中文（无标点/空白/字母） */
function isValidDiff(diff: string): boolean {
  const len = diff.length
  if (len < 2 || len > 12) return false
  return /^[一-龥]+$/.test(diff)
}
