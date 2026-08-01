import { DEFAULT_LOCALE, t, formatLocaleDate, formatLocaleDateTime } from '../shared/locale'

/**
 * 格式化相对时间（模块级 t() 读取当前 locale，随语言切换即时生效）
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return t('time.justNow')
  if (minutes < 60) return t('time.minutesAgo').replace('{n}', String(minutes))
  if (hours < 24) return t('time.hoursAgo').replace('{n}', String(hours))
  if (days < 7) return t('time.daysAgo').replace('{n}', String(days))
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
