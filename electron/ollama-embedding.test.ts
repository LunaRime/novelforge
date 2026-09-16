/**
 * ollama-embedding 模块测试（T2：Ollama 本地向量档，纯 HTTP）
 *
 * 契约（T3/T4/T5 依赖，签名锁定）：
 * - detectOllama 三态不抛：连接拒绝 / 非 200 / 畸形 JSON → {ok:false,error}
 * - listOllamaModels：`:latest` 规范化 + 去重 + 按 name 排序；空/畸形/非 200 → []（不抛）
 * - pullModel：NDJSON 逐行解析（跨 chunk 行边界必须正确）+ 300s 长超时 + 失败帧 → {success:false}
 * - embedLocal：与输入同序返回；非 200 / 畸形 / 空 / 数量不匹配 → throw（供 T3 降级链捕获）
 *
 * 说明：本模块不 import electron（保持可在 CI 无 electron 二进制下直接单测），
 * 因此这里只 mock 全局 fetch，不 mock 'electron'。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  detectOllama,
  embedLocal,
  listOllamaModels,
  pullModel,
  type PullProgress,
} from './ollama-embedding'

const BASE = 'http://127.0.0.1:11434'

/** 造一个最小 JSON Response（只实现被测代码用到的字段） */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

/** 造一个按给定 chunk 顺序吐字节的流式 Response（模拟 NDJSON 网络分片） */
function ndjsonResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return {
    ok: status >= 200 && status < 300,
    status,
    body,
    text: async () => chunks.join(''),
  } as unknown as Response
}

/** 只含 ASCII 的用户可见/日志错误串（模块内不得写死中文，UI 文案属 T5） */
const ASCII_ONLY = /^[\x20-\x7E]+$/

// ===== detectOllama =====

describe('detectOllama（三态，不抛）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('200 → {ok:true, version}，打 GET {base}/api/version', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ version: '0.5.11' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await detectOllama(BASE)

    expect(result).toEqual({ ok: true, version: '0.5.11' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${BASE}/api/version`)
    expect(init.method ?? 'GET').toBe('GET')
  })

  it('baseUrl 尾斜杠 → 归一化为单斜杠（不产生 //api/version）', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ version: '0.5.11' }))
    vi.stubGlobal('fetch', fetchMock)

    await detectOllama(`${BASE}/`)

    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${BASE}/api/version`)
  })

  it('连接拒绝（fetch reject）→ {ok:false,error}，不抛', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))

    const result = await detectOllama(BASE)

    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    expect(String(result.error)).toMatch(ASCII_ONLY)
  })

  it('非 200（500）→ {ok:false,error}，不抛，error 含状态码', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'boom' }, 500)))

    const result = await detectOllama(BASE)

    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain('500')
    expect(String(result.error)).toMatch(ASCII_ONLY)
  })

  it('200 但 JSON 畸形 → {ok:false,error}，不抛', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected token < in JSON') },
      text: async () => '<html>',
    } as unknown as Response)))

    const result = await detectOllama(BASE)

    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

// ===== listOllamaModels =====

describe('listOllamaModels（:latest 规范化 + 去重 + 排序）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('规范化 :latest、去重、按 name 升序（保留首次出现的 size）', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      models: [
        { name: 'llama3.3', size: 2 },
        { name: 'bge-m3:latest', size: 1 },
        { name: 'bge-m3', size: 9 },
        { name: 'all-minilm:latest', size: 4 },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await listOllamaModels(BASE)

    expect(result).toEqual([
      { name: 'all-minilm', size: 4 },
      { name: 'bge-m3', size: 1 },
      { name: 'llama3.3', size: 2 },
    ])
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${BASE}/api/tags`)
    expect(init.method ?? 'GET').toBe('GET')
  })

  it('非 :latest 的 tag 原样保留（如 bge-m3:fp16）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      models: [{ name: 'bge-m3:fp16', size: 7 }],
    })))

    expect(await listOllamaModels(BASE)).toEqual([{ name: 'bge-m3:fp16', size: 7 }])
  })

  it('空列表 → []，不抛', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ models: [] })))
    expect(await listOllamaModels(BASE)).toEqual([])
  })

  it('畸形响应（models 非数组 / 缺字段）→ []，不抛', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ models: 'nope' })))
    expect(await listOllamaModels(BASE)).toEqual([])

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    expect(await listOllamaModels(BASE)).toEqual([])

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      models: [{ size: 1 }, null, { name: 'ok-model', size: 3 }],
    })))
    expect(await listOllamaModels(BASE)).toEqual([{ name: 'ok-model', size: 3 }])
  })

  it('非 200 / fetch reject → []，不抛', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'nope' }, 404)))
    expect(await listOllamaModels(BASE)).toEqual([])

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    expect(await listOllamaModels(BASE)).toEqual([])
  })
})

// ===== pullModel（NDJSON 流） =====

describe('pullModel（NDJSON 流式进度）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('多帧 + 末帧 success → onProgress 收到多帧、percent 合理、返回 {success:true}', async () => {
    const chunks = [
      '{"status":"pulling manifest"}\n',
      '{"status":"pulling","digest":"sha256:a","completed":1,"total":4}\n',
      '{"status":"pulling","digest":"sha256:a","completed":2,"total":4}\n',
      '{"status":"success"}\n',
    ]
    const fetchMock = vi.fn(async () => ndjsonResponse(chunks))
    vi.stubGlobal('fetch', fetchMock)

    const frames: PullProgress[] = []
    const result = await pullModel(BASE, 'bge-m3', (p) => frames.push(p))

    expect(result).toEqual({ success: true })
    expect(frames.map((f) => f.status)).toEqual([
      'pulling manifest', 'pulling', 'pulling', 'success',
    ])
    // 无 completed/total 的帧 → percent 缺省（UI 显示不确定进度）
    expect(frames[0].percent).toBeUndefined()
    expect(frames[1].percent).toBe(25)
    expect(frames[2].percent).toBe(50)
    // percent = completed / total * 100（1/3 → 33）
    expect(frames[1].completed).toBe(1)
    expect(frames[1].total).toBe(4)

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${BASE}/api/pull`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'bge-m3', stream: true })
  })

  it('percent 取整（completed/total*100）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjsonResponse([
      '{"status":"pulling","completed":1,"total":3}\n',
      '{"status":"success"}\n',
    ])))

    const frames: PullProgress[] = []
    await pullModel(BASE, 'bge-m3', (p) => frames.push(p))

    expect(frames[0].percent).toBe(33)
  })

  it('跨 chunk 行边界（半个 JSON 行 + 无尾换行的残行）→ 全部正确解析', async () => {
    // 第 2 个 chunk 把一行 JSON 从中间切断；最后一个 chunk 没有尾随 \n（靠流结束 flush 残行）
    const chunks = [
      '{"status":"pulling manifest"}\n{"status":"pull',
      'ing","completed":1,"total":2}\n{"status":"pulling","completed":2,"total":2}\n',
      '{"status":"success"}',
    ]
    vi.stubGlobal('fetch', vi.fn(async () => ndjsonResponse(chunks)))

    const frames: PullProgress[] = []
    const result = await pullModel(BASE, 'bge-m3', (p) => frames.push(p))

    expect(result).toEqual({ success: true })
    expect(frames.map((f) => f.status)).toEqual([
      'pulling manifest', 'pulling', 'pulling', 'success',
    ])
    expect(frames[1].percent).toBe(50)
    expect(frames[2].percent).toBe(100)
  })

  it('空行 / 非法 JSON 行 → 跳过且不炸整条流', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjsonResponse([
      '\n',
      'not-json-at-all\n',
      '{"status":"pulling","completed":1,"total":2}\n',
      '\n',
      '{"status":"success"}\n',
    ])))

    const frames: PullProgress[] = []
    const result = await pullModel(BASE, 'bge-m3', (p) => frames.push(p))

    expect(result).toEqual({ success: true })
    expect(frames.map((f) => f.status)).toEqual(['pulling', 'success'])
  })

  it('流内失败帧 {"error":...} → {success:false,error}（不再继续消费）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjsonResponse([
      '{"status":"pulling","completed":1,"total":2}\n',
      '{"error":"pull model manifest: file does not exist"}\n',
      '{"status":"success"}\n',
    ])))

    const frames: PullProgress[] = []
    const result = await pullModel(BASE, 'no-such-model', (p) => frames.push(p))

    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('file does not exist')
    expect(String(result.error)).toMatch(ASCII_ONLY)
    // 失败后不应再上报 terminal success
    expect(frames.map((f) => f.status)).not.toContain('success')
  })

  it('流结束但无 success 终帧（截断）→ {success:false,error}', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjsonResponse([
      '{"status":"pulling","completed":1,"total":2}\n',
    ])))

    const result = await pullModel(BASE, 'bge-m3')

    expect(result.success).toBe(false)
    expect(String(result.error)).toMatch(ASCII_ONLY)
  })

  it('非 200 → {success:false,error}（含状态码）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'not found' }, 404)))

    const result = await pullModel(BASE, 'bge-m3')

    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('404')
  })

  it('无 body（流缺失）→ {success:false,error}，不抛', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, body: null, text: async () => '',
    } as unknown as Response)))

    const result = await pullModel(BASE, 'bge-m3')

    expect(result.success).toBe(false)
  })

  it('onProgress 缺省 → 正常返回（不因回调缺失抛错）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjsonResponse(['{"status":"success"}\n'])))

    await expect(pullModel(BASE, 'bge-m3')).resolves.toEqual({ success: true })
  })

  it('onProgress 抛错 → 不炸下载结果（吞回调异常）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjsonResponse([
      '{"status":"pulling","completed":1,"total":2}\n',
      '{"status":"success"}\n',
    ])))

    const result = await pullModel(BASE, 'bge-m3', () => { throw new Error('renderer destroyed') })

    expect(result).toEqual({ success: true })
  })
})

