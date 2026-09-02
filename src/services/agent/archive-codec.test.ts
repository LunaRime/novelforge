import { describe, it, expect } from 'vitest'
import { selectCompressionBatch, serializeArchive, parseArchive } from './archive-codec'
import type { AgentMessage, AgentConversation } from '../../stores/agent-store'

const makeMsg = (id: string, role: 'user' | 'assistant' | 'system', content: string): AgentMessage => ({
  id, role, content, createdAt: 0,
})

const msgs = (n: number): AgentMessage[] =>
  Array.from({ length: n }, (_, i) => makeMsg(`m${i}`, i % 2 === 0 ? 'user' : 'assistant', `第${i}条消息内容`.repeat(20)))

describe('selectCompressionBatch', () => {
  it('总 token 在预算内时 batch 为空', () => {
    const { batch, rest } = selectCompressionBatch(msgs(2), 100_000)
    expect(batch).toHaveLength(0)
    expect(rest).toHaveLength(2)
  })

  it('超预算时最旧消息进入 batch，rest 保留最新消息', () => {
    const { batch, rest } = selectCompressionBatch(msgs(10), 800)
    expect(batch.length).toBeGreaterThan(0)
    expect(rest.length).toBeGreaterThan(0)
    // 顺序保持：batch 在前、rest 在后，拼接回原序
    expect([...batch, ...rest].map(m => m.id)).toEqual(msgs(10).map(m => m.id))
  })

  it('rest 至少保留 1 条最新消息', () => {
    const { rest } = selectCompressionBatch(msgs(10), 1)
    expect(rest.length).toBeGreaterThanOrEqual(1)
  })

  it('跳过 system 消息（不压缩 system，始终留在 rest 尾部）', () => {
    const withSys = [makeMsg('s1', 'system', '系统指令'), ...msgs(10)]
    const { batch } = selectCompressionBatch(withSys, 800)
    expect(batch.some(m => m.role === 'system')).toBe(false)
  })

  it('system 消息位于 batch 中间时不进 batch 且 rest 保序', () => {
    // [m0, system, m1, m2, m3] 超预算：system 落在 batch 中段
    // （预算 50 < 单条 ~210，从最新端累积时 m2 触发 break，batch = [m0, system, m1, m2]；
    //   system 移回 rest 头部，非 system 消息顺序不变——契约见 selectCompressionBatch 注释）
    const withSysMid = [msgs(4)[0], makeMsg('sys', 'system', '系统指令'), msgs(4)[1], msgs(4)[2], msgs(4)[3]]
    const { batch, rest } = selectCompressionBatch(withSysMid, 50)
    expect(batch.some(m => m.role === 'system')).toBe(false)
    expect(rest.some(m => m.role === 'system')).toBe(true)
    // rest 是原消息的子序列（相对顺序保持）
    const restIds = rest.map(m => m.id)
    const origIds = withSysMid.map(m => m.id)
    let j = 0
    for (const id of origIds) {
      if (restIds[j] === id) j++
    }
    expect(j).toBe(restIds.length)
    // 非 system 消息顺序不变（batch + rest 拼接）
    expect([...batch, ...rest].filter(m => m.role !== 'system').map(m => m.id))
      .toEqual(withSysMid.filter(m => m.role !== 'system').map(m => m.id))
  })
})

