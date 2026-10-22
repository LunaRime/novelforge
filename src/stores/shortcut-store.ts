import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { TextKey } from '../shared/locale'

export type ShortcutCategory = 'general' | 'view' | 'editor'

export interface ShortcutDefinition {
  id: string
  category: ShortcutCategory
  labelKey: TextKey
  defaultBinding: string
}

export const SHORTCUT_CATEGORIES: Array<{ id: ShortcutCategory; labelKey: TextKey }> = [
  { id: 'general', labelKey: 'command.group.general' },
  { id: 'view', labelKey: 'command.group.view' },
  { id: 'editor', labelKey: 'command.group.editor' },
]

/** 应用级快捷键唯一注册表（设置页 / 命令面板 / 键盘处理共用）。 */
export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  { id: 'command-palette', category: 'general', labelKey: 'command.title', defaultBinding: 'Mod+K' },
  { id: 'shortcuts-help', category: 'general', labelKey: 'command.shortcuts', defaultBinding: '?' },
  { id: 'new-project', category: 'general', labelKey: 'dialog.newProject', defaultBinding: 'Mod+N' },
  { id: 'open-project', category: 'general', labelKey: 'action.openProject', defaultBinding: 'Mod+O' },
  { id: 'settings', category: 'general', labelKey: 'settings.title', defaultBinding: 'Mod+,' },
  { id: 'check-updates', category: 'general', labelKey: 'settings.checkUpdate', defaultBinding: 'Mod+U' },

  { id: 'toggle-sidebar', category: 'view', labelKey: 'command.toggleSidebar', defaultBinding: 'Mod+B' },
  { id: 'toggle-bottom', category: 'view', labelKey: 'command.toggleBottom', defaultBinding: 'Mod+J' },
  { id: 'toggle-agent', category: 'view', labelKey: 'command.toggleAgent', defaultBinding: 'Mod+Shift+A' },
  { id: 'focus-mode', category: 'view', labelKey: 'command.focusMode', defaultBinding: 'F11' },
  { id: 'zoom-in', category: 'view', labelKey: 'shortcut.zoomIn', defaultBinding: 'Mod+=' },
  { id: 'zoom-out', category: 'view', labelKey: 'shortcut.zoomOut', defaultBinding: 'Mod+-' },
  { id: 'zoom-reset', category: 'view', labelKey: 'shortcut.zoomReset', defaultBinding: 'Mod+0' },

  { id: 'save', category: 'editor', labelKey: 'action.save', defaultBinding: 'Mod+S' },
  { id: 'find', category: 'editor', labelKey: 'find.search', defaultBinding: 'Mod+F' },
  { id: 'close-tab', category: 'editor', labelKey: 'shortcut.closeTab', defaultBinding: 'Mod+W' },
  { id: 'undo', category: 'editor', labelKey: 'shortcut.undo', defaultBinding: 'Mod+Z' },
  { id: 'redo', category: 'editor', labelKey: 'shortcut.redo', defaultBinding: 'Mod+Y' },
]

const DEFAULT_BINDINGS = Object.fromEntries(
  SHORTCUT_DEFINITIONS.map(def => [def.id, def.defaultBinding]),
) as Record<string, string>

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift', 'CapsLock'])
const KEY_ALIASES: Record<string, string> = {
  esc: 'Escape',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  space: 'Space',
}

function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)
}

/** 单个按键的规范化显示/比较形式（字母统一小写，Esc/方向键统一全名）。 */
function normalizeKey(key: string): string {
  const trimmed = key.trim()
  if (!trimmed) return ''
  const alias = KEY_ALIASES[trimmed.toLowerCase()]
  if (alias) return alias
  if (trimmed.length === 1) {
    if (trimmed === '+') return '='
    return /[A-Z]/.test(trimmed) ? trimmed.toLowerCase() : trimmed
  }
  return trimmed
}

/** 把用户/默认绑定规范化为 `Mod+Shift+K` 形式。 */
export function normalizeBinding(binding: string): string {
  const raw = binding.trim()
  if (!raw) return ''
  const parts = raw.split('+').map(part => part.trim()).filter(Boolean)
  let mod = false
  let alt = false
  let shift = false
  let key = ''
  for (const part of parts) {
    const lower = part.toLowerCase()
    if (lower === 'mod' || lower === 'ctrl' || lower === 'control' || lower === 'cmd' || lower === 'meta') mod = true
    else if (lower === 'alt' || lower === 'option') alt = true
    else if (lower === 'shift') shift = true
    else key = normalizeKey(part)
  }
  if (!key) return ''
  return `${mod ? 'Mod+' : ''}${alt ? 'Alt+' : ''}${shift ? 'Shift+' : ''}${key}`
}

