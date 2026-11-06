// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import GenerateConfigDialog from './GenerateConfigDialog'
import { NovelConfigRequestCancelled } from '../../core'
import type { NovelConfig } from '../../shared/ipc-channels'

const h = vi.hoisted(() => ({ confirm: vi.fn(), generate: vi.fn(), start: vi.fn(), error: vi.fn(), closed: vi.fn(),
  prompt: {} as { onChange(e: { target: { value: string } }): void }, session: 1,
  config: { genre: '玄幻', subGenre: '', targetAudience: '男频', totalChapters: 100, wordsPerChapter: 3000, plotStructure: 'three_act', narrativePOV: 'third_limited', coreOutline: 'old', worldSetting: '', goldenFinger: '', protagonistProfile: '', globalGuidance: '' } as NovelConfig,
}))
vi.mock('../../hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../stores/project-store', () => ({ useProjectStore: (select: (s: unknown) => unknown) => select({ currentProject: { novelConfig: h.config }, updateNovelConfig: vi.fn() }) }))
vi.mock('../../stores/llm-store', () => ({ useLLMStore: (select: (s: unknown) => unknown) => select({ defaultModelId: 'model' }) }))
vi.mock('../../stores/workflow-store', () => ({ useWorkflowStore: Object.assign((select: (s: unknown) => unknown) => select({ isTypeRunning: () => false }), { getState: () => ({ addLog: vi.fn() }) }) }))
vi.mock('../../services/workflows/start-workflow', () => ({ startWorkflow: h.start }))
vi.mock('../../services/render-logger', () => ({ renderLog: vi.fn() }))
vi.mock('../ui/Confirm', () => ({ confirm: h.confirm }))
vi.mock('../ui/Toast', () => ({ toast: { error: h.error, info: vi.fn() } }))
vi.mock('../ui/Dialog', () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return { Dialog: Part, DialogContent: Part, DialogHeader: Part, DialogTitle: Part, DialogFooter: Part, DialogDescription: Part }
})
vi.mock('../ui/Textarea', () => ({ Textarea: (props: typeof h.prompt) => { h.prompt = props; return <textarea /> } }))
let root: Root, host: HTMLDivElement
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
async function flush(work: () => void = () => {}) { await act(async () => { work(); await Promise.resolve() }) }
async function mount() {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  const props = { isOpen: true, onClose: h.closed, config: h.config, hasModel: () => { if (h.session !== 1) throw new NovelConfigRequestCancelled(); return true }, isConfigRunning: false,
    assertCurrent: () => { if (h.session !== 1) throw new NovelConfigRequestCancelled() }, onUpdateConfig: vi.fn(), onGenerate: h.generate, onGenerated: vi.fn() }
  await flush(() => root.render(<GenerateConfigDialog {...props} />))
  await flush(() => h.prompt.onChange({ target: { value: 'story idea' } }))
}
async function generate() { const button = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('genConfig.btn')); expect(button).toBeDefined(); await flush(() => button!.click()) }
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks(); h.session = 1; h.confirm.mockResolvedValue(true); h.generate.mockResolvedValue(undefined); h.start.mockResolvedValue({ runId: 'run' }) })
afterEach(async () => { if (root) await flush(() => root.unmount()); host?.remove() })
it('source changes during overwrite confirmation prevent launching or closing the new session', async () => {
  const pending = deferred<boolean>(); h.confirm.mockReturnValueOnce(pending.promise)
  await mount(); await generate(); h.session = 2
  await flush(() => pending.resolve(true))
  expect(h.start).not.toHaveBeenCalled(); expect(h.generate).not.toHaveBeenCalled(); expect(h.closed).not.toHaveBeenCalled(); expect(h.error).not.toHaveBeenCalled()
})
it('delegates a confirmed launch once with the captured scale', async () => {
  await mount(); await generate()
  expect(h.generate).toHaveBeenCalledWith('story idea', 100, 3000)
  expect(h.start).not.toHaveBeenCalled(); expect(h.closed).toHaveBeenCalledOnce()
})
it('a stale dialog launch is ignored before model availability checks', async () => {
  await mount(); h.session = 2; await generate()
  expect(h.generate).not.toHaveBeenCalled(); expect(h.error).not.toHaveBeenCalled()
})
