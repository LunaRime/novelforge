import { describe, expect, it, vi } from 'vitest'
import { ArchitectureDocumentBusy, ArchitectureRequestCancelled, createArchitectureDocumentApplication } from './architecture-document'
import type { ArchitectureDocumentPorts } from '../ports/architecture-document'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
function fixture() {
  const scope = { id: 'a', path: '/a', session: 1 }
  const ports: ArchitectureDocumentPorts = {
    scope: () => scope,
    read: vi.fn(async () => 'body'),
    write: vi.fn(async () => true),
    readArchitecture: vi.fn(async () => ({ premise: '', characters: 'x'.repeat(50), worldbuilding: '', synopsis: '' })),
    existingCharacterCount: vi.fn(async () => 2),
    startWorkflow: vi.fn(async () => ({ runId: 'run-1', displayName: 'Architecture', chapterTag: '' })),
  }
  return { scope, ports, app: createArchitectureDocumentApplication(ports, 'vela://core/premise') }
}
describe('architecture document application', () => {
  it('distinguishes missing, empty and failed reads', async () => {
    const f = fixture()
    vi.mocked(f.ports.read).mockResolvedValueOnce(null).mockResolvedValueOnce('').mockRejectedValueOnce(new Error('disk'))
    await expect(f.app.read()).resolves.toEqual({ status: 'missing' })
    await expect(f.app.read()).resolves.toEqual({ status: 'ready', content: '' })
    await expect(f.app.read()).rejects.toThrow('disk')
  })

  it('cancels older reads when a newer read finishes first', async () => {
    const f = fixture(), old = deferred<string>()
    vi.mocked(f.ports.read).mockReturnValueOnce(old.promise)
    const pending = f.app.read()
    await f.app.status()
    await expect(f.app.read()).resolves.toEqual({ status: 'ready', content: 'body' })
    old.resolve('old')
    await expect(pending).rejects.toBeInstanceOf(ArchitectureRequestCancelled)
  })

  it('keeps status reads independent from document reads', async () => {
    const f = fixture(), read = deferred<string>()
    vi.mocked(f.ports.read).mockReturnValueOnce(read.promise)
    const pending = f.app.read()
    await f.app.status()
    read.resolve('current')
    await expect(pending).resolves.toEqual({ status: 'ready', content: 'current' })
  })

  it('copies scope and rejects same-path reopen before IO', async () => {
    const f = fixture()
    f.scope.session++
    await expect(f.app.read()).rejects.toBeInstanceOf(ArchitectureRequestCancelled)
    expect(f.ports.read).not.toHaveBeenCalled()
  })

  it('rejects false/throwing writes and releases its save mutex', async () => {
    const f = fixture()
    vi.mocked(f.ports.write).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('write failed'))
    await expect(f.app.save('a')).rejects.toThrow()
    await expect(f.app.save('b')).rejects.toThrow('write failed')
    await expect(f.app.save('c')).resolves.toBeUndefined()
  })

  it('prevents reentrant writes and cancels publication after dispose', async () => {
    const f = fixture(), write = deferred<boolean>()
    vi.mocked(f.ports.write).mockReturnValue(write.promise)
    const pending = f.app.save('a')
    await expect(f.app.save('b')).rejects.toBeInstanceOf(ArchitectureDocumentBusy)
    expect(f.ports.write).toHaveBeenCalledTimes(1)
    f.app.dispose()
    write.resolve(true)
    await expect(pending).rejects.toBeInstanceOf(ArchitectureRequestCancelled)
    await expect(f.app.save('c')).rejects.toBeInstanceOf(ArchitectureRequestCancelled)
  })

  it('retains the exact status parser thresholds and placeholder rule', async () => {
    const f = fixture()
    vi.mocked(f.ports.readArchitecture).mockResolvedValue({ premise: 'p'.repeat(51), characters: 'c'.repeat(50), worldbuilding: '待生成' + 'w'.repeat(60), synopsis: '' })
    await expect(f.app.status()).resolves.toEqual({ premise: true, characters: false, worldbuilding: false, synopsis: false })
    await expect(f.app.existingCharacterCount()).resolves.toBe(2)
  })

  it('copies generation arguments and returns the workflow receipt', async () => {
    const f = fixture(), result = deferred<{
      runId: string
      displayName: string
      chapterTag: string
    }>()
    vi.mocked(f.ports.startWorkflow).mockReturnValue(result.promise)
    const steps: Array<'premise' | 'characters'> = ['premise']
    const guidance = { premise: 'original' }
    const pending = f.app.generate(steps, guidance)
    steps.push('characters')
    guidance.premise = 'changed'
    expect(f.ports.startWorkflow).toHaveBeenCalledWith({ workflow: 'generate_architecture', architecture: { selectedSteps: ['premise'], stepGuidance: { premise: 'original' } } })
    result.resolve({ runId: 'real-id', displayName: 'Arch', chapterTag: '' })
    await expect(pending).resolves.toEqual({ runId: 'real-id', displayName: 'Arch', chapterTag: '' })
  })

  it('does not start extraction after a failed or stale read', async () => {
    const f = fixture()
    vi.mocked(f.ports.readArchitecture).mockRejectedValueOnce(new Error('read failed'))
    await expect(f.app.extract('fantasy')).rejects.toThrow('read failed')
    const read = deferred<{
      premise: string
      characters: string
      worldbuilding: string
      synopsis: string
    }>()
    vi.mocked(f.ports.readArchitecture).mockReturnValue(read.promise)
    const pending = f.app.extract('fantasy')
    f.scope.session++
    read.resolve({ premise: '', characters: 'x'.repeat(80), worldbuilding: '', synopsis: '' })
    await expect(pending).rejects.toBeInstanceOf(ArchitectureRequestCancelled)
    expect(f.ports.startWorkflow).not.toHaveBeenCalled()
  })

  it('starts extraction at length 50 and propagates startup failures', async () => {
    const f = fixture()
    await expect(f.app.extract('fantasy')).resolves.toEqual({ status: 'started', runId: 'run-1' })
    expect(f.ports.startWorkflow).toHaveBeenCalledWith({ workflow: 'extract_arch_characters', projectPath: '/a', characterDynamicsContent: 'x'.repeat(50), genre: 'fantasy' })
    vi.mocked(f.ports.startWorkflow).mockRejectedValueOnce(new Error('start failed'))
    await expect(f.app.generate(['premise'], {})).rejects.toThrow('start failed')
    vi.mocked(f.ports.readArchitecture).mockResolvedValue({ premise: '', characters: 'x'.repeat(49), worldbuilding: '', synopsis: '' })
    await expect(f.app.extract('fantasy')).resolves.toEqual({ status: 'empty' })
  })

  it('cancels a late workflow receipt after the source session changes', async () => {
    const f = fixture(), receipt = deferred<{
      runId: string
      displayName: string
      chapterTag: string
    }>()
    vi.mocked(f.ports.startWorkflow).mockReturnValue(receipt.promise)
    const pending = f.app.generate(['premise'], {})
    f.scope.session++
    receipt.resolve({ runId: 'old-run', displayName: 'Arch', chapterTag: '' })
    await expect(pending).rejects.toBeInstanceOf(ArchitectureRequestCancelled)
  })

  it('rejects all further IO after disposal', async () => {
    const f = fixture()
    f.app.dispose()
    await expect(f.app.read()).rejects.toBeInstanceOf(ArchitectureRequestCancelled)
    await expect(f.app.status()).rejects.toBeInstanceOf(ArchitectureRequestCancelled)
    await expect(f.app.existingCharacterCount()).rejects.toBeInstanceOf(ArchitectureRequestCancelled)
    await expect(f.app.generate(['premise'], {})).rejects.toBeInstanceOf(ArchitectureRequestCancelled)
    await expect(f.app.extract('fantasy')).rejects.toBeInstanceOf(ArchitectureRequestCancelled)
    expect(f.ports.read).not.toHaveBeenCalled()
    expect(f.ports.readArchitecture).not.toHaveBeenCalled()
    expect(f.ports.existingCharacterCount).not.toHaveBeenCalled()
    expect(f.ports.startWorkflow).not.toHaveBeenCalled()
  })

  it('only publishes latest status and converts stale errors into cancellation', async () => {
    const f = fixture(), read = deferred<never>()
    vi.mocked(f.ports.readArchitecture).mockReturnValueOnce(read.promise)
    const pending = f.app.status()
    await f.app.status()
    read.reject(new Error('old'))
    await expect(pending).rejects.toBeInstanceOf(ArchitectureRequestCancelled)
  })
})
describe('architecture workflow source ownership', () => {
  it('queries the captured source while rejecting stale sessions before attribution', () => {
    const f = fixture()
    const ownsRun = vi.fn((_id: string, source: {
      id: string
      path: string
      session: number
    }) => source.session === 1)
    const app = createArchitectureDocumentApplication({ ...f.ports, ownsRun }, 'vela://core/premise')
    expect(app.ownsRun('external-generation')).toBe(true)
    expect(ownsRun).toHaveBeenCalledWith('external-generation', { id: 'a', path: '/a', session: 1 })
    f.scope.session++
    expect(() => app.ownsRun('external-generation')).toThrow(ArchitectureRequestCancelled)
    expect(ownsRun).toHaveBeenCalledTimes(1)
  })

  it('does not attribute unknown runs when no ownership port is configured', () => {
    expect(fixture().app.ownsRun('unknown')).toBe(false)
  })
})
