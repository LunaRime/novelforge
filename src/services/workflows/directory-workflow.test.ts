// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { t } from '../../shared/locale'
import { globalEventBus } from '../../shared/event-bus'
import type { WorkflowContext, WorkflowStep } from '../../shared/workflow-types'
import { useWorkflowStore } from '../../stores/workflow-store'
import { createDirectoryWorkflow } from './directory-workflow'

const h = vi.hoisted(() => {
  const refresh = vi.fn()
  return {
    llm: vi.fn(), invoke: vi.fn(), refresh,
    project: { currentProject: { id: 'a', path: '/a', novelConfig: { totalChapters: 3 } }, projectSession: 1, refreshFileTree: refresh },
  }
})
vi.mock('../ipc-client', () => ({ ipc: { invoke: h.invoke } }))
vi.mock('../../stores/project-store', () => ({ useProjectStore: { getState: () => h.project } }))
vi.mock('../../stores/llm-store', () => ({ useLLMStore: { getState: () => ({ models: [] }) } }))
vi.mock('./commands/base-command', () => ({ BaseWorkflowCommand: class { protected callLLM = h.llm } }))
vi.mock('../render-logger', () => ({ renderLog: vi.fn() }))

const scope = { projectPath: '/a', token: 'connection-a' }
const snapshot = {
  scope, digest: 'a'.repeat(64),
  range: { mode: 'replace-all', first: 1, last: 3, totalChapters: 3 },
}
const result = { success: true, writtenChapterNumbers: [1, 2, 3], deletedChapterNumbers: [] }
const modelOutput = (chapters: number[]) => JSON.stringify(chapters.map(chapterNumber => ({ chapterNumber, title: `Ch ${chapterNumber}` })))
const makeRun = () => {
  const context: WorkflowContext = { data: {}, cancelled: false }
  const step: WorkflowStep = { id: 'directory', name: '', description: '', status: 'running', logs: [] }
  const callbacks = { log: vi.fn(), setProgress: vi.fn(), appendText: vi.fn() }
  const workflow = createDirectoryWorkflow()
  return { context, callbacks, execute: (index: number, definition = workflow, data = context) => definition.steps[index].executor(step, data, callbacks) }
}

beforeEach(() => {
  h.project.projectSession = 1
  h.refresh.mockReset().mockResolvedValue(undefined)
  h.llm.mockReset().mockResolvedValue(modelOutput([1, 2, 3]))
  h.invoke.mockReset().mockImplementation(async (channel: string) => {
    if (channel === 'db:project-core-get') return { premise: 'P'.repeat(60) }
    if (channel === 'db:blueprint-directory-snapshot') return { snapshot, existingBlueprints: [] }
    if (channel === 'db:blueprint-write-scope') return scope
    if (channel === 'db:blueprint-directory-commit') return result
    throw new Error(`Unexpected IPC: ${channel}`)
  })
})

it('stages output until the final step, then commits once and refreshes', async () => {
  const run = makeRun()
  await run.execute(0)
  await run.execute(1)
  expect(h.invoke.mock.calls.map(([channel]) => channel)).toEqual([
    'db:blueprint-write-scope', 'db:project-core-get', 'db:blueprint-directory-snapshot', 'db:blueprint-write-scope',
  ])
  expect(h.refresh).not.toHaveBeenCalled()
  expect(h.llm.mock.calls[0][4]).toBe(run.context)

  await run.execute(2)
  expect(h.invoke).toHaveBeenLastCalledWith('db:blueprint-directory-commit', {
    snapshot,
    items: [1, 2, 3].map(chapterNumber => expect.objectContaining({ chapterNumber })),
  })
  expect(h.refresh).toHaveBeenCalledTimes(1)
})

it.each(['cancel', 'reopen'])('drops late model output after %s', async action => {
  const run = makeRun()
  await run.execute(0)
  h.llm.mockImplementationOnce(async () => {
    if (action === 'cancel') run.context.cancelled = true
    else h.project.projectSession++
    return modelOutput([1, 2, 3])
  })
  await expect(run.execute(1)).rejects.toThrow()
  expect(run.context.data.newBlueprints).toBeUndefined()
  expect(h.invoke.mock.calls.some(([channel]) => channel === 'db:blueprint-directory-commit')).toBe(false)
})

it('does not capture a snapshot after a switch during architecture read', async () => {
  const run = makeRun()
  h.invoke.mockResolvedValueOnce(scope).mockImplementationOnce(async () => {
    h.project.projectSession++
    return { premise: 'P'.repeat(60) }
  })
  await expect(run.execute(0)).rejects.toThrow()
  expect(h.invoke.mock.calls).toEqual([['db:blueprint-write-scope'], ['db:project-core-get']])
})

it('resumes only with the original connection snapshot', async () => {
  const run = makeRun()
  await run.execute(0)
  const restored = createDirectoryWorkflow()
  const checkpoint = structuredClone(run.context)
  await run.execute(1, restored, checkpoint)
  expect(checkpoint.data.newBlueprints).toHaveLength(3)
  h.invoke.mockResolvedValueOnce({ ...scope, token: 'reopened' })
  await expect(run.execute(1, restored, checkpoint)).rejects.toThrow(t('error.directorySnapshotExpired'))
  await expect(run.execute(2, restored, { ...checkpoint, data: {} })).rejects.toThrow(t('error.directorySnapshotExpired'))
})

