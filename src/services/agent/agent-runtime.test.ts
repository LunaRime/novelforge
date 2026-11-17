import { describe, expect, it, vi } from 'vitest'
import { runAgentLoop, type AgentEngineCallbacks, type LLMMessage } from './agent-engine'
import { buildAgentTool, createToolRegistry, toolRegistry } from './tool-registry'
import { buildAgentSystemSegmentsAsync } from './context-builder'
import { readFileTool } from './tools/read-file.tool'
import type { AgentRuntimePorts } from './runtime-ports'

function fixture(label: string) {
  const execute = vi.fn().mockImplementation(async args => ({
    success: true, content: `${label}-${args.step}`,
    artifacts: [{ type: 'workflow.progressed', runId: label, step: String(args.step), pct: 0 }],
  }))
  const tool = buildAgentTool({
    name: 'instance_tool', description: '', source: 'builtin', inputSchema: { type: 'object', properties: {} },
    requiresConfirmation: true, isReadOnly: false, timeoutMs: 20, execute,
  })
  const tools = createToolRegistry([tool])
  const approval = vi.fn<AgentEngineCallbacks['onToolCallConfirmRequired']>().mockResolvedValue(true)
  const done = vi.fn<AgentEngineCallbacks['onDone']>()
  const complete = vi.fn<AgentEngineCallbacks['onToolCallComplete']>()
  const generate = vi.fn<(messages: LLMMessage[]) => Promise<string>>().mockResolvedValue('done').mockResolvedValueOnce(
    '<tool_call>{"name":"instance_tool","arguments":{"step":1}}</tool_call>'
    + '<tool_call>{"name":"instance_tool","arguments":{"step":2}}</tool_call>',
  )
  const controller = new AbortController()
  const run = () => runAgentLoop('', [], 'run', 'model', generate, {
    onTextChunk: vi.fn(), onToolCallStart: vi.fn(), onToolCallComplete: complete,
    onToolCallConfirmRequired: approval, onDone: done, onError: vi.fn(),
  }, controller.signal, undefined, { tools })
  return { run, approval, done, complete, generate, execute, controller }
}

describe('parallel agent runtimes', () => {
  it('uses each injected context, transport and file read cache', async () => {
    function runtime(label: string): AgentRuntimePorts {
      return {
        tools: createToolRegistry([readFileTool]),
        io: { invoke: vi.fn(async channel => channel === 'memory:list' ? [] : { success: true, content: label }) },
        project: { current: () => ({ id: label, path: '/same', name: label, novelConfig: {} }), session: () => 1 },
        editor: { snapshot: () => ({ tabs: [] }) },
        conversation: { active: () => null },
        workflows: { snapshot: () => ({ currentRun: null, activeRuns: [], hasActiveRun: () => false }) },
      } as unknown as AgentRuntimePorts
    }
    const a = runtime('Project alpha')
    const b = runtime('Project bravo')
    const [contextA, contextB] = await Promise.all([
      buildAgentSystemSegmentsAsync('max', '', undefined, a),
      buildAgentSystemSegmentsAsync('max', '', undefined, b),
    ])
    expect(contextA.base).toContain('Project alpha')
    expect(contextA.base).not.toContain('Project bravo')
    expect(contextB.base).toContain('Project bravo')
    const args = { file_path: 'C:/shared.txt' }
    expect((await readFileTool.execute(args, a)).content).toBe('Project alpha')
    expect((await readFileTool.execute(args, b)).content).toBe('Project bravo')
    await readFileTool.execute(args, a)
    expect(a.io.invoke).toHaveBeenCalledTimes(2)
    expect(b.io.invoke).toHaveBeenCalledTimes(2)
  })

  it('keeps the other instance ordered when one cancels during approval', async () => {
    const a = fixture('A')
    const b = fixture('B')
    let approve!: (allow: boolean) => void
    a.approval.mockImplementationOnce(() => new Promise(resolve => { approve = resolve }))
    const first = a.run()
    const second = b.run()
    await vi.waitFor(() => expect(approve).toBeTypeOf('function'))
    a.controller.abort()
    await Promise.all([first, second])
    approve(true)
    expect(a.execute).not.toHaveBeenCalled()
    expect(a.approval).toHaveBeenCalledTimes(1)
    expect(b.approval.mock.calls.map(([call]) => call.arguments.step)).toEqual([1, 2])
    expect(b.complete.mock.calls.map(([call]) => call.result)).toEqual(['B-1', 'B-2'])
    expect(b.done.mock.calls[0][2].map(event => event.type === 'workflow.progressed' && event.runId)).toEqual(['B', 'B'])
    expect(toolRegistry.get('instance_tool')).toBeUndefined()
  })

  it('isolates tool timeout and thrown errors from another instance', async () => {
    const a = fixture('A')
    const b = fixture('B')
    a.execute.mockImplementationOnce(() => new Promise(() => {})).mockRejectedValueOnce(new Error('A failed'))
    await Promise.all([a.run(), b.run()])
    expect(a.complete.mock.calls.map(([call]) => call.status)).toEqual(['failed', 'failed'])
    expect(a.complete.mock.calls[1][0].error).toContain('A failed')
    expect(b.complete.mock.calls.map(([call]) => call.result)).toEqual(['B-1', 'B-2'])
    expect(b.generate.mock.calls[1][0].at(-1)?.content).not.toContain('A failed')
  })
})
