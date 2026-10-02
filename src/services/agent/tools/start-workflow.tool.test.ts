// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startWorkflowTool } from './start-workflow.tool'
import { startChapterWorkflow, startBlueprintWorkflow, WorkflowStartError } from '../../workflows/workflow-starter'
import { t } from '../../../shared/locale'

// 工具层触发由 workflow-starter 驱动——mock 掉全部启动入口（仅保留 WorkflowStartError 等真实导出）
vi.mock('../../workflows/workflow-starter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../workflows/workflow-starter')>()
  return {
    ...actual,
    startChapterWorkflow: vi.fn(),
    startBlueprintWorkflow: vi.fn(),
    startArchitectureWorkflow: vi.fn(),
  }
})

const mockStartChapter = vi.mocked(startChapterWorkflow)

describe('start_workflow 错误语义映射', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ERR_NO_DRAFT(refine) → wfNoRefineDraft 文案（M4：三路映射补用例——本路径即 I1 参数化后的工具层口径）', async () => {
    // 注：startChapterWorkflow 被 mock，直接注入修稿语义消息（真实来源为 workflow-starter 参数化后 throw）
    mockStartChapter.mockRejectedValue(new WorkflowStartError('ERR_NO_DRAFT', t('tool.wfNoRefineDraft').replace('{chapter}', '3')))

    const r = await startWorkflowTool.execute({ workflow: 'refine', chapter_number: 3 })

    expect(r.success).toBe(false)
    expect(r.error).toBe(t('tool.wfNoRefineDraft').replace('{chapter}', '3'))
  })

  it('ERR_NO_DRAFT(finalize) → wfNoFinalizeDraft 文案（M4：finalize 分支同样回映射）', async () => {
    mockStartChapter.mockRejectedValue(new WorkflowStartError('ERR_NO_DRAFT', t('tool.wfNoFinalizeDraft').replace('{chapter}', '3')))

    const r = await startWorkflowTool.execute({ workflow: 'finalize', chapter_number: 3 })

    expect(r.success).toBe(false)
    expect(r.error).toBe(t('tool.wfNoFinalizeDraft').replace('{chapter}', '3'))
  })

  it('ERR_NO_BLUEPRINT → e.message 透传（M4：蓝图缺失归因——「零用户可见变化」声明路径）', async () => {
    const blueprintMsg = t('tool.wfBlueprintDataMissing').replace('{chapter}', '3')
    mockStartChapter.mockRejectedValue(new WorkflowStartError('ERR_NO_BLUEPRINT', blueprintMsg))

    const r = await startWorkflowTool.execute({ workflow: 'generate_draft', chapter_number: 3 })

    expect(r.success).toBe(false)
    expect(r.error).toBe(blueprintMsg)
  })

  it('成功路径正常返回 workflowStarted 文案（M4：错误映射不影响成功语义）', async () => {
    mockStartChapter.mockResolvedValue({ runId: 'run-1', displayName: t('tool.wfRefine'), chapterTag: t('tool.chapterTag').replace('{n}', '3') })

    const r = await startWorkflowTool.execute({ workflow: 'refine', chapter_number: 3 })

    expect(r.success).toBe(true)
    expect(r.content).toContain(t('tool.wfRefine'))
  })

  it('ERR_GUARD → e.message 透传（带 guard 明细；I4 覆盖回填）', async () => {
    mockStartChapter.mockRejectedValue(new WorkflowStartError('ERR_GUARD', '第2章尚未定稿，请先完成'))

    const r = await startWorkflowTool.execute({ workflow: 'generate_draft', chapter_number: 3 })

    expect(r.success).toBe(false)
    expect(r.error).toBe('第2章尚未定稿，请先完成')
  })

  it('ERR_GUARD 空 message → 回退 error.prereqNotMet（I4 覆盖回填）', async () => {
    mockStartChapter.mockRejectedValue(new WorkflowStartError('ERR_GUARD', ''))

    const r = await startWorkflowTool.execute({ workflow: 'generate_draft', chapter_number: 3 })

    expect(r.success).toBe(false)
    expect(r.error).toBe(t('error.prereqNotMet'))
  })
})

