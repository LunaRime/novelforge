import { describe, it, expect, vi } from 'vitest'
import { toAnthropicRequest, createAnthropicStreamParser, mapAnthropicError, AnthropicProvider } from './anthropic-provider'
import { proxyFetch } from '../net/proxy-fetch'
import type { ResolvedModelProfile, LLMUsage } from './provider.interface'

vi.mock('../net/proxy-fetch', () => ({ proxyFetch: vi.fn() }))

// 夹具 = **已解析密钥**的条目（provider 的入参类型，v3 §3.2）：`ModelProfile` 上已无 `apiKey`，
// 能带上密钥的只有 `ResolvedModelProfile`。provider 用 'custom' —— 这正是 anthropic 协议
// 在 NF 里的实际用法（自定义端点走 Messages API）。
const model: ResolvedModelProfile = {
  id: 'a1', name: 'Claude', provider: 'custom', protocol: 'anthropic',
  modelName: 'claude-sonnet-5', apiKey: 'sk-ant-x',
  baseUrl: 'https://api.anthropic.com', temperature: 0.7, maxTokens: 8192, contextWindow: 200000,
  purposes: ['generation'],
}

describe('toAnthropicRequest', () => {
  it('URL 归一化：裸域名/尾斜杠/已含 /v1 都拼成 {root}/v1/messages（不重复）', () => {
    for (const base of ['https://api.anthropic.com', 'https://api.anthropic.com/', 'https://api.anthropic.com/v1',
      'https://api.anthropic.com/v1/']) {
      expect(toAnthropicRequest({ ...model, baseUrl: base }, [{ role: 'user', content: 'hi' }]).url)
        .toBe('https://api.anthropic.com/v1/messages')
    }
  })

  it('system 提取为顶层字段（多条合并），不进 messages；max_tokens 取 model.maxTokens', () => {
    const req = toAnthropicRequest(model, [
      { role: 'system', content: '你是一位小说家。' },
      { role: 'system', content: '【架构】主角是林晚。' },
      { role: 'user', content: '写一章' },
      { role: 'assistant', content: '好的' },
    ])
    expect(req.body.system).toBe('你是一位小说家。\n\n【架构】主角是林晚。')
    expect(req.body.messages.map(m => m.role)).toEqual(['user', 'assistant'])
    expect(req.body.max_tokens).toBe(8192)
    expect(req.headers['x-api-key']).toBe('sk-ant-x')
    expect(req.headers['anthropic-version']).toBe('2023-06-01')
  })

  it('maxTokens 缺失兜底 4096（Anthropic 拒绝空 max_tokens）', () => {
    const req = toAnthropicRequest({ ...model, maxTokens: undefined as unknown as number }, [{ role: 'user', content: 'hi' }])
    expect(req.body.max_tokens).toBe(4096)
  })

  it('temperature 钳到 [0,1]（Anthropic API 固有上限，本仓允许 0–2）', () => {
    expect(toAnthropicRequest({ ...model, temperature: 1.6 }, [{ role: 'user', content: 'hi' }]).body.temperature).toBe(1)
    expect(toAnthropicRequest({ ...model, temperature: -1 }, [{ role: 'user', content: 'hi' }]).body.temperature).toBe(0)
    expect(toAnthropicRequest(model, [{ role: 'user', content: 'hi' }]).body.temperature).toBe(0.7)
  })
})

