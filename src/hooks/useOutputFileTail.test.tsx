// @vitest-environment jsdom
/**
 * useOutputFileTail — 输出文件「可见性驱动轮询」（M2，CC §三.4）
 *
 * - 挂载才轮询：enabled=false 零读取；enabled=true 挂载即读一次 + 每 1s 轮询；
 * - 卸载即停 / 停用即停：组件卸载或 enabled=false 后 clearInterval，不再发起读取；
 * - CircularBuffer：跨轮把 tail 新增行并入有界行环（最近 maxLines 行），内容未变不重复并入。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { useOutputFileTail, type UseOutputFileTailOptions, type OutputFileTailState } from './useOutputFileTail'

// ===== IPC 桩：记录 tail 调用并返回按调用序号编排的响应 =====
let tailResponses: Array<{ content: string; exists?: boolean; totalBytes: number }>
let tailCalls: number

beforeEach(() => {
  tailResponses = []
  tailCalls = 0
  Object.defineProperty(window, 'velaAPI', {
    value: {
      invoke: async (channel: string) => {
        if (channel === 'fs:workflow-output-tail') {
          const idx = Math.min(tailCalls, tailResponses.length - 1)
          tailCalls += 1
          const r = tailResponses[idx] ?? { content: '', totalBytes: 0 }
          return { success: true, exists: r.exists !== false, content: r.content, totalBytes: r.totalBytes, truncated: false }
        }
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
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

function Probe({ options }: { options: UseOutputFileTailOptions }) {
  const state = useOutputFileTail(options)
  return <div data-state={JSON.stringify(state)} />
}

function readState(container: HTMLElement): OutputFileTailState {
  const raw = container.querySelector('[data-state]')!.getAttribute('data-state')!
  return JSON.parse(raw) as OutputFileTailState
}

async function flush() {
  await act(async () => {})
}

describe('挂载门控（不可见任务不轮询）', () => {
  it('enabled=false 零读取；启用后立即读一次并按 1s 轮询', async () => {
    vi.useFakeTimers()
    tailResponses = [{ content: 'line1', totalBytes: 5 }, { content: 'line1\nline2', totalBytes: 11 }]
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    act(() => { root.render(<Probe options={{ runId: 'r1', stepIndex: 0, enabled: false }} />) })
    await flush()
    expect(tailCalls).toBe(0) // 不可见：不轮询

    act(() => { root.render(<Probe options={{ runId: 'r1', stepIndex: 0, enabled: true }} />) })
    await flush()
    expect(tailCalls).toBe(1) // 挂载/启用立即读

    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(tailCalls).toBe(2) // 1s 轮询
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(tailCalls).toBe(3)

    act(() => { root.unmount() })
    document.body.removeChild(container)
  })

  it('卸载即停：unmount 后 timer 清理，不再读取', async () => {
    vi.useFakeTimers()
    tailResponses = [{ content: 'x', totalBytes: 1 }]
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    act(() => { root.render(<Probe options={{ runId: 'r1', stepIndex: 0, enabled: true }} />) })
    await flush()
    expect(tailCalls).toBe(1)
    act(() => { root.unmount() })
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(tailCalls).toBe(1) // 卸载后无任何轮询
    document.body.removeChild(container)
  })

  it('停用即停：enabled 变 false 后停止轮询；重新启用恢复', async () => {
    vi.useFakeTimers()
    tailResponses = [{ content: 'x', totalBytes: 1 }, { content: 'x', totalBytes: 1 }, { content: 'x', totalBytes: 1 }]
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    act(() => { root.render(<Probe options={{ runId: 'r1', stepIndex: 0, enabled: true }} />) })
    await flush()
    expect(tailCalls).toBe(1)

    act(() => { root.render(<Probe options={{ runId: 'r1', stepIndex: 0, enabled: false }} />) })
    await act(async () => { vi.advanceTimersByTime(3000) })
    expect(tailCalls).toBe(1) // 停用后 timer 已清

    act(() => { root.render(<Probe options={{ runId: 'r1', stepIndex: 0, enabled: true }} />) })
    await flush()
    expect(tailCalls).toBe(2) // 重新启用立即恢复
    act(() => { root.unmount() })
    document.body.removeChild(container)
  })
})

describe('tail 窗口 + CircularBuffer（最近 maxLines 行）', () => {
  it('内容并入环形缓冲：尾部增长只并入新增行，内容未变不重复并入', async () => {
    vi.useFakeTimers()
    tailResponses = [
      { content: 'line1\nline2', totalBytes: 11 },
      { content: 'line1\nline2\nline3', totalBytes: 17 }, // 增长：新增 line3
      { content: 'line1\nline2\nline3', totalBytes: 17 }, // 未变：去重
    ]
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    act(() => { root.render(<Probe options={{ runId: 'r1', stepIndex: 0, enabled: true, intervalMs: 1000 }} />) })
    await flush()
    expect(readState(container).lines).toEqual(['line1', 'line2'])
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(readState(container).lines).toEqual(['line1', 'line2', 'line3'])
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(readState(container).lines).toEqual(['line1', 'line2', 'line3']) // 未增长去重
    act(() => { root.unmount() })
    document.body.removeChild(container)
  })

  it('行数超过 maxLines（1000 语义）只保留最近 N 行', async () => {
    const longLines = Array.from({ length: 5 }, (_, i) => `r${i}`)
    tailResponses = [{ content: longLines.join('\n'), totalBytes: 14 }]
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    act(() => { root.render(<Probe options={{ runId: 'r1', stepIndex: 0, enabled: true, maxLines: 3 }} />) })
    await flush()
    expect(readState(container).lines).toEqual(['r2', 'r3', 'r4'])
    expect(readState(container).content).toBe(longLines.join('\n'))
    act(() => { root.unmount() })
    document.body.removeChild(container)
  })

  it('文件不存在降级：exists=false + 空内容，不抛错不循环', async () => {
    tailResponses = [{ content: '', exists: false, totalBytes: 0 }]
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    act(() => { root.render(<Probe options={{ runId: 'r1', stepIndex: 0, enabled: true }} />) })
    await flush()
    const s = readState(container)
    expect(s.exists).toBe(false)
    expect(s.content).toBe('')
    expect(s.lines).toEqual([])
    act(() => { root.unmount() })
    document.body.removeChild(container)
  })
})
