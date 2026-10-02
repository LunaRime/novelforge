// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorkflowStartError, startChapterWorkflow } from './workflow-starter'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { t } from '../../shared/locale'

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

/** startWorkflow mock（workflow-starter 经 useWorkflowStore.getState().startWorkflow 触发）
 *  C1（2026-10-02）：真实 store 在 run 开始即回调 options.onStarted——mock 按同契约提供回执 */
const startWorkflowMock = vi.fn(async (_def: unknown, _sb?: boolean, options?: { onStarted?: (id: string) => void }) => {
  options?.onStarted?.('run-1-test')
  return 'run-1-test'
})

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
    expect(err.message).toBe(t('tool.wfNoReviewDraft').replace('{chapter}', '1'))
    expect(startWorkflowMock).not.toHaveBeenCalled()
  })

  it('refine 无草稿 → ERR_NO_DRAFT message 为 wfNoRefineDraft 文案（I1：按 workflow 参数化——意图层透传 e.message 不再报「审稿」）', async () => {
    const err = await startChapterWorkflow('refine', 1).catch(e => e)
    expect(err).toBeInstanceOf(WorkflowStartError)
    expect(err).toMatchObject({ code: 'ERR_NO_DRAFT' })
    expect(err.message).toBe(t('tool.wfNoRefineDraft').replace('{chapter}', '1'))
    expect(startWorkflowMock).not.toHaveBeenCalled()
  })

  it('finalize 无草稿 → ERR_NO_DRAFT message 为 wfNoFinalizeDraft 文案（I1 三分支同构回归）', async () => {
    const err = await startChapterWorkflow('finalize', 1).catch(e => e)
    expect(err).toBeInstanceOf(WorkflowStartError)
    expect(err).toMatchObject({ code: 'ERR_NO_DRAFT' })
    expect(err.message).toBe(t('tool.wfNoFinalizeDraft').replace('{chapter}', '1'))
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

  // ===== C1（2026-10-02 评审）：启动即回执——引擎工具超时 30s 且不中止执行，等待型回执必被腰斩 =====

  /** guard 放行 fixture（与「正常触发」同） */
  function passGuardFixtures(): void {
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
  }

  it('启动即回执：onStarted 一到即 resolve，不等整个 run 结束', async () => {
    passGuardFixtures()
    let settleRun: (v: string) => void = () => {}
    const runPending = new Promise<string>(res => { settleRun = res })
    let runSettled = false
    useWorkflowStore.setState({
      startWorkflow: vi.fn((_def: unknown, _sb?: boolean, options?: { onStarted?: (id: string) => void }) => {
        options?.onStarted?.('run-early')
        return runPending.then(v => { runSettled = true; return v })
      }) as never,
    })

    const r = await startChapterWorkflow('generate_draft', 3)

    expect(r.runId).toBe('run-early')
    expect(runSettled).toBe(false) // 回执不等待 run 结束——否则引擎 30s 超时腰斩（C1）
    settleRun('run-early') // 收口后台 promise（防泄漏）
  })

  it('run 晚到 rejection 被吞掉（不产生 unhandledrejection，不影响回执）', async () => {
    passGuardFixtures()
    let rejectRun: (e: unknown) => void = () => {}
    const runPending = new Promise<string>((_res, rej) => { rejectRun = rej })
    useWorkflowStore.setState({
      startWorkflow: vi.fn((_def: unknown, _sb?: boolean, options?: { onStarted?: (id: string) => void }) => {
        options?.onStarted?.('run-early')
        return runPending
      }) as never,
    })

    const r = await startChapterWorkflow('generate_draft', 3)
    expect(r.runId).toBe('run-early')

    rejectRun(new Error('run 体内爆'))
    await new Promise(res => setTimeout(res, 0)) // 让晚到 rejection settle；若未被吞掉会以 unhandledrejection 使用例失败
  })
})
