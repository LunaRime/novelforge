// @vitest-environment jsdom
import { StrictMode, act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { createKnowledgeApplication, type KnowledgePorts, type KnowledgeDocument } from '../../core'
import KnowledgePanel from './KnowledgePanel'

const h = vi.hoisted(() => ({ factory: vi.fn(), confirm: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(),
  input: {} as { onChange(e: { target: { value: string } }): void; onKeyDown(e: { key: string }): void },
  close: undefined as undefined | ((open: boolean) => void),
}))
vi.mock('../../services/knowledge/knowledge-adapter', () => ({ createRendererKnowledgeApplication: h.factory }))
vi.mock('../../stores/project-store', async () => {
  const { create: make } = await import('zustand')
  return { useProjectStore: make(() => ({ currentProject: { id: 'a', path: '/a' }, projectSession: 1 })) }
})
vi.mock('../../hooks/useTranslation', () => ({ useTranslation: () => ({ t: translate }) }))
vi.mock('../../services/render-logger', () => ({ renderLog: vi.fn() }))
vi.mock('../ui/Confirm', () => ({ confirm: h.confirm }))
vi.mock('../ui/Toast', () => ({ toast: { success: h.success, error: h.error, warning: h.warning } }))
vi.mock('../dialogs/ChapterExportDialog', () => ({ default: () => null }))
vi.mock('../ui/Input', () => ({ Input: (props: typeof h.input) => { h.input = props; return <input /> } }))
vi.mock('../ui/Dialog', () => ({
  Dialog: ({ open, onOpenChange, children }: { open: boolean; onOpenChange(v: boolean): void; children: ReactNode }) => {
    h.close = onOpenChange; return open ? <section data-summary>{children}</section> : null
  },
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
import { useProjectStore } from '../../stores/project-store'
const translate = (key: string) => key
const doc: KnowledgeDocument = { id: 'd', fileName: 'chapter_1.md', filePath: '/a/chapter_1.md', importedAt: '2026-01-01', chunkCount: 1 }
let ports: KnowledgePorts, root: Root, host: HTMLDivElement
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
async function flush(work: () => void = () => {}) { await act(async () => { work(); await Promise.resolve() }) }
async function mount(strict = false) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await flush(() => root.render(strict ? <StrictMode><KnowledgePanel /></StrictMode> : <KnowledgePanel />))
}
async function search(query: string) {
  await flush(() => h.input.onChange({ target: { value: query } }))
  await flush(() => h.input.onKeyDown({ key: 'Enter' }))
}
async function click(title: string) {
  const button = host.querySelector<HTMLButtonElement>(`button[title="${title}"]`)
  expect(button).not.toBeNull(); await flush(() => button!.click())
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks(); h.confirm.mockResolvedValue(true)
  useProjectStore.setState({ currentProject: { id: 'a', path: '/a' } as never, projectSession: 1 })
  ports = {
    scope: () => { const s = useProjectStore.getState(); return s.currentProject ? { id: s.currentProject.id, path: s.currentProject.path, session: s.projectSession } : null },
    load: vi.fn(async () => ({ documents: [doc], stats: { documentCount: 1, totalChunks: 1, vectorDimension: 0 } })),
    search: vi.fn(async () => []), read: vi.fn(async () => ''), generate: vi.fn(async () => 'summary'), remove: vi.fn(async () => {}),
  }
  h.factory.mockImplementation(source => createKnowledgeApplication(ports, source))
})
afterEach(async () => { if (root) await flush(() => root.unmount()); host?.remove() })
describe('KnowledgePanel application boundary', () => {
  it('clears search results completed while deletion was pending once it commits', async () => {
    const pending = deferred<void>(); vi.mocked(ports.remove).mockReturnValueOnce(pending.promise)
    vi.mocked(ports.search).mockResolvedValue([{ text: 'DELETED CONTENT', fileName: doc.fileName, score: 1 }])
    await mount(); await click('action.delete'); await search('during delete')
    expect(host.textContent).toContain('DELETED CONTENT')
    vi.mocked(ports.load).mockResolvedValue({ documents: [], stats: { documentCount: 0, totalChunks: 0, vectorDimension: 0 } })
    await flush(() => pending.resolve())
    expect(h.success).toHaveBeenCalledOnce()
    expect(host.textContent).not.toContain('DELETED CONTENT')
  })
  it('keeps only the latest search and ignores a late old rejection', async () => {
    const old = deferred<never>(); const latest = deferred<Awaited<ReturnType<KnowledgePorts['search']>>>()
    vi.mocked(ports.search).mockImplementationOnce(() => old.promise).mockImplementationOnce(() => latest.promise)
    await mount(true); await search('old'); await search('new')
    await flush(() => latest.resolve([{ text: 'LATEST', fileName: 'new', score: 1 }]))
    await flush(() => old.reject(new Error('late old failure')))
    expect(host.textContent).toContain('LATEST'); expect(h.error).not.toHaveBeenCalled()
  })
  it('clearing input invalidates a pending search', async () => {
    const pending = deferred<Awaited<ReturnType<KnowledgePorts['search']>>>()
    vi.mocked(ports.search).mockReturnValueOnce(pending.promise)
    await mount(); await search('pending'); await flush(() => h.input.onChange({ target: { value: '' } }))
    await flush(() => pending.resolve([{ text: 'OBSOLETE', fileName: 'old', score: 1 }]))
    expect(host.textContent).not.toContain('OBSOLETE')
  })
  it('same-path project reopen drops old search results', async () => {
    const pending = deferred<Awaited<ReturnType<KnowledgePorts['search']>>>()
    vi.mocked(ports.search).mockReturnValueOnce(pending.promise)
    await mount(); await search('pending')
    await flush(() => useProjectStore.setState({ projectSession: 2 }))
    await flush(() => pending.resolve([{ text: 'OLD SESSION', fileName: 'old', score: 1 }]))
    expect(host.textContent).not.toContain('OLD SESSION')
  })
  it('closing summary prevents late model output from reopening it', async () => {
    const pending = deferred<string>(); vi.mocked(ports.read).mockResolvedValue('body'); vi.mocked(ports.generate).mockReturnValueOnce(pending.promise)
    await mount(); await click('knowledge.summarize'); await flush(() => h.close!(false))
    await flush(() => pending.resolve('LATE SUMMARY'))
    expect(host.querySelector('[data-summary]')).toBeNull(); expect(host.textContent).not.toContain('LATE SUMMARY')
  })
  it('failed deletion preserves the document and reports failure', async () => {
    vi.mocked(ports.remove).mockRejectedValueOnce(new Error('failed'))
    await mount(); await click('action.delete')
    expect(host.querySelector(`[title="${doc.fileName}"]`)).not.toBeNull(); expect(h.error).toHaveBeenCalledOnce(); expect(h.success).not.toHaveBeenCalled()
  })
  it('confirmation cannot delete into a reopened project session', async () => {
    const pending = deferred<boolean>(); h.confirm.mockReturnValueOnce(pending.promise)
    await mount(); await click('action.delete'); await flush(() => useProjectStore.setState({ projectSession: 2 }))
    await flush(() => pending.resolve(true)); expect(ports.remove).not.toHaveBeenCalled()
  })
  it('committed deletion remains successful when reloading the list fails', async () => {
    await mount(); vi.mocked(ports.load).mockRejectedValueOnce(new Error('refresh failed'))
    await click('action.delete')
    expect(h.success).toHaveBeenCalledOnce(); expect(h.error).toHaveBeenCalledOnce(); expect(host.querySelector(`[title="${doc.fileName}"]`)).toBeNull()
  })
})
