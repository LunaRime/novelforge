// @vitest-environment jsdom
/* eslint-disable react-hooks/globals, react-hooks/immutability -- 测试 harness 需在 render 期捕获 hook 返回值 */
/**
 * useWorkflowCompletion — 工作流完成状态机契约（线③ 第 3 条）
 *
 * 契约：start 后 running=true；WORKFLOW_COMPLETE 按 workflowType 过滤、按 status 区分
 * success/failed；超时经 onDone('timeout') 显式上报（替代静默释放）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { useWorkflowCompletion } from './useWorkflowCompletion'
import { globalEventBus } from '../shared/event-bus'

let container: HTMLDivElement | null = null
let root: Root | null = null
// Harness 把 hook 返回值暴露到外部对象（对象属性赋值，规避 react-hooks/globals 的变量 reassign 规则）
const captured: { value: ReturnType<typeof useWorkflowCompletion> | null } = { value: null }

function Harness() {
  captured.value = useWorkflowCompletion()
  return null
}

function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(<Harness />) })
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  captured.value = null
  vi.useRealTimers()
})

describe('useWorkflowCompletion（线③ 第 3 条）', () => {
  it('start 后 running=true；WORKFLOW_COMPLETE(success) 收尾 running=false 且 onDone=success', async () => {
    render()
    const onDone = vi.fn()
    let triggerRan = false
    await act(async () => {
      await captured.value!.start(() => { triggerRan = true }, { workflowType: 'post_process', onDone })
    })
    expect(triggerRan).toBe(true)
    expect(captured.value!.running).toBe(true)

    act(() => { globalEventBus.emit('WORKFLOW_COMPLETE', { type: 'post_process', status: 'success' }) })
    expect(captured.value!.running).toBe(false)
    expect(onDone).toHaveBeenCalledWith('success')
  })

  it('status=failed → onDone=failed', async () => {
    render()
    const onDone = vi.fn()
    await act(async () => { await captured.value!.start(() => {}, { workflowType: 'post_process', onDone }) })
    act(() => { globalEventBus.emit('WORKFLOW_COMPLETE', { type: 'post_process', status: 'failed' }) })
    expect(onDone).toHaveBeenCalledWith('failed')
  })

  it('workflowType 过滤：其他 type 的完成事件不触发收尾', async () => {
    render()
    const onDone = vi.fn()
    await act(async () => { await captured.value!.start(() => {}, { workflowType: 'post_process', onDone }) })
    act(() => { globalEventBus.emit('WORKFLOW_COMPLETE', { type: 'chapter_creation', status: 'success' }) })
    expect(captured.value!.running).toBe(true)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('超时（短 timeoutMs）→ onDone=timeout 显式上报', async () => {
    vi.useFakeTimers()
    render()
    const onDone = vi.fn()
    await act(async () => { await captured.value!.start(() => {}, { workflowType: 'post_process', timeoutMs: 50, onDone }) })
    expect(captured.value!.running).toBe(true)
    act(() => { vi.advanceTimersByTime(60) })
    expect(captured.value!.running).toBe(false)
    expect(onDone).toHaveBeenCalledWith('timeout')
  })
})