/** 从键盘事件生成绑定；仅修饰键/无修饰普通字符（F1–F12、? 除外）返回 null。 */
export function bindingFromEvent(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null
  const key = normalizeKey(event.key)
  if (!key) return null
  const mod = event.metaKey || event.ctrlKey
  const alt = event.altKey
  const isFunctionKey = /^F([1-9]|1[0-2])$/.test(key)
  const isHelpKey = key === '?'
  if (!mod && !alt && !isFunctionKey && !isHelpKey) return null
  // 符号键的 Shift 已隐含在字符里（? / + / _），不重复计入
  const shift = event.shiftKey && !(key.length === 1 && !/[a-z0-9]/i.test(key))
  return `${mod ? 'Mod+' : ''}${alt ? 'Alt+' : ''}${shift ? 'Shift+' : ''}${key}`
}

/** 事件是否命中某个绑定。 */
export function matchesBinding(event: KeyboardEvent, binding: string): boolean {
  const pressed = bindingFromEvent(event)
  if (!pressed) return false
  return normalizeBinding(pressed) === normalizeBinding(binding)
}

/** 平台化显示：Mac 用 ⌘/⌥/⇧，其它平台用 Ctrl/Alt/Shift。 */
export function formatBinding(binding: string): string {
  const normalized = normalizeBinding(binding)
  if (!normalized) return ''
  const parts = normalized.split('+')
  const key = parts.pop() ?? ''
  const mac = isMacPlatform()
  const symbols = parts.map(part => {
    if (part === 'Mod') return mac ? '⌘' : 'Ctrl'
    if (part === 'Alt') return mac ? '⌥' : 'Alt'
    if (part === 'Shift') return mac ? '⇧' : 'Shift'
    return part
  })
  if (mac) return `${symbols.join('')}${key === '=' ? '=' : key.toUpperCase()}`
  return [...symbols, key === '=' ? '=' : key.toUpperCase()].join('+')
}

/** 转为 CodeMirror keymap 的键名（Mod+Shift+Z → Mod-Shift-z）。 */
export function toCodeMirrorKey(binding: string): string {
  const parts = normalizeBinding(binding).split('+')
  const key = parts.pop() ?? ''
  const mapped = key.length === 1 && /[A-Z]/.test(key) ? key.toLowerCase() : key
  return [...parts, mapped].filter(Boolean).join('-')
}

export interface SetBindingResult {
  ok: boolean
  conflictId?: string
}

interface ShortcutState {
  bindings: Record<string, string>
  setBinding: (id: string, binding: string) => SetBindingResult
  resetBinding: (id: string) => void
  resetAll: () => void
}

export const useShortcutStore = create<ShortcutState>()(persist((set, get) => ({
  bindings: {},
  setBinding: (id, binding) => {
    const normalized = normalizeBinding(binding)
    if (!normalized) return { ok: false }
    const conflict = SHORTCUT_DEFINITIONS.find(def =>
      def.id !== id && normalizeBinding(get().bindings[def.id] ?? def.defaultBinding) === normalized,
    )
    if (conflict) return { ok: false, conflictId: conflict.id }
    set(state => ({ bindings: { ...state.bindings, [id]: normalized } }))
    return { ok: true }
  },
  resetBinding: (id) => set(state => {
    const next = { ...state.bindings }
    delete next[id]
    return { bindings: next }
  }),
  resetAll: () => set({ bindings: {} }),
}), {
  name: 'novelforge:shortcuts',
}))

/** 读取当前生效绑定（默认值兜底）。 */
export function shortcutBinding(id: string, bindings: Record<string, string> = useShortcutStore.getState().bindings): string {
  return bindings[id] ?? DEFAULT_BINDINGS[id] ?? ''
}

export function shortcutLabelKey(id: string): TextKey {
  return SHORTCUT_DEFINITIONS.find(def => def.id === id)?.labelKey ?? 'command.title'
}
