/**
 * 智能模型下载 — Electron 网络传输适配层（**唯一 import electron 的下载相关文件**）
 *
 * 把 `session.setProxy` + `net.request` 归一化成 `Transport`，供纯逻辑模块注入使用。
 *
 * ⚠️ 两个实测结论（2026-09-25，均为一次性脚本验证，勿凭直觉改回）：
 * 1. **必须用 `net.request`，不能用 `net.fetch`**——后者绕过 session 代理，实测假代理
 *    一个 CONNECT 都收不到，请求仍然直连。
 * 2. **代理用 `proxyRules: 'host:port'`，不能带 `http://` 前缀**——带前缀时 `setProxy`
 *    静默不生效（`resolveProxy` 仍报 PROXY，但请求照样直连）。
 * 3. 也别指望环境变量：主进程 `globalThis.fetch` 是 Node undici（`globalThis.fetch !== net.fetch`），
 *    除非**启动期**就带上 `NODE_USE_ENV_PROXY`，否则 `HTTPS_PROXY` 一律被忽略。
 *
 * 独立 partition（与其它流量隔离）：下载走代理不代表应用自己的请求也该走代理。
 */

import { net, session, type Session } from 'electron'
import type { NetPath } from '../net-path'
import type { Transport, TransportResponse } from '../ollama-registry'

/** 下载专用 session：与应用其余网络请求隔离 */
const PARTITION = 'persist:novelforge-model-download'

/** 最近一次已应用的 proxyRules（`setProxy` 是异步 IPC，range 重试时没必要重复设） */
let appliedRules: string | null | undefined

async function applyProxy(ses: Session, path: NetPath): Promise<void> {
  const rules = path.proxyRules ?? null
  if (appliedRules === rules) return
  await ses.setProxy(rules ? { proxyRules: rules } : { mode: 'direct' })
  appliedRules = rules
}

/**
 * Electron 的 `IncomingMessage` 运行时**确实**有 `pause`/`resume`（实测 `typeof === 'function'`），
 * 只是官方类型定义里没声明——用最小结构断言取回，别为了它把整条链路 any 掉。
 */
interface PausableMessage {
  pause?: () => void
  resume?: () => void
}

/** Electron IncomingMessage → AsyncIterable（带背压：消费者取走前不无限堆积） */
function toAsyncIterable(message: Electron.IncomingMessage): AsyncIterable<Uint8Array> {
  const stream = message as unknown as PausableMessage
  const queue: Buffer[] = []
  let finished = false
  let failure: Error | undefined
  let wake: (() => void) | undefined

  const notify = (): void => {
    const fn = wake
    wake = undefined
    fn?.()
  }

  message.on('data', (chunk: Buffer) => {
    queue.push(chunk)
    // 队列积压时暂停底层流，避免大 blob 在内存里堆成山
    if (queue.length > 64) stream.pause?.()
    notify()
  })
  message.on('end', () => { finished = true; notify() })
  message.on('error', (e: Error) => { failure = e; finished = true; notify() })

  return {
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      return {
        next: async (): Promise<IteratorResult<Uint8Array>> => {
          while (queue.length === 0 && !finished) {
            await new Promise<void>((resolve) => { wake = resolve })
          }
          if (failure) throw failure
          const chunk = queue.shift()
          if (!chunk) return { done: true, value: undefined }
          if (queue.length <= 32) stream.resume?.()
          return { done: false, value: chunk }
        },
      }
    },
  }
}

export function createElectronTransport(): Transport {
  return {
    request: async (url, opts): Promise<TransportResponse> => {
      const ses = session.fromPartition(PARTITION)
      await applyProxy(ses, opts.path)

      return new Promise<TransportResponse>((resolve, reject) => {
        const request = net.request({
          url,
          method: 'GET',
          session: ses,
          redirect: 'follow',
          useSessionCookies: false,
        })
        for (const [key, value] of Object.entries(opts.headers ?? {})) {
          request.setHeader(key, value)
        }

        const onAbort = (): void => request.abort()
        opts.signal?.addEventListener('abort', onAbort, { once: true })
        const cleanup = (): void => opts.signal?.removeEventListener('abort', onAbort)

        request.on('response', (message) => {
          cleanup()
          const headers: Record<string, string | undefined> = {}
          for (const [key, value] of Object.entries(message.headers)) {
            headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : value
          }
          resolve({
            status: message.statusCode,
            headers,
            body: toAsyncIterable(message),
          })
        })
        request.on('error', (e: Error) => { cleanup(); reject(e) })
        request.on('abort', () => { cleanup(); reject(new Error('request aborted')) })

        request.end()
      })
    },
  }
}
