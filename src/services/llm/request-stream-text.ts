import type { LLMRequest } from '../../shared/ipc-channels'
import { t } from '../../shared/locale'
import { ipc } from '../ipc-client'

/** 请求完整流式响应，取消时立即清理监听并通知主进程。 */
export function requestStreamText(request: LLMRequest, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID()
    let started = false
    const stop = () => {
      if (started) void ipc.invoke('llm:cancel', requestId).catch(() => {})
    }
    const onAbort = () => { cleanup(); stop(); reject(signal.reason) }
    const fail = (error: unknown) => { cleanup(); reject(error) }
    const done = ipc.on('llm:stream-done', event => {
      if (event.requestId !== requestId) return
      cleanup()
      resolve(event.fullText)
    })
    const failed = ipc.on('llm:stream-error', event => {
      if (event.requestId === requestId) fail(new Error(event.error))
    })
    function cleanup() {
      signal.removeEventListener('abort', onAbort)
      done()
      failed()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    // 启动回执可能晚于取消，确认已启动后补发取消请求。
    void ipc.invoke('llm:generate-stream', requestId, request).then(result => {
      started = result?.started === true
      if (signal.aborted) stop()
      else if (!started) fail(new Error(t('log.render.llmStreamFailed')))
    }).catch(fail)
  })
}