describe('archive 序列化', () => {
  it('round-trip 保持会话完整（含 compressed/rollingSummary）', () => {
    const conv: AgentConversation = {
      id: 'c1', title: '测试会话', messages: msgs(3),
      createdAt: 0, updatedAt: 1, mode: 'balanced', modelId: 'm',
      projectPath: 'E:/p', projectName: 'P',
      compressed: [{ batch: 1, original: [msgs(3)[0]], summary: '摘要', compressedAt: 1, originalTokens: 100 }],
      rollingSummary: '滚动摘要',
      // F5：parse 同 messages/compressed 一样恒常附加缺省字段——rewound 缺失即 []（完整形状契约）
      rewound: [],
    }
    const parsed = parseArchive(serializeArchive(conv))
    expect(parsed).toEqual(conv)
  })

  it('损坏 JSON 返回 null（不抛错）', () => {
    expect(parseArchive('{bad json')).toBeNull()
  })

  it('缺字段降级：messages/compressed/rollingSummary 缺省', () => {
    const parsed = parseArchive('{"id":"c1","title":"T","createdAt":0,"updatedAt":0,"mode":"balanced","modelId":null}')
    expect(parsed).not.toBeNull()
    expect(parsed!.messages).toEqual([])
    expect(parsed!.compressed).toEqual([])
    expect(parsed!.rewound).toEqual([])
    expect(parsed!.rollingSummary).toBeUndefined()
  })

  it('手改/损坏形状防御：content 非字符串的消息被过滤，original 非数组置空', () => {
    const raw = JSON.stringify({
      id: 'c2', title: 'T', createdAt: 0, updatedAt: 0, mode: 'balanced', modelId: null,
      messages: [
        { id: 'ok', role: 'user', content: '正常', createdAt: 0 },
        { id: 'bad', role: 'assistant', content: 12345, createdAt: 0 },
        { id: 'nullish', role: 'user', content: null, createdAt: 0 },
        '不是对象',
      ],
      compressed: [
        { batch: 1, summary: '摘要', original: [{ id: 'a', role: 'user', content: '原文', createdAt: 0 }], compressedAt: 1, originalTokens: 100 },
        { batch: 2, summary: '损坏批', original: '不是数组', compressedAt: 2, originalTokens: 50 },
        { batch: 3, original: [{ id: 'x', role: 'user', content: '无摘要', createdAt: 0 }], compressedAt: 3, originalTokens: 10 },
        '不是对象',
      ],
    })
    const parsed = parseArchive(raw)
    expect(parsed).not.toBeNull()
    expect(parsed!.messages).toEqual([{ id: 'ok', role: 'user', content: '正常', createdAt: 0 }])
    expect(parsed!.compressed).toHaveLength(2)
    expect(parsed!.compressed![0].original).toEqual([{ id: 'a', role: 'user', content: '原文', createdAt: 0 }])
    // original 非数组 → 置空（不崩溃）
    expect(parsed!.compressed![1].original).toEqual([])
  })

  it('C4 恢复净化：崩溃残片四类（tool_call/thinking/空白/陈旧 streaming）解析后被净化', () => {
    const raw = JSON.stringify({
      id: 'c3', title: 'T', createdAt: 0, updatedAt: 0, mode: 'balanced', modelId: null,
      messages: [
        { id: 'u1', role: 'user', content: '帮我查第 3 章', createdAt: 0 },
        // 1) 无配对 tool_call（无正文）assistant → 整条过滤
        { id: 'a1', role: 'assistant', content: '<tool_call>\n{"name":"read_drafts","arguments":{}}\n</tool_call>', createdAt: 1 },
        // 2) thinking 残片 + tool 块混入正文 → 清残片留正文
        { id: 'a2', role: 'assistant', content: '好的。<think>思考</think>\n<tool_result name="read_drafts">第3章\n</tool_result>\n继续', createdAt: 2 },
        // 3) 纯空白消息（user + streaming 占位符 assistant）→ 整条过滤
        { id: 'u2', role: 'user', content: '   ', createdAt: 3 },
        { id: 'a3', role: 'assistant', content: '', createdAt: 4, streaming: true, toolCalls: [] },
        // 4) 陈旧 streaming 但有正文 → 保留并清 flag
        { id: 'a4', role: 'assistant', content: '半截正文', createdAt: 5, streaming: true },
        // 角色非法（手改归档）→ 过滤
        { id: 'bad-role', role: 'tool', content: 'x', createdAt: 6 },
        // 正常结尾
        { id: 'u3', role: 'user', content: '继续', createdAt: 7 },
      ],
      compressed: [{
        batch: 1, summary: '摘要', compressedAt: 1, originalTokens: 10,
        original: [
          { id: 'c1', role: 'assistant', content: '<tool_call>{"name":"x","arguments":{}}</tool_call>', createdAt: 0 },
          { id: 'c2', role: 'user', content: '正常原文', createdAt: 0 },
        ],
      }],
      rewound: [{
        messageId: 'u1', rewoundAt: 1,
        messages: [
          { id: 'r1', role: 'assistant', content: '<think>未闭合', createdAt: 0 },
          { id: 'r2', role: 'user', content: '归档正文', createdAt: 0 },
        ],
      }],
    })
    const parsed = parseArchive(raw)!
    expect(parsed.messages.map(m => m.id)).toEqual(['u1', 'a2', 'a4', 'u3'])
    expect(parsed.messages[1]!.content).toBe('好的。\n\n继续')
    expect(parsed.messages[2]!.content).toBe('半截正文')
    expect(parsed.messages[2]!.streaming).toBe(false)
    // compressed/rewound 与 messages 同口径净化
    expect(parsed.compressed![0].original.map(m => m.id)).toEqual(['c2'])
    expect(parsed.rewound![0].messages.map(m => m.id)).toEqual(['r2'])
  })

  it('C4 行为兼容锁定：正常归档解析零改动（含思考引用形态与压缩/rewind 往返）', () => {
    const conv: AgentConversation = {
      id: 'c4', title: '会话', messages: [
        { id: 'u1', role: 'user', content: '帮我写一章', createdAt: 0 },
        // 正常可见思考形态（引用前缀 + 正文）——净化不得触碰
        { id: 'a1', role: 'assistant', content: '_思考过程：_\n> 先梳理伏笔\n\n夜色渐深。', createdAt: 1 },
        { id: 'u2', role: 'user', content: '继续', createdAt: 2 },
        { id: 'a2', role: 'assistant', content: '他推开门，风涌了进来。', createdAt: 3 },
      ],
      createdAt: 0, updatedAt: 4, mode: 'deep', modelId: null,
      compressed: [{ batch: 1, summary: '摘要', compressedAt: 1, originalTokens: 1,
        original: [{ id: 'u0', role: 'user', content: '旧的原文问题', createdAt: -1 }] }],
      rewound: [{ messageId: 'u1', rewoundAt: 2,
        messages: [{ id: 'a0', role: 'assistant', content: '被回退的回复', createdAt: -1 }] }],
    }
    expect(parseArchive(serializeArchive(conv))).toEqual(conv)
  })
})
