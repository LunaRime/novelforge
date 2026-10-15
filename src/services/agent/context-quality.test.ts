// @vitest-environment jsdom
/**
 * 上下文质量用例集（§4 度量口径的 **A 部分：确定性**）
 *
 * 见 `docs/superpowers/specs/2026-10-15-context-quality-eval.md`：
 * 本文件只测**上下文层的结构不变量**（任务状态是否存活、被截断的工具是否仍可调用、
 * 召回是否越界、预算是否守住）——它能证明"机制就位且未被后续改动破坏"，
 * **不能**证明"生成质量提升"（那需要真机 B 部分）。
 *
 * 与单元测试的分工：单元测试锁**函数契约**；本文件锁**跨模块组合后的场景结果**
 * （压缩批次 + 长历史 + 档位策略 + 记忆层一起作用时的最终 system prompt）。
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import {
  buildAgentSystemPromptAsync,
  SYSTEM_PROMPT_BUDGET_TOKENS,
  SESSION_SUMMARY_BUDGET_TOKENS,
  computeToolPromptBudget,
} from './context-builder'
import { resolveContextPolicy } from './context-policy'
import { toolRegistry } from './tool-registry'
import { registerBuiltinTools } from './tools'
import { estimateTokens, initTokenEngine } from './token-budget'
import { AUTO_RECALL_BUDGET_TOKENS } from './memory-layers'
import { useAgentStore } from '../../stores/agent-store'
import { t } from '../../shared/locale'
import type { MemoryFileMeta } from '../memory/memory-codec'

beforeAll(async () => {
  // 与生产同口径（tiktoken）——避免口径差异让"预算不变量"名不副实
  await initTokenEngine()
})

/** 记忆夹具（manual 一条 + auto 一条） */
const MEMORY: Record<string, string> = {
  'book-state.md': '---\n---\n\n# 全书状态\n主角佩剑名为霜落，反派动机是复仇。',
  'chapters-001-015.md': '---\n---\n\n# 卷一\n第 1 章：主角觉醒。',
}
const memoryList = (): MemoryFileMeta[] => [
  { file: 'book-state.md', kind: 'book', loadMode: 'manual', brief: '主角佩剑霜落 与 反派动机', stale: false, mtime: 1 } as MemoryFileMeta,
  { file: 'chapters-001-015.md', kind: 'chapters', loadMode: 'auto', brief: '卷一关键事件', stale: false, mtime: 1 } as MemoryFileMeta,
]

const setupIpc = (): void => {
  Object.defineProperty(window, 'velaAPI', {
    value: {
      invoke: vi.fn(async (ch: string, file?: string) => {
        if (ch === 'memory:list') return memoryList()
        if (ch === 'memory:read') return MEMORY[String(file)] ?? null
        return null
      }),
    },
    configurable: true,
  })
}

/** 造一个"已经压过 2 批 + 长历史"的会话（模拟长期对话后的真实状态） */
const seedLongConversation = (userRequested: string): void => {
  const conv = useAgentStore.getState().createConversation({ title: 'EVAL' })
  const history = Array.from({ length: 10 }, (_, i) => ({
    id: `h${i}`, role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `第 ${i} 轮的历史内容。`.repeat(20), createdAt: i,
  }))
  useAgentStore.setState(state => ({
    conversations: state.conversations.map(c => c.id === conv.id
      ? {
          ...c,
          messages: history,
          rollingSummary: `${t('ccr.summarySectionFacts')}\n主角佩剑霜落\n\n${t('ccr.summarySectionTasks')}\n${userRequested}`,
          compressed: [
            { batch: 1, original: [], summary: '批 1 摘要', compressedAt: 1, originalTokens: 500, recoverable: true },
            { batch: 2, original: [], summary: '批 2 摘要', compressedAt: 2, originalTokens: 500, recoverable: true },
          ],
        }
      : c),
  }))
}

