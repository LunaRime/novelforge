import { describe, it, expect, vi } from 'vitest'
import { createKnowledgeApplication, KnowledgeRequestCancelled } from './knowledge'
import type { KnowledgePorts } from '../ports/knowledge'
const doc = { id: '1', filePath: 'a.md', fileName: 'a.md', chunkCount: 1, importedAt: '' }
const data = { documents: [doc], stats: { documentCount: 1, totalChunks: 1, vectorDimension: 0 } }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((a,b) => { resolve=a; reject=b }); return { promise, resolve, reject } }
function fixture() {
  const scope = { id: 'a', path: '/a', session: 1 }
  const ports: KnowledgePorts = { scope: () => scope, load: vi.fn(async () => data), search: vi.fn(async () => []),
    read: vi.fn(async () => 'content'), generate: vi.fn(async () => 'summary'), remove: vi.fn(async () => {}) }
  return { scope, ports, app: createKnowledgeApplication(ports) }
}
describe('knowledge application', () => {
  it('makes the latest search authoritative even when older results arrive last', async () => {
    const f=fixture(); const old=deferred<[]>(); vi.mocked(f.ports.search).mockReturnValueOnce(old.promise)
    const a=f.app.search('a'); await expect(f.app.search('b')).resolves.toEqual([])
    old.resolve([]); await expect(a).rejects.toBeInstanceOf(KnowledgeRequestCancelled)
  })
  it('clear cancels both late success and late errors', async () => {
    const f=fixture(); const old=deferred<[]>(); vi.mocked(f.ports.search).mockReturnValueOnce(old.promise)
    const a=f.app.search('a'); f.app.cancelSearch(); old.reject(new Error('old error'))
    await expect(a).rejects.toBeInstanceOf(KnowledgeRequestCancelled)
  })
  it('copies source scope and rejects same-path reopen without any IO', async () => {
    const f=fixture(); f.scope.session++
    await expect(f.app.load()).rejects.toBeInstanceOf(KnowledgeRequestCancelled)
    expect(f.ports.load).not.toHaveBeenCalled()
  })
  it('closing summary while reading prevents model dispatch', async () => {
    const f=fixture(); const read=deferred<string>(); vi.mocked(f.ports.read).mockReturnValue(read.promise)
    const pending=f.app.summarize(doc,'prompt'); f.app.cancelSummary(); read.resolve('content')
    await expect(pending).rejects.toBeInstanceOf(KnowledgeRequestCancelled); expect(f.ports.generate).not.toHaveBeenCalled()
  })
  it('does not confuse failed reads with legitimate empty content', async () => {
    const f=fixture(); vi.mocked(f.ports.read).mockRejectedValueOnce(new Error('disk failed'))
    await expect(f.app.summarize(doc,'prompt')).rejects.toThrow('disk failed')
    vi.mocked(f.ports.read).mockResolvedValueOnce(' ')
    await expect(f.app.summarize(doc,'prompt')).resolves.toEqual({status:'empty'})
    expect(f.ports.generate).not.toHaveBeenCalled()
  })
  it('retains prompt and 30k content limit and propagates model failure', async () => {
    const f=fixture(); vi.mocked(f.ports.read).mockResolvedValue('a'.repeat(40_000))
    vi.mocked(f.ports.generate).mockRejectedValueOnce(new Error('model failed'))
    await expect(f.app.summarize(doc,'localized prompt')).rejects.toThrow('model failed')
    expect(f.ports.generate).toHaveBeenCalledWith('a'.repeat(30_000),'localized prompt')
  })
  it('delete failure never claims success or reloads', async () => {
    const f=fixture(); vi.mocked(f.ports.remove).mockRejectedValue(new Error('remove failed'))
    await expect(f.app.remove(doc)).rejects.toThrow('remove failed'); expect(f.ports.load).not.toHaveBeenCalled()
  })
  it('delete commit remains success after reload fails', async () => {
    const f=fixture(); vi.mocked(f.ports.load).mockRejectedValue(new Error('reload failed'))
    await expect(f.app.remove(doc)).resolves.toMatchObject({success:true,refreshError:'Error: reload failed'})
  })
  it('delete cancels pre-existing search/load/summary publication', async () => {
    const f=fixture(); const old=deferred<[]>(); vi.mocked(f.ports.search).mockReturnValue(old.promise)
    const pending=f.app.search('a'); await f.app.remove(doc); old.resolve([])
    await expect(pending).rejects.toBeInstanceOf(KnowledgeRequestCancelled)
  })
  it('disposed application rejects further work before IO', async () => {
    const f=fixture(); f.app.dispose(); await expect(f.app.load()).rejects.toBeInstanceOf(KnowledgeRequestCancelled)
    expect(f.ports.load).not.toHaveBeenCalled()
  })
})
