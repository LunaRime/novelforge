import { describe, expect, it, vi } from 'vitest'
import * as application from './architecture-overview'
import { ArchitectureRequestCancelled } from './architecture-document'
import type { ArchitectureOverviewPorts } from '../ports/architecture-overview'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
function fixture() {
  const scope = { id: 'a', path: '/a', session: 1 }
  const fields = { premise: { status: 'ready', content: 'p'.repeat(51) }, characters: { status: 'ready', content: 'c'.repeat(50) }, worldbuilding: { status: 'ready', content: '待生成' + 'w'.repeat(60) }, synopsis: { status: 'missing' } } as const
  const ports: ArchitectureOverviewPorts = {
    scope: () => scope,
    readFields: vi.fn(async () => fields),
    readPostProcess: vi.fn(async () => false),
  }
  return { scope, ports, fields, app: application.createArchitectureOverviewApplication(ports, scope) }
}
describe('architecture overview application', () => {
  it('projects generated status and legacy word counts per field', async () => {
    const f = fixture()
    expect((await f.app.load()).fields).toEqual({ premise: { status: 'ready', generated: true, wordCount: 51 }, characters: { status: 'ready', generated: false, wordCount: 0 }, worldbuilding: { status: 'ready', generated: false, wordCount: 0 }, synopsis: { status: 'missing' } })
  })
  it('keeps field failures and postprocessing failures separate', async () => {
    const f = fixture()
    vi.mocked(f.ports.readFields).mockResolvedValue({ ...f.fields, characters: { status: 'failed', error: 'malformed' } })
    vi.mocked(f.ports.readPostProcess).mockRejectedValue(new Error('post failed'))
    const result = await f.app.load()
    expect(result.fields.characters).toEqual({ status: 'failed', error: 'malformed' })
    expect(result.fields.premise.status).toBe('ready')
    expect(result.postProcess).toEqual({ status: 'failed', error: 'post failed' })
  })
  it.each(['resolve', 'reject'] as const)('cancels obsolete %s without reading postprocessing', async kind => {
    const f = fixture(), old = deferred<typeof f.fields>()
    vi.mocked(f.ports.readFields).mockReturnValueOnce(old.promise)
    const pending = f.app.load()
    await f.app.load()
    if (kind === 'resolve') old.resolve(f.fields)
    else old.reject(new Error('old error'))
    await expect(pending).rejects.toBeInstanceOf(ArchitectureRequestCancelled)
    expect(f.ports.readPostProcess).toHaveBeenCalledTimes(1)
  })
  it.each(['id', 'path', 'session', 'dispose'] as const)('cancels %s changes while IO is pending', async change => {
    const f = fixture(), old = deferred<typeof f.fields>()
    vi.mocked(f.ports.readFields).mockReturnValueOnce(old.promise)
    const pending = f.app.load()
    if (change === 'dispose') f.app.dispose()
    else if (change === 'session') f.scope.session++
    else f.scope[change] += '-new'
    old.resolve(f.fields)
    await expect(pending).rejects.toBeInstanceOf(ArchitectureRequestCancelled)
    expect(f.ports.readPostProcess).not.toHaveBeenCalled()
  })
  it('represents thrown core reads as failed fields and still reads postprocessing', async () => {
    const f = fixture()
    vi.mocked(f.ports.readFields).mockRejectedValue(new Error('core failed'))
    vi.mocked(f.ports.readPostProcess).mockResolvedValue(null)
    const result = await f.app.load()
    expect(Object.values(result.fields)).toEqual(Array(4).fill({ status: 'failed', error: 'core failed' }))
    expect(result.postProcess).toEqual({ status: 'ready', allCriticalPassed: null })
  })
  it.each(['resolve', 'reject'] as const)('cancels late postprocessing %s after a newer load', async kind => {
    const f = fixture(), post = deferred<boolean | null>()
    vi.mocked(f.ports.readPostProcess).mockReturnValueOnce(post.promise)
    const pending = f.app.load()
    await Promise.resolve()
    await f.app.load()
    if (kind === 'resolve') post.resolve(false)
    else post.reject(new Error('old post failure'))
    await expect(pending).rejects.toBeInstanceOf(ArchitectureRequestCancelled)
  })
})
