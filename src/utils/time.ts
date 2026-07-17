import { DEFAULT_LOCALE, formatLocaleDate, formatLocaleDateTime } from '../shared/locale'

/**
 * 格式化相对时间（如：刚刚 / 5分钟前 / 2小时前 / 3天前）
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 7) return `${days}天前`
  return formatLocaleDate(timestamp, { month: 'short', day: 'numeric' })
}

/**
 * 格式化日期为本地化字符串
 * @deprecated 新代码请使用 formatLocaleDateTime() from src/shared/locale.ts
 */
export function formatDate(timestamp: number, options?: Intl.DateTimeFormatOptions): string {
  return formatLocaleDateTime(timestamp, options ?? {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export { DEFAULT_LOCALE }
