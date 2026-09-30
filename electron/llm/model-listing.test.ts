import { describe, it, expect } from 'vitest'
import { MAX_LISTING_BYTES, pickCapacity, readListingJson, toCandidates } from './model-listing'

describe('pickCapacity —— 容量字段多拼写解析（对齐 dsh readListing）', () => {
  it('OpenAI 系拼写：context_length / max_tokens', () => {
    expect(pickCapacity({ context_length: 128000, max_tokens: 8192 }))
      .toEqual({ contextWindow: 128000, maxTokens: 8192 })
  })
  it('Anthropic 系拼写：max_input_tokens / max_output_tokens', () => {
    expect(pickCapacity({ max_input_tokens: 200000, max_output_tokens: 64000 }))
      .toEqual({ contextWindow: 200000, maxTokens: 64000 })
  })
  it('Gemini 系拼写：inputTokenLimit / outputTokenLimit；limit.context 嵌套形态', () => {
    expect(pickCapacity({ inputTokenLimit: 1048576, outputTokenLimit: 8192 }))
      .toEqual({ contextWindow: 1048576, maxTokens: 8192 })
    expect(pickCapacity({ limit: { context: 32000, output: 4096 } }))
      .toEqual({ contextWindow: 32000, maxTokens: 4096 })
  })
  it('无效值丢弃（0 / 负数 / NaN / 字符串不冒充数字）', () => {
    expect(pickCapacity({ context_length: 0, max_tokens: -5 })).toEqual({})
    expect(pickCapacity({ context_length: 'x', max_tokens: null })).toEqual({})
  })
})

describe('toCandidates —— 组装修整（无 id 跳过 / 按 id 去重 / 保持顺序）', () => {
  it('无 id 行跳过；重复 id 去重；顺序保持端点序', () => {
    const entries = [
      { id: 'b', context_length: 100 },
      { id: '' }, // 空 id 跳过
      { name: '无 id 字段' }, // 跳过
      { id: 'a', max_tokens: 10 },
      { id: 'b', context_length: 200 }, // 重复：保留首个
    ]
    const out = toCandidates(entries, (e) => (typeof e.id === 'string' ? e.id : undefined))
    expect(out).toEqual([
      { id: 'b', contextWindow: 100 },
      { id: 'a', maxTokens: 10 },
    ])
  })

  it('idOf 可做变换（Gemini 的 models/ 前缀剥离）', () => {
    const out = toCandidates(
      [{ name: 'models/gemini-2.5-pro', inputTokenLimit: 1048576 }],
      (e) => (typeof e.name === 'string' ? e.name.replace(/^models\//, '') : undefined),
    )
    expect(out).toEqual([{ id: 'gemini-2.5-pro', contextWindow: 1048576 }])
  })

  it('⚠️ 不从端点条目里取显示名（v3 T8）：`name` 与 id 的语义各家不同', () => {
    // Gemini 的 `name` 是资源路径（models/gemini-2.5-pro），OpenRouter 的才是显示名；
    // 统一抓 `name` 会把前者变成一串带前缀的假显示名。显示名只由内置直答提供（见 llm-controller）。
    const out = toCandidates(
      [{ name: 'models/gemini-2.5-pro', inputTokenLimit: 1048576 }],
      (e) => (typeof e.name === 'string' ? e.name.replace(/^models\//, '') : undefined),
    )
    expect(out[0]).not.toHaveProperty('name')
  })
})

describe('readListingJson —— 响应体上限（4MB，v3 §5「补 4MB 响应上限」）', () => {
  const json = (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, ...init })

  it('正常响应 → 解出 JSON（未超限时零行为变化）', async () => {
    const res = await readListingJson(json({ data: [{ id: 'm1' }] }))
    expect(res).toEqual({ data: [{ id: 'm1' }] })
  })

  it('声明值就超限 → 提前拒绝（不读 body）', async () => {
    const res = new Response('{}', { headers: { 'content-length': String(MAX_LISTING_BYTES + 1) } })
    await expect(readListingJson(res)).rejects.toThrow(/too large/i)
  })

  it('声明值缺失/撒谎 → 按实际字节数截断（超过即中止读取并抛错）', async () => {
    const huge = 'x'.repeat(64)
    const res = new Response(huge, { headers: { 'content-type': 'application/json' } })
    // 用小上限验证读流路径（不必造 4MB 的真实响应体）
    await expect(readListingJson(res, 16)).rejects.toThrow(/too large/i)
    expect(huge.length).toBeGreaterThan(16) // 防「上限参数被忽略」把这条断言变成空转

    // 同样一份 body，上限放大到够用 → 正常解出（证明上一条失败是因为上限，不是解析错误）
    await expect(readListingJson(new Response('{"ok":1}'), 16)).resolves.toEqual({ ok: 1 })
  })

  it('上限是 4MB（dsh 同口径）', () => {
    expect(MAX_LISTING_BYTES).toBe(4 * 1024 * 1024)
  })
})
