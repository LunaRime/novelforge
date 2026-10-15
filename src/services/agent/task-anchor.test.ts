/**
 * task-anchor（S2/W2）——任务锚点纯函数契约：
 * 只在有真实诉求时出现；命令轮不注入；失败回执才进"未完成"；硬上限 120 tokens。
 *
 * 为什么这些用例重要：锚点是**唯一**能对抗"任务状态被压进摘要"的机制，
 * 而它一旦误判（把命令当诉求、把已完成的写入当未完成），就会变成新的幻觉源。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { buildTaskAnchor, TASK_ANCHOR_BUDGET_TOKENS } from './task-anchor'
import { registerBuiltinTools } from './tools'
import { toolRegistry } from './tool-registry'
import { estimateTokens } from './token-budget'
import { t } from '../../shared/locale'
import type { AgentMessage } from '../../stores/agent-store'

/** 构造带工具调用的消息（write_file 是内置的**写类**工具 → 会被回执抽取） */
const msgWithTool = (id: string, status: 'completed' | 'failed', filePath = 'drafts/c1.md'): AgentMessage => ({
  id,
  role: 'assistant',
  content: '已处理',
  createdAt: 1,
  toolCalls: [{ id: `tc-${id}`, toolName: 'write_file', arguments: { file_path: filePath }, status }],
} as AgentMessage)

describe('task-anchor', () => {
  beforeEach(() => {
    if (toolRegistry.listAll().length === 0) registerBuiltinTools()
  })

  it('无诉求 / 空白 → 空串（不注入、不出现在明细段）', () => {
    expect(buildTaskAnchor({ userMessage: '', messages: [] })).toBe('')
    expect(buildTaskAnchor({ userMessage: '   \n ', messages: [] })).toBe('')
  })

  it('斜杠命令 → 空串（/clear 等不是创作任务，不能当诉求注入）', () => {
    expect(buildTaskAnchor({ userMessage: '/clear', messages: [] })).toBe('')
    expect(buildTaskAnchor({ userMessage: '  /skill agent-tool-context', messages: [] })).toBe('')
  })

  it('有诉求 → 含标题 + 诉求首句 + 非历史声明', () => {
    const out = buildTaskAnchor({
      userMessage: '把第三章的重逢场景改得更克制一些。顺便看看伏笔。',
      messages: [],
    })
    expect(out).toContain(t('engine.taskAnchorHeader'))
    expect(out).toContain('把第三章的重逢场景改得更克制一些')   // 首句
    expect(out).not.toContain('顺便看看伏笔')                    // 只取首句，不搬全文
    expect(out).toContain(t('engine.taskAnchorNote'))
    expect(out).not.toContain(t('engine.taskAnchorPending'))     // 无失败回执 → 不出现"未完成"行
  })

  it('首句过长 → 截断并加省略号，且「非历史」声明绝不被截掉', () => {
    const long = `${'很长的诉求描述'.repeat(30)}。后面还有一句。`
    const out = buildTaskAnchor({ userMessage: long, messages: [] })
    expect(out).toContain('…')
    expect(out).not.toContain('后面还有一句')          // 只取首句
    expect(out).toContain(t('engine.taskAnchorNote'))  // 固定部分优先保额（先截诉求，不截声明）
  })

  it('失败回执 → 进"未完成"行（工具 → 目标）', () => {
    const out = buildTaskAnchor({
      userMessage: '继续写第 4 章',
      messages: [msgWithTool('m1', 'failed', 'drafts/c4.md')],
    })
    expect(out).toContain(t('engine.taskAnchorPending'))
    expect(out).toContain('write_file → drafts/c4.md')
  })

  it('成功回执 → 不进"未完成"（已完成的写入无需提醒模型）', () => {
    const out = buildTaskAnchor({
      userMessage: '继续写第 4 章',
      messages: [msgWithTool('m1', 'completed', 'drafts/c4.md')],
    })
    expect(out).not.toContain(t('engine.taskAnchorPending'))
  })

  it('同一目标先失败后成功 → 以最新为准，不再列为未完成（防误报）', () => {
    const out = buildTaskAnchor({
      userMessage: '继续写第 4 章',
      messages: [msgWithTool('m1', 'failed', 'drafts/c4.md'), msgWithTool('m2', 'completed', 'drafts/c4.md')],
    })
    expect(out).not.toContain(t('engine.taskAnchorPending'))
  })

  it('硬上限：任何输入下锚点 ≤ TASK_ANCHOR_BUDGET_TOKENS', () => {
    const many = Array.from({ length: 10 }, (_, i) => msgWithTool(`m${i}`, 'failed', `drafts/very-long-file-name-${i}.md`))
    const out = buildTaskAnchor({ userMessage: `${'超长诉求。'.repeat(200)}`, messages: many })
    expect(estimateTokens(out)).toBeLessThanOrEqual(TASK_ANCHOR_BUDGET_TOKENS)
    expect(out.length).toBeGreaterThan(0)
  })
})
