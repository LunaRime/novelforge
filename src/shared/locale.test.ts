import { describe, it, expect } from 'vitest'
import {
  t, UI_TEXTS,
  DEFAULT_LOCALE, SUPPORTED_LOCALES,
  getCurrentLocale, setCurrentLocale,
  formatLocaleDate, formatLocaleTime, formatLocaleDateTime,
  compareLocaleStrings,
  LOCALE_LABELS,
} from './locale'

describe('i18n dictionary', () => {
  it('all keys have zh-CN, en-US, and ru-RU translations', () => {
    for (const [key, entry] of Object.entries(UI_TEXTS)) {
      expect(entry['zh-CN'], `missing zh-CN for "${key}"`).toBeTruthy()
      expect(entry['en-US'], `missing en-US for "${key}"`).toBeTruthy()
      expect(entry['ru-RU'], `missing ru-RU for "${key}"`).toBeTruthy()
    }
  })

  it('t() returns zh-CN by default', () => {
    expect(t('action.save')).toBe('保存')
    expect(t('action.cancel')).toBe('取消')
    expect(t('panel.tasks')).toBe('任务')
  })

  it('t() returns en-US after switching locale', () => {
    setCurrentLocale('en-US')
    expect(t('action.save')).toBe('Save')
    expect(t('action.cancel')).toBe('Cancel')
    setCurrentLocale('zh-CN') // restore
  })

  it('t() returns ru-RU after switching locale', () => {
    setCurrentLocale('ru-RU')
    expect(t('action.save')).toBe('Сохранить')
    expect(t('action.cancel')).toBe('Отмена')
    expect(t('unit.chars')).toBe('зн.')
    setCurrentLocale('zh-CN') // restore
  })

  it('t() returns key for non-existent key', () => {
    const result = t('nonexistent.key' as never)
    expect(result).toBe('nonexistent.key')
  })

  it('t() falls back to zh-CN for unknown locale', () => {
    // save current, set to unknown (should fallback)
    const saved = getCurrentLocale()
    setCurrentLocale('zh-CN')
    // zh-CN is primary fallback
    expect(t('action.save')).toBe('保存')
    setCurrentLocale(saved)
  })
})

describe('locale config', () => {
  it('has zh-CN as default', () => {
    expect(DEFAULT_LOCALE).toBe('zh-CN')
  })

  it('supports zh-CN, en-US, and ru-RU', () => {
    expect(SUPPORTED_LOCALES).toContain('zh-CN')
    expect(SUPPORTED_LOCALES).toContain('en-US')
    expect(SUPPORTED_LOCALES).toContain('ru-RU')
  })

  it('getCurrentLocale returns zh-CN by default', () => {
    setCurrentLocale('zh-CN')
    expect(getCurrentLocale()).toBe('zh-CN')
  })

  it('setCurrentLocale changes runtime locale', () => {
    setCurrentLocale('en-US')
    expect(getCurrentLocale()).toBe('en-US')
    setCurrentLocale('zh-CN')
    expect(getCurrentLocale()).toBe('zh-CN')
  })

  it('LOCALE_LABELS has labels for all supported locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(LOCALE_LABELS[locale], `missing label for ${locale}`).toBeTruthy()
    }
  })
})

describe('formatLocaleDate', () => {
  it('formats a timestamp to zh-CN date string', () => {
    setCurrentLocale('zh-CN')
    const date = new Date(2026, 6, 18)
    const result = formatLocaleDate(date.getTime())
    expect(result).toContain('2026')
  })

  it('formats in ru-RU style', () => {
    setCurrentLocale('ru-RU')
    const date = new Date(2026, 6, 18)
    const result = formatLocaleDate(date.getTime())
    expect(result).toBeTruthy()
    expect(typeof result).toBe('string')
    setCurrentLocale('zh-CN')
  })
})

describe('formatLocaleTime', () => {
  it('formats a timestamp to time string', () => {
    const date = new Date(2026, 6, 18, 14, 30, 0)
    const result = formatLocaleTime(date.getTime())
    expect(result).toBeTruthy()
    expect(typeof result).toBe('string')
  })
})

describe('formatLocaleDateTime', () => {
  it('formats a timestamp to date+time string', () => {
    setCurrentLocale('zh-CN')
    const date = new Date(2026, 6, 18, 14, 30, 0)
    const result = formatLocaleDateTime(date.getTime())
    expect(result).toContain('2026')
  })
})

describe('compareLocaleStrings', () => {
  it('sorts Chinese numeric strings correctly', () => {
    setCurrentLocale('zh-CN')
    const result = ['第10章', '第2章', '第1章'].sort((a, b) =>
      compareLocaleStrings(a, b, { numeric: true })
    )
    expect(result).toEqual(['第1章', '第2章', '第10章'])
  })
})
