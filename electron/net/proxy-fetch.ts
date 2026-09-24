/**
 * 主进程出站请求的代理包装（2026-09-25）
 *
 * ── 为什么需要它 ──────────────────────────────────────────────
 * `llm-controller` 的 `applyProxyConfig()` 把 `process.env.HTTPS_PROXY` 设成用户配置的代理，
 * 但**对主进程自己的请求完全无效**：主进程的 `globalThis.fetch` 是 Node 的 undici，
 * 它只在**进程启动时**带 `NODE_USE_ENV_PROXY=1` 的情况下才读代理环境变量（运行期赋值来不及）。
 * 实测：把 `HTTPS_PROXY` 指向死端口，主进程 fetch 到公网照样 200。
 * 也就是说——用户配了代理、UI 上开关是亮的，**应用自己的 LLM/Embedding 请求一直是直连的**。
 *
 * （注：那个环境变量设置**不是**死代码——`mcp-manager` 用 `env: {...process.env}` 拉起 MCP
 *   子进程，子进程会继承到它。所以保留，只是它服务的是子进程而非主进程。）
 *
 * ── 做法 ────────────────────────────────────────────────────
 * 代理启用且目标为公网地址时，改用 **npm undici 的 fetch + ProxyAgent**。
 * ⚠️ 必须用 npm undici 自己的 fetch，不能把 ProxyAgent 塞给全局 fetch：
 * Node 内置 undici 是 7.21.0、npm 是 8.9.0，跨实例 dispatcher 实测抛 `UND_ERR_INVALID_ARG`。
 * 用同一实例则版本无关，且 agent 缓存/关闭都自洽。
 *
 * 约束：不 import electron（保持可在 CI 无 electron 二进制下直接单测）。
 */

import { fetch as undiciFetch, ProxyAgent } from 'undici'
import { DEFAULT_GLOBAL_CONFIG, GLOBAL_CONFIG_PATH, readJsonFile } from '../utils/config-utils'
import type { GlobalConfig } from '../../src/shared/ipc-channels'

export interface ProxySettings {
  enabled: boolean
  type: 'http' | 'socks5'
  host: string
  port: number
}

/** 与全局 fetch 同形；调用方无感替换 */
export type ProxyFetch = (url: string, init?: RequestInit) => Promise<Response>

/**
 * 判断目标是否应当**直连**（不绕代理）。
 *
 * 三类必须直连：
 * - 回环（Ollama 11434 / CDP 9222 等本地服务）
 * - 私有网段与 `.local`（局域网里自建 LLM 服务很常见，绕代理必挂）
 * - 非法 URL（解析不了就别往代理里塞，安全侧选择）
 */
export function isDirectTarget(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return true
  }
  if (!host) return true

  // ⚠️ WHATWG URL 对 IPv6 会**保留方括号**（`new URL('http://[::1]/').hostname === '[::1]'`）
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  if (bare === 'localhost' || bare === '::1' || bare.endsWith('.local')) return true
  if (bare.startsWith('127.')) return true // 整个 127/8 都是回环
  host = bare

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 10) return true // 10/8
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
    if (a === 192 && b === 168) return true // 192.168/16
    if (a === 169 && b === 254) return true // link-local
  }
  return false
}

/**
 * 建一个代理感知的 fetch。`getProxy` 每次调用都会读一次配置（配置改了立即生效）。
 *
 * agent 按 `<type>://<host>:<port>` 缓存：同一代理复用连接池，换了代理则新建并 `close()`
 * 旧实例——否则每次改配置都会泄漏一个带连接池的 agent。
 */
export function createProxyFetch(getProxy: () => ProxySettings | undefined): ProxyFetch {
  let cachedKey: string | undefined
  let cachedAgent: ProxyAgent | undefined

  const agentFor = (proxy: ProxySettings): ProxyAgent => {
    const key = `${proxy.type}://${proxy.host}:${proxy.port}`
    if (key !== cachedKey || !cachedAgent) {
      const previous = cachedAgent
      cachedAgent = new ProxyAgent(key)
      cachedKey = key
      // 关闭旧实例是异步的，且失败无关紧要（进程退出也会回收）——不阻塞当前请求
      if (previous) void previous.close().catch(() => {})
    }
    return cachedAgent
  }

  return async (url, init) => {
    const proxy = getProxy()
    if (!proxy?.enabled || !proxy.host || !proxy.port) return fetch(url, init)
    if (isDirectTarget(url)) return fetch(url, init)

    // 类型上 npm undici 自带 undici-types，与 @types/node 的全局 RequestInit/Response
    // 名义类型不一致（Blob/ArrayBufferView 的泛型细节不同），但**运行时结构一致**。
    // 在这个唯一边界处收敛，调用方拿到的是标准 Response。
    const undiciInit = {
      ...init,
      dispatcher: agentFor(proxy),
    } as unknown as Parameters<typeof undiciFetch>[1]
    return undiciFetch(url, undiciInit) as unknown as Promise<Response>
  }
}

/** 从全局配置读代理（读失败按「无代理」处理——代理判断不该拖垮请求本身） */
function readProxySettings(): ProxySettings | undefined {
  try {
    return readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG).proxy
  } catch {
    return undefined
  }
}

/**
 * 当前生效的代理——**推送模型**（启动时、`config:set` 后、每次 LLM 调用前各推一次），
 * 而不是每次请求去读配置文件。
 *
 * 为什么不让 `proxyFetch` 自己读：那会让**每个** Embedding 调用都做一次同步文件读，
 * 更麻烦的是单测里没有推送 → 状态恒为 undefined → 既有「mock 全局 fetch」的测试全部照常，
 * 不需要为了这次修复去改一堆测试文件。
 */
let current: ProxySettings | undefined
let singleton: ProxyFetch | undefined

/** 直接设定当前代理（配置变更时由控制器推送） */
export function setOutboundProxy(proxy: ProxySettings | undefined): void {
  current = proxy
}

/** 从全局配置重读并推送——启动时与 `config:set` 之后调用 */
export function refreshOutboundProxy(): void {
  setOutboundProxy(readProxySettings())
}

/**
 * 应用内单例：主进程所有**出站**请求都该走它（LLM / Embedding / 开发者 API / 健康检查）。
 * 本机回环与私有网段由 `isDirectTarget` 自动直连，调用方无需判断。
 */
export function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  singleton ??= createProxyFetch(() => current)
  return singleton(url, init)
}
