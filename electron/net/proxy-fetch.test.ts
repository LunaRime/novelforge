/**
 * proxy-fetch 模块测试（2026-09-25：修复「应用自己的请求从不走代理」）
 *
 * 契约：
 * - 代理未配置 / 未启用 → 原样走全局 fetch（行为与修复前完全一致）
 * - 代理启用 + 公网目标 → 走 npm undici 的 fetch 并带 ProxyAgent dispatcher
 *   （⚠️ 必须是 npm undici 自己的 fetch：Node 内置 undici 7.21.0 与 npm 8.9.0 跨实例
 *    dispatcher 实测抛 UND_ERR_INVALID_ARG）
 * - 回环（localhost / 127.0.0.1 / ::1）与私有网段 → **显式直连**：
 *   本地 Ollama(11434)、CDP(9222)、局域网自建 LLM 服务都不该绕代理
 * - agent 按代理地址缓存；代理变更时新建并关闭旧实例（防 socket 泄漏）
 * - 非法 URL → 退回全局 fetch，不抛
 *
 * 说明：mock 掉 undici 与全局 fetch，本模块不 import electron。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  // 参数留空：断言处再断言 calls 的形状（本项目 eslint 未配 `_` 前缀豁免）
  undiciFetch: vi.fn(async () => ({ ok: true, status: 200 })),
  globalFetch: vi.fn(async () => ({ ok: true, status: 200 })),
  agents: [] as Array<{ uri: string; close: ReturnType<typeof vi.fn> }>,
}))

vi.mock('undici', () => ({
  fetch: h.undiciFetch,
  ProxyAgent: class {
    uri: string
    // 真实 undici 的 close() 返回 Promise —— mock 必须同形，否则测不出「.catch 被调用」这条路径
    close = vi.fn(async () => {})
    constructor(uri: string) {
      this.uri = uri
      h.agents.push(this as unknown as { uri: string; close: ReturnType<typeof vi.fn> })
    }
  },
}))

import { createProxyFetch, isDirectTarget, type ProxySettings } from './proxy-fetch'

const HTTP_PROXY: ProxySettings = { enabled: true, type: 'http', host: '127.0.0.1', port: 7897 }

/** 造一个「当前代理配置」可变的注入器 */
function withProxy(initial: ProxySettings | undefined): {
  fetch: ReturnType<typeof createProxyFetch>
  set: (p: ProxySettings | undefined) => void
} {
  let current = initial
  return {
    fetch: createProxyFetch(() => current),
    set: (p) => { current = p },
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', h.globalFetch)
  h.undiciFetch.mockClear()
  h.globalFetch.mockClear()
  h.agents.length = 0
})

describe('isDirectTarget（哪些目标必须直连）', () => {
  it('回环地址 → 直连', () => {
    for (const url of [
      'http://localhost:11434/api/tags',
      'http://127.0.0.1:9222/json',
      'http://[::1]:11434/api/tags',
      'http://127.5.5.5:8080/x', // 整个 127/8 都是回环
    ]) {
      expect(isDirectTarget(url), url).toBe(true)
    }
  })

  it('私有网段 → 直连（局域网自建 LLM 服务不该绕代理）', () => {
    for (const url of [
      'http://192.168.1.5:1234/v1/models',
      'http://10.0.0.3:8000/v1',
      'http://172.16.0.1:8080/v1',
      'http://172.31.255.254/v1',
      'http://machine.local/v1',
    ]) {
      expect(isDirectTarget(url), url).toBe(true)
    }
  })

  it('公网地址 → 不直连（走代理）', () => {
    for (const url of [
      'https://api.openai.com/v1/chat/completions',
      'https://registry.ollama.ai/v2/x',
      'http://172.32.0.1/v1', // 172.32 已不在 172.16/12 私有段内
      'http://11.0.0.1/v1',   // 11.x 不是私有段
    ]) {
      expect(isDirectTarget(url), url).toBe(false)
    }
  })

  it('非法 URL → 当作直连（安全侧：宁可直连，不把畸形地址塞给代理）', () => {
    expect(isDirectTarget('not a url')).toBe(true)
    expect(isDirectTarget('')).toBe(true)
  })
})

