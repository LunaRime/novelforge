/**
 * useOutputFileTail — 工作流步骤输出文件的「可见性驱动轮询」（M2，CC §三.4 diskOutput + TaskOutput）
 *
 * - **组件挂载才轮询，卸载即停**：enabled=false（面板关闭/组件卸载/非可见步骤）时不发起任何读取；
 *   挂载后立即读一次 + setInterval(1s) 轮询 tail（默认 4KB），卸载/停用时 clearInterval；
 * - **CircularBuffer 最近 1000 行**：跨轮把 tail 窗口的新增行并入有界行环（appendTailRing，
 *   窗口内容与行数均受限——内存恒定，输出再长也只显示最近 1000 行）；
 * - 与内存流式（step.result）是**双轨**：本 hook 只读主进程落盘文件，服务崩溃恢复续读场景
 *   （中断步骤 result 为空 + 文件在）；正在流式的步骤仍走内存渲染，不参与轮询；
 * - 轮询失败/文件不存在静默降级（exists=false，UI 兜底空态），不抛错不循环重试。
 */
import { useEffect, useState } from 'react'
import { appendTailRing, readStepOutputTail, splitTailLines } from '../services/workflow-output'
import type { WorkflowOutputTailData } from '../shared/ipc-channels'

export interface UseOutputFileTailOptions {
  runId: string
  stepIndex: number
  /** false = 不轮询也不读（组件不可见 / 步骤有内存内容） */
  enabled: boolean
  /** 轮询间隔 ms（默认 1000 = CC TaskOutput 1s 轮询） */
  intervalMs?: number
  /** tail 字节窗口（默认 4096 = CC tail 4KB） */
  maxBytes?: number
  /** CircularBuffer 行数上限（默认 1000） */
  maxLines?: number
}

export interface OutputFileTailState {
  /** 最近一次 tail 窗口内容 */
  content: string
  /** 环形缓冲行（最近 maxLines 行，跨轮去重累积） */
  lines: string[]
  /** 文件是否存在 */
  exists: boolean
  /** 是否因字节/行窗口截断 */
  truncated: boolean
  /** 文件总字节数（增量判等） */
  totalBytes: number
}

/** 初始空态（内容/行/存在性均未知时避免闪烁） */
const EMPTY_STATE: OutputFileTailState = { content: '', lines: [], exists: false, truncated: false, totalBytes: 0 }

/** 把一次 tail 结果并入轮询状态：内容未变时返回原引用（React 自动跳过重渲染） */
function mergeTailState(
  prev: OutputFileTailState,
  data: WorkflowOutputTailData,
  maxLines: number,
): OutputFileTailState {
  const incoming = splitTailLines(data.content)
  let lines = prev.lines
  // 文件增长（或首轮）→ 并入新增行；未增长 → 保持（内容未变时零重渲染）
  const grew = data.totalBytes > prev.totalBytes || prev.totalBytes === 0
  if (grew && incoming.length > 0) lines = appendTailRing(prev.lines, incoming, maxLines)
  if (
    prev.content === data.content &&
    prev.exists === data.exists &&
    prev.truncated === data.truncated &&
    prev.totalBytes === data.totalBytes &&
    prev.lines === lines
  ) {
    return prev
  }
  return { content: data.content, lines, exists: data.exists, truncated: data.truncated, totalBytes: data.totalBytes }
}

export function useOutputFileTail(options: UseOutputFileTailOptions): OutputFileTailState {
  const { runId, stepIndex, enabled, intervalMs = 1000, maxBytes = 4096, maxLines = 1000 } = options
  const [state, setState] = useState<OutputFileTailState>(EMPTY_STATE)

  useEffect(() => {
    if (!enabled) return // 组件不可见/步骤有内存内容：不读不轮询（卸载/停用即停）
    let cancelled = false
    const poll = async (): Promise<void> => {
      const data = await readStepOutputTail(runId, stepIndex, { maxBytes, maxLines })
      if (cancelled) return
      setState(prev => mergeTailState(prev, data, maxLines))
    }
    // 挂载（或启用）立即读一次，随后按 intervalMs 轮询；卸载/停用即 clearInterval
    void poll()
    const timer = setInterval(() => { void poll() }, intervalMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [enabled, runId, stepIndex, intervalMs, maxBytes, maxLines])

  return state
}
