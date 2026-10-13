import { useRef, useState } from 'react'
import type { WorkflowType } from '../stores/workflow-store'

export type CompletionStatus = 'success' | 'failed' | 'timeout'

/**
 * useWorkflowCompletion — 工作流完成状态机（线③ 第 3 条：角色档案状态机抽公共 hook）
 *
 * 统一「启动工作流 → 监听 WORKFLOW_COMPLETE → 完成/失败/超时收尾」模式。
 * 原 CharacterEditor / CharactersView 两份重复状态机（archiving + timerRef + 60s 兜底）抽此 hook。
 *
 * 修复：60s 超时从「静默释放监听」改为「显式失败状态 timeout」（经 onDone 上报）；
 * 并加 workflowType 过滤，避免其他工作流完成事件误触发收尾。
 */
export function useWorkflowCompletion() {
  const [running, setRunning] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * 启动工作流并跟踪完成状态（fire-and-forget；不等待工作流结束）。
   * @param trigger 启动工作流的函数（内部调 startWorkflow / runCharacterArchive 等）
   * @param opts.workflowType 过滤目标工作流类型（避免其他工作流完成误触发）
   * @param opts.onDone 完成/失败/超时的收尾回调
   */
  const start = async (
    trigger: () => void,
    opts?: {
      workflowType?: WorkflowType
      timeoutMs?: number
      onDone?: (status: CompletionStatus) => void
    },
  ): Promise<void> => {
    setRunning(true)
    let unsub: () => void = () => {}
    const stop = (status: CompletionStatus) => {
      unsub()
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
      setRunning(false)
      opts?.onDone?.(status)
    }
    const { globalEventBus } = await import('../shared/event-bus')
    unsub = globalEventBus.on('WORKFLOW_COMPLETE', (payload) => {
      if (opts?.workflowType && payload.type !== opts.workflowType) return
      stop(payload.status === 'failed' ? 'failed' : 'success')
    })
    timerRef.current = setTimeout(() => stop('timeout'), opts?.timeoutMs ?? 60000)
    trigger()
  }

  return { running, start }
}
