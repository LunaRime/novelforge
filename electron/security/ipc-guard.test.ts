/**
 * ipc-guard 来源校验单测（L4 S6）
 *
 * 为什么这些用例必须存在：来源校验的失败模式是「应用启动即不可用」（IPC 全被拒），
 * 而 CI 没有 electron 二进制、无法真机验证。因此判定逻辑做成纯函数 `isSenderTrusted`
 * 并在这里离线覆盖全部分支；`guardedHandle` 的接线单独用 mock 的 ipcMain 验证一次。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}))

import { ipcMain } from 'electron'
import {
  isSenderTrusted,
  guardedHandle,
  trustWebContents,
  untrustWebContents,
  resetTrustedWebContentsForTest,
  type SenderProbe,
  type SenderTrustPolicy,
} from './ipc-guard'

const prodPolicy = (ids: number[] = [1]): SenderTrustPolicy => ({
  trustedIds: new Set(ids),
  devServerUrl: undefined,
})

const probe = (over: Partial<SenderProbe> = {}): SenderProbe => ({
  senderId: 1,
  frameUrl: 'file:///C:/app/dist/index.html',
  isTopFrame: true,
  alive: true,
  ...over,
})

describe('isSenderTrusted（来源校验判定）', () => {
  it('生产：己方 top frame + file:// → 放行', () => {
    expect(isSenderTrusted(probe(), prodPolicy())).toBe(true)
  })

  it('非 top frame（子帧/iframe/webview）→ 拒绝', () => {
    expect(isSenderTrusted(probe({ isTopFrame: false }), prodPolicy())).toBe(false)
  })

  it('帧已销毁（alive=false）→ 拒绝', () => {
    expect(isSenderTrusted(probe({ alive: false }), prodPolicy())).toBe(false)
  })

  it('frameUrl 为 null（帧不可读）→ 拒绝', () => {
    expect(isSenderTrusted(probe({ frameUrl: null }), prodPolicy())).toBe(false)
  })

  it('未登记的 webContents（未来新增窗口）→ 拒绝', () => {
    expect(isSenderTrusted(probe({ senderId: 99 }), prodPolicy([1]))).toBe(false)
  })

  it('生产：远程 http(s) 页面 → 拒绝（只接受 file:）', () => {
    expect(isSenderTrusted(probe({ frameUrl: 'https://evil.example/x.html' }), prodPolicy())).toBe(false)
    expect(isSenderTrusted(probe({ frameUrl: 'http://127.0.0.1:5173/' }), prodPolicy())).toBe(false)
  })

  it('非法 URL 字符串 → 拒绝（不抛错）', () => {
    expect(isSenderTrusted(probe({ frameUrl: 'not a url' }), prodPolicy())).toBe(false)
  })

  it('开发：origin 命中 VITE_DEV_SERVER_URL → 放行', () => {
    const policy: SenderTrustPolicy = { trustedIds: new Set([1]), devServerUrl: 'http://localhost:5173' }
    expect(isSenderTrusted(probe({ frameUrl: 'http://localhost:5173/index.html' }), policy)).toBe(true)
    expect(isSenderTrusted(probe({ frameUrl: 'http://localhost:5173/#/x' }), policy)).toBe(true)
  })

  it('开发：origin 不匹配（含端口不同）→ 拒绝', () => {
    const policy: SenderTrustPolicy = { trustedIds: new Set([1]), devServerUrl: 'http://localhost:5173' }
    expect(isSenderTrusted(probe({ frameUrl: 'http://localhost:5174/index.html' }), policy)).toBe(false)
    expect(isSenderTrusted(probe({ frameUrl: 'http://evil.example/' }), policy)).toBe(false)
  })
})

describe('guardedHandle 接线（策略表 + 来源校验）', () => {
  const handleMock = vi.mocked(ipcMain.handle)

  beforeEach(() => {
    handleMock.mockClear()
    resetTrustedWebContentsForTest()
  })

  /** 构造一个最小 event（只用到 senderFrame / sender.id） */
  const fakeEvent = (senderId: number, url: string | null, parent: unknown = null) => ({
    sender: { id: senderId },
    senderFrame: url === null ? null : { url, parent },
  }) as never

  it('未登记策略的通道 → 注册期抛错（纵深防御）', () => {
    expect(() => guardedHandle('nope:channel' as never, (() => undefined) as never)).toThrow(/未登记策略/)
  })

  it('未登记窗口调用 → 抛错；登记后 → 放行且返回 handler 结果', () => {
    // 同步 handler：guardedHandle 不做 await 包装，返回值原样透出（便于断言接线未被改变）
    guardedHandle('styles:list', (() => 'ok') as never)
    expect(handleMock).toHaveBeenCalledTimes(1)
    const wrapper = handleMock.mock.calls[0][1] as (e: unknown) => unknown

    // 未登记 webContents → 默认拒绝
    expect(() => wrapper(fakeEvent(7, 'file:///app/index.html'))).toThrow(/sender not trusted/)

    // 显式登记后放行
    trustWebContents(7)
    expect(wrapper(fakeEvent(7, 'file:///app/index.html'))).toBe('ok')

    // 注销后再次拒绝（窗口销毁 → 不留后门）
    untrustWebContents(7)
    expect(() => wrapper(fakeEvent(7, 'file:///app/index.html'))).toThrow(/sender not trusted/)
  })

  it('非 top frame 即使窗口已登记 → 仍拒绝', () => {
    trustWebContents(7)
    guardedHandle('styles:get', (() => 'ok') as never)
    const wrapper = handleMock.mock.calls[0][1] as (e: unknown) => unknown
    expect(() => wrapper(fakeEvent(7, 'file:///app/index.html', { parent: 'x' }))).toThrow(/sender not trusted/)
  })
})
