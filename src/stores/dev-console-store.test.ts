import { describe, it, expect, vi, beforeEach } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../services/ipc-client', () => ({ ipc: { invoke } }))

import { useDevConsoleStore } from './dev-console-store'

describe('dev-console-store', () => {
  beforeEach(() => {
    invoke.mockReset()
    useDevConsoleStore.setState({ enabled: null })
  })

  it('refresh 读取后端门禁结果', async () => {
    invoke.mockResolvedValue({ enabled: true })
    await useDevConsoleStore.getState().refresh()
    expect(useDevConsoleStore.getState().enabled).toBe(true)
  })

  it('后端不可用时降级为 false', async () => {
    invoke.mockRejectedValue(new Error('no ipc'))
    await useDevConsoleStore.getState().refresh()
    expect(useDevConsoleStore.getState().enabled).toBe(false)
  })
})