// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
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

describe('StatusBarUpdate', () => {
  it('发现更新时可选择前台/后台下载', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    act(() => { createRoot(container).render(<StatusBarUpdate />) })
    expect(container.textContent).toContain('9.9.9')
    act(() => { (container.querySelector('button') as HTMLButtonElement).click() })
    expect(container.textContent).toContain('后台下载')
  })

  it('下载完成后提供重启动作', () => {
    useUpdateStore.setState({ status: 'downloaded' } as never)
    const container = document.createElement('div')
    document.body.appendChild(container)
    act(() => { createRoot(container).render(<StatusBarUpdate />) })
    act(() => { (container.querySelector('button') as HTMLButtonElement).click() })
    expect(container.textContent).toContain('立即重启')
  })

  it('后台下载完成后只弹一次重启提示', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    act(() => { createRoot(container).render(<StatusBarUpdate />) })
    act(() => { (container.querySelector('button') as HTMLButtonElement).click() })

    const bg = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('后台下载'))
    await act(async () => { bg!.click(); await Promise.resolve() })

    act(() => { useUpdateStore.setState({ status: 'downloaded' } as never) })
    act(() => { useUpdateStore.setState({ status: 'downloaded' } as never) })

    expect(toastShow).toHaveBeenCalledTimes(1)
  })
})