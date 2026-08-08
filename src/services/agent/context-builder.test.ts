/**
 * context-builder — Agent system prompt 输出语言约束测试（#30）
 * 此前仅 identityRuleLanguage 弱约束（"Reply in the user's language" 不指明具体语言），
 * 英文界面下 Agent 仍回中文。修复后末尾追加 appendOutputLanguage 明确语言指令。
 */
import { describe, it, expect } from 'vitest'
import { buildAgentSystemPrompt } from './context-builder'

describe('buildAgentSystemPrompt 输出语言约束', () => {
  it('末尾包含明确输出语言指令', () => {
    const prompt = buildAgentSystemPrompt('quick')
    expect(prompt).toContain('[System] 请始终使用')
    expect(prompt).toContain('Do not respond in any other language')
    // 语言指令位于末尾（优先级最高）
    expect(prompt.trim().endsWith('Do not respond in any other language.')).toBe(true)
  })
})
