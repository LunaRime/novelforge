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
import { useCallback, useSyncExternalStore } from 'react'
import { t as translate, type TextKey, getCurrentLocale, setCurrentLocale, type SupportedLocale } from '../shared/locale'

// 简易 locale 变更通知机制 — 组件订阅后 locale 切换时自动重渲染
let localeListeners: Array<() => void> = []
function subscribeToLocale(cb: () => void) {
  localeListeners.push(cb)
  return () => { localeListeners = localeListeners.filter(l => l !== cb) }
}
function notifyLocaleChange() { localeListeners.forEach(l => l()) }

/** 供语言选择 UI 调用的切换函数，会触发全界面重渲染，并同步主进程（对话框/菜单） */
export function switchLocale(locale: SupportedLocale) {
  setCurrentLocale(locale)
  // 窗口标题**不在这里写** —— 这里的 t('window.title') 会把项目名冲掉（标题有两层信息）。
  // 标题的唯一写入口是 App 的 effect（src/lib/window-title.ts），它的依赖里有 locale，
  // 因此本函数触发的重渲染自然会让标题跟着语言走。
  notifyLocaleChange()
  // 主进程对话框/菜单的 t() 跟随 UI 语言（非 Electron 环境静默忽略）
  import('../services/ipc-client').then(({ ipc }) => {
    if (ipc.isElectron) ipc.invoke('config:set-locale', locale).catch(() => {})
  }).catch(() => {})
}

export function useTranslation() {
  const locale = useSyncExternalStore(
    subscribeToLocale,
    getCurrentLocale,
    getCurrentLocale,
  )

  const t = useCallback((key: TextKey) => translate(key), [])

  return { t, locale }
}
