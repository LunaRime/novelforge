import { beforeEach, expect, it, vi } from 'vitest'
import { createCharacterExtractSteps } from './architecture-workflow'
import { InferGlobalSettingsCommand } from './commands/import-novel.command'
import { createImportWorkflow } from './import-workflow'
import { createCharacterArchiveWorkflow } from './character-archive-workflow'
import { buildFinalizePostProcessSteps } from './commands/finalize-chapter.command'
import { EMPTY_CARD } from '../../stores/character-store'

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  stream: vi.fn(),
  project: { currentProject: { id: 'a', path: '/a' }, projectSession: 1 },
}))
vi.mock('../ipc-client', () => ({ ipc: { invoke: h.invoke } }))
vi.mock('../../stores/project-store', () => ({ useProjectStore: { getState: () => h.project } }))
vi.mock('../../stores/llm-store', () => ({ useLLMStore: { getState: () => ({ defaultModelId: 'model', generateStream: h.stream }) } }))
vi.mock('../render-logger', () => ({ renderLog: vi.fn() }))

const callbacks = () => ({ appendText: vi.fn(), log: vi.fn(), setProgress: vi.fn() })
const scope = { projectPath: '/a', token: 'db-a' }

beforeEach(() => {
  h.project.projectSession = 1
  h.invoke.mockReset().mockImplementation(async (channel: string) => {
    if (channel === 'db:character-edit-snapshot') return { scope, cards: [{ name: 'Known', uid: 'known' }] }
    if (channel === 'db:character-merge-cards') return { success: true, stats: { saved: 1, merged: 0, created: 1 } }
    if (channel === 'kb:search') return []
    throw new Error(`Unexpected IPC channel: ${channel}`)
  })
  h.stream.mockReset().mockImplementation((_messages, stream) => {
    stream.onChunk('{"characters":[{"name":"New","role":"protagonist"}]}')
    stream.onDone()
  })
})

it('routes architecture extraction through the dedicated scoped model write', async () => {
  const [step] = createCharacterExtractSteps('/a', 'Character architecture', 'Fantasy')
  await step.executor(callbacks())
  expect(h.invoke.mock.calls).toEqual([
    ['db:character-edit-snapshot'],
    ['db:character-merge-cards', {
      scope, known: [expect.objectContaining({ name: 'Known', uid: 'known' })],
      cards: [expect.objectContaining({ name: 'New' })],
    }],
  ])
})

it('rejects late architecture results after a same-path reopen', async () => {
  h.stream.mockImplementationOnce((_messages, stream) => {
    h.project.projectSession++
    stream.onChunk('{"characters":[{"name":"New"}]}')
    stream.onDone()
  })
  const [step] = createCharacterExtractSteps('/a', 'Character architecture', 'Fantasy')
  await expect(step.executor(callbacks())).rejects.toThrow()
  expect(h.invoke.mock.calls).toEqual([['db:character-edit-snapshot']])
})

it('routes import cards through the same write-time merge', async () => {
  class ImportFixture extends InferGlobalSettingsCommand {
    protected override async callLLM() {
      return '{"characterCards":[{"name":"Imported","background":"From manuscript"}]}'
    }
  }
  await new ImportFixture().execute({
    step: {},
    context: { cancelled: false, data: { chapters: [{ number: 1, title: 'Chapter', content: 'Body' }] } },
    callbacks: callbacks(),
  })
  expect(h.invoke).toHaveBeenLastCalledWith('db:character-merge-cards', expect.objectContaining({
    scope, cards: [{ name: 'Imported', background: 'From manuscript' }],
  }))
})

it('rejects an import continuation after reopening the same project', async () => {
  const chapters = [{ number: 1, title: 'Chapter', content: 'Body', wordCount: 1 }]
  const workflow = createImportWorkflow({ chapters })
  h.project.projectSession++
  await expect(workflow.steps[1].executor(
    { id: 'import', name: '', description: '', logs: [], status: 'running' },
    { cancelled: false, data: { chapters } }, callbacks(),
  )).rejects.toThrow()
  expect(h.invoke).not.toHaveBeenCalled()
})

it.each([false, true])('keeps archive writes and pipeline status in the originating session (reopen=%s)', async reopen => {
  const known = { ...EMPTY_CARD, name: '甲', uid: 'known' }
  h.invoke.mockImplementation(async (channel: string) => {
    switch (channel) {
      case 'db:character-edit-snapshot': return { scope, cards: [known] }
      case 'db:draft-get-all-chapter-numbers': return [1]
      case 'db:draft-get-finalized': return { id: 1 }
      case 'db:draft-get-full': return { content: '甲走进房间，取出一把旧剑。' }
      case 'db:post-process-get-latest-run': return { id: 1, allCriticalPassed: true }
      case 'db:post-process-create-run': return { success: true, id: 1 }
      case 'db:post-process-get-steps': return []
      case 'db:character-merge-fields':
      case 'db:post-process-mark-step-ok': return { success: true }
      default: throw new Error(`Unexpected IPC: ${channel}`)
    }
  })
  h.stream.mockImplementationOnce((_messages, stream) => {
    if (reopen) h.project.projectSession++
    stream.onChunk('{"甲":{"appearance":"高个子"}}')
    stream.onDone()
  })
  const workflow = createCharacterArchiveWorkflow({ projectPath: '/a' })
  const run = workflow.steps[0].executor(
    { id: 'archive', name: '', description: '', logs: [], status: 'running' },
    { cancelled: false, data: {} }, callbacks(),
  )
  if (reopen) {
    await expect(run).rejects.toThrow()
    expect(h.invoke.mock.calls.some(([channel]) => channel === 'db:character-merge-fields' || channel.includes('mark-step'))).toBe(false)
  } else {
    await run
    expect(h.invoke).toHaveBeenCalledWith('db:character-merge-fields', '甲', expect.objectContaining({ appearance: '高个子' }), { scope, uid: 'known' })
  }
})

it('finalization submits relationship changes with the observed source and target identities', async () => {
  const first = { ...EMPTY_CARD, name: '阿甲', uid: 'first' }
  const second = { ...EMPTY_CARD, name: '阿乙', uid: 'second' }
  h.invoke.mockResolvedValueOnce({ scope, cards: [first, second] }).mockResolvedValueOnce({ success: true, cards: [first, second] })
  const steps = buildFinalizePostProcessSteps({ path: '/a' }, 1, 'Chapter', '阿甲看向阿乙，说了一句话。')
  await steps.find(step => step.key === 'relation_detect')!.executor(callbacks())
  expect(h.invoke).toHaveBeenLastCalledWith('db:character-commit-edits', {
    scope,
    edits: [
      { before: first, after: expect.objectContaining({ relations: expect.stringContaining('"target":"阿乙"') }) },
      { before: second, after: expect.objectContaining({ relations: expect.stringContaining('"target":"阿甲"') }) },
    ],
    relationTargets: [{ name: '阿乙', uid: 'second' }, { name: '阿甲', uid: 'first' }],
  })
})
