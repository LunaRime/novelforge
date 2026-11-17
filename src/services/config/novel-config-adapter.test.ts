import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRendererNovelConfigApplication } from './novel-config-adapter'
import { registerWorkflowSource } from '../workflows/workflow-source'

const { state, llm, startWorkflow, saveProject } = vi.hoisted(() => {
  const saveProject = vi.fn()
  return { state: { currentProject: { id: 'a', path: '/a', novelConfig: { coreOutline: 'old', worldSetting: 'world' } }, projectSession: 1, configFieldVersions: {} as Record<string, number>, saveProject,
    updateNovelConfig(patch: Record<string, string>) { Object.assign(this.currentProject.novelConfig, patch); for (const key of Object.keys(patch)) this.configFieldVersions[key] = (this.configFieldVersions[key] ?? 0) + 1 } }, llm: { defaultModelId: 'model' as string | null }, startWorkflow: vi.fn(), saveProject }
})
vi.mock('../../stores/project-store', () => ({
  useProjectStore: { getState: () => state },
  captureProjectConfigSource: () => ({ id: state.currentProject.id, path: state.currentProject.path, session: state.projectSession }),
}))
vi.mock('../../stores/llm-store', () => ({ useLLMStore: { getState: () => llm } }))
vi.mock('../workflows/start-workflow', () => ({ startWorkflow }))
beforeEach(() => {
  vi.clearAllMocks(); state.projectSession = 1; state.currentProject.novelConfig = { coreOutline: 'old', worldSetting: 'world' }; state.configFieldVersions = {}; llm.defaultModelId = 'model'
  saveProject.mockResolvedValue(true); startWorkflow.mockResolvedValue({ runId: 'run', displayName: 'Config', chapterTag: '' })
})
describe('novel config renderer adapter', () => {
  it('uses store versions and persists the captured config', async () => {
    const app = createRendererNovelConfigApplication(); const snapshot = app.snapshot()
    app.update({ coreOutline: 'new' }); expect(app.applyGenerated({ coreOutline: 'AI' }, snapshot)).toEqual({ status: 'conflict', fields: ['coreOutline'] })
    await app.save(); expect(saveProject).toHaveBeenCalledWith({ coreOutline: 'new', worldSetting: 'world' })
    saveProject.mockResolvedValue(false); await expect(app.save()).rejects.toThrow()
  })
  it('binds workflow startup, ownership and model availability to the project session', async () => {
    const app = createRendererNovelConfigApplication(); expect(app.hasModel()).toBe(true)
    llm.defaultModelId = null; expect(app.hasModel()).toBe(false)
    await app.startBulk('idea', 5, 1000); expect(startWorkflow).toHaveBeenCalledWith({ workflow: 'config_generation', idea: 'idea', totalChapters: 5, wordsPerChapter: 1000 })
    registerWorkflowSource('run', { id: 'a', path: '/a', session: 1 }, ['run']); expect(app.ownsRun('run')).toBe(true)
    state.projectSession++; expect(app.ownsRun('run')).toBe(false)
    await expect(app.startField('coreOutline')).rejects.toThrow()
    expect(() => createRendererNovelConfigApplication({ id: 'a', path: '/a', session: 1 }).snapshot()).toThrow()
  })
})
