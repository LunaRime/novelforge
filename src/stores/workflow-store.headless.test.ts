// @vitest-environment jsdom
/**
 * workflow-store × headless 选项（D 档写作自动化）
 *
 * 自动触发的工作流不得抢焦点：startWorkflow 此前硬编码「打开底栏任务面板 + 右侧 AI 输出视图」，
 * headless 选项只跳过这两行 —— checkpoint / 事件 / 状态流转一字不动（改动错会波及所有既有工作流）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useWorkflowStore, type WorkflowDefinition } from './workflow-store'
import { useLayoutStore } from './layout-store'

const invokeCalls: Array<{ channel: string; args: unknown[] }> = []

beforeEach(() => {
  invokeCalls.length = 0
  Object.defineProperty(window, 'velaAPI', {
    value: {
      invoke: async (channel: string, ...args: unknown[]) => {
        invokeCalls.push({ channel, args })
        return { success: true }
      },
      on: () => () => {},
      once: () => {},
      send: () => {},
      setZoomLevel: () => {},
      setZoomFactor: () => {},
      getZoomLevel: () => 0,
    },
    configurable: true,
  })
  useWorkflowStore.setState({
    activeRuns: [], history: [], globalLogs: [], waitingRuns: {},
    currentRun: null, waitingForConfirm: false, waitingAfterStepIndex: -1,
  })
  useLayoutStore.setState({ bottomPanelOpen: false, aiPanelOpen: false })
})

afterEach(() => {
  localStorage.clear()
})

function makeDefinition(): WorkflowDefinition {
  return {
    type: 'chapter_creation',
    title: '测试工作流',
    steps: [{
      name: '步骤一',
      description: '',
      executor: async (_step, _ctx, callbacks) => {
        callbacks.appendText('产出')
        return undefined
      },
    }],
  }
}

/** 面板打开是 layout-store 的非阻塞 import 触发的，需让微任务队列走完 */
const flushMicrotasks = () => new Promise<void>(resolve => setTimeout(resolve, 0))

describe('startWorkflow headless 选项', () => {
  it('headless: true 不打开底栏与右侧面板', async () => {
    await useWorkflowStore.getState().startWorkflow(makeDefinition(), false, { headless: true })
    await flushMicrotasks()
    expect(useLayoutStore.getState().bottomPanelOpen).toBe(false)
    expect(useLayoutStore.getState().aiPanelOpen).toBe(false)
  })

  it('不传 options 时行为与既有完全一致（打开底栏与右侧面板）', async () => {
    await useWorkflowStore.getState().startWorkflow(makeDefinition())
    await flushMicrotasks()
    expect(useLayoutStore.getState().bottomPanelOpen).toBe(true)
    expect(useLayoutStore.getState().aiPanelOpen).toBe(true)
  })

  it('headless: true 其余行为不变（步骤照跑、产出照写、run 进历史）', async () => {
    const runId = await useWorkflowStore.getState().startWorkflow(makeDefinition(), false, { headless: true })
    const run = useWorkflowStore.getState().history.find(r => r.id === runId)!
    expect(run.steps[0].status).toBe('completed')
    expect(run.steps[0].result).toBe('产出')
  })

  it('onStarted 在 run 结束前回调 runId（自动化侧据此立刻拿到 refId，不必等执行完成）', async () => {
    let startedId: string | null = null
    let stepFinished = false
    const slow: WorkflowDefinition = {
      type: 'chapter_creation',
      title: '慢工作流',
      steps: [{
        name: '步骤一',
        description: '',
        executor: async () => {
          await new Promise(resolve => setTimeout(resolve, 30))
          stepFinished = true
          return undefined
        },
      }],
    }
    const pending = useWorkflowStore.getState().startWorkflow(slow, false, {
      headless: true,
      onStarted: (id) => { startedId = id },
    })
    await new Promise(resolve => setTimeout(resolve, 10))
    // 10ms 时：已拿到 runId，而步骤仍在执行
    expect(startedId).toBeTruthy()
    expect(stepFinished).toBe(false)
    const runId = await pending
    expect(startedId).toBe(runId)
  })
})
