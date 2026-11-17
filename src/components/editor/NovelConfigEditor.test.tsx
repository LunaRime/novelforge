// @vitest-environment jsdom
import { StrictMode, act, type ComponentProps, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import NovelConfigEditor from './NovelConfigEditor'
import { useProjectStore } from '../../stores/project-store'
import type { ProjectData } from '../../shared/ipc-channels'

const h = vi.hoisted(() => ({ invoke: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), show: vi.fn(), start: vi.fn(), log: vi.fn(),
  fields: {} as Record<string, ComponentProps<'textarea'>>,
}))
vi.mock('../../services/ipc-client', () => ({ ipc: { invoke: h.invoke } }))
vi.mock('../../services/render-logger', () => ({ renderLog: h.log }))
vi.mock('../../services/workflows/start-workflow', () => ({ startWorkflow: h.start }))
vi.mock('../../stores/llm-store', () => ({ useLLMStore: Object.assign((select: (s: unknown) => unknown) => select({ defaultModelId: 'model' }), { getState: () => ({ defaultModelId: 'model' }) }) }))
vi.mock('../../hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../ui/Toast', () => ({ toast: { success: h.success, error: h.error, warning: h.warning, show: h.show } }))
vi.mock('../dialogs/GenerateConfigDialog', () => ({ default: () => null }))
vi.mock('../ui/Textarea', () => ({ Textarea: (props: ComponentProps<'textarea'>) => { h.fields[String(props.placeholder)] = props; return <textarea {...props} /> } }))
vi.mock('../ui/Select', () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return { Select: Container, SelectTrigger: Container, SelectValue: Container, SelectContent: Container, SelectItem: Container }
})
const project: ProjectData = { id: 'a', path: '/a', name: 'Novel', characterStates: '', createdAt: 0, updatedAt: 0,
  novelConfig: { genre: '玄幻', subGenre: '', targetAudience: '男频', totalChapters: 100, wordsPerChapter: 3000,
    plotStructure: 'three_act', narrativePOV: 'third_limited', coreOutline: 'outline', worldSetting: 'world', goldenFinger: '', protagonistProfile: '', globalGuidance: '' } }
let host: HTMLDivElement, root: Root
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
async function flush(work: () => void = () => {}) { await act(async () => { work(); await Promise.resolve() }) }
async function mount() { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await flush(() => root.render(<StrictMode><NovelConfigEditor /></StrictMode>)) }
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(button => button.textContent?.includes(text))
  expect(button, text).toBeDefined(); await flush(() => button!.click())
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks(); h.fields = {}; h.invoke.mockResolvedValue({ success: true }); h.start.mockResolvedValue({ runId: 'config-run', displayName: '', chapterTag: '' })
  useProjectStore.setState({ currentProject: structuredClone(project), projectSession: 1, configSnapshot: null })
})
afterEach(async () => { if (root) await flush(() => root.unmount()); host?.remove() })
describe('novel config application view', () => {
  it('false persistence reports failure instead of success', async () => {
    h.invoke.mockResolvedValue({ success: false }); await mount(); await click('action.save')
    expect(h.success).not.toHaveBeenCalled(); expect(h.error).toHaveBeenCalledOnce()
    expect(h.log).toHaveBeenCalledWith('error', 'Save:Config', expect.any(String))
  })
  it('preserves edits made while a captured save is pending', async () => {
    const pending = deferred<{ success: boolean }>(); h.invoke.mockReturnValueOnce(pending.promise)
    await mount(); await click('action.save')
    await flush(() => h.fields['novelConfig.worldSettingPlaceholder'].onChange!({ target: { value: 'new input' } } as never))
    await flush(() => pending.resolve({ success: true }))
    expect(useProjectStore.getState().currentProject!.novelConfig.worldSetting).toBe('new input')
    expect(h.invoke.mock.calls[0][2].novelConfig.worldSetting).toBe('world')
  })
  it('shows a pending receipt without reporting failure or resending the save', async () => {
    vi.useFakeTimers()
    const pending = deferred<{ success: boolean }>()
    h.invoke.mockReturnValueOnce(pending.promise)
    try {
      await mount(); await click('action.save')
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
      expect(h.warning).toHaveBeenCalledOnce()
      expect(h.error).not.toHaveBeenCalled()
      expect(h.success).not.toHaveBeenCalled()
      const saving = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('status.saving'))!
      expect(saving.disabled).toBe(true)
      await flush(() => saving.click())
      expect(h.invoke).toHaveBeenCalledTimes(1)
      await flush(() => pending.resolve({ success: true }))
      expect(h.success).toHaveBeenCalledOnce()
    } finally {
      pending.resolve({ success: true })
      vi.useRealTimers()
    }
  })
  it('same-path reopen suppresses old save feedback', async () => {
    const pending = deferred<{ success: boolean }>(); h.invoke.mockReturnValueOnce(pending.promise)
    await mount(); await click('action.save')
    await flush(() => useProjectStore.setState({ projectSession: 2 }))
    await flush(() => pending.resolve({ success: true }))
    expect(h.success).not.toHaveBeenCalled(); expect(h.error).not.toHaveBeenCalled()
    expect([...host.querySelectorAll('button')].find(button => button.textContent?.includes('action.save'))?.disabled).toBe(false)
  })
  it('old field callbacks cannot edit a reopened project', async () => {
    await mount(); const staleInput = h.fields['novelConfig.worldSettingPlaceholder'].onChange!
    await flush(() => useProjectStore.setState({ projectSession: 2 }))
    await flush(() => staleInput({ target: { value: 'stale input' } } as never))
    expect(useProjectStore.getState().currentProject!.novelConfig.worldSetting).toBe('world')
  })
  it('blocks a second field start while the first start receipt is pending', async () => {
    const pending = deferred<{ runId: string; displayName: string; chapterTag: string }>(); h.start.mockReturnValueOnce(pending.promise)
    await mount(); const generate = [...host.querySelectorAll('button')].find(button => button.title === 'tip.aiGenerateField')!
    expect(generate).toBeDefined()
    await flush(() => { generate.click(); generate.click() })
    expect(h.start).toHaveBeenCalledTimes(1)
    await flush(() => pending.resolve({ runId: 'config-run', displayName: '', chapterTag: '' }))
  })
})
