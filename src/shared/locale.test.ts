import { describe, it, expect } from 'vitest'
import {
  t, UI_TEXTS,
  DEFAULT_LOCALE, SUPPORTED_LOCALES,
  formatLocaleDate, formatLocaleTime, formatLocaleDateTime,
  compareLocaleStrings,
} from './locale'

describe('i18n dictionary', () => {
  it('all keys have both zh-CN and en-US translations', () => {
    for (const [key, entry] of Object.entries(UI_TEXTS)) {
      expect(entry['zh-CN'], `missing zh-CN for "${key}"`).toBeTruthy()
      expect(entry['en-US'], `missing en-US for "${key}"`).toBeTruthy()
    }
  })

  it('t() returns zh-CN by default', () => {
    expect(t('action.save')).toBe('保存')
    expect(t('action.cancel')).toBe('取消')
    expect(t('panel.tasks')).toBe('任务')
  })

  it('t() falls back to zh-CN for unknown locale', () => {
    expect(t('action.save', 'en-US' as never)).toBe('Save')
  })

  it('t() returns key for non-existent key', () => {
    const result = t('nonexistent.key' as never)
    expect(result).toBe('nonexistent.key')
  })
})

describe('locale config', () => {
  it('has zh-CN as default', () => {
    expect(DEFAULT_LOCALE).toBe('zh-CN')
  })

  it('supports zh-CN and en-US', () => {
    expect(SUPPORTED_LOCALES).toContain('zh-CN')
    expect(SUPPORTED_LOCALES).toContain('en-US')
  })
})

describe('formatLocaleDate', () => {
  it('formats a timestamp to zh-CN date string', () => {
    const date = new Date(2026, 6, 18) // July 18, 2026
    const result = formatLocaleDate(date.getTime())
    expect(result).toContain('2026')
  })
})

describe('formatLocaleTime', () => {
  it('formats a timestamp to zh-CN time string', () => {
    const date = new Date(2026, 6, 18, 14, 30, 0)
    const result = formatLocaleTime(date.getTime())
    expect(result).toBeTruthy()
    expect(typeof result).toBe('string')
  })
})

describe('formatLocaleDateTime', () => {
  it('formats a timestamp to zh-CN date+time string', () => {
    const date = new Date(2026, 6, 18, 14, 30, 0)
    const result = formatLocaleDateTime(date.getTime())
    expect(result).toContain('2026')
  })
})

describe('compareLocaleStrings', () => {
  it('sorts Chinese numeric strings correctly', () => {
    const result = ['第10章', '第2章', '第1章'].sort((a, b) =>
      compareLocaleStrings(a, b, { numeric: true })
    )
    expect(result).toEqual(['第1章', '第2章', '第10章'])
  })
})
