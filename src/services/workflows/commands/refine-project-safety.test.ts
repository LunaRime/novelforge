import { beforeEach, expect, test, vi } from 'vitest'
import type { CommandExecuteParams } from './base-command'

const state = vi.hoisted(() => ({
  project: { path: '/a', novelConfig: {} } as { path: string; novelConfig: object } | null,
  invoke: vi.fn(), generate: vi.fn(), openFile: vi.fn(), voices: vi.fn(), style: vi.fn(),
}))
vi.mock('../../../stores/project-store', () => ({ useProjectStore: { getState: () => ({ currentProject: state.project }) } }))
vi.mock('../../../stores/editor-store', () => ({ useEditorStore: { getState: () => ({ openFile: state.openFile }) } }))
vi.mock('../../ipc-client', () => ({ ipc: { invoke: state.invoke } }))
vi.mock('../../prompt-templates', () => ({ getPromptTemplate: () => ({}) }))
vi.mock('../../character-voice-analyzer', () => ({ loadCharacterVoiceProfiles: state.voices, formatVoiceForPrompt: () => '' }))
vi.mock('../../agent/style-registry', () => ({ getActiveStyle: state.style, appendWritingStyle: () => '' }))
vi.mock('../../prompts/prompt-builder', () => ({ ChapterPromptBuilder: class {
  withReviewReport() { return this }
  withDraftContent() { return this }
  withGlobalGuidance() { return this }
  withUserRefinePrompt() { return this }
  withChapterInfo() { return this }
  withWritingStyle() { return this }
  withGlobalSummary() { return this }
  withShortSummary() { return this }
  withCharacterStates() { return this }
  withVoiceProfile() { return this }
  withWordNumber() { return this }
} }))
vi.mock('./base-command', () => ({ BaseWorkflowCommand: class {
  callLLMWithBuilder() { return state.generate() }
  stripThinkingTags(value: string) { return value }
} }))
vi.mock('../chapter-workflow', () => ({ parseDraftMeta: async () => ({ id: 42 }) }))
import { RefineFromReviewCommand } from './refine-from-review.command'
import { RefineDraftCommand } from './refine-draft.command'

const execute = () => new RefineFromReviewCommand({ chapterNumber: 7, draftPath: 'vela://draft/42', draftContent: 'old', reviewReport: '{}' })
  .execute({ callbacks: { log: vi.fn() } } as unknown as CommandExecuteParams)

beforeEach(() => {
  state.project = { path: '/a', novelConfig: {} }
  state.invoke.mockReset(); state.generate.mockReset(); state.openFile.mockReset()
  state.generate.mockResolvedValue('revision')
  state.voices.mockReset(); state.style.mockReset()
  state.voices.mockResolvedValue([]); state.style.mockResolvedValue(null)
})

test.each(['voices', 'style'] as const)('project switch while preparing %s prevents subsequent database/model context reads', async stage => {
  state[stage].mockImplementation(async () => { state.project = { path: '/b', novelConfig: {} }; return null })
  state.invoke.mockResolvedValue([])
  const cmd = new RefineDraftCommand({ chapterNumber: 7, draftPath: 'vela://draft/42', draftContent: 'old',
    chapterInfo: { chapterNumber: 7, title: 'title', role: '', purpose: '', characters: [], keyEvents: '' } })
  await expect(cmd.execute({ context: { data: {} }, callbacks: { log: vi.fn() } } as unknown as CommandExecuteParams)).rejects.toThrow()
  if (stage === 'voices') expect(state.invoke).not.toHaveBeenCalled()
  expect(state.generate).not.toHaveBeenCalled()
})

test('late model completion after project switch never creates/discards revisions', async () => {
  state.generate.mockImplementation(async () => { state.project = { path: '/b', novelConfig: {} }; return 'revision' })
  await expect(execute()).rejects.toThrow()
  expect(state.invoke).not.toHaveBeenCalled()
  expect(state.openFile).not.toHaveBeenCalled()
})

test('failed revision creation preserves pending revision and never opens an unsaved diff', async () => {
  state.invoke.mockImplementation(async (channel: string) => {
    if (channel === 'db:revision-next-index') return 2
    if (channel === 'db:revision-get-pending') return [{ id: 9 }]
    if (channel === 'db:revision-create') return { success: false, error: 'disk full' }
    return { success: true }
  })
  await expect(execute()).rejects.toThrow('disk full')
  expect(state.invoke.mock.calls.some(([channel]) => channel === 'db:revision-mark-discarded')).toBe(false)
  expect(state.openFile).not.toHaveBeenCalled()
})
