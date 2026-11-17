import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRendererArchitectureDocumentApplication } from './architecture-adapter'
import { registerWorkflowSource } from '../workflows/workflow-source'

const { invoke, startWorkflow, scope } = vi.hoisted(() => ({
  invoke: vi.fn(),
  startWorkflow: vi.fn(),
  scope: { currentProject: { id: 'a', path: '/a' }, projectSession: 1 },
}))
vi.mock('../ipc-client', () => ({ ipc: { invoke } }))
vi.mock('../../stores/project-store', () => ({ useProjectStore: { getState: () => scope } }))
vi.mock('../workflows/start-workflow', () => ({ startWorkflow }))

beforeEach(() => {
  vi.clearAllMocks()
  scope.projectSession = 1
  startWorkflow.mockResolvedValue({ runId: 'actual-run', displayName: 'Arch', chapterTag: '' })
})
describe('architecture renderer adapter', () => {
  it('reads real core URI fields and distinguishes missing from empty', async () => {
    invoke.mockResolvedValueOnce({ charactersArch: 'characters' }).mockResolvedValueOnce(null).mockResolvedValueOnce({ premise: '' })
    await expect(createRendererArchitectureDocumentApplication('vela://core/characters').read()).resolves.toEqual({ status: 'ready', content: 'characters' })
    await expect(createRendererArchitectureDocumentApplication('vela://core/premise').read()).resolves.toEqual({ status: 'missing' })
    await expect(createRendererArchitectureDocumentApplication('vela://core/premise').read()).resolves.toEqual({ status: 'ready', content: '' })
    expect(invoke).toHaveBeenCalledWith('db:project-core-get')
  })

  it.each(['vela://core/no-such-key', 'vela://draft/1', 'vela://core/__proto__', 'vela://core/premise/extra'])('rejects invalid internal locator %s before IO', async (locator) => {
    const app = createRendererArchitectureDocumentApplication(locator)
    await expect(app.read()).rejects.toThrow()
    await expect(app.save('body')).rejects.toThrow()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('rejects physical read failures without empty fallback', async () => {
    invoke.mockResolvedValueOnce({ success: false, content: '', error: 'disk failed' })
    await expect(createRendererArchitectureDocumentApplication('/a/premise.md').read()).rejects.toThrow('disk failed')
    expect(invoke).toHaveBeenCalledWith('fs:read-file', '/a/premise.md')
  })

  it('rejects malformed core content instead of silently clearing it', async () => {
    invoke.mockResolvedValue({ premise: 123 })
    await expect(createRendererArchitectureDocumentApplication('vela://core/premise').read()).rejects.toThrow()
  })

  it('writes exact core fields and rejects false DB and file responses', async () => {
    invoke.mockResolvedValueOnce({ success: false }).mockResolvedValueOnce({ success: false }).mockResolvedValueOnce({ success: true })
    await expect(createRendererArchitectureDocumentApplication('vela://core/characters').save('body')).rejects.toThrow()
    expect(invoke).toHaveBeenCalledWith('db:project-core-update', { charactersArch: 'body' })
    const app = createRendererArchitectureDocumentApplication('/a/premise.md')
    await expect(app.save('body')).rejects.toThrow()
    await expect(app.save('retry')).resolves.toBeUndefined()
    expect(invoke).toHaveBeenCalledWith('fs:write-file', '/a/premise.md', 'retry')
  })

  it('maps four raw core fields and character count without interpreting IO failure as empty', async () => {
    invoke.mockResolvedValueOnce({ premise: 'p'.repeat(51), charactersArch: 'c'.repeat(51), worldbuilding: '待生成' + 'w'.repeat(70), synopsis: '' }).mockResolvedValueOnce([{ id: 1 }, { id: 2 }]).mockRejectedValueOnce(new Error('db failed'))
    const app = createRendererArchitectureDocumentApplication('vela://core/premise')
    await expect(app.status()).resolves.toEqual({ premise: true, characters: true, worldbuilding: false, synopsis: false })
    await expect(app.existingCharacterCount()).resolves.toBe(2)
    await expect(app.existingCharacterCount()).rejects.toThrow('db failed')
  })

  it('routes extraction and generation through the awaited workflow receipt', async () => {
    invoke.mockResolvedValue({ charactersArch: 'x'.repeat(50) })
    const app = createRendererArchitectureDocumentApplication('vela://core/characters')
    await expect(app.extract('fantasy')).resolves.toEqual({ status: 'started', runId: 'actual-run' })
    expect(startWorkflow).toHaveBeenCalledWith({ workflow: 'extract_arch_characters', projectPath: '/a', characterDynamicsContent: 'x'.repeat(50), genre: 'fantasy' })
    await expect(app.generate(['premise'], { premise: 'guide' })).resolves.toEqual({ runId: 'actual-run', displayName: 'Arch', chapterTag: '' })
    startWorkflow.mockRejectedValueOnce(new Error('startup failed'))
    await expect(app.extract('fantasy')).rejects.toThrow('startup failed')
  })

  it('uses explicit captured scope to reject same-path reopened sessions', async () => {
    const app = createRendererArchitectureDocumentApplication('vela://core/premise', { id: 'a', path: '/a', session: 0 })
    await expect(app.read()).rejects.toThrow()
    expect(invoke).not.toHaveBeenCalled()
  })
})
describe('remounted architecture workflow attribution', () => {
  it('recognizes same-session runs from another caller and rejects a reopened project session', () => {
    const source = { id: 'a', path: '/a', session: 1 }
    registerWorkflowSource('overview-generation', source, ['overview-generation'])
    const original = createRendererArchitectureDocumentApplication('vela://core/premise')
    original.dispose()
    const remounted = createRendererArchitectureDocumentApplication('vela://core/premise')
    expect(remounted.ownsRun('overview-generation')).toBe(true)
    scope.projectSession++
    const reopened = createRendererArchitectureDocumentApplication('vela://core/premise')
    expect(reopened.ownsRun('overview-generation')).toBe(false)
  })
})
