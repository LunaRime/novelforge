import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeRequestCancelled } from '../../core'
import { createRendererKnowledgeMaintenanceApplication } from './knowledge-maintenance-adapter'

const { invoke, state } = vi.hoisted(() => ({
  invoke: vi.fn(),
  state: { currentProject: { id: 'a', path: '/a' } as { id: string; path: string } | null, projectSession: 1 },
}))
vi.mock('../ipc-client', () => ({ ipc: { invoke } }))
vi.mock('../../stores/project-store', () => ({ useProjectStore: { getState: () => state } }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  vi.resetAllMocks()
  state.currentProject = { id: 'a', path: '/a' }
  state.projectSession = 1
})

describe('knowledge maintenance renderer adapter', () => {
  it.each(['vectors', 'tokens'] as const)('routes %s maintenance and unwraps the refreshed count', async kind => {
    const result = { success: true, processed: 3, failed: 2, error: 'two rows skipped' }
    invoke.mockResolvedValueOnce(result).mockResolvedValueOnce({ count: 2 })
    await expect(createRendererKnowledgeMaintenanceApplication().run(kind)).resolves.toEqual({ result, vectorlessCount: 2 })
    expect(invoke.mock.calls).toEqual([[`kb:backfill-${kind}`], ['kb:get-vectorless-count']])
  })

  it('preserves the dimension failure and never retries through token maintenance', async () => {
    const result = { success: false, processed: 1, failed: 4, error: 'rebuild required', errorCode: 'dim-mismatch' }
    invoke.mockResolvedValue(result)
    await expect(createRendererKnowledgeMaintenanceApplication().run('vectors')).resolves.toEqual({ result })
    expect(invoke.mock.calls).toEqual([['kb:backfill-vectors']])
  })

  it('rejects an explicitly stale source before dispatch', async () => {
    const app = createRendererKnowledgeMaintenanceApplication({ id: 'a', path: '/a', session: 0 })
    await expect(app.count()).rejects.toBeInstanceOf(KnowledgeRequestCancelled)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not refresh a reopened project after delayed maintenance', async () => {
    const pending = deferred<{ success: boolean; processed: number; failed: number }>()
    invoke.mockReturnValue(pending.promise)
    const run = createRendererKnowledgeMaintenanceApplication().run('tokens')
    const assertion = expect(run).rejects.toBeInstanceOf(KnowledgeRequestCancelled)
    state.projectSession++
    pending.resolve({ success: true, processed: 1, failed: 0 })
    await assertion
    expect(invoke.mock.calls).toEqual([['kb:backfill-tokens']])
  })

  it('rejects a late count after switching project and unwraps the current project count', async () => {
    const pending = deferred<{ count: number }>()
    invoke.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ count: 9 })
    const count = createRendererKnowledgeMaintenanceApplication().count()
    const assertion = expect(count).rejects.toBeInstanceOf(KnowledgeRequestCancelled)
    state.currentProject = { id: 'b', path: '/b' }
    state.projectSession++
    await expect(createRendererKnowledgeMaintenanceApplication().count()).resolves.toBe(9)
    pending.resolve({ count: 1 })
    await assertion
  })
})