describe('createAnthropicStreamParser', () => {
  it('帧序列：text_delta 累积文本，usage 两处合并（message_start.in + message_delta.out），先 usage 后 finish', () => {
    const events: string[] = []
    let text = ''
    const parse = createAnthropicStreamParser((e) => {
      if (e.type === 'text') text += e.text
      if (e.type === 'usage') events.push(`usage:${e.inputTokens}/${e.outputTokens}`)
      if (e.type === 'finish') events.push('finish')
    })
    parse('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":1}}}\n\n')
    parse('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好"}}\n\n')
    parse('event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":7}}\n\n')
    parse('event: message_stop\ndata: {"type":"message_stop"}\n\n')
    expect(text).toBe('你好')
    expect(events).toEqual(['usage:12/7', 'finish'])
  })

  it('帧被 TCP 分片切断：一行 data 拆两个 chunk 投喂仍完整解析（Review Focus 1）', () => {
    let text = ''
    const parse = createAnthropicStreamParser((e) => { if (e.type === 'text') text += e.text })
    const line = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"分片"}}\n\n'
    parse(line.slice(0, 40))
    parse(line.slice(40))
    expect(text).toBe('分片')
  })

  it('finish 后不再产出（Review Focus：dsh 流式契约）', () => {
    const seen: string[] = []
    const parse = createAnthropicStreamParser((e) => seen.push(e.type))
    parse('event: message_stop\ndata: {"type":"message_stop"}\n\n')
    parse('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"迟到"}}\n\n')
    expect(seen).toEqual(['usage', 'finish'])
  })

  it('非 JSON / 心跳帧（ping）容忍：不产出、不崩溃', () => {
    const seen: string[] = []
    const parse = createAnthropicStreamParser((e) => seen.push(e.type))
    parse('event: ping\ndata: {"type":"ping"}\n\n')
    parse('event: x\ndata: not-json{{{\n\n')
    expect(seen).toEqual([])
  })

  it('流中 error 帧：emit error 事件并停止（HTTP 200 内的中途错误，复核 Important 3）', () => {
    const seen: string[] = []
    const parse = createAnthropicStreamParser((e) => seen.push(e.type === 'error' ? `err:${e.message}` : e.type))
    parse('event: error\ndata: {"type":"error","error":{"message":"overloaded"}}\n\n')
    parse('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"迟到"}}\n\n')
    expect(seen).toEqual(['err:overloaded'])
  })

  it('CRLF 行终止符（\\r\\n\\r\\n）也能切帧，含跨 chunk 的 \\r|\\n 拆分（复核 Important 4）', () => {
    let text = ''
    const parse = createAnthropicStreamParser((e) => { if (e.type === 'text') text += e.text })
    const line = 'event: content_block_delta\r\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"CRLF"}}\r\n\r\n'
    // 在最刁钻的位置切：`\r` 与 `\n` 分属两个 chunk
    const cut = line.indexOf('\r\n\r\n') + 1
    parse(line.slice(0, cut))
    parse(line.slice(cut))
    expect(text).toBe('CRLF')
  })
})

describe('AnthropicProvider.generateStream（类级：mock proxyFetch，复核 Critical 1 回归锁）', () => {
  it('请求体必须带 stream:true，且 SSE 全流程交付文本与 usage', async () => {
    const frames = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":1}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":3}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join('')
    const stream = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new TextEncoder().encode(frames)); c.close() },
    })
    vi.mocked(proxyFetch).mockResolvedValueOnce(new Response(stream, { status: 200 }))

    const provider = new AnthropicProvider()
    let doneText = ''
    let usage: LLMUsage | undefined
    let errMsg = ''
    await provider.generateStream(model, [{ role: 'user', content: 'hi' }], {
      temperature: 0.7,
      maxTokens: 100,
      signal: new AbortController().signal,
      onChunk: () => {},
      onDone: (t, u) => { doneText = t; usage = u },
      onError: (e) => { errMsg = e },
    })

    const init = vi.mocked(proxyFetch).mock.calls.at(-1)?.[1] as RequestInit
    const body = JSON.parse(String(init.body)) as { stream?: boolean }
    expect(body.stream, '流式请求必须带 stream:true（否则 Anthropic 返回单条 JSON，解析器零事件）').toBe(true)
    expect(doneText).toBe('你好')
    expect(usage?.totalTokens).toBe(8)
    expect(errMsg).toBe('')
  })
})

describe('mapAnthropicError', () => {
  it('401 → 带 status 的错误；429 响应体取 error.message', () => {
    expect(mapAnthropicError(401, '{"type":"error","error":{"message":"invalid x-api-key"}}').status).toBe(401)
    const e = mapAnthropicError(429, '{"error":{"message":"rate limited"}}')
    expect(e.status).toBe(429)
    expect(e.message).toBe('rate limited')
  })

  it('HTML 错误页（非 JSON）不崩，仍抛带 status 的错误（Review Focus 5）', () => {
    const e = mapAnthropicError(502, '<html><body>Bad Gateway</body></html>')
    expect(e.status).toBe(502)
    expect(e.message).toContain('Bad Gateway')
  })
})
