// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipc } from '../../ipc-client'

vi.mock('../../ipc-client', () => ({
  ipc: { invoke: vi.fn() },
}))

const mockInvoke = vi.mocked(ipc.invoke)

beforeEach(() => {
  mockInvoke.mockClear()
})

describe('call_external_api 工具', () => {
  it('调用 dev:invoke 并映射结果（HTTP 状态 + 内容）', async () => {
    mockInvoke.mockResolvedValue({ success: true, status: 200, content: '{"result":"ok"}' })
    const { callExternalApiTool } = await import('./call-external-api.tool')
    const result = await callExternalApiTool.execute({ path: '/search?q=主角' })
    expect(mockInvoke).toHaveBeenCalledWith('dev:invoke', { path: '/search?q=主角', method: 'GET', body: undefined })
    expect(result.success).toBe(true)
    expect(result.content).toContain('HTTP 200')
    expect(result.content).toContain('{"result":"ok"}')
  })

  it('POST 带 body 透传', async () => {
    mockInvoke.mockResolvedValue({ success: true, status: 201, content: 'created' })
    const { callExternalApiTool } = await import('./call-external-api.tool')
    await callExternalApiTool.execute({ path: '/api/v1', method: 'POST', body: '{"q":"x"}' })
    expect(mockInvoke).toHaveBeenCalledWith('dev:invoke', { path: '/api/v1', method: 'POST', body: '{"q":"x"}' })
  })

  it('缺 path → 报错且不调用 IPC（不静默调根路径）', async () => {
    const { callExternalApiTool } = await import('./call-external-api.tool')
    const result = await callExternalApiTool.execute({})
    expect(result.success).toBe(false)
    expect(result.error).toContain('path')
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('失败（开发者模式未启用等）→ error 透传给 LLM observation', async () => {
    mockInvoke.mockResolvedValue({ success: false, error: '开发者模式未启用（设置 → 开发者模式）' })
    const { callExternalApiTool } = await import('./call-external-api.tool')
    const result = await callExternalApiTool.execute({ path: '/x' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('开发者模式未启用')
  })
})
