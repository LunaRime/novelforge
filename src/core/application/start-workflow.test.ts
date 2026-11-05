import { describe, expect, test, vi } from 'vitest'
import { startWorkflow, WorkflowStartError, type WorkflowStartPort, type WorkflowStartRequest } from './start-workflow'

function fixture() {
  const prepared = { definition: { steps: [] }, displayName: 'Workflow', chapterTag: 'Chapter 1' }
  const port: WorkflowStartPort<{ steps: never[] }> = {
    chapter: vi.fn(async () => prepared), blueprint: vi.fn(async () => prepared),
    architecture: vi.fn(async () => prepared), book: vi.fn(async () => prepared),
    config: vi.fn(async () => prepared), start: vi.fn(async () => 'run-1'),
    repair: vi.fn(async () => prepared),
    fillGaps: vi.fn(async () => prepared),
    write: vi.fn(async () => prepared), importNovel: vi.fn(async () => ({ ...prepared, stepByStep: true })),
    configField: vi.fn(async () => prepared),
    extractCharacters: vi.fn(async () => prepared), repairCharacters: vi.fn(async () => prepared),
  }
  return { port, prepared }
}

describe('startWorkflow', () => {
  test.each([
    [{ workflow: 'generate_draft', chapterNumber: 1 }, 'chapter'],
    [{ workflow: 'review', chapterNumber: 1 }, 'chapter'],
    [{ workflow: 'refine', chapterNumber: 1 }, 'chapter'],
    [{ workflow: 'finalize', chapterNumber: 1 }, 'chapter'],
    [{ workflow: 'generate_blueprint' }, 'blueprint'],
    [{ workflow: 'generate_architecture' }, 'architecture'],
    [{ workflow: 'generate_book', chapterStart: 1, chapterEnd: 2 }, 'book'],
    [{ workflow: 'config_generation', idea: 'a story' }, 'config'],
    [{ workflow: 'repair_finalize', chapterNumber: 1 }, 'repair'],
    [{ workflow: 'fill_blueprint_gaps', gaps: [{ missingChapterNumbers: [1], gapSize: 1, context: 'Context' }] }, 'fillGaps'],
    [{ workflow: 'generate_config_field', fieldKey: 'coreOutline' }, 'configField'],
    [{ workflow: 'extract_arch_characters', projectPath: '/project', characterDynamicsContent: 'Characters', genre: 'Genre' }, 'extractCharacters'],
    [{ workflow: 'repair_arch_characters', projectPath: '/project' }, 'repairCharacters'],
  ] as const)('dispatches %o and returns the start receipt', async (request, builder) => {
    const { port, prepared } = fixture()
    expect(await startWorkflow(request, port)).toEqual({ runId: 'run-1', displayName: 'Workflow', chapterTag: 'Chapter 1' })
    expect(port[builder]).toHaveBeenCalledTimes(1)
    expect(port.start).toHaveBeenCalledWith(prepared.definition)
  })

  test.each([
    { workflow: 'review', chapterNumber: 0 },
    { workflow: 'refine', chapterNumber: 1.5 },
    { workflow: 'generate_book', chapterStart: 3, chapterEnd: 2 },
    { workflow: 'generate_book', chapterStart: 1, chapterEnd: 101 },
    { workflow: 'config_generation', idea: '  ' },
    { workflow: 'unknown' },
    { workflow: 'fill_blueprint_gaps', gaps: [] },
    { workflow: 'generate_blueprint', directory: { mode: 'full', count: 0 } },
    { workflow: 'import_novel', chapters: [] },
    { workflow: 'generate_config_field', fieldKey: 'unknown' },
  ])('rejects invalid requests before building or starting (%o)', async request => {
    const { port } = fixture()
    await expect(startWorkflow(request as WorkflowStartRequest, port)).rejects.toThrow()
    for (const method of Object.values(port)) expect(method).not.toHaveBeenCalled()
  })

  test('preserves guard error identity without starting a run', async () => {
    const { port } = fixture()
    const error = new WorkflowStartError('ERR_NO_DRAFT', 'No draft')
    vi.mocked(port.chapter).mockRejectedValue(error)
    await expect(startWorkflow({ workflow: 'review', chapterNumber: 1 }, port)).rejects.toBe(error)
    expect(port.start).not.toHaveBeenCalled()
  })

  test('passes an explicit editor draft and review guidance to the adapter', async () => {
    const { port } = fixture()
    const draft = { draftPath: 'vela://draft/42', draftContent: 'body', chapterTitle: 'Title', reviewReport: 'Review', userRefinePrompt: 'Guidance' }
    await startWorkflow({ workflow: 'refine', chapterNumber: 3, draft }, port)
    expect(port.chapter).toHaveBeenCalledWith('refine', 3, draft)
  })

  test('rejects an explicit draft with an invalid identity before starting', async () => {
    const { port } = fixture()
    await expect(startWorkflow({ workflow: 'review', chapterNumber: 1, draft: {
      draftPath: '../draft.md', draftContent: 'body', chapterTitle: 'Title',
    } }, port)).rejects.toThrow()
    expect(port.start).not.toHaveBeenCalled()
  })

  test('starts imported chapters in step mode without discarding the original text', async () => {
    const { port, prepared } = fixture()
    const chapters = [{ number: 1, title: 'Title', content: 'Body\n', wordCount: 4 }]
    await startWorkflow({ workflow: 'import_novel', chapters }, port)
    expect(port.importNovel).toHaveBeenCalledWith(chapters)
    expect(port.start).toHaveBeenCalledWith(prepared.definition, true)
  })

  test('preserves explicit chapter creation inputs', async () => {
    const { port } = fixture()
    const chapterInfo = { chapterNumber: 3, title: 'Title', role: 'Role', purpose: 'Purpose', characters: ['A'], keyEvents: 'Events', knowledgeQueryHint: 'Hint' }
    await startWorkflow({ workflow: 'generate_draft', chapterNumber: 3, chapterInfo }, port)
    expect(port.write).toHaveBeenCalledWith(chapterInfo)
  })
})
