/**
 * useTranslation — React i18n 翻译 Hook
 *
 * 提供 t() 函数用于在组件中获取翻译文本。
 * 未来可从 GlobalConfig 读取用户选择的 locale 实现运行时切换。
 *
 * @example
 * const { t } = useTranslation()
 * return <button>{t('action.save')}</button>
 */
import { useCallback } from 'react'
import { t as translate, type TextKey, type SupportedLocale } from '../shared/locale'

export function useTranslation() {
  // 未来可从 store/context 读取当前 locale
  const locale: SupportedLocale = 'zh-CN'

  const t = useCallback((key: TextKey) => translate(key, locale), [locale])

  return { t, locale }
}
