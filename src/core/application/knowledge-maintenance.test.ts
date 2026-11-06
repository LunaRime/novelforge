import { describe, expect, it, vi } from 'vitest'
import { createKnowledgeMaintenanceApplication, KnowledgeMaintenanceBusy } from './knowledge-maintenance'
import { KnowledgeRequestCancelled } from './knowledge'
import type { KnowledgeMaintenancePorts, MaintenanceResult } from '../ports/knowledge-maintenance'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
const success: MaintenanceResult = { success: true, processed: 3, failed: 0 }
function fixture() {
  const scope = { id: 'a', path: '/a', session: 1 }
  const ports: KnowledgeMaintenancePorts = {
    scope: () => scope,
    vectorlessCount: vi.fn(async () => 4),
    backfill: vi.fn(async () => ({ ...success })),
  }
  return { scope, ports, app: createKnowledgeMaintenanceApplication(ports, scope) }
}

describe('knowledge maintenance application', () => {
  it.each(['id', 'path', 'session'] as const)('captures source %s by value before any IO', async key => {
    const f = fixture()
    if (key === 'session') f.scope.session++
    else f.scope[key] += '-changed'
    await expect(f.app.count()).rejects.toBeInstanceOf(KnowledgeRequestCancelled)
    await expect(f.app.run('vectors')).rejects.toBeInstanceOf(KnowledgeRequestCancelled)
    expect(f.ports.vectorlessCount).not.toHaveBeenCalled()
    expect(f.ports.backfill).not.toHaveBeenCalled()
  })

  it.each(['resolve', 'reject'] as const)('cancels an older count %s after a newer count', async settle => {
    const f = fixture(); const old = deferred<number>()
    vi.mocked(f.ports.vectorlessCount).mockReturnValueOnce(old.promise)
    const pending = f.app.count()
    await expect(f.app.count()).resolves.toBe(4)
    if (settle === 'resolve') old.resolve(99)
    else old.reject(new Error('old failure'))
    await expect(pending).rejects.toBeInstanceOf(KnowledgeRequestCancelled)
  })

  it('claims busy synchronously before dispatch and releases after completion', async () => {
    const f = fixture(); const write = deferred<MaintenanceResult>()
    vi.mocked(f.ports.backfill).mockReturnValueOnce(write.promise)
    const pending = f.app.run('vectors')
    await expect(f.app.run('tokens')).rejects.toBeInstanceOf(KnowledgeMaintenanceBusy)
    expect(f.ports.backfill).toHaveBeenCalledTimes(1)
    write.resolve(success)
    await expect(pending).resolves.toEqual({ result: success, vectorlessCount: 4 })
    await expect(f.app.run('tokens')).resolves.toEqual({ result: success, vectorlessCount: 4 })
    expect(f.ports.backfill).toHaveBeenLastCalledWith('tokens')
  })

  it('releases busy after transport exceptions and keeps failed transport distinct', async () => {
    const f = fixture()
    vi.mocked(f.ports.backfill).mockRejectedValueOnce(new Error('transport failed'))
    await expect(f.app.run('vectors')).rejects.toThrow('transport failed')
    expect(f.ports.vectorlessCount).not.toHaveBeenCalled()
    await expect(f.app.run('tokens')).resolves.toEqual({ result: success, vectorlessCount: 4 })
  })

  it.each([
    { success: true, processed: 2, failed: 1, error: 'one failed' },
    { success: false, processed: 2, failed: 1, error: 'partial failure' },
    { success: false, processed: 0, failed: 3, error: 'dimensions', errorCode: 'dim-mismatch' },
  ] satisfies MaintenanceResult[])('preserves backfill result without retries: %j', async result => {
    const f = fixture(); vi.mocked(f.ports.backfill).mockResolvedValue(result)
    await expect(f.app.run('vectors')).resolves.toEqual(result.success ? { result, vectorlessCount: 4 } : { result })
    expect(f.ports.backfill).toHaveBeenCalledExactlyOnceWith('vectors')
    expect(f.ports.vectorlessCount).toHaveBeenCalledTimes(result.success ? 1 : 0)
  })

  it('reports refresh failure separately from a committed maintenance result', async () => {
    const f = fixture(); vi.mocked(f.ports.vectorlessCount).mockRejectedValueOnce(new Error('stats failed'))
    await expect(f.app.run('vectors')).resolves.toEqual({ result: success, refreshError: 'Error: stats failed' })
    await expect(f.app.run('tokens')).resolves.toEqual({ result: success, vectorlessCount: 4 })
  })

  it.each(['resolve', 'reject'] as const)('stops stale maintenance %s before any statistics IO', async settle => {
    const f = fixture(); const write = deferred<MaintenanceResult>()
    vi.mocked(f.ports.backfill).mockReturnValueOnce(write.promise)
    const pending = f.app.run('vectors'); f.scope.session++
    if (settle === 'resolve') write.resolve(success)
    else write.reject(new Error('old failure'))
    await expect(pending).rejects.toBeInstanceOf(KnowledgeRequestCancelled)
    expect(f.ports.vectorlessCount).not.toHaveBeenCalled()
  })

  it('maintenance refresh supersedes an earlier explicit count', async () => {
    const f = fixture(); const old = deferred<number>()
    vi.mocked(f.ports.vectorlessCount).mockReturnValueOnce(old.promise)
    const pending = f.app.count()
    await expect(f.app.run('vectors')).resolves.toEqual({ result: success, vectorlessCount: 4 })
    old.resolve(99)
    await expect(pending).rejects.toBeInstanceOf(KnowledgeRequestCancelled)
  })

  it('explicit count supersedes maintenance statistics while preserving the committed result', async () => {
    const f = fixture(); const refresh = deferred<number>(); const started = deferred<void>()
    vi.mocked(f.ports.vectorlessCount).mockImplementationOnce(() => { started.resolve(); return refresh.promise })
    const pending = f.app.run('vectors'); await started.promise
    await expect(f.app.count()).resolves.toBe(4)
    refresh.resolve(99)
    await expect(pending).resolves.toEqual({ result: success })
    await expect(f.app.run('tokens')).resolves.toEqual({ result: success, vectorlessCount: 4 })
  })

  it('preserves the committed result when the newer statistics request is still pending', async () => {
    const f = fixture(); const refresh = deferred<number>(); const newer = deferred<number>(); const started = deferred<void>()
    vi.mocked(f.ports.vectorlessCount)
      .mockImplementationOnce(() => { started.resolve(); return refresh.promise })
      .mockReturnValueOnce(newer.promise)
    const pending = f.app.run('vectors'); await started.promise
    const count = f.app.count()
    refresh.reject(new Error('obsolete statistics failed'))
    await expect(pending).resolves.toEqual({ result: success })
    newer.resolve(2)
    await expect(count).resolves.toBe(2)
  })

  it('keeps maintenance busy through statistics refresh', async () => {
    const f = fixture(); const refresh = deferred<number>(); const started = deferred<void>()
    vi.mocked(f.ports.vectorlessCount).mockImplementationOnce(() => { started.resolve(); return refresh.promise })
    const pending = f.app.run('vectors'); await started.promise
    await expect(f.app.run('tokens')).rejects.toBeInstanceOf(KnowledgeMaintenanceBusy)
    refresh.resolve(0)
    await expect(pending).resolves.toEqual({ result: success, vectorlessCount: 0 })
  })

  it('does not turn a project change during refresh into a refresh error receipt', async () => {
    const f = fixture(); const refresh = deferred<number>(); const started = deferred<void>()
    vi.mocked(f.ports.vectorlessCount).mockImplementationOnce(() => { started.resolve(); return refresh.promise })
    const pending = f.app.run('vectors'); await started.promise
    f.scope.session++; refresh.reject(new Error('stats failed'))
    await expect(pending).rejects.toBeInstanceOf(KnowledgeRequestCancelled)
  })

  it('dispose cancels pending work and permanently prevents new IO', async () => {
    const f = fixture(); const write = deferred<MaintenanceResult>(); const count = deferred<number>()
    vi.mocked(f.ports.backfill).mockReturnValueOnce(write.promise)
    vi.mocked(f.ports.vectorlessCount).mockReturnValueOnce(count.promise)
    const pendingWrite = f.app.run('vectors'); const pendingCount = f.app.count()
    f.app.dispose(); write.resolve(success); count.resolve(1)
    await expect(pendingWrite).rejects.toBeInstanceOf(KnowledgeRequestCancelled)
    await expect(pendingCount).rejects.toBeInstanceOf(KnowledgeRequestCancelled)
    await expect(f.app.run('tokens')).rejects.toBeInstanceOf(KnowledgeRequestCancelled)
    await expect(f.app.count()).rejects.toBeInstanceOf(KnowledgeRequestCancelled)
    expect(f.ports.backfill).toHaveBeenCalledTimes(1)
    expect(f.ports.vectorlessCount).toHaveBeenCalledTimes(1)
  })

  it('does not share the mutex across independent instances', async () => {
    const f = fixture(); const write = deferred<MaintenanceResult>()
    vi.mocked(f.ports.backfill).mockReturnValueOnce(write.promise)
    const pending = f.app.run('vectors')
    const other = fixture()
    await expect(other.app.run('tokens')).resolves.toEqual({ result: success, vectorlessCount: 4 })
    write.resolve(success); await pending
  })
})
