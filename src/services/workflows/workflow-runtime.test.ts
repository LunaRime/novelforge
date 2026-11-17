import { expect, it, vi } from 'vitest'
import { createWorkflowRuntime, type WorkflowRuntimePorts } from './workflow-runtime'
import type { CheckpointData, WorkflowDefinition } from '../../shared/workflow-types'

function fixture(label: string) {
  let checkpoint: CheckpointData | null = null
  let sequence = 0
  const listener = vi.fn()
  const events = new Set([listener])
  const step = vi.fn(async () => `${label} completed`)
  const project = { id: label, path: `/${label}`, session: 1 }
  const definition: WorkflowDefinition = {
    type: 'directory', title: label, rehydrateParams: { label }, steps: [
      { name: 'first', description: '', executor: async (_step, context, callbacks) => {
        context.data.owner = label
        callbacks.appendText(label)
        return label
      } },
      { name: 'second', description: '', executor: step },
    ],
  }
  const ports: WorkflowRuntimePorts = {
    id: () => String(++sequence),
    project: { current: () => project, subscribe: () => () => {} },
    checkpoint: {
      read: async () => checkpoint,
      write: data => { checkpoint = structuredClone(data) },
      clear: () => { checkpoint = null },
    },
    output: { append: vi.fn(), delete: vi.fn(), read: vi.fn() },
    emitComplete: event => { for (const callback of events) callback(event) },
    rehydrate: async () => () => definition,
  }
  const runtime = createWorkflowRuntime(ports)
  return { ...runtime, definition, listener, step, ports, project, checkpoint: () => checkpoint, unsubscribe: () => events.delete(listener) }
}

it('keeps approval, checkpoint, output and subscriptions isolated for identical run ids', async () => {
  const a = fixture('A')
  const b = fixture('B')
  const first = a.store.getState().startWorkflow(a.definition, true)
  const second = b.store.getState().startWorkflow(b.definition, true)
  await vi.waitFor(() => {
    expect(a.store.getState().waitingRuns['1']).toBeDefined()
    expect(b.store.getState().waitingRuns['1']).toBeDefined()
  })
  expect(a.checkpoint()?.contextData?.['1'].owner).toBe('A')
  expect(b.checkpoint()?.contextData?.['1'].owner).toBe('B')
  expect(b.checkpoint()?.waitingRuns['1']).toBeDefined()
  expect(a.ports.output.append).toHaveBeenCalledWith('1', 0, 'A')
  expect(b.ports.output.append).toHaveBeenCalledWith('1', 0, 'B')
  const bCheckpoint = b.checkpoint()

  a.store.getState().cancelWorkflow('1')
  await first
  expect(a.step).not.toHaveBeenCalled()
  expect(b.step).not.toHaveBeenCalled()
  expect(b.checkpoint()).toEqual(bCheckpoint)
  expect(b.listener).not.toHaveBeenCalled()
  a.unsubscribe()
  b.store.getState().confirmContinue('1')
  await second
  expect(b.step).toHaveBeenCalledOnce()
  expect(a.listener).not.toHaveBeenCalled()
  expect(b.listener).toHaveBeenCalledWith({ type: 'directory', runId: '1', status: 'success' })
  expect(b.store.getState().history[0].steps[1].result).toBe('B completed')
})

it('keeps the new project checkpoint when the former project finishes', async () => {
  const runtime = fixture('A')
  let finish!: () => void
  const first = runtime.store.getState().startWorkflow({
    ...runtime.definition,
    steps: [{ name: 'pending', description: '', executor: () => new Promise<void>(resolve => { finish = resolve }) }],
  })
  runtime.project.session++
  const second = runtime.store.getState().startWorkflow(runtime.definition, true)
  try {
    await vi.waitFor(() => expect(runtime.checkpoint()?.activeRuns).toHaveLength(1))
    const current = runtime.checkpoint()
    expect(current?.activeRuns[0].id).not.toBe('1')
    finish()
    await first
    expect(runtime.checkpoint()).toEqual(current)
  } finally {
    finish?.()
    runtime.store.getState().cancelWorkflow()
    await Promise.all([first, second])
  }
})
