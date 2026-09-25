/**
 * 带超时的出站 fetch —— 主进程共用
 *
 * 2026-09-25 从 `electron/embedding.ts` 挪来：它当时的注释就写着「导出自 T1：Ollama pull
 * 等长任务复用」，即早已是共用工具，只是住在嵌入服务模块里。挪出来是为了让 LLM provider
 * 能直接用它，而不必从「嵌入服务」import 网络工具（依赖方向反了）。
 */
import { proxyFetch } from './proxy-fetch'

/** 默认超时：API 挂起时不能无限阻塞调用方 */
export const DEFAULT_FETCH_TIMEOUT_MS = 10_000

/**
 * 带 AbortController 超时兜底的 fetch（长任务传 `timeoutMs` 覆盖默认 10s）。
 *
 * ⚠️ **abort 兜底**（2026-08-29 冒烟实测根因）：API 请求挂起（限流/网络）时，
 * undici 对挂起连接的 abort reject 可能延迟 ~20s（实测），IPC 30s 窗口内降级链来不及完成
 * → kb:import-text 三次超时 → 后处理管线中止。`Promise.race` 保证超时即 abort + 立即 reject，
 * 不依赖 fetch 对 abort 信号的响应及时性。**改回单纯传 signal 会重新引入这个延迟。**
 */
export function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new DOMException('This operation was aborted', 'AbortError'))
    }, timeoutMs)
  })
  return Promise.race([
    proxyFetch(url, { ...init, signal: controller.signal }),
    timeoutPromise,
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}
