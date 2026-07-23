/**
 * 国际化可扩展层 — Locale 配置与格式化工具
 *
 * 支持 zh-CN / en-US / ru-RU 三语动态切换。
 * 语言偏好保存在 localStorage 中，运行时通过 setCurrentLocale() 切换。
 *
 * UI 翻译字典见 locale-data.ts — 通过 UI_TEXTS 对象统一导出。
 */

import { UI_TEXTS_DATA } from './locale-data'

// ===== locale 持久化 =====

const LOCALE_STORAGE_KEY = 'novelforge-locale'

function loadLocalePref(): string | null {
  try { return localStorage.getItem(LOCALE_STORAGE_KEY) }
  catch { return null }
}

function saveLocalePref(locale: string): void {
  try { localStorage.setItem(LOCALE_STORAGE_KEY, locale) }
  catch { /* localStorage 不可用时静默忽略 */ }
}

// ===== 语言配置 =====

/** 备选 locale 列表（UI 可切换的目标语言） */
export const SUPPORTED_LOCALES = ['zh-CN', 'en-US', 'ru-RU'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

/** locale 友好标签（用于语言选择下拉） */
export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  'zh-CN': '中文',
  'en-US': 'English',
  'ru-RU': 'Русский',
}

/** 默认 locale（注意：已废弃，请用 getCurrentLocale()） */
export const DEFAULT_LOCALE: SupportedLocale = 'zh-CN'

let currentLocale: SupportedLocale = (loadLocalePref() as SupportedLocale) || DEFAULT_LOCALE

/** 获取当前运行时 locale */
export function getCurrentLocale(): SupportedLocale {
  return currentLocale
}

/** 切换 locale 并持久化 */
export function setCurrentLocale(locale: SupportedLocale): void {
  if (SUPPORTED_LOCALES.includes(locale)) {
    currentLocale = locale
    saveLocalePref(locale)
  }
}

// ===== 格式化工具 =====

/** 日期格式化（仅日期，无时间） */
export function formatLocaleDate(
  timestamp: number | string | Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  return date.toLocaleDateString(currentLocale, options)
}

/** 时间格式化（仅时间） */
export function formatLocaleTime(
  timestamp: number | string | Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  return date.toLocaleTimeString(currentLocale, options)
}

/** 日期+时间格式化 */
export function formatLocaleDateTime(
  timestamp: number | string | Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  return date.toLocaleString(currentLocale, options)
}

/** 中文友好的字符串比较（用于文件/目录排序） */
export function compareLocaleStrings(
  a: string,
  b: string,
  options?: { numeric?: boolean },
): number {
  return a.localeCompare(b, currentLocale, options)
}

// ===== UI 翻译字典 =====

/** 翻译记录类型 — 每个键必须覆盖所有 SupportedLocale */
type Texts = Record<string, Record<SupportedLocale, string>>

/** 通用 UI 文案字典 */
export const UI_TEXTS: Texts = UI_TEXTS_DATA as Texts

export type TextKey = keyof typeof UI_TEXTS_DATA

/** 获取当前 locale 下的翻译文本 */
export function t(key: TextKey): string {
  const entry = (UI_TEXTS as Record<string, Record<SupportedLocale, string>>)[key]
  if (!entry) return key
  return entry[currentLocale] ?? entry['zh-CN']
}
