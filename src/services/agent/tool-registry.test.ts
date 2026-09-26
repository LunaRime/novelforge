import { describe, it, expect, afterEach } from 'vitest'
import { toolRegistry, buildAgentTool } from './tool-registry'

describe('generateToolPrompt 子集（C 档第二轮 T1）', () => {
  const reg = (name: string): void => {
    toolRegistry.register(buildAgentTool({
      name,
      description: `d-${name}`,
      source: 'builtin',
      inputSchema: { type: 'object', properties: { p: { type: 'string', description: 'x' } } },
      requiresConfirmation: false,
      execute: async () => ({ success: true, content: '' }),
    }))
  }

  afterEach(() => { toolRegistry.unregister('reg_test_a'); toolRegistry.unregister('reg_test_b') })

  it('只列给定工具；缺省列全量（子 agent 不该看到它调不了的工具契约）', () => {
    reg('reg_test_a')
    reg('reg_test_b')
    const subset = toolRegistry.generateToolPrompt([toolRegistry.get('reg_test_a')!])
    expect(subset).toContain('reg_test_a')
    expect(subset).not.toContain('reg_test_b')
    const all = toolRegistry.generateToolPrompt()
    expect(all).toContain('reg_test_a')
    expect(all).toContain('reg_test_b')
  })

  it('空子集 → 空串（不产出只有标题的空段）', () => {
    expect(toolRegistry.generateToolPrompt([])).toBe('')
  })
})