const weakBudgets = () => {
  const p = resolveContextPolicy({ contextWindow: 32_000 })
  return { toolBudgetTokens: p.toolBudgetTokens, m1BudgetTokens: p.m1BudgetTokens, l1BudgetTokens: p.l1BudgetTokens, autoRecall: p.autoRecall }
}
const weakPolicy = resolveContextPolicy({ contextWindow: 32_000 })

beforeEach(() => {
  if (toolRegistry.listAll().length === 0) registerBuiltinTools()
  setupIpc()
  useAgentStore.setState({ conversations: [], activeConversationId: null })
})

describe('A1 任务锚点活过压缩（S2/W2 的核心承诺）', () => {
  it('压过 2 批 + 长历史后，system 仍含本轮诉求，且语言指令保持最末', async () => {
    seedLongConversation('把第三章的重逢写得更克制')
    const prompt = await buildAgentSystemPromptAsync('balanced', '把第三章的重逢写得更克制', weakBudgets())

    // ① 诉求仍在（锚点每轮重建，不依赖摘要是否压得住）
    expect(prompt).toContain('把第三章的重逢写得更克制')
    expect(prompt).toContain(t('engine.taskAnchorHeader'))
    // ② 语言指令仍在最末尾（#30 语义）
    expect(prompt.trim().endsWith('Do not respond in any other language.')).toBe(true)
    // ③ 压缩批次的存在不改变这一结论（历史被压过是前提，不是反例）
    const conv = useAgentStore.getState().getActiveConversation()!
    expect(conv.compressed).toHaveLength(2)
  })
})

describe('A2 降级链末端的工具仍可调用（P0-3 教训）', () => {
  const probes: string[] = []
  beforeEach(() => {
    // 注册 20 个长描述工具：把契约顶到预算之上，逼出"截断 + 签名补偿"路径
    for (let i = 0; i < 20; i++) {
      const name = `eval-probe-${i}`
      probes.push(name)
      toolRegistry.register({
        name,
        description: '演示用长描述工具。'.repeat(30),
        source: 'builtin',
        inputSchema: {
          type: 'object',
          properties: { alpha: { type: 'string', description: '参数 alpha' } },
          required: ['alpha'],
        },
        requiresConfirmation: false,
        isReadOnly: true,
        execute: async () => ({ success: true, content: 'ok' }),
      })
    }
  })
  afterEach(() => {
    for (const name of probes.splice(0)) toolRegistry.unregister(name)
  })

  it('工具被截断时，签名清单仍覆盖**每一个**已注册工具（含首/中/尾）', async () => {
    const all = toolRegistry.listAll()
    const prompt = await buildAgentSystemPromptAsync('balanced', '写第 1 章')
    expect(estimateTokens(toolRegistry.generateToolPrompt())).toBeGreaterThan(
      computeToolPromptBudget(all.length),
    )
    // 抽样首/中/尾 + 全部 probe：每个名字都能在提示词里找到"名字("
    for (const tool of [all[0], all[Math.floor(all.length / 2)], all[all.length - 1], ...all.filter(x => x.name.startsWith('eval-probe-'))]) {
      expect(prompt).toContain(`${tool.name}(`)
    }
  })
})

describe('A3 弱档召回精度与预算（W3）', () => {
  it('弱档 + 命中（消息提到记忆名）→ 注入召回段且 ≤400 tokens', async () => {
    seedLongConversation('继续写')
    const { buildAgentSystemSegmentsAsync } = await import('./context-builder')
    const built = await buildAgentSystemSegmentsAsync('balanced', '帮我核对 book-state 里的设定', weakBudgets())
    expect(built.autoRecall).toContain(t('memory.autoRecallHeader'))
    expect(built.autoRecall).toContain('主角佩剑名为霜落')
    const recall = built.segments.find(s => s.key === 'memory-auto-recall')
    expect(recall?.tokens).toBeLessThanOrEqual(AUTO_RECALL_BUDGET_TOKENS)
    // 最终 prompt 里也确实带着它
    const prompt = await buildAgentSystemPromptAsync('balanced', '帮我核对 book-state 里的设定', weakBudgets())
    expect(prompt).toContain(t('memory.autoRecallHeader'))
  })

  it('弱档 + 未命中 → 无召回段（不因"开了开关"就每轮塞记忆）', async () => {
    seedLongConversation('继续写')
    const prompt = await buildAgentSystemPromptAsync('balanced', '继续写第 7 章', weakBudgets())
    expect(prompt).not.toContain(t('memory.autoRecallHeader'))
  })

  it('强/标准档即使命中也不注入（强模型自己会 @ / read_memory）', async () => {
    seedLongConversation('继续写')
    const strong = resolveContextPolicy({ contextWindow: 200_000 })
    const prompt = await buildAgentSystemPromptAsync('balanced', '帮我核对 book-state 里的设定', {
      toolBudgetTokens: strong.toolBudgetTokens, m1BudgetTokens: strong.m1BudgetTokens, l1BudgetTokens: strong.l1BudgetTokens,
      autoRecall: strong.autoRecall,
    })
    expect(prompt).not.toContain(t('memory.autoRecallHeader'))
    // @ 显式引用仍然照常工作（自动召回关掉不影响既有通路）
    const explicit = await buildAgentSystemPromptAsync('balanced', '@book-state.md 看一下', {
      toolBudgetTokens: strong.toolBudgetTokens, m1BudgetTokens: strong.m1BudgetTokens, l1BudgetTokens: strong.l1BudgetTokens,
      autoRecall: strong.autoRecall,
    })
    expect(explicit).toContain('主角佩剑名为霜落')
  })
})

describe('A4 三档预算不变量与 A5 M1 注入不越界', () => {
  it('三档下 system 总量 ≤ 7500 + 各独立段；语言指令恒最末', async () => {
    seedLongConversation('把第三章写得更克制')
    for (const window of [32_000, 128_000, 200_000]) {
      const policy = resolveContextPolicy({ contextWindow: window })
      const built = await (await import('./context-builder')).buildAgentSystemSegmentsAsync('balanced', '把第三章写得更克制', {
        toolBudgetTokens: policy.toolBudgetTokens, m1BudgetTokens: policy.m1BudgetTokens, l1BudgetTokens: policy.l1BudgetTokens,
        autoRecall: policy.autoRecall,
      })
      const volatile = estimateTokens(built.memoryResident) + estimateTokens(built.memoryManual) + estimateTokens(built.autoRecall)
      const budget = SYSTEM_PROMPT_BUDGET_TOKENS + volatile
      const prompt = await buildAgentSystemPromptAsync('balanced', '把第三章写得更克制', {
        toolBudgetTokens: policy.toolBudgetTokens, m1BudgetTokens: policy.m1BudgetTokens, l1BudgetTokens: policy.l1BudgetTokens,
        autoRecall: policy.autoRecall,
      })
      expect(estimateTokens(prompt)).toBeLessThanOrEqual(budget)
      expect(prompt.trim().endsWith('Do not respond in any other language.')).toBe(true)
    }
  })

  it('M1 注入不越界：超长滚动摘要 + 弱档 200 → 摘要段 ≤ 200 + 标题开销', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'EVAL-M1' })
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id
        ? { ...c, rollingSummary: '很长的摘要内容'.repeat(400) }
        : c),
    }))
    const built = await (await import('./context-builder')).buildAgentSystemSegmentsAsync('balanced', '继续', weakBudgets())
    const m1 = built.segments.find(s => s.key === 'memory-m1')!
    const overhead = estimateTokens(`${t('ccr.conversationSummaryHeader')}\n${t('ccr.autoGeneratedNotice')}\n\n`)
    expect(m1.tokens).toBeLessThanOrEqual(weakPolicy.m1BudgetTokens + overhead + 4)
    expect(weakPolicy.m1BudgetTokens).toBeLessThan(SESSION_SUMMARY_BUDGET_TOKENS)   // 弱档确实比缺省更紧
  })
})
