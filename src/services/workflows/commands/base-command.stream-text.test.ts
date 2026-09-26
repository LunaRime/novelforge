// @vitest-environment jsdom
/**
 * base-command × 流式原文保存（issue #34：思考内容可见的数据源）
 *
 * callLLM 返回值仍是清洗后文本（既有语义），但含 <think> 的流式原文被保留，
 * 供命令在步骤产出中展示思考过程（此前原文是闭包局部变量，随调用丢弃）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BaseWorkflowCommand } from './base-command'
import type { StepCallbacks } from '../../../stores/workflow-store'

vi.mock('../../ipc-client', () => ({
  ipc: { invoke: vi.fn().mockResolvedValue({ success: true }) },
}))
vi.mock('../../render-logger', () => ({ renderLog: vi.fn() }))

/** 流式脚本（onChunk 依次吐出原文；onDone 给清洗后文本） */
const script = { chunks: [] as string[], cleaned: '' }

vi.mock('../../../stores/llm-store', () => ({
  useLLMStore: {
    getState: () => ({
      defaultModelId: 'm1',
      models: [{ id: 'm1', name: 'Test', modelName: 'test-model' }],
      getModelForPurpose: () => 'm1',
      cancelGeneration: vi.fn(),
      generateStream: async (
        _messages: unknown,
        cbs: { onChunk: (c: string) => void; onDone: (t: string) => void },
      ) => {
        for (const c of script.chunks) cbs.onChunk(c)
        cbs.onDone(script.cleaned)
        return 'req-1'
      },
    }),
  },
}))

class StreamProbe extends BaseWorkflowCommand<string> {
  async execute(): Promise<string> { return '' }
  async runLLM(callbacks: StepCallbacks): Promise<string> {
    return this.callLLM('prompt', 'system', callbacks)
  }
  streamText(): string { return this.getLastStreamText() }
}

const makeCallbacks = (): StepCallbacks => ({
  log: vi.fn(),
  setProgress: vi.fn(),
  appendText: vi.fn(),
})

beforeEach(() => {
  script.chunks = []
  script.cleaned = ''
})

describe('callLLM 流式原文保存（issue #34）', () => {
  it('保存含 <think> 的流式原文，返回值仍为清洗后文本（既有语义不回归）', async () => {
    script.chunks = ['<think>推理过程', '继续推理</think>', '正文内容']
    script.cleaned = '正文内容'
    const cmd = new StreamProbe()
    const result = await cmd.runLLM(makeCallbacks())
    expect(result).toBe('正文内容')
    expect(cmd.streamText()).toContain('推理过程')
    expect(cmd.streamText()).toContain('正文内容')
  })

  it('模型未输出思考时，保存的原文即纯正文', async () => {
    script.chunks = ['纯正文']
    script.cleaned = '纯正文'
    const cmd = new StreamProbe()
    await cmd.runLLM(makeCallbacks())
    expect(cmd.streamText()).toBe('纯正文')
  })
})
