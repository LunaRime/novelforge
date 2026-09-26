// @vitest-environment jsdom
/**
 * 子 agent 的 scoped 提示词装配（C 档第二轮 T2）。
 * 契约：含身份/任务/L0/记忆；**不含**白名单外的工具契约，也不含父专属段
 * （技能目录 / 会话摘要 M1 / 编辑器上下文 L1 —— 子任务与之无关，且要省预算）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildSubAgentPrompt } from './prompt'
import { registerBuiltinTools } from '../tools'
import { estimateTokens } from '../token-budget'
import { SUBAGENT_PROMPT_BUDGET_TOKENS } from './types'
import { t } from '../../../shared/locale'
import { useProjectStore } from '../../../stores/project-store'

const TASK = {
  taskId: 't1', description: '查玉佩伏笔',
  prompt: '查清前 29 章里玉佩相关伏笔', allowedTools: ['read_drafts', 'read_memory'], modelId: 'm',
}

beforeEach(() => {
  registerBuiltinTools()
  useProjectStore.setState({ currentProject: null })
  Object.defineProperty(window, 'velaAPI', {
    value: {
      invoke: vi.fn(async (ch: string, file?: string) => {
        if (ch === 'memory:list') return [{ file: 'book-state.md', kind: 'book', loadMode: 'resident', brief: '主角是苏晚晴', stale: false, mtime: 1 }]
        if (ch === 'memory:read') return file === 'book-state.md' ? '---\nload_mode: resident\n---\n主角是苏晚晴' : null
        return null
      }),
    },
    configurable: true,
  })
})

describe('buildSubAgentPrompt（scoped 装配）', () => {
  it('含子 agent 身份 + 任务说明 + 常驻记忆（复用父的分层装配）', async () => {
    const p = await buildSubAgentPrompt(TASK)
    expect(p).toContain('查玉佩伏笔')
    expect(p).toContain('查清前 29 章里玉佩相关伏笔')
    expect(p).toContain('主角是苏晚晴')      // 常驻记忆段
  })

  it('工具契约只含白名单内的工具（子 agent 不该看到它调不了的工具）', async () => {
    const p = await buildSubAgentPrompt(TASK)
    expect(p).toContain('#### read_drafts')
    expect(p).toContain('#### read_memory')
    // ⚠️ 断言**契约头**而不是名字：别的工具描述里可能提到它（如 read_memory 的描述里
    //    写了「与 search_knowledge 的分工」）——那是说明文字，不是可用契约
    expect(p).not.toContain('#### write_file')
    expect(p).not.toContain('#### search_knowledge')
  })

  it('不含父专属段：技能目录 / 会话摘要 / 编辑器上下文', async () => {
    const p = await buildSubAgentPrompt(TASK)
    expect(p).not.toContain('可用技能')
    expect(p).not.toContain('会话摘要')
    expect(p).not.toContain('编辑器')
  })

  it('超预算按 常驻 → 目录 → 工具描述 顺序降级，最终 ≤ SUBAGENT_PROMPT_BUDGET_TOKENS', async () => {
    const big = { ...TASK, prompt: '详'.repeat(4000) }
    const p = await buildSubAgentPrompt(big)
    expect(estimateTokens(p)).toBeLessThanOrEqual(SUBAGENT_PROMPT_BUDGET_TOKENS)
    expect(p).toContain('详'.repeat(20))     // 任务说明保底（不是一裁到底）
    expect(p).toContain(t('subagent.taskTruncated'))   // 裁了要留痕：子 agent 得知道指令被裁过
  })

  it('记忆读盘失败：装配照常（不抛，只是没有记忆段）', async () => {
    const invokeMock = window.velaAPI.invoke as ReturnType<typeof vi.fn>
    invokeMock.mockRejectedValue(new Error('no project'))
    const p = await buildSubAgentPrompt(TASK)
    expect(p).toContain('查玉佩伏笔')
    expect(p).toContain('read_drafts')
  })
})
