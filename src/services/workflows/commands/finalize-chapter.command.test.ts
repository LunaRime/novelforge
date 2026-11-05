import { beforeEach, expect, test, vi } from 'vitest'
vi.mock('./base-command', () => ({ BaseWorkflowCommand: class {} }))
vi.mock('../../ipc-client', () => ({ ipc: { invoke: vi.fn() } }))
vi.mock('../../../stores/project-store', () => ({ useProjectStore: { getState: vi.fn() } }))
vi.mock('../../../stores/llm-store', () => ({ useLLMStore: { getState: vi.fn() } }))
vi.mock('../chapter-workflow', () => ({ parseDraftMeta: vi.fn() }))
vi.mock('../workflow-utils', () => ({ runPostProcessPipeline: vi.fn(), getChapterFinalizeScope: vi.fn(), stripThinkingTags: (s: string) => s }))
import { FinalizeChapterCommand } from './finalize-chapter.command'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import { parseDraftMeta } from '../chapter-workflow'

const project = { id: 'project-a', path: '/project-a' }
const execute = () => new FinalizeChapterCommand({ draftPath: 'vela://draft/1', draftContent: '正文', chapterNumber: 1,
  chapterInfo: { title: '标题' } as never }).execute({ callbacks: { log: vi.fn() } } as never)
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useProjectStore.getState).mockReturnValue({ currentProject: project, refreshFileTree: vi.fn() } as never)
  vi.mocked(parseDraftMeta).mockResolvedValue({ id: 1, chapterNumber: 1 } as never)
  vi.mocked(ipc.invoke).mockResolvedValue({ success: true } as never)
})
test('failed content commit cannot mark draft finalized or run downstream writes', async () => {
  vi.mocked(ipc.invoke).mockResolvedValue({ success: false, error: 'write failed' } as never)
  await expect(execute()).rejects.toThrow('write failed')
  expect(vi.mocked(ipc.invoke).mock.calls.map(c => c[0])).toEqual(['db:draft-update-content'])
})
test('failed status commit stops export and postprocessing', async () => {
  vi.mocked(ipc.invoke).mockResolvedValueOnce({ success: true } as never).mockResolvedValueOnce({ success: false, error: 'status failed' } as never)
  await expect(execute()).rejects.toThrow('status failed')
  expect(vi.mocked(ipc.invoke).mock.calls.map(c => c[0])).toEqual(['db:draft-update-content', 'db:draft-update-status'])
})
test('project change during draft lookup must stop before writing', async () => {
  vi.mocked(parseDraftMeta).mockImplementationOnce(async () => {
    vi.mocked(useProjectStore.getState).mockReturnValue({ currentProject: { id: 'project-b', path: '/project-b' } } as never)
    return { id: 1, chapterNumber: 1 } as never
  })
  await expect(execute()).rejects.toThrow()
  expect(ipc.invoke).not.toHaveBeenCalled()
})
