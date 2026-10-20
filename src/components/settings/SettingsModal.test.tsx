// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import SettingsModal from './SettingsModal'
import { useLayoutStore } from '../../stores/layout-store'
import { useUpdateStore } from '../../stores/update-store'

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
    act(() => { createRoot(container).render(<SettingsModal open onClose={() => {}} />) })

    const text = container.textContent ?? ''
    expect(text).toContain('9.9.9')
    // 可用更新时引导到状态栏（唯一操作面）
    expect(text).toContain('请在底部状态栏下载或安装更新')
    // 旧的下载/重启入口已移除
    expect(text).not.toContain('立即更新')
    expect(text).not.toContain('立即重启')
  })
})