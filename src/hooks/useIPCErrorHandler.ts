/**
 * useIPCErrorHandler — 统一 IPC 错误处理 Hook
 *
 * 返回标准化错误处理回调，统一 toast 提示和日志记录。
 * 用于替代组件中散落的 console.warn + toast.error 模式。
 *
 * @returns handleIPCError — 接收 IPC 返回结果，失败时自动 toast
 *
 * @example
 * const handleError = useIPCErrorHandler()
 * const result = await ipc.invoke('fs:write-file', path, text)
 * handleError(result, '保存失败')
 */
import { useCallback } from 'react'
import { toast } from '../components/ui/Toast'

/** 典型的 IPC 返回值形状（含 success 字段） */
interface IPCLikeResult {
  success?: boolean
  error?: string
}

export function useIPCErrorHandler() {
  const handleIPCError = useCallback((result: IPCLikeResult | unknown, fallbackMsg: string) => {
    if (result && typeof result === 'object' && 'success' in result) {
      const r = result as IPCLikeResult
      if (r.success === false) {
        const msg = r.error || fallbackMsg
        console.warn(`[IPC] ${msg}`)
        toast.error(msg)
        return true // 表示有错误
      }
    }
    return false
  }, [])

  return handleIPCError
}
