// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  bindingFromEvent,
  formatBinding,
  matchesBinding,
  normalizeBinding,
  useShortcutStore,
} from './shortcut-store'

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init)
}

beforeEach(() => {
  useShortcutStore.setState({ bindings: {} })
})

describe('shortcut-store — 绑定规范化与匹配', () => {
  it('规范化修饰键顺序与字母大小写', () => {
    expect(normalizeBinding('shift+mod+a')).toBe('Mod+Shift+a')
    expect(normalizeBinding('Ctrl+Alt+Z')).toBe('Mod+Alt+z')
  })

  it('从键盘事件生成绑定：字母/符号/功能键', () => {
    expect(bindingFromEvent(key({ key: 'k', ctrlKey: true }))).toBe('Mod+k')
    expect(bindingFromEvent(key({ key: 'A', ctrlKey: true, shiftKey: true }))).toBe('Mod+Shift+a')
    expect(bindingFromEvent(key({ key: '?', shiftKey: true }))).toBe('?')
    expect(bindingFromEvent(key({ key: 'F11' }))).toBe('F11')
    expect(bindingFromEvent(key({ key: 'k' }))).toBeNull()
  })

  it('匹配事件与绑定', () => {
    expect(matchesBinding(key({ key: 'k', ctrlKey: true }), 'Mod+K')).toBe(true)
    expect(matchesBinding(key({ key: 'k', metaKey: true }), 'Mod+K')).toBe(true)
    expect(matchesBinding(key({ key: 'j', ctrlKey: true }), 'Mod+K')).toBe(false)
  })

  it('平台化显示', () => {
    const formatted = formatBinding('Mod+Shift+A')
    expect(formatted).toMatch(/Ctrl\+Shift\+A|⌘⇧A/)
  })
})

describe('shortcut-store — 冲突与重置', () => {
  it('重复绑定被拒绝并返回冲突项', () => {
    const result = useShortcutStore.getState().setBinding('save', 'Mod+K')
    expect(result).toEqual({ ok: false, conflictId: 'command-palette' })
    expect(useShortcutStore.getState().bindings.save).toBeUndefined()
  })

  it('改键后读取新值，单项与全部可恢复默认', () => {
    expect(useShortcutStore.getState().setBinding('save', 'Mod+Alt+S')).toEqual({ ok: true })
    expect(useShortcutStore.getState().bindings.save).toBe('Mod+Alt+s')
    useShortcutStore.getState().resetBinding('save')
    expect(useShortcutStore.getState().bindings.save).toBeUndefined()
    useShortcutStore.getState().setBinding('save', 'Mod+Alt+S')
    useShortcutStore.getState().resetAll()
    expect(useShortcutStore.getState().bindings).toEqual({})
  })
})