it('blocks a cancelled save and propagates a rejected commit without refreshing', async () => {
  const run = makeRun()
  await run.execute(0)
  await run.execute(1)
  run.context.cancelled = true
  await expect(run.execute(2)).rejects.toThrow(t('error.workflowCancelled'))
  run.context.cancelled = false
  h.invoke.mockResolvedValueOnce({ success: false, reason: 'conflict', error: 'changed' })
  await expect(run.execute(2)).rejects.toThrow('changed')
  expect(h.refresh).not.toHaveBeenCalled()
})

it('a refresh failure does not turn a committed write into a failed save', async () => {
  const run = makeRun()
  await run.execute(0)
  await run.execute(1)
  h.refresh.mockRejectedValueOnce(new Error('refresh failed'))
  await expect(run.execute(2)).resolves.toBe(t('workflow.dirSaved'))
  expect(run.callbacks.log).toHaveBeenCalledWith(expect.stringContaining('refresh failed'))
})

it('does not refresh a replacement project when commit response arrives', async () => {
  const run = makeRun()
  await run.execute(0)
  await run.execute(1)
  h.invoke.mockImplementationOnce(async () => {
    h.project.projectSession++
    return result
  })
  await expect(run.execute(2)).resolves.toBe(t('workflow.dirSaved'))
  expect(h.refresh).not.toHaveBeenCalled()
})

it('a default append beyond the planned total skips generation and commit', async () => {
  const run = makeRun()
  const workflow = createDirectoryWorkflow({ mode: 'append' })
  h.invoke.mockResolvedValueOnce(scope).mockResolvedValueOnce({ premise: 'P'.repeat(60) })
    .mockResolvedValueOnce({ snapshot: { ...snapshot, range: null }, existingBlueprints: [] })
  for (let index = 0; index < 3; index++) await run.execute(index, workflow)
  expect(h.llm).not.toHaveBeenCalled()
  expect(h.invoke.mock.calls.some(([channel]) => channel === 'db:blueprint-directory-commit')).toBe(false)
  expect(h.refresh).not.toHaveBeenCalled()
})

it('rejects a same-path database reopening between architecture and blueprint reads', async () => {
  const run = makeRun()
  h.invoke.mockImplementation(async (channel: string) => {
    if (channel === 'db:blueprint-write-scope') return scope
    if (channel === 'db:project-core-get') return { premise: 'P'.repeat(60) }
    if (channel === 'db:blueprint-directory-snapshot') {
      return { snapshot: { ...snapshot, scope: { ...scope, token: 'reopened' } }, existingBlueprints: [] }
    }
  })
  await expect(run.execute(0)).rejects.toThrow(t('error.directorySnapshotExpired'))
  expect(run.context.data).toEqual({})
})

it('keeps the requested start and count for explicit range generation', async () => {
  const run = makeRun()
  const workflow = createDirectoryWorkflow({ mode: 'append', startChapter: 2, count: 1 })
  await run.execute(0, workflow)
  expect(h.invoke).toHaveBeenCalledWith('db:blueprint-directory-snapshot', expect.objectContaining({ mode: 'append', startChapter: 2, count: 1 }))
})

it('passes the total shown by the full-book dialog even if the store changes before the workflow starts', async () => {
  const run = makeRun()
  const workflow = createDirectoryWorkflow({ mode: 'full', expectedTotalChapters: 100 })
  await run.execute(0, workflow)
  expect(h.invoke).toHaveBeenCalledWith('db:blueprint-directory-snapshot', expect.objectContaining({ expectedTotalChapters: 100 }))
})

it('does not treat a partial write receipt as a successful commit', async () => {
  const run = makeRun()
  await run.execute(0)
  await run.execute(1)
  h.invoke.mockResolvedValueOnce({ ...result, writtenChapterNumbers: [1, 2] })
  await expect(run.execute(2)).rejects.toThrow()
  expect(h.refresh).not.toHaveBeenCalled()
})

it.each([false, true])('keeps an in-flight commit authoritative when cancelling (all=%s)', async cancelAll => {
  const completed = vi.fn()
  const off = globalEventBus.on('WORKFLOW_COMPLETE', completed)
  let signalCommit!: () => void
  let finishCommit!: (value: typeof result) => void
  const committing = new Promise<void>(resolve => { signalCommit = resolve })
  const pendingResult = new Promise<typeof result>(resolve => { finishCommit = resolve })
  const invoke = h.invoke.getMockImplementation()!
  h.invoke.mockImplementation(async (channel: string) => {
    if (channel !== 'db:blueprint-directory-commit') return invoke(channel)
    signalCommit()
    return pendingResult
  })
  const { startWorkflow, cancelWorkflow } = useWorkflowStore.getState()
  let runId = ''
  const running = startWorkflow(createDirectoryWorkflow(), false, { headless: true, onStarted: id => { runId = id } })
  try {
    await committing
    cancelWorkflow(cancelAll ? undefined : runId)
    expect(useWorkflowStore.getState().activeRuns.some(run => run.id === runId)).toBe(true)
    finishCommit(result)
    await running
    expect(useWorkflowStore.getState().history.find(run => run.id === runId)?.status).toBe('completed')
    await vi.waitFor(() => expect(completed).toHaveBeenCalledWith({ type: 'directory', runId, status: 'success' }))
    expect(h.refresh).toHaveBeenCalledTimes(1)
  } finally {
    finishCommit(result)
    await running
    off()
  }
})
