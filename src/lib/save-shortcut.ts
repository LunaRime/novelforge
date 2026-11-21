import type { KeyboardEvent } from 'react'
import { useTranslation } from '../hooks/useTranslation'
import { formatBinding, matchesBinding, shortcutBinding, useShortcutStore } from '../stores/shortcut-store'

/** 保存键随焦点所在的编辑区走，嵌套弹窗由自己的保存入口处理。 */
export function handleSaveShortcut(event: KeyboardEvent<HTMLElement>, save: () => unknown, enabled = true) {
  if (event.defaultPrevented || event.nativeEvent.isComposing || !matchesBinding(event.nativeEvent, shortcutBinding('save'))) return
  if (!(event.target instanceof Element) || !event.currentTarget.contains(event.target) ||
    event.target.closest('[role="dialog"]') !== event.currentTarget.closest('[role="dialog"]')) return
  event.preventDefault()
  event.stopPropagation()
  if (enabled && !event.repeat) void save()
}

/** 悬停提示与实际按键绑定一起更新，适配平台和自定义键位。 */
export function useSaveShortcutTitle() {
  const { t } = useTranslation()
  const key = useShortcutStore(state => formatBinding(shortcutBinding('save', state.bindings)))
  return t('tip.saveShortcut').replace('{shortcut}', () => key)
}
