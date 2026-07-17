/**
 * 国际化可扩展层 — Locale 配置与格式化工具
 *
 * 当前默认使用 zh-CN（中文网文市场），未来可通过全局配置切换。
 * 所有日期/时间/数字/字符串比较的格式化都应通过此模块，而非硬编码 locale。
 *
 * 扩展方式：
 *   1. 修改 DEFAULT_LOCALE 或从 GlobalConfig.themeLocale 读取
 *   2. 新增翻译文案 → 使用 i18n 框架（react-i18next / 自建）
 *   3. 日期格式偏好 → 为每个 locale 预设 DateTimeFormat 默认值
 */

/** 当前默认 locale，未来可从用户配置读取 */
export const DEFAULT_LOCALE = 'zh-CN'

/** 备选 locale 列表（UI 可切换的目标语言） */
export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

// ===== 格式化工具 =====

/** 日期格式化（仅日期，无时间） */
export function formatLocaleDate(
  timestamp: number | string | Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  return date.toLocaleDateString(DEFAULT_LOCALE, options)
}

/** 时间格式化（仅时间） */
export function formatLocaleTime(
  timestamp: number | string | Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  return date.toLocaleTimeString(DEFAULT_LOCALE, options)
}

/** 日期+时间格式化 */
export function formatLocaleDateTime(
  timestamp: number | string | Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  return date.toLocaleString(DEFAULT_LOCALE, options)
}

/** 中文友好的字符串比较（用于文件/目录排序） */
export function compareLocaleStrings(
  a: string,
  b: string,
  options?: { numeric?: boolean },
): number {
  return a.localeCompare(b, DEFAULT_LOCALE, options)
}
