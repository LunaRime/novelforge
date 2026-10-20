// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import StatusBarUpdate from './StatusBarUpdate'
import { useUpdateStore } from '../../stores/update-store'

const toastShow = vi.hoisted(() => vi.fn())
vi.mock('../../components/ui/Toast', () => ({
  toast: {
    show: toastShow,
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    workflowComplete: vi.fn(),
  },
}))

const downloadUpdate = vi.fn(async () => true)
const installUpdate = vi.fn(async () => true)

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(): HTMLDivElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(<StatusBarUpdate />) })
  return container
}

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} disconnect() {} }
})

beforeEach(() => {
  document.body.innerHTML = ''
  downloadUpdate.mockClear()
  installUpdate.mockClear()
  toastShow.mockClear()
  useUpdateStore.setState({
    status: 'available',
    updateInfo: { version: '9.9.9', releaseDate: '2026-10-20' } as never,
    downloadProgress: null,
    error: null,
    downloadUpdate,
    installUpdate,
    init: () => () => {},
  } as never)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('StatusBarUpdate', () => {
  it('发现更新时可选择前台/后台下载', () => {
    const el = render()
    expect(el.textContent).toContain('9.9.9')
    act(() => { (el.querySelector('button') as HTMLButtonElement).click() })
    expect(el.textContent).toContain('后台下载')
  })

  it('下载完成后提供重启动作', () => {
    useUpdateStore.setState({ status: 'downloaded' } as never)
    const el = render()
    act(() => { (el.querySelector('button') as HTMLButtonElement).click() })
    expect(el.textContent).toContain('立即重启')
  })

  it('后台下载完成后只弹一次重启提示', async () => {
    const el = render()
    act(() => { (el.querySelector('button') as HTMLButtonElement).click() })

    const bg = [...el.querySelectorAll('button')].find(b => b.textContent?.includes('后台下载'))
    await act(async () => { bg!.click(); await Promise.resolve() })

    act(() => { useUpdateStore.setState({ status: 'downloaded' } as never) })
    act(() => { useUpdateStore.setState({ status: 'downloaded' } as never) })

    expect(toastShow).toHaveBeenCalledTimes(1)
  })

  it('前台下载时关闭弹窗，完成后按后台模式提示一次', async () => {
    const el = render()
    act(() => { (el.querySelector('button') as HTMLButtonElement).click() })

    const fg = [...el.querySelectorAll('button')].find(b => b.textContent?.trim() === '下载')
    await act(async () => { fg!.click(); await Promise.resolve() })

    // 下载事件到达后用户关掉弹窗（Esc），随后下载完成
    act(() => { useUpdateStore.setState({ status: 'downloading' } as never) })
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    act(() => { useUpdateStore.setState({ status: 'downloaded' } as never) })

    expect(toastShow).toHaveBeenCalledTimes(1)
  })
})