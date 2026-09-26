import { describe, it, expect } from 'vitest'
import { selectCompressionBatch, serializeArchive, parseArchive, extractSideEffectReceipts } from './archive-codec'
import { registerBuiltinTools } from './tools'
import type { AgentMessage, AgentConversation } from '../../stores/agent-store'
import { MAX_SUB_SESSIONS, MAX_SUBAGENT_MESSAGES, type SubAgentSession } from './subagent/types'

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

describe('extractSideEffectReceipts（B 档第二轮：副作用回执）', () => {
  // 回执只在**有副作用**的工具上抽取（评审 I5）—— 需要真实注册表判定 isReadOnly
  registerBuiltinTools()


  const msgWithTool = (
    id: string, tool: string, target: string, status: string, paths: string[] = [],
  ): AgentMessage => ({
    id, role: 'assistant', content: '', createdAt: 0,
    toolCalls: [{
      id: `${id}-tc`, toolName: tool, arguments: { file_path: target }, status: status as never,
    }],
    artifacts: paths.map(path => ({ type: 'file_modified', path, name: path })) as never,
  })

  it('只抽已结束的工具调用（pending/running 不抽）', () => {
    const receipts = extractSideEffectReceipts([
      msgWithTool('a', 'write_file', 'drafts/c1.md', 'completed'),
      msgWithTool('b', 'write_file', 'drafts/c2.md', 'running'),
      msgWithTool('c', 'read_file', 'drafts/c3.md', 'pending'),
    ])
    expect(receipts).toHaveLength(1)
    expect(receipts[0].target).toBe('drafts/c1.md')
  })

  it('同 target 只留最新（防重放核心：旧回执不诱导重复写入）', () => {
    const receipts = extractSideEffectReceipts([
      msgWithTool('a', 'write_file', 'drafts/c1.md', 'completed'),
      msgWithTool('b', 'write_file', 'drafts/c1.md', 'completed'),
    ])
    expect(receipts).toHaveLength(1)
    expect(receipts[0].tool).toBe('write_file')
  })

  it('失败的工具标 failed（回执要能区分成败）', () => {
    const receipts = extractSideEffectReceipts([msgWithTool('a', 'edit_file', 'drafts/c1.md', 'failed')])
    expect(receipts[0].outcome).toBe('failed')
  })

  it('带上产物路径', () => {
    const receipts = extractSideEffectReceipts([
      msgWithTool('a', 'write_file', 'drafts/c1.md', 'completed', ['drafts/c1.md']),
    ])
    expect(receipts[0].artifactPaths).toEqual(['drafts/c1.md'])
  })

  it('上限 32 条（超出丢最旧）', () => {
    const many = Array.from({ length: 40 }, (_, i) => msgWithTool(`m${i}`, 'write_file', `drafts/c${i}.md`, 'completed'))
    const receipts = extractSideEffectReceipts(many)
    expect(receipts.length).toBeLessThanOrEqual(32)
    expect(receipts[receipts.length - 1].target).toBe('drafts/c39.md')   // 保留最新
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
      // C 档第二轮：parse 同 messages/compressed/rewound 一样恒常附加缺省字段（完整形状契约）
      subSessions: [],
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
      subSessions: [],   // C 档第二轮：parse 恒常附加缺省字段（完整形状契约）
    }
    expect(parseArchive(serializeArchive(conv))).toEqual(conv)
  })

  it('F1/F2 锁：user/system 正文含原始标签经 parseArchive 逐字保留；assistant 同内容清理', () => {
    const conv: AgentConversation = {
      id: 'c5', title: '会话', messages: [
        // user 用户原文（可含字面 tool/think 标签——写入链零清洗，绝不可被净化改写）
        { id: 'u1', role: 'user', content: '<tool_call> 和 <tool_result> 怎么用？', createdAt: 0 },
        { id: 'u2', role: 'user', content: '文件里是 <think> 未闭合\n\n其后整段正文，不能被吞', createdAt: 1 },
        { id: 's1', role: 'system', content: '系统注入：参考 <think> 折叠语法', createdAt: 2 },
        // assistant 同内容 → 崩溃残片语义，清理
        { id: 'a1', role: 'assistant', content: '<tool_call>\n{"name":"x","arguments":{}}\n</tool_call>\n正文回复', createdAt: 3 },
      ],
      createdAt: 0, updatedAt: 4, mode: 'deep', modelId: null,
    }
    const raw = serializeArchive(conv)
    const parsed = parseArchive(raw)!
    expect(parsed.messages.map(m => m.id)).toEqual(['u1', 'u2', 's1', 'a1'])
    expect(parsed.messages[0]!.content).toBe('<tool_call> 和 <tool_result> 怎么用？')
    expect(parsed.messages[1]!.content).toBe('文件里是 <think> 未闭合\n\n其后整段正文，不能被吞')
    expect(parsed.messages[2]!.content).toBe('系统注入：参考 <think> 折叠语法')
    expect(parsed.messages[3]!.content).toBe('\n正文回复')
  })
})

describe('归档 subSessions（C 档第二轮 T4）', () => {
  const baseConv = (): AgentConversation => ({
    id: 'c1', title: 'T', messages: [], createdAt: 0, updatedAt: 0, mode: 'quick', modelId: null,
  })
  const sess = (over: Partial<SubAgentSession> = {}): SubAgentSession => ({
    id: 'abc123', taskId: 'abc123', description: '查玉佩伏笔', prompt: 'p', allowedTools: ['read_drafts'],
    status: 'completed', messages: [{ id: 'm1', role: 'user', content: '查玉佩', createdAt: 0 }],
    toolCalls: [], artifacts: [], result: '结论', startedAt: 1, endedAt: 2, ...over,
  })

  it('round-trip 保持 subSessions', () => {
    const conv = { ...baseConv(), subSessions: [sess()] }
    expect(parseArchive(serializeArchive(conv))!.subSessions).toEqual([sess()])
  })

  it('缺字段降级为 []（旧档兼容）', () => {
    const parsed = parseArchive('{"id":"c1","title":"T","createdAt":0,"updatedAt":0,"mode":"quick","modelId":null}')
    expect(parsed!.subSessions).toEqual([])
  })

  it('坏条目过滤：非对象 / 缺 id / messages 非数组（Review Focus 5：一条坏数据不毁整档）', () => {
    const raw = JSON.stringify({
      ...baseConv(),
      subSessions: [sess(), '不是对象', { description: '缺 id' }, { ...sess({ id: 'ok2' }), messages: '不是数组' }],
    })
    const parsed = parseArchive(raw)!
    expect(parsed.subSessions!.map(s => s.id)).toEqual(['abc123'])
  })

  it('超 MAX_SUB_SESSIONS 裁剪为最新 N 条（按 startedAt 倒序保留）', () => {
    const many = Array.from({ length: 30 }, (_, i) => sess({ id: `s${i}`, taskId: `s${i}`, startedAt: i }))
    const parsed = parseArchive(serializeArchive({ ...baseConv(), subSessions: many }))!
    expect(parsed.subSessions!).toHaveLength(MAX_SUB_SESSIONS)
    expect(parsed.subSessions![0].startedAt).toBe(29)          // 最新在前
  })

  it('单条超 MAX_SUBAGENT_MESSAGES 裁剪消息', () => {
    const long = sess({ messages: Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, role: 'assistant' as const, content: 'x', createdAt: i })) })
    expect(parseArchive(serializeArchive({ ...baseConv(), subSessions: [long] }))!.subSessions![0].messages)
      .toHaveLength(MAX_SUBAGENT_MESSAGES)
  })

  it('子转录净化：崩溃残片（无配对 tool_call / thinking）与父同口径', () => {
    const dirty = sess({
      messages: [
        { id: 'a1', role: 'assistant', content: '<tool_call>{"name":"x","arguments":{}}</tool_call>', createdAt: 0 },
        { id: 'a2', role: 'assistant', content: '正文<think>残片', createdAt: 1 },
      ],
    })
    const parsed = parseArchive(serializeArchive({ ...baseConv(), subSessions: [dirty] }))!
    expect(parsed.subSessions![0].messages.map(m => m.id)).toEqual(['a2'])
  })

  it('toolCalls / artifacts / allowedTools 非数组时置空（渲染层不崩）', () => {
    const broken = { ...sess(), toolCalls: 'x', artifacts: null, allowedTools: 3, result: 42 }
    const parsed = parseArchive(JSON.stringify({ ...baseConv(), subSessions: [broken] }))!
    const s = parsed.subSessions![0]
    expect(s.toolCalls).toEqual([])
    expect(s.artifacts).toEqual([])
    expect(s.allowedTools).toEqual([])
    expect(s.result).toBe('')
  })
})

describe('归档 running 归一（C 档第二轮评审 I4）', () => {
  const baseConv = (): AgentConversation => ({
    id: 'c1', title: 'T', messages: [], createdAt: 0, updatedAt: 0, mode: 'quick', modelId: null,
  })
  it('半途崩溃留下的 running 子会话 → 归一为 cancelled（否则永远「执行中」+ 幂等锁死）', () => {
    const raw = JSON.stringify({
      ...baseConv(),
      subSessions: [{
        id: 's1', taskId: 's1', description: 'd', prompt: 'p', allowedTools: [], status: 'running',
        messages: [], toolCalls: [], artifacts: [], result: '', startedAt: 1,
      }],
    })
    const s = parseArchive(raw)!.subSessions![0]
    expect(s.status).toBe('cancelled')
    expect(s.error).toBeTruthy()      // 带原因（不静默）
  })
})
