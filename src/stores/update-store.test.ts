// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('../services/ipc-client', () => ({ ipc: { invoke: invokeMock, on: () => () => {}, isElectron: true } }))

import { useUpdateStore } from './update-store'

beforeEach(() => {
  invokeMock.mockReset()
  useUpdateStore.setState({ status: 'available', updateInfo: { version: '9.9.9' } as never })
})

describe('downloadUpdate 启动语义', () => {
  it('invoke 返回成功时只结束 loading，不直接置 downloaded', async () => {
    invokeMock.mockResolvedValue({ success: true })
    const ok = await useUpdateStore.getState().downloadUpdate()
    expect(ok).toBe(true)
    expect(useUpdateStore.getState().status).toBe('available')
    expect(useUpdateStore.getState().loading).toBe(false)
  })
})

describe('checkForUpdates 错误语义', () => {
  it('检查失败时保持 error，而不是改写成 no-update', async () => {
    invokeMock.mockResolvedValue({ hasUpdate: false, error: 'network down' })
    const ok = await useUpdateStore.getState().checkForUpdates()
    expect(ok).toBe(false)
    expect(useUpdateStore.getState().status).toBe('error')
    expect(useUpdateStore.getState().error).toBe('network down')
  })
})