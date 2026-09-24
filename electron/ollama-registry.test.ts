/**
 * ollama-registry 模块测试（智能模型下载 T2：manifest + blob 下载）
 *
 * 契约（T3 依赖，签名锁定）：
 * - registryManifestUrl / registryBlobUrl：指向 registry.ollama.ai，匿名可读（实测 200）
 * - digestToBlobName：`sha256:ab…` → `sha256-ab…`（Ollama 落盘命名，digest 即文件名）
 * - parseManifest：畸形（非 JSON / 缺 config / 缺 layers / 元素形状不对）→ null，不抛
 * - fetchManifest：按候选路径顺序试，任一成功即返回
 * - downloadBlob：Range 续传 + 流式 sha256 校验 + 停滞换路 + 连续错误换路；
 *   校验不符 / 换路超限 → {success:false}（不抛），且不留坏文件
 *
 * 说明：本模块不 import electron——测试注入 mock Transport，用真实临时目录做文件校验。
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NetPath } from './net-path'
import {
  digestToBlobName,
  downloadBlob,
  fetchManifest,
  parseManifest,
  probePath,
  registryBlobUrl,
  registryManifestUrl,
  type Transport,
  type TransportResponse,
} from './ollama-registry'

const direct: NetPath = { id: 'direct', label: 'direct' }
const proxy: NetPath = { id: 'proxy', label: '127.0.0.1:7897', proxyRules: '127.0.0.1:7897' }

const sha256 = (buf: Buffer): string => `sha256:${createHash('sha256').update(buf).digest('hex')}`

/** 把若干 Buffer 包成 TransportResponse 的 body 异步迭代器 */
async function* bodyOf(chunks: Buffer[], onDone?: () => void): AsyncIterable<Uint8Array> {
  for (const c of chunks) yield c
  onDone?.()
}

/**
 * 永不出字节的 body（模拟停滞连接）；signal 中止时 reject。
 * 写成手搓 AsyncIterable 而非 async generator——后者没有 yield 会触发 `require-yield`。
 */
function hangingBody(signal?: AbortSignal): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: (): Promise<IteratorResult<Uint8Array>> => new Promise((_, reject) => {
          const fail = (): void => reject(new Error('aborted'))
          if (signal?.aborted) fail()
          else signal?.addEventListener('abort', fail, { once: true })
        }),
      }
    },
  }
}

function res(partial: Partial<TransportResponse> & { status: number }): TransportResponse {
  return {
    headers: {},
    body: bodyOf([]),
    ...partial,
  } as TransportResponse
}

describe('URL 与命名', () => {
  it('manifest / blob URL 指向 registry.ollama.ai 的 library 命名空间', () => {
    expect(registryManifestUrl('bge-m3', 'latest'))
      .toBe('https://registry.ollama.ai/v2/library/bge-m3/manifests/latest')
    expect(registryBlobUrl('bge-m3', 'sha256:abc'))
      .toBe('https://registry.ollama.ai/v2/library/bge-m3/blobs/sha256:abc')
  })

  it('digest → 落盘文件名（冒号换连字符）', () => {
    expect(digestToBlobName('sha256:daec91ff')).toBe('sha256-daec91ff')
  })
})

describe('parseManifest', () => {
  const valid = {
    schemaVersion: 2,
    config: { mediaType: 'application/vnd.docker.container.image.v1+json', digest: 'sha256:c0', size: 337 },
    layers: [{ mediaType: 'application/vnd.ollama.image.model', digest: 'sha256:d0', size: 1_157_671_200 }],
  }

  it('合法 manifest → 解析出 config 与 layers', () => {
    const m = parseManifest(JSON.stringify(valid))
    expect(m?.config.digest).toBe('sha256:c0')
    expect(m?.layers).toHaveLength(1)
    expect(m?.layers[0].size).toBe(1_157_671_200)
  })

  it('非 JSON / 缺 config / 缺 layers / layer 形状不对 → null（不抛）', () => {
    expect(parseManifest('not json')).toBeNull()
    expect(parseManifest(JSON.stringify({ ...valid, config: undefined }))).toBeNull()
    expect(parseManifest(JSON.stringify({ ...valid, layers: undefined }))).toBeNull()
    expect(parseManifest(JSON.stringify({ ...valid, layers: [{ digest: 'sha256:d0' }] }))).toBeNull()
  })
})

describe('fetchManifest', () => {
  const manifestJson = JSON.stringify({
    schemaVersion: 2,
    config: { mediaType: 'x', digest: 'sha256:c0', size: 10 },
    layers: [{ mediaType: 'x', digest: 'sha256:d0', size: 100 }],
  })

  it('首条路径成功即返回，并记录所用路径', async () => {
    const transport: Transport = {
      request: async () => res({ status: 200, body: bodyOf([Buffer.from(manifestJson)]) }),
    }
    const out = await fetchManifest(transport, { name: 'bge-m3', tag: 'latest', paths: [direct, proxy] })
    expect(out.success).toBe(true)
    expect(out.path).toEqual(direct)
    expect(out.manifest?.layers[0].digest).toBe('sha256:d0')
  })

  it('首条失败 → 用下一条候选', async () => {
    const tried: string[] = []
    const transport: Transport = {
      request: async (_url, opts) => {
        tried.push(opts.path.id)
        if (opts.path.id === 'direct') return res({ status: 500 })
        return res({ status: 200, body: bodyOf([Buffer.from(manifestJson)]) })
      },
    }
    const out = await fetchManifest(transport, { name: 'bge-m3', tag: 'latest', paths: [direct, proxy] })
    expect(out.success).toBe(true)
    expect(out.path).toEqual(proxy)
    expect(tried).toEqual(['direct', 'proxy'])
  })

  it('全部候选失败 → {success:false}，不抛', async () => {
    const transport: Transport = { request: async () => { throw new Error('ECONNRESET') } }
    const out = await fetchManifest(transport, { name: 'bge-m3', tag: 'latest', paths: [direct, proxy] })
    expect(out.success).toBe(false)
    expect(out.error).toBeTruthy()
  })
})

describe('downloadBlob', () => {
  let dir: string
  let dest: string
  const payload = Buffer.alloc(64 * 1024, 7) // 64 KiB 假权重
  const digest = sha256(payload)

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vela-registry-'))
    dest = join(dir, 'sha256-test')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const opts = () => ({ url: registryBlobUrl('m', digest), destPath: dest, digest, expectedSize: payload.length })

  it('正常下载：写满 + 校验通过 + 进度上报 + 返回所用路径', async () => {
    const progress: number[] = []
    const transport: Transport = {
      request: async () => res({
        status: 200,
        headers: { 'content-length': String(payload.length) },
        body: bodyOf([payload.subarray(0, 32768), payload.subarray(32768)]),
      }),
    }
    const out = await downloadBlob(transport, {
      ...opts(), paths: [direct], onProgress: (p) => progress.push(p.completed),
    })
    expect(out.success).toBe(true)
    expect(out.usedPath).toEqual(direct)
    expect(readFileSync(dest).equals(payload)).toBe(true)
    expect(progress.at(-1)).toBe(payload.length)
  })

  it('续传：已有部分文件 → 发 Range 并从断点追加，最终仍校验整体 sha256', async () => {
    const half = payload.subarray(0, 32768)
    writeFileSync(dest, half)
    let rangeHeader: string | undefined
    const transport: Transport = {
      request: async (_url, o) => {
        rangeHeader = o.headers?.Range
        return res({
          status: 206,
          headers: { 'content-range': `bytes 32768-65535/${payload.length}` },
          body: bodyOf([payload.subarray(32768)]),
        })
      },
    }
    const out = await downloadBlob(transport, { ...opts(), paths: [direct] })
    expect(rangeHeader).toBe(`bytes=32768-`)
    expect(out.success).toBe(true)
    expect(readFileSync(dest).equals(payload)).toBe(true)
  })

  it('校验不符 → 失败并删除残缺文件（不留坏 blob 进模型库）', async () => {
    const bad = Buffer.alloc(payload.length, 9)
    const transport: Transport = {
      request: async () => res({ status: 200, body: bodyOf([bad]) }),
    }
    const out = await downloadBlob(transport, { ...opts(), paths: [direct] })
    expect(out.success).toBe(false)
    expect(out.error).toContain('sha256')
    expect(existsSync(dest)).toBe(false)
  })

  it('流被截断（少于期望字节）→ 不判定成功', async () => {
    const transport: Transport = {
      request: async () => res({ status: 200, body: bodyOf([payload.subarray(0, 1024)]) }),
    }
    const out = await downloadBlob(transport, { ...opts(), paths: [direct] })
    expect(out.success).toBe(false)
  })

  it('停滞（长时间零字节）→ 中止当前请求并换下一条候选', async () => {
    const switched: string[] = []
    const transport: Transport = {
      request: async (_url, o) => {
        if (o.path.id === 'direct') return res({ status: 200, body: hangingBody(o.signal) })
        return res({ status: 200, body: bodyOf([payload]) })
      },
    }
    const out = await downloadBlob(transport, {
      ...opts(),
      paths: [direct, proxy],
      stallTimeoutMs: 40,
      onSwitch: (_from, to) => switched.push(to.id),
    })
    expect(out.success).toBe(true)
    expect(out.usedPath).toEqual(proxy)
    expect(switched).toEqual(['proxy'])
  })

  it('同一路径连续出错达上限 → 换路；候选耗尽 → 失败', async () => {
    let directCalls = 0
    const transport: Transport = {
      request: async (_url, o) => {
        if (o.path.id === 'direct') { directCalls++; throw new Error('unexpected EOF') }
        throw new Error('unexpected EOF')
      },
    }
    const out = await downloadBlob(transport, { ...opts(), paths: [direct, proxy], stallTimeoutMs: 10_000 })
    expect(out.success).toBe(false)
    expect(directCalls).toBe(3) // MAX_PATH_ERRORS
  })

  it('反复截断且每轮都有少量字节 → 必须终止（回归：曾在错误计数被字节重置后无限重试）', async () => {
    let calls = 0
    const transport: Transport = {
      request: async () => {
        calls++
        // 每轮都吐一点字节但永远不满：若「收到字节就重置错误计数」，这里会永远循环下去
        return res({ status: 200, body: bodyOf([payload.subarray(0, 1024)]) })
      },
    }
    const out = await downloadBlob(transport, { ...opts(), paths: [direct], stallTimeoutMs: 10_000 })
    expect(out.success).toBe(false)
    expect(calls).toBeLessThanOrEqual(5) // 错误预算 3 次 + 余量，绝不是无限
  })

  it('服务端忽略 Range 返回 200 → 丢弃已有前缀从头写（不能拼接错位数据）', async () => {
    writeFileSync(dest, Buffer.alloc(1024, 1))
    const transport: Transport = {
      request: async (_url, o) => {
        expect(o.headers?.Range).toBe('bytes=1024-')
        return res({ status: 200, headers: { 'content-length': String(payload.length) }, body: bodyOf([payload]) })
      },
    }
    const out = await downloadBlob(transport, { ...opts(), paths: [direct] })
    expect(out.success).toBe(true)
    expect(readFileSync(dest).equals(payload)).toBe(true)
  })
})

describe('probePath', () => {
  it('按 Range 采样并换算吞吐', async () => {
    const chunk = Buffer.alloc(4096, 3)
    let rangeHeader: string | undefined
    const transport: Transport = {
      request: async (_url, o) => {
        rangeHeader = o.headers?.Range
        // 立刻吐满采样量（远超 maxBytes）→ 只要收到字节就算有效采样
        return res({ status: 206, body: bodyOf([chunk, chunk]) })
      },
    }
    const score = await probePath(transport, 'https://x/blob', direct, { maxBytes: 8192 })
    expect(rangeHeader).toBe('bytes=0-8191')
    expect(score).not.toBeNull()
    expect(score as number).toBeGreaterThan(0)
  })

  it('一个字节都收不到 / 非 2xx → null（该路径判失败）', async () => {
    const empty: Transport = { request: async () => res({ status: 206, body: bodyOf([]) }) }
    expect(await probePath(empty, 'https://x/blob', direct, { maxBytes: 1024 })).toBeNull()

    const notFound: Transport = { request: async () => res({ status: 404 }) }
    expect(await probePath(notFound, 'https://x/blob', direct, { maxBytes: 1024 })).toBeNull()
  })

  it('连接报错 → null（不抛给调用方）', async () => {
    const broken: Transport = { request: async () => { throw new Error('ECONNRESET') } }
    expect(await probePath(broken, 'https://x/blob', direct, { maxBytes: 1024 })).toBeNull()
  })
})