describe('createProxyFetch', () => {
  it('未配置代理 → 走全局 fetch，不碰 undici', async () => {
    const { fetch: pf } = withProxy(undefined)
    await pf('https://api.openai.com/v1/models', { method: 'GET' })

    expect(h.globalFetch).toHaveBeenCalledTimes(1)
    expect(h.undiciFetch).not.toHaveBeenCalled()
  })

  it('代理配置存在但 enabled=false → 仍走全局 fetch', async () => {
    const { fetch: pf } = withProxy({ ...HTTP_PROXY, enabled: false })
    await pf('https://api.openai.com/v1/models', {})

    expect(h.globalFetch).toHaveBeenCalledTimes(1)
    expect(h.undiciFetch).not.toHaveBeenCalled()
  })

  it('代理启用 + 公网目标 → 走 undici.fetch 且带 ProxyAgent（含 type://host:port）', async () => {
    const { fetch: pf } = withProxy(HTTP_PROXY)
    await pf('https://api.openai.com/v1/models', { method: 'POST' })

    expect(h.globalFetch).not.toHaveBeenCalled()
    expect(h.undiciFetch).toHaveBeenCalledTimes(1)
    const init = (h.undiciFetch.mock.calls[0] as unknown as [string, { method?: string; dispatcher?: unknown }])[1]
    expect(init.method).toBe('POST')
    expect(init.dispatcher).toBe(h.agents[0])
    expect(h.agents[0].uri).toBe('http://127.0.0.1:7897')
  })

  it('socks5 类型 → 用 socks5:// 前缀建 agent', async () => {
    const { fetch: pf } = withProxy({ ...HTTP_PROXY, type: 'socks5' })
    await pf('https://api.openai.com/v1/models', {})

    expect(h.agents[0].uri).toBe('socks5://127.0.0.1:7897')
  })

  it('回环目标 → 直连（本地 Ollama / CDP 不走代理）', async () => {
    const { fetch: pf } = withProxy(HTTP_PROXY)
    await pf('http://127.0.0.1:11434/api/embed', { method: 'POST' })
    await pf('http://localhost:11434/api/tags', {})

    expect(h.globalFetch).toHaveBeenCalledTimes(2)
    expect(h.undiciFetch).not.toHaveBeenCalled()
    expect(h.agents).toHaveLength(0) // 连 agent 都不该建
  })

  it('同一代理地址 → 复用同一个 agent（不重复建连接池）', async () => {
    const { fetch: pf } = withProxy(HTTP_PROXY)
    await pf('https://api.openai.com/v1/a', {})
    await pf('https://api.openai.com/v1/b', {})

    expect(h.undiciFetch).toHaveBeenCalledTimes(2)
    expect(h.agents).toHaveLength(1)
  })

  it('代理地址变更 → 新建 agent 并关闭旧实例（防 socket 泄漏）', async () => {
    const { fetch: pf, set } = withProxy(HTTP_PROXY)
    await pf('https://api.openai.com/v1/a', {})
    const first = h.agents[0]

    set({ ...HTTP_PROXY, port: 7890 })
    await pf('https://api.openai.com/v1/b', {})

    expect(h.agents).toHaveLength(2)
    expect(h.agents[1].uri).toBe('http://127.0.0.1:7890')
    expect(first.close).toHaveBeenCalledTimes(1)
  })

  it('代理缺 host/port（配置损坏）→ 退回全局 fetch，不抛', async () => {
    const { fetch: pf } = withProxy({ enabled: true, type: 'http', host: '', port: 0 })
    await pf('https://api.openai.com/v1/models', {})

    expect(h.globalFetch).toHaveBeenCalledTimes(1)
    expect(h.undiciFetch).not.toHaveBeenCalled()
  })

  it('非法 URL → 退回全局 fetch，不抛（代理判断失败不能拖垮请求本身）', async () => {
    const { fetch: pf } = withProxy(HTTP_PROXY)
    await expect(pf('not a url', {})).resolves.toBeTruthy()

    expect(h.globalFetch).toHaveBeenCalledTimes(1)
  })
})