describe('start_workflow 区间（chapter_end，2026-10-02 方案 B 配套）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('闭区间：串行启动每一章，逐章返回文案与产物', async () => {
    mockStartChapter.mockImplementation(async (_wf, n) => ({
      runId: `run-${n}`,
      displayName: t('tool.wfDraft'),
      chapterTag: t('tool.chapterTag').replace('{n}', String(n)),
    }))

    const r = await startWorkflowTool.execute({ workflow: 'generate_draft', chapter_number: 5, chapter_end: 7 })

    expect(r.success).toBe(true)
    expect(mockStartChapter).toHaveBeenCalledTimes(3)
    expect(mockStartChapter.mock.calls.map(c => c[1])).toEqual([5, 6, 7])
    expect(r.artifacts).toHaveLength(3)
    expect(r.content).toContain(t('tool.chapterTag').replace('{n}', '7'))
  })

  it('chapter_end < chapter_number → wfRangeInvalid（不启动任何工作流）', async () => {
    const r = await startWorkflowTool.execute({ workflow: 'generate_draft', chapter_number: 5, chapter_end: 3 })

    expect(r.success).toBe(false)
    expect(r.error).toBe(t('tool.wfRangeInvalid'))
    expect(mockStartChapter).not.toHaveBeenCalled()
  })

  it('chapter_end === chapter_number → 等价单章（一次调用一次启动）', async () => {
    mockStartChapter.mockResolvedValue({ runId: 'r', displayName: t('tool.wfDraft'), chapterTag: t('tool.chapterTag').replace('{n}', '5') })

    const r = await startWorkflowTool.execute({ workflow: 'generate_draft', chapter_number: 5, chapter_end: 5 })

    expect(r.success).toBe(true)
    expect(mockStartChapter).toHaveBeenCalledTimes(1)
    expect(r.artifacts).toHaveLength(1)
  })

  it('区间中途失败：错误附已启动清单（模型可据此恢复，不重发整个区间），后续章未触达', async () => {
    mockStartChapter
      .mockResolvedValueOnce({ runId: 'r5', displayName: t('tool.wfReview'), chapterTag: t('tool.chapterTag').replace('{n}', '5') })
      .mockRejectedValueOnce(new WorkflowStartError('ERR_NO_DRAFT', t('tool.wfNoReviewDraft').replace('{chapter}', '6')))

    const r = await startWorkflowTool.execute({ workflow: 'review', chapter_number: 5, chapter_end: 7 })

    expect(r.success).toBe(false)
    expect(r.error).toBe(
      t('tool.wfNoReviewDraft').replace('{chapter}', '6')
      + t('tool.wfRangePartial').replace('{started}', t('tool.chapterTag').replace('{n}', '5')),
    )
    expect(mockStartChapter).toHaveBeenCalledTimes(2) // 5 已启动、6 失败即止（7 未触达）
  })

  it('非章节工作流携带 chapter_end → 忽略（不报错，按原路径执行）', async () => {
    vi.mocked(startBlueprintWorkflow).mockResolvedValue({ runId: 'rb', displayName: t('tool.wfBlueprint') })

    const r = await startWorkflowTool.execute({ workflow: 'generate_blueprint', chapter_end: 9 })

    expect(r.success).toBe(true)
  })

  it('区间过大（> 20 章）→ wfRangeTooLarge（不启动任何工作流；I1）', async () => {
    const r = await startWorkflowTool.execute({ workflow: 'generate_draft', chapter_number: 1, chapter_end: 21 })

    expect(r.success).toBe(false)
    expect(r.error).toBe(t('tool.wfRangeTooLarge').replace('{max}', '20'))
    expect(mockStartChapter).not.toHaveBeenCalled()
  })

  it('非整数 / 越界章号 → wfRangeInvalid（I1：5.5 / chapter_end 25.5 / chapter_number 0）', async () => {
    const r1 = await startWorkflowTool.execute({ workflow: 'generate_draft', chapter_number: 5.5 })
    expect(r1.success).toBe(false)
    expect(r1.error).toBe(t('tool.wfRangeInvalid'))

    const r2 = await startWorkflowTool.execute({ workflow: 'generate_draft', chapter_number: 5, chapter_end: 25.5 })
    expect(r2.success).toBe(false)
    expect(r2.error).toBe(t('tool.wfRangeInvalid'))

    const r3 = await startWorkflowTool.execute({ workflow: 'generate_draft', chapter_number: 0 })
    expect(r3.success).toBe(false)
    expect(r3.error).toBe(t('tool.wfRangeInvalid'))

    expect(mockStartChapter).not.toHaveBeenCalled()
  })
})
