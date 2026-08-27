// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startWorkflowTool } from './start-workflow.tool'
import { startChapterWorkflow, WorkflowStartError } from '../../workflows/workflow-starter'
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
})
