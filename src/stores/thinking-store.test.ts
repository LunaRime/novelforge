// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('../services/ipc-client', () => ({ ipc: { invoke: invokeMock, isElectron: true } }))
vi.mock('../services/render-logger', () => ({ renderLog: vi.fn() }))
vi.mock('../components/ui/Toast', () => ({ toast: { error: vi.fn() } }))

import { useThinkingStore, getThinkingTemperature } from './thinking-store'

beforeEach(() => {
  invokeMock.mockReset()
  useThinkingStore.setState({ level: 'high', initialized: false })
})

afterEach(() => { vi.useRealTimers() })

describe('thinking-store', () => {
  it('init 读取 config.thinkingLevel', async () => {
    invokeMock.mockResolvedValue({ thinkingLevel: 'low' })
    await useThinkingStore.getState().init()
    expect(useThinkingStore.getState().level).toBe('low')
    expect(useThinkingStore.getState().initialized).toBe(true)
  })

  it('非法/旧值回退 High', async () => {
    invokeMock.mockResolvedValue({ thinkingLevel: 'deep' })
    await useThinkingStore.getState().init()
    expect(useThinkingStore.getState().level).toBe('high')
  })

  it('setLevel 乐观更新并 300ms 防抖写盘', async () => {
    vi.useFakeTimers()
    useThinkingStore.getState().setLevel('max')
    expect(useThinkingStore.getState().level).toBe('max')
    expect(invokeMock).not.toHaveBeenCalledWith('config:set', expect.anything())
    await vi.advanceTimersByTimeAsync(300)
    expect(invokeMock).toHaveBeenCalledWith('config:set', { thinkingLevel: 'max' })
  })

  it('getThinkingTemperature 反映当前档位', () => {
    useThinkingStore.setState({ level: 'max' })
    expect(getThinkingTemperature()).toBe(1.2)
  })
})