// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GenerateFieldCommand } from './generate-field.command'
import { GenerateConfigCommand } from './architecture.command'
import { createFieldGenerationWorkflow, createConfigGenerationWorkflow } from '../architecture-workflow'
import { useProjectStore } from '../../../stores/project-store'
import type { ProjectData } from '../../../shared/ipc-channels'

const h = vi.hoisted(() => ({ llm: vi.fn(), confirm: vi.fn(), show: vi.fn(), success: vi.fn(), error: vi.fn(), invoke: vi.fn() }))
vi.mock('./base-command', () => ({ BaseWorkflowCommand: class {
  callLLM(...args: unknown[]) { return h.llm(...args) }
  callLLMWithBuilder(...args: unknown[]) { return h.llm(...args) }
  stripThinkingTags(text: string) { return text }
  parseJSON(text: string) { return JSON.parse(text) }
  getLastStreamText() { return '' }
} }))
vi.mock('../../prompt-templates', () => ({ getPromptTemplate: () => ({}) }))
vi.mock('../../prompts/prompt-builder', () => ({ ArchitecturePromptBuilder: class {
  withUserIdea() { return this }
  withNumberOfChapters() { return this }
  withWordNumber() { return this }
} }))
vi.mock('../../../components/ui/Confirm', () => ({ confirm: h.confirm }))
vi.mock('../../../components/ui/Toast', () => ({ toast: { show: h.show, success: h.success, error: h.error, info: vi.fn(), warning: vi.fn() } }))
vi.mock('../../ipc-client', () => ({ ipc: { invoke: h.invoke } }))
vi.mock('../../render-logger', () => ({ renderLog: vi.fn() }))
const project: ProjectData = { id: 'a', path: '/a', name: 'Novel', characterStates: '', createdAt: 0, updatedAt: 0,
  novelConfig: { genre: '玄幻', subGenre: '', targetAudience: '男频', totalChapters: 100, wordsPerChapter: 3000,
    plotStructure: 'three_act', narrativePOV: 'third_limited', coreOutline: 'old outline', worldSetting: 'old world',
    goldenFinger: '', protagonistProfile: '', globalGuidance: '' } }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
function params() { return { step: { id: 'step' }, context: { data: {}, cancelled: false }, callbacks: { log: vi.fn(), setProgress: vi.fn(), appendText: vi.fn() } } }
beforeEach(() => {
  vi.clearAllMocks(); h.confirm.mockResolvedValue(true); h.llm.mockResolvedValue('generated outline'); h.invoke.mockResolvedValue({ success: true })
  useProjectStore.setState({ currentProject: structuredClone(project), projectSession: 1, configSnapshot: null })
})

