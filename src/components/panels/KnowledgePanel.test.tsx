// @vitest-environment jsdom
import { StrictMode, act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { createKnowledgeApplication, type KnowledgePorts, type KnowledgeDocument } from '../../core'
import KnowledgePanel from './KnowledgePanel'
import { globalEventBus } from '../../shared/event-bus'

const h = vi.hoisted(() => ({ factory: vi.fn(), confirm: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(),
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
  it('routes semantic search to the editor while leaving the document list available', async () => {
    const openSearch = vi.fn()
    const unsub = globalEventBus.on('OPEN_KNOWLEDGE_SEARCH', openSearch)
    try {
      await mount(); await click('knowledge.semanticSearch')
      expect(openSearch).toHaveBeenCalledOnce()
      expect(host.querySelector('input')).toBeNull()
      expect(host.querySelector('[title="chapter_1.md"]')).not.toBeNull()
      expect(ports.search).not.toHaveBeenCalled()
    } finally { unsub() }
  })
  it('publishes the project session only after document deletion commits', async () => {
    const removed = vi.fn()
    const unsub = globalEventBus.on('KNOWLEDGE_DOCUMENT_REMOVED', removed)
    const pending = deferred<void>()
    vi.mocked(ports.remove).mockReturnValueOnce(pending.promise)
    try {
      await mount(); await click('action.delete')
      expect(removed).not.toHaveBeenCalled()
      vi.mocked(ports.load).mockResolvedValue({ documents: [], stats: { documentCount: 0, totalChunks: 0, vectorDimension: 0 } })
      await flush(() => pending.resolve())
      expect(removed).toHaveBeenCalledWith({ projectSession: 1 })
      expect(host.querySelector('[title="chapter_1.md"]')).toBeNull()
    } finally { unsub() }
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
