// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorkflowStartError, startChapterWorkflow } from './workflow-starter'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore } from '../../stores/workflow-store'

// ---- ipc 通道路由（window.velaAPI.invoke——参照 agent-store.test.ts:10-28/:59 模式）----
// 默认全部为空/缺失；各用例按需覆盖。未路由通道（如 db:post-process-get-latest-run）返回 null——
// 后处理状态文件不存在视为旧版定稿，兼容放行（guardChapterWriting 行为）
let blueprintGetAll: unknown[]
let characterGetAll: unknown[]
let blueprintGetResult: unknown
let draftListResult: unknown[]
let draftGetFinalizedResult: unknown

const mockInvoke = vi.fn(async (ch: string) => {
  switch (ch) {
    case 'db:blueprint-get-all':
      return blueprintGetAll
    case 'db:character-get-all':
      return characterGetAll
    case 'db:blueprint-get':
      return blueprintGetResult
    case 'db:draft-list':
      return draftListResult
    case 'db:draft-get-finalized':
      return draftGetFinalizedResult
    default:
      return null
  }
})

/** startWorkflow mock（workflow-starter 经 useWorkflowStore.getState().startWorkflow 触发） */
const startWorkflowMock = vi.fn(async () => 'run-1-test')

beforeEach(() => {
  vi.clearAllMocks()
  blueprintGetAll = []
  characterGetAll = []
  blueprintGetResult = null
  draftListResult = []
  draftGetFinalizedResult = null
  Object.defineProperty(window, 'velaAPI', { value: { invoke: mockInvoke }, configurable: true })
  // 项目 fixture（guardChapterWriting / readPostProcessStatus 读取 currentProject）
  useProjectStore.setState({
    currentProject: {
      id: 'test-project',
      name: '测试项目',
      path: '/tmp/test-project',
      novelConfig: {
        genre: '玄幻',
        subGenre: '东方玄幻',
        targetAudience: '男频',
        totalChapters: 100,
        wordsPerChapter: 2000,
        plotStructure: 'three_act',
        narrativePOV: 'third_limited',
        coreOutline: '',
        worldSetting: '',
        goldenFinger: '',
        protagonistProfile: '',
        globalGuidance: '',
      },
      characterStates: '',
      createdAt: 0,
      updatedAt: 0,
    },
  })
  useWorkflowStore.setState({ startWorkflow: startWorkflowMock as never })
})

describe('workflow-starter', () => {
  it('guard 失败 → throw WorkflowStartError ERR_GUARD', async () => {
    // db:blueprint-get-all → [] → guardChapterWriting 失败（无任何章节蓝图）
    const err = await startChapterWorkflow('generate_draft', 1).catch(e => e)
    expect(err).toBeInstanceOf(WorkflowStartError)
    expect(err).toMatchObject({ code: 'ERR_GUARD' })
    expect(startWorkflowMock).not.toHaveBeenCalled()
  })

  it('无草稿 → throw ERR_NO_DRAFT（不再返回 null）', async () => {
    // db:draft-list → [] → getLatestDraft 返回 null
    const err = await startChapterWorkflow('review', 1).catch(e => e)
    expect(err).toBeInstanceOf(WorkflowStartError)
    expect(err).toMatchObject({ code: 'ERR_NO_DRAFT' })
    expect(startWorkflowMock).not.toHaveBeenCalled()
  })

  it('蓝图缺失 → throw ERR_NO_BLUEPRINT（P0-3：不误归 ERR_GUARD）', async () => {
    // guard 通过（蓝图/角色卡存在），但 db:blueprint-get → null（getChapterInfoFromBlueprint 取不到）
    blueprintGetAll = [{ id: 1, title: '第1章 山门' }]
    characterGetAll = [{ id: 'c1', name: '主角' }]
    const err = await startChapterWorkflow('generate_draft', 1).catch(e => e)
    expect(err).toBeInstanceOf(WorkflowStartError)
    expect(err).toMatchObject({ code: 'ERR_NO_BLUEPRINT' })
    expect(startWorkflowMock).not.toHaveBeenCalled()
  })

  it('正常触发 → 返回 runId + displayName + chapterTag', async () => {
    // guard 通过：第 3 章需前一章（第 2 章）已定稿（db:draft-get-finalized → meta，
    // 后处理状态 db:post-process-get-latest-run → null 视为旧版定稿兼容放行）
    blueprintGetAll = [{ id: 1, title: '第1章 山门' }]
    characterGetAll = [{ id: 'c1', name: '主角' }]
    draftGetFinalizedResult = { id: 'd2', title: '第2章' }
    blueprintGetResult = {
      id: 1,
      chapterNumber: 3,
      title: '第3章 惊变',
      role: '过渡',
      purpose: '推进主线',
      characters: ['主角'],
      keyEvents: '山门剧变',
      userGuidance: '保持悬念',
    }
    const r = await startChapterWorkflow('generate_draft', 3)
    expect(r.runId).toBe('run-1-test')
    expect(r.displayName).toBeTruthy()
    expect(r.chapterTag).toBeTruthy()
    expect(startWorkflowMock).toHaveBeenCalledTimes(1)
  })
})