describe('pullModel 长超时（300s，非默认 10s）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('挂起 fetch：10s 未 reject，推进到 300s 才超时返回 {success:false}', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))

    let settled = false
    const pending = pullModel(BASE, 'bge-m3').then((r) => { settled = true; return r })

    // 跨过默认 10s 超时点 → 仍不得失败（否则大模型 pull 会被默认超时腰斩）
    await vi.advanceTimersByTimeAsync(10_000 + 1)
    expect(settled).toBe(false)

    // 推进到 300s 超时点 → abort + 立即返回失败（供 UI 展示/重试）
    await vi.advanceTimersByTimeAsync(300_000 - 10_000)
    const result = await pending

    expect(settled).toBe(true)
    expect(result.success).toBe(false)
    expect(String(result.error)).toMatch(/abort/i)
  })
})

// ===== embedLocal =====

describe('embedLocal（保序 + 失败 throw）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('{embeddings:[[..],[..]]} → 按输入原序返回，打 POST {base}/api/embed', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ embeddings: [[1, 2], [3, 4]] }))
    vi.stubGlobal('fetch', fetchMock)

    const texts = ['第一段', '第二段']
    const result = await embedLocal(texts, BASE, 'bge-m3')

    expect(result).toEqual([[1, 2], [3, 4]])

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${BASE}/api/embed`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ model: 'bge-m3', input: texts, keep_alive: '30m' })
  })

  it('响应带乱序 index（OpenAI 形状兼容）→ 按 index 排序后与输入同序', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      data: [
        { index: 2, embedding: [5, 6] },
        { index: 0, embedding: [1, 2] },
        { index: 1, embedding: [3, 4] },
      ],
    })))

    const result = await embedLocal(['a', 'b', 'c'], BASE, 'bge-m3')

    expect(result).toEqual([[1, 2], [3, 4], [5, 6]])
  })

  it('非 200 → throw（含状态码，供 T3 降级捕获）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'model not found' }, 404)))

    const err = await embedLocal(['a'], BASE, 'missing-model').catch((e: Error) => e)

    expect(err).toBeInstanceOf(Error)
    expect(String((err as Error).message)).toContain('404')
    expect(String((err as Error).message)).toMatch(ASCII_ONLY)
  })

  it('空 embeddings → throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ embeddings: [] })))

    await expect(embedLocal(['a'], BASE, 'bge-m3')).rejects.toThrow(Error)
  })

  it('畸形响应（缺 embeddings / 非数字数组）→ throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(embedLocal(['a'], BASE, 'bge-m3')).rejects.toThrow(Error)

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ embeddings: 'nope' })))
    await expect(embedLocal(['a'], BASE, 'bge-m3')).rejects.toThrow(Error)

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ embeddings: [[1, 2], null] })))
    await expect(embedLocal(['a', 'b'], BASE, 'bge-m3')).rejects.toThrow(Error)
  })

  it('向量数与输入数不匹配 → throw（静默错位会污染检索）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ embeddings: [[1, 2]] })))

    await expect(embedLocal(['a', 'b'], BASE, 'bge-m3')).rejects.toThrow(/1/)
  })

  it('空输入 → 直接 [] 且不发请求', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ embeddings: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(embedLocal([], BASE, 'bge-m3')).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ===== embedLocal 冷启动超时（2026-09-14 真机缺陷回归）=====
//
// 真机实测：bge-m3（F16 / 1.08 GB）首次调用 total_duration 11.98s，其中 load_duration 9.53s
// 全是模型加载。原先 embedLocal 用默认 EMBEDDING_TIMEOUT_MS = 10s → 加载没完就 abort，
// 用户看到 "This operation was aborted"，且写入侧本地档永远失败、静默降级到 FTS。

describe('embedLocal 冷启动超时（真机：模型加载 9.53s > 默认 10s）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** 挂起请求：永不返回；被 abort 时按 undici 行为 reject AbortError */
  function hangingFetch() {
    return vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('This operation was aborted', 'AbortError'))
      })
    }))
  }

  /** 记录 embedLocal 是否已 settle（'resolved' / 错误 name / 未 settle 则数组为空） */
  function trackSettle(): string[] {
    const settled: string[] = []
    void embedLocal(['测试文本'], BASE, 'bge-m3').then(
      () => settled.push('resolved'),
      (e: unknown) => settled.push(e instanceof Error ? e.name : 'unknown'),
    )
    return settled
  }

  it('越过默认 10s 上限仍不中断（修复前此处即 abort —— 本地档必然失败）', async () => {
    vi.stubGlobal('fetch', hangingFetch())

    const settled = trackSettle()
    await vi.advanceTimersByTimeAsync(10_001)

    expect(settled).toEqual([])
  })

  it('到 120s 本地档超时才中断（AbortError，供 T3 降级链捕获）', async () => {
    vi.stubGlobal('fetch', hangingFetch())

    const settled = trackSettle()
    await vi.advanceTimersByTimeAsync(10_001)
    expect(settled).toEqual([])

    await vi.advanceTimersByTimeAsync(120_000 - 10_001)
    expect(settled).toEqual(['AbortError'])
  })

  it('请求体带 keep_alive（避免闲置 5 分钟后每次重付 9.53s 加载）', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ embeddings: [[1, 2]] }))
    vi.stubGlobal('fetch', fetchMock)

    await embedLocal(['a'], BASE, 'bge-m3')

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({ keep_alive: '30m' })
  })
})
