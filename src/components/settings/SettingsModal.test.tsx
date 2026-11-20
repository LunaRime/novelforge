// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import SettingsModal from './SettingsModal'
import { useLayoutStore } from '../../stores/layout-store'
import { useUpdateStore } from '../../stores/update-store'
import { useEditorPrefsStore } from '../../stores/editor-prefs-store'
import { t } from '../../shared/locale'

beforeAll(() => {
  vi.stubGlobal('__APP_VERSION__', '9.9.9');
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} disconnect() {} }
})

beforeEach(() => {
  document.body.innerHTML = ''
  useLayoutStore.setState({ settingsSection: 'about' })
  useUpdateStore.setState({
    status: 'available',
    updateInfo: { version: '9.9.9', releaseDate: '2026-10-20' } as never,
    error: null,
    downloadProgress: null,
    loading: false,
  } as never)
})

describe('SettingsModal — 关于区更新入口', () => {
  it('只保留检查更新与状态栏提示，不再提供下载/重启按钮', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => { root.render(<SettingsModal open onClose={() => {}} />) })

    const text = container.textContent ?? ''
    expect(text).toContain('9.9.9')
    // 可用更新时引导到状态栏（唯一操作面）
    expect(text).toContain('请在底部状态栏下载或安装更新')
    // 旧的下载/重启入口已移除
    expect(text).not.toContain('立即更新')
    expect(text).not.toContain('立即重启')
    act(() => root.unmount())
  })
})

it('预览和跨分区保留外观草稿，应用后才更新正文偏好', async () => {
  useEditorPrefsStore.setState({ proseFontSize: 17, measureWidth: 760 })
  useLayoutStore.setState({ settingsSection: 'editor' })
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  const button = (name: string) => Array.from(document.querySelectorAll('button')).find(el => el.textContent === name)!
  try {
    await act(async () => root.render(<SettingsModal open onClose={vi.fn()} />))
    await act(async () => button('18px').click())
    await act(async () => button('800').click())
    expect(useEditorPrefsStore.getState()).toMatchObject({ proseFontSize: 17, measureWidth: 760 })
    const about = [...container.querySelectorAll<HTMLButtonElement>('aside button')]
      .find(item => item.textContent?.endsWith(t('settings.about')))!
    await act(async () => about.click())
    await act(async () => button(t('settings.editor')).click())
    expect(button('18px').getAttribute('aria-pressed')).toBe('true')
    expect(button('800').getAttribute('aria-pressed')).toBe('true')
    await act(async () => button(t('action.apply')).click())
    expect(useEditorPrefsStore.getState()).toMatchObject({ proseFontSize: 18, measureWidth: 800 })
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})

it('Esc 二次确认可取消，放弃只丢弃外观草稿', async () => {
  useEditorPrefsStore.setState({ prosePaper: 'theme', listDensity: 'standard' })
  useLayoutStore.setState({ settingsSection: 'editor' })
  const root = createRoot(document.body.appendChild(document.createElement('div')))
  const onClose = vi.fn()
  const button = (name: string) => Array.from(document.querySelectorAll('button')).find(el => el.textContent === name)!
  try {
    await act(async () => root.render(<SettingsModal open onClose={onClose} />))
    const warmPaper = button(t('settings.prosePaperWarm'))
    await act(async () => { warmPaper.focus(); warmPaper.click() })
    expect(document.documentElement.dataset.v3ProsePaper).toBe('theme')
    await act(async () => warmPaper.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(document.body.textContent).toContain(t('settings.discardConfirm'))
    await act(async () => button(t('action.cancel')).click())
    await act(async () => new Promise(resolve => setTimeout(resolve, 0)))
    expect(document.activeElement).toBe(warmPaper)
    expect(warmPaper.getAttribute('aria-pressed')).toBe('true')
    await act(async () => warmPaper.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    await act(async () => button(t('action.discard')).click())
    expect(onClose).toHaveBeenCalledOnce()
    expect(useEditorPrefsStore.getState()).toMatchObject({ prosePaper: 'theme', listDensity: 'standard' })
  } finally {
    await act(async () => root.unmount())
  }
})
