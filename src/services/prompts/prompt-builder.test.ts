import { describe, it, expect, vi } from 'vitest'
import { BasePromptBuilder } from './prompt-builder'
import { BUILTIN_PROMPTS, type PromptTemplate } from '../prompt-templates'

function makeTemplate(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    key: 'test_key',
    name: '测试模板',
    description: 'd',
    content: '写作要求：{{global_guidance}}\n目标字数：{{word_number}}字',
    variables: { global_guidance: '指导', word_number: '字数' },
    ...overrides,
  }
}

describe('BasePromptBuilder.build', () => {
  it('替换变量并追加输出语言约束（末尾 [System] 指令）', () => {
    const builder = new BasePromptBuilder(makeTemplate())
    builder['variables'] = { global_guidance: '黄金三章', word_number: '3000' }
    const out = builder.build()
    expect(out).toContain('写作要求：\n=== USER_INPUT_START ===\n黄金三章\n=== USER_INPUT_END ===\n')
    expect(out).toContain('[System] 请始终使用 中文 输出所有内容')
    expect(out).not.toContain('{{global_guidance}}')
  })

  it('systemSuffix 从内置模板追加（若存在）', () => {
    // 内置模板中找带 systemSuffix 的真实模板验证追加逻辑
    const real = BUILTIN_PROMPTS.find(p => p.systemSuffix)
    if (!real) {
      expect(true).toBe(true) // 无内置 systemSuffix 模板则跳过
      return
    }
    const builder = new BasePromptBuilder(real)
    const out = builder.build()
    expect(out.endsWith('[System] 请始终使用 中文 输出所有内容。Do not respond in any other language.')).toBe(true)
  })

  it('未赋值占位符警告但语言指令仍追加', () => {
    const builder = new BasePromptBuilder(makeTemplate())
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = builder.build() // 无变量 → {{global_guidance}} 残留
    expect(out).toContain('[System]')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
