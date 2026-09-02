// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkflowStore } from './workflow-store'

// IPC 桩：renderLog（addLog → log:write）在测试环境静默，避免 velaAPI 未注入告警噪音
beforeEach(() => {
  Object.defineProperty(window, 'velaAPI', {
    value: {
      invoke: async () => null,
      on: () => () => {},
      once: () => {},
      send: () => {},
      setZoomLevel: () => {},
      setZoomFactor: () => {},
      getZoomLevel: () => 0,
    },
    configurable: true,
  })
})

// ===== 工厂 =====

const CHECKPOINT_KEY = 'vela-workflow-checkpoint'

const step = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `步骤-${id}`,
  description: '',
  status: 'completed',
  logs: [],
  ...over,
})

const run = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  type: 'chapter_creation',
  title: '第 1 章创作',
  status: 'running',
  currentStepIndex: 1,
  createdAt: '2026-08-29T00:00:00.000Z',
  steps: [
    step('s1', { status: 'completed', result: '第一章正文（干净）', completedAt: '2026-08-29T00:01:00.000Z' }),
    step('s2', { status: 'running', result: '半截正文<think>流式中断', logs: ['<think>x</think>中途日志'], startedAt: '2026-08-29T00:02:00.000Z' }),
    step('s3', { status: 'pending' }),
  ],
  ...over,
})

const resetStore = () => {
  useWorkflowStore.setState({
    activeRuns: [],
    history: [],
    globalLogs: [],
    waitingRuns: {},
    currentRun: null,
    waitingForConfirm: false,
    waitingAfterStepIndex: -1,
  })
}

beforeEach(() => {
  localStorage.clear()
  resetStore()
})

describe('restoreCheckpoint 恢复净化', () => {
  it('运行中中断（崩溃残片）→ paused，steps 内 think/tool 残片被净化', () => {
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify({
      activeRuns: [run('run-1')],
      waitingRuns: {},
      savedAt: '2026-08-29T00:03:00.000Z',
    }))
    const cp = useWorkflowStore.getState().restoreCheckpoint()
    expect(cp).not.toBeNull()
    const restored = useWorkflowStore.getState().activeRuns
    expect(restored).toHaveLength(1)
    expect(restored[0]!.id).toBe('run-1')
    expect(restored[0]!.status).toBe('paused')
    // 干净正文零改动
    expect(restored[0]!.steps[0]!.result).toBe('第一章正文（干净）')
    // 崩溃残片净化（result 未闭合 think / logs think）
    expect(restored[0]!.steps[1]!.result).toBe('半截正文')
    expect(restored[0]!.steps[1]!.logs).toEqual(['中途日志'])
    expect(cp!.activeRuns[0]!.steps[1]!.result).toBe('半截正文')
  })

  it('步进等待中断 → failed 且等待标记清除（既有语义不回归）', () => {
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify({
      activeRuns: [
        run('run-wait', { status: 'waiting' }),
        run('run-run', { status: 'running' }),
      ],
      waitingRuns: { 'run-wait': { waitingForConfirm: true, waitingAfterStepIndex: 0 } },
      savedAt: '2026-08-29T00:03:00.000Z',
    }))
    useWorkflowStore.getState().restoreCheckpoint()
    const restored = useWorkflowStore.getState().activeRuns
    const waitRun = restored.find(r => r.id === 'run-wait')
    const normalRun = restored.find(r => r.id === 'run-run')
    expect(waitRun?.status).toBe('failed')
    expect(normalRun?.status).toBe('paused')
    expect(useWorkflowStore.getState().waitingRuns).toEqual({})
  })

  it('正常 checkpoint（无残片）恢复零改动——result/logs 逐字保留', () => {
    const cleanRun = {
      id: 'run-clean',
      type: 'directory',
      title: '目录生成',
      status: 'paused',
      currentStepIndex: 0,
      createdAt: '2026-08-29T00:00:00.000Z',
      steps: [
        step('p1', { status: 'completed', result: '目录正文\n\n含空行与缩进  ', completedAt: 'x' }),
      ],
    }
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify({
      activeRuns: [cleanRun],
      waitingRuns: {},
      savedAt: '2026-08-29T00:01:00.000Z',
    }))
    const cp = useWorkflowStore.getState().restoreCheckpoint()!
    expect(useWorkflowStore.getState().activeRuns[0]!.steps[0]!.result).toBe('目录正文\n\n含空行与缩进  ')
    expect(cp.activeRuns).toEqual([cleanRun])
  })

  it('损坏 checkpoint（activeRuns 非数组）→ null，不崩不恢复（曾致启动崩溃）', () => {
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify({ activeRuns: 'corrupt', savedAt: 'x' }))
    expect(() => useWorkflowStore.getState().restoreCheckpoint()).not.toThrow()
    expect(useWorkflowStore.getState().restoreCheckpoint()).toBeNull()
    expect(useWorkflowStore.getState().activeRuns).toHaveLength(0)
  })

  it('步骤内坏 shape（run 缺 id / step 非对象）→ 丢弃，合法数据保留', () => {
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify({
      activeRuns: [
        run('good'),
        { type: 'no-id', steps: [] },
        { id: 'no-steps', status: 'running' },
      ],
      waitingRuns: {},
      savedAt: 'x',
    }))
    const cp = useWorkflowStore.getState().restoreCheckpoint()
    expect(cp!.activeRuns.map(r => r.id)).toEqual(['good'])
    expect(useWorkflowStore.getState().activeRuns.map(r => r.id)).toEqual(['good'])
  })
})
