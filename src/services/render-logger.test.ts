// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { detectLogEnvMode, renderLog, installRendererErrorCapture } from './render-logger'
import { ipc } from './ipc-client'

vi.mock('./ipc-client', () => ({
  ipc: { invoke: vi.fn().mockResolvedValue({ success: true }) },
}))

describe('detectLogEnvMode', () => {
  it('dev 模式（Vite HMR）→ dev 环境', () => {
    expect(detectLogEnvMode(true, '0.1.5')).toBe('dev')
  })

  it('内测版编号式 prerelease（-alpha.N）→ dev 环境', () => {
    expect(detectLogEnvMode(false, '0.1.5-alpha.1')).toBe('dev')
  })

  it('历史日期式内测版（-YYYYMMDD）→ dev 环境', () => {
    expect(detectLogEnvMode(false, '0.1.4-20260804')).toBe('dev')
  })

  it('公测版（-beta.N）与正式版 → release 环境', () => {
    expect(detectLogEnvMode(false, '0.1.5-beta.1')).toBe('release')
    expect(detectLogEnvMode(false, '0.1.5')).toBe('release')
  })
})

describe('renderLog', () => {
  beforeEach(() => {
    vi.mocked(ipc.invoke).mockClear()
  })

  it('通过 log:write 写入主进程日志文件', () => {
    renderLog('info', 'Workflow', '测试消息')
    expect(ipc.invoke).toHaveBeenCalledWith('log:write', 'info', 'Workflow', '测试消息')
  })

  it('IPC 失败时静默（不抛异常）', () => {
    vi.mocked(ipc.invoke).mockRejectedValueOnce(new Error('主进程不可用'))
    expect(() => renderLog('error', 'Renderer', 'boom')).not.toThrow()
  })
})

describe('installRendererErrorCapture', () => {
  beforeEach(() => {
    vi.mocked(ipc.invoke).mockClear()
  })

  it('window error 事件 → ERROR 落盘', () => {
    installRendererErrorCapture()
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom', filename: 'app.ts', lineno: 42 }))
    expect(ipc.invoke).toHaveBeenCalledWith(
      'log:write', 'error', 'Renderer', expect.stringContaining('boom'),
    )
  })

  it('unhandledrejection → ERROR 落盘（含堆栈）', () => {
    installRendererErrorCapture()
    const ev = new Event('unhandledrejection')
    Object.defineProperty(ev, 'reason', { value: new Error('reject-boom') })
    window.dispatchEvent(ev)
    expect(ipc.invoke).toHaveBeenCalledWith(
      'log:write', 'error', 'Renderer', expect.stringContaining('reject-boom'),
    )
  })
})
