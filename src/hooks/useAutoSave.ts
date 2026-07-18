/**
 * useAutoSave — 自动保存 Hook
 *
 * 通用自动保存定时器封装，从 DraftEditor 中提取复用。
 * 组件卸载时自动清除定时器，saveFn 通过 ref 保持最新引用避免闭包过期。
 *
 * @param filePath      关联的文件路径（定时器重新初始化依赖）
 * @param contentRef    当前内容的 RefObject（稳定引用，从 ref.current 读取最新值）
 * @param saveFn        执行保存的异步函数（自动保持最新引用）
 * @param defaultIntervalSec 默认保存间隔秒数，可通过 config:get 覆盖
 */
import { useEffect, useRef, type RefObject } from 'react'

export function useAutoSave(
  filePath: string,
  contentRef: RefObject<string>,
  saveFn: (text: string) => Promise<void>,
  defaultIntervalSec: number = 30,
) {
  const saveFnRef = useRef(saveFn)
  saveFnRef.current = saveFn

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    let cancelled = false

    const init = async () => {
      try {
        const { ipc } = await import('../services/ipc-client')
        const config = await ipc.invoke('config:get')
        const intervalMs = (config.autoSaveInterval || defaultIntervalSec) * 1000
        if (intervalMs <= 0) return

        timer = setInterval(() => {
          if (cancelled) return
          const content = contentRef.current
          if (content) {
            saveFnRef.current(content)
          }
        }, intervalMs)
      } catch { /* config:get 不可用时静默 */ }
    }

    init()

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [filePath, defaultIntervalSec])
}