describe('actual field generation session', () => {
  it('bulk generation also retains conflicting output and does not claim it was applied', async () => {
    const pending = deferred<string>(); h.llm.mockReturnValueOnce(pending.promise); const applied = vi.fn()
    const running = new GenerateConfigCommand('idea', 100, 3000, applied).execute(params())
    await vi.waitFor(() => expect(h.llm).toHaveBeenCalledOnce())
    useProjectStore.getState().updateNovelConfig({ coreOutline: 'bulk user edit' })
    pending.resolve(JSON.stringify({ coreOutline: 'bulk generated' })); await running
    expect(useProjectStore.getState().currentProject!.novelConfig.coreOutline).toBe('bulk user edit')
    expect(applied).not.toHaveBeenCalled(); expect(h.invoke).not.toHaveBeenCalled()
    await h.show.mock.calls.at(-1)?.[0].actions?.[0]?.onClick()
    expect(applied).toHaveBeenCalledWith({ coreOutline: 'bulk generated' })
    expect(useProjectStore.getState().currentProject!.novelConfig.coreOutline).toBe('bulk generated')
  })
  it.each(['{}', 'null', '[]'])('empty bulk output %s is not applied or reported as saved', async output => {
    h.llm.mockResolvedValue(output); const applied = vi.fn()
    const result = await new GenerateConfigCommand('idea', 100, 3000, applied).execute(params())
    expect(result).toBe(''); expect(applied).not.toHaveBeenCalled(); expect(h.invoke).not.toHaveBeenCalled(); expect(h.show).not.toHaveBeenCalled()
  })
  it('a completion callback that changes project session cannot publish an old AI toast', async () => {
    h.llm.mockResolvedValue(JSON.stringify({ coreOutline: 'bulk result' }))
    await new GenerateConfigCommand('idea', 100, 3000, () => useProjectStore.setState({ projectSession: 2 })).execute(params())
    expect(h.invoke).toHaveBeenCalledOnce(); expect(h.show).not.toHaveBeenCalled()
  })
  it.each(['field', 'bulk'])('a %s workflow prepared for an old session cannot start against a reopened project', async kind => {
    const definition = kind === 'field' ? createFieldGenerationWorkflow('coreOutline')
      : createConfigGenerationWorkflow({ idea: 'idea', totalChapters: 100, wordsPerChapter: 3000, onGenerated: vi.fn() })
    useProjectStore.setState({ projectSession: 2 })
    const request = params()
    await definition.steps[0].executor(request.step as never, request.context, request.callbacks).catch(() => {})
    expect(h.llm).not.toHaveBeenCalled(); expect(h.invoke).not.toHaveBeenCalled()
  })
  it('an edit during explicit conflict confirmation still preserves the newer input', async () => {
    const pending = deferred<string>(); h.llm.mockReturnValueOnce(pending.promise)
    const running = new GenerateFieldCommand('coreOutline').execute(params())
    await vi.waitFor(() => expect(h.llm).toHaveBeenCalledOnce())
    useProjectStore.getState().updateNovelConfig({ coreOutline: 'first edit' })
    pending.resolve('model result'); await running
    const apply = h.show.mock.calls.at(-1)?.[0].actions?.[0]?.onClick
    const confirmation = deferred<boolean>(); h.confirm.mockReturnValueOnce(confirmation.promise)
    const applying = apply()
    useProjectStore.getState().updateNovelConfig({ coreOutline: 'second edit' })
    confirmation.resolve(true); await applying
    expect(useProjectStore.getState().currentProject!.novelConfig.coreOutline).toBe('second edit')
    expect(h.show.mock.calls.at(-1)?.[0].actions?.[0]?.label).toBe('应用')
    expect(h.invoke).not.toHaveBeenCalled()
  })
  it('preserves a target edited during generation and offers explicit application', async () => {
    const pending = deferred<string>(); h.llm.mockReturnValueOnce(pending.promise)
    const running = new GenerateFieldCommand('coreOutline').execute(params())
    await vi.waitFor(() => expect(h.llm).toHaveBeenCalledOnce())
    useProjectStore.getState().updateNovelConfig({ coreOutline: 'user edit' })
    pending.resolve('model result'); await running
    expect(useProjectStore.getState().currentProject!.novelConfig.coreOutline).toBe('user edit')
    expect(h.invoke).not.toHaveBeenCalledWith('project:update-config', expect.anything(), expect.anything())
    expect(h.show.mock.calls.some(([toast]) => toast.actions?.some((action: { label: string }) => action.label === '应用'))).toBe(true)
  })
  it('does not overwrite a target changed and then changed back', async () => {
    const pending = deferred<string>(); h.llm.mockReturnValueOnce(pending.promise)
    const running = new GenerateFieldCommand('coreOutline').execute(params())
    await vi.waitFor(() => expect(h.llm).toHaveBeenCalledOnce())
    useProjectStore.getState().updateNovelConfig({ coreOutline: 'intermediate' })
    useProjectStore.getState().updateNovelConfig({ coreOutline: 'old outline' })
    pending.resolve('model result'); await running
    expect(useProjectStore.getState().currentProject!.novelConfig.coreOutline).toBe('old outline')
  })
  it('keeps other-field edits and persists the generated field only into its source project', async () => {
    const pending = deferred<string>(); h.llm.mockReturnValueOnce(pending.promise)
    const running = new GenerateFieldCommand('coreOutline').execute(params())
    await vi.waitFor(() => expect(h.llm).toHaveBeenCalledOnce())
    useProjectStore.getState().updateNovelConfig({ worldSetting: 'new user world' })
    pending.resolve('model result'); await running
    expect(useProjectStore.getState().currentProject!.novelConfig).toMatchObject({ coreOutline: 'model result', worldSetting: 'new user world' })
    const saved = h.invoke.mock.calls.find(([channel]) => channel === 'project:update-config')
    expect(saved?.[2].novelConfig).toEqual({ coreOutline: 'model result' })
  })
  it('stops before model or persistence if project changed during overwrite confirmation', async () => {
    const confirmation = deferred<boolean>(); h.confirm.mockReturnValueOnce(confirmation.promise)
    const running = new GenerateFieldCommand('coreOutline').execute(params())
    useProjectStore.setState({ projectSession: 2 }); confirmation.resolve(true)
    await running.catch(() => {})
    expect(h.llm).not.toHaveBeenCalled(); expect(h.invoke).not.toHaveBeenCalled()
  })
  it('rejects late model output from a reopened project session', async () => {
    const pending = deferred<string>(); h.llm.mockReturnValueOnce(pending.promise)
    const running = new GenerateFieldCommand('coreOutline').execute(params())
    await vi.waitFor(() => expect(h.llm).toHaveBeenCalledOnce())
    useProjectStore.setState({ projectSession: 2 }); pending.resolve('old model output')
    await running.catch(() => {})
    expect(useProjectStore.getState().currentProject!.novelConfig.coreOutline).toBe('old outline')
    expect(h.invoke).not.toHaveBeenCalled(); expect(h.show).not.toHaveBeenCalled()
  })
  it('respects workflow cancellation after model returns', async () => {
    const pending = deferred<string>(); h.llm.mockReturnValueOnce(pending.promise); const request = params()
    const running = new GenerateFieldCommand('coreOutline').execute(request)
    await vi.waitFor(() => expect(h.llm).toHaveBeenCalledOnce())
    request.context.cancelled = true; pending.resolve('cancelled output')
    await running.catch(() => {})
    expect(useProjectStore.getState().currentProject!.novelConfig.coreOutline).toBe('old outline'); expect(h.invoke).not.toHaveBeenCalled()
    expect(h.llm.mock.calls[0][4]).toBe(request.context)
  })
  it('false persistence never reports saved and preserves the generated value for recovery', async () => {
    h.invoke.mockResolvedValue({ success: false })
    const request = params(); await new GenerateFieldCommand('coreOutline').execute(request).catch(() => {})
    expect(useProjectStore.getState().currentProject!.novelConfig.coreOutline).toBe('generated outline')
    expect(h.error).toHaveBeenCalled(); expect(h.show).not.toHaveBeenCalled()
    expect(request.callbacks.log.mock.calls.some(([line]) => line.includes('已保存'))).toBe(false)
  })
  it('undo preserves later edits to other fields and cannot restore into a new session', async () => {
    await new GenerateFieldCommand('coreOutline').execute(params())
    const undo = h.show.mock.calls.at(-1)?.[0].actions?.[0]?.onClick
    expect(undo).toBeTypeOf('function')
    useProjectStore.getState().updateNovelConfig({ worldSetting: 'later world' })
    await undo()
    expect(useProjectStore.getState().currentProject!.novelConfig).toMatchObject({ coreOutline: 'old outline', worldSetting: 'later world' })
    await new GenerateFieldCommand('coreOutline').execute(params())
    const staleUndo = h.show.mock.calls.at(-1)?.[0].actions?.[0]?.onClick
    useProjectStore.setState({ projectSession: 2 }); await staleUndo()
    expect(useProjectStore.getState().currentProject!.novelConfig.coreOutline).toBe('generated outline')
  })
})
