// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CallPurpose } from '../../llm/model-router'

const captured = vi.hoisted(() => ({ options: undefined as { temperature?: number } | undefined }))
vi.mock('../../../stores/llm-store', () => ({
  useLLMStore: {
    getState: () => ({
      defaultModelId: 'm1',
      models: [{ id: 'm1', name: 'M1', modelName: 'm1' }],
      getModelForPurpose: () => 'm1',
      cancelGeneration: vi.fn(),
      generateStream: (_m: unknown, cb: { onDone: (t: string) => void }, _id: string, opts: { temperature?: number }) => {
        captured.options = opts
        queueMicrotask(() => cb.onDone('ok'))
        return Promise.resolve('req-1')
      },
    }),
  },
}))
vi.mock('../../render-logger', () => ({ renderLog: vi.fn() }))
vi.mock('../../../services/ipc-client', () => ({ ipc: { invoke: vi.fn(async () => ({ success: true })) } }))

import { BaseWorkflowCommand } from './base-command'

type CallOpts = { responseFormat?: { type: string }; purpose?: CallPurpose; temperature?: number }
class TempCommand extends BaseWorkflowCommand<string> {
  async execute() { return '' }
  call(prompt: string, options?: CallOpts): Promise<string> {
    return this.callLLM(prompt, 'system', { log: () => {}, setProgress: () => {}, appendText: () => {} }, options)
  }
}

beforeEach(() => { captured.options = undefined })

describe('base-command 温度解析', () => {
  it('无选项 → 交给 llm-store 注入全局档位', async () => {
    await new TempCommand().call('x')
    expect(captured.options?.temperature).toBeUndefined()
  })

  it('结构化 purpose → 低温', async () => {
    await new TempCommand().call('x', { purpose: 'review_chapter' })
    expect(captured.options?.temperature).toBe(0.2)
  })

  it('创作类 purpose → 不覆盖全局', async () => {
    await new TempCommand().call('x', { purpose: 'draft_chapter' })
    expect(captured.options?.temperature).toBeUndefined()
  })

  it('JSON 模式且无 purpose → 0.3', async () => {
    await new TempCommand().call('x', { responseFormat: { type: 'json_object' } })
    expect(captured.options?.temperature).toBe(0.3)
  })

  it('显式温度优先', async () => {
    await new TempCommand().call('x', { temperature: 0.6 })
    expect(captured.options?.temperature).toBe(0.6)
  })
})