import { describe, it, expect } from 'vitest'
import { BUILTIN_PROMPTS, EDITABLE_PROMPT_KEYS, PROMPT_VAR_KEYS, PROMPT_NAME_KEYS, PROMPT_DESC_KEYS } from '../prompt-templates'

/**
 * 模板系统一致性测试（开发者护栏）：
 * 1. 内置模板自身的 {{变量}} 必须都在 variables 里（否则渲染残留字面量给 LLM）
 * 2. 模板 variables 的说明文案必须都在 PROMPT_VAR_KEYS 里（否则显示层不翻译，断链）
 * 3. EDITABLE_PROMPT_KEYS 必须全部存在于内置模板（否则设置页出现空条目）
 * 4. PROMPT_NAME_KEYS / PROMPT_DESC_KEYS 引用的 key 必须存在于模板
 */

function extractPlaceholders(text: string): string[] {
  return [...text.matchAll(/\{\{([^{}]+)\}\}/g)].map(m => m[1])
}

describe('提示词模板一致性', () => {
  it('内置模板 content + systemSuffix 的 {{变量}} 都在自身 variables 中', () => {
    const problems: string[] = []
    for (const tpl of BUILTIN_PROMPTS) {
      const declared = new Set(Object.keys(tpl.variables))
      const used = [
        ...extractPlaceholders(tpl.content),
        ...(tpl.systemSuffix ? extractPlaceholders(tpl.systemSuffix) : []),
      ]
      for (const v of used) {
        if (!declared.has(v)) {
          problems.push(`${tpl.key}: 使用未声明变量 {{${v}}}`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('模板 variables 的说明文案全部在 PROMPT_VAR_KEYS 映射表中（防显示层断链）', () => {
    const problems: string[] = []
    for (const tpl of BUILTIN_PROMPTS) {
      for (const [varName, desc] of Object.entries(tpl.variables)) {
        if (!PROMPT_VAR_KEYS[desc]) {
          problems.push(`${tpl.key}.${varName}: 说明「${desc}」不在 PROMPT_VAR_KEYS 中`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('EDITABLE_PROMPT_KEYS 全部存在于内置模板', () => {
    const keys = new Set(BUILTIN_PROMPTS.map(p => p.key))
    const missing = EDITABLE_PROMPT_KEYS.filter(k => !keys.has(k))
    expect(missing).toEqual([])
  })

  it('PROMPT_NAME_KEYS / PROMPT_DESC_KEYS 引用的模板 key 全部存在', () => {
    const keys = new Set(BUILTIN_PROMPTS.map(p => p.key))
    const missingName = Object.keys(PROMPT_NAME_KEYS).filter(k => !keys.has(k))
    const missingDesc = Object.keys(PROMPT_DESC_KEYS).filter(k => !keys.has(k))
    expect([...missingName, ...missingDesc]).toEqual([])
  })

  it('每个内置模板至少有一个可用变量（variables 非空）', () => {
    const empty = BUILTIN_PROMPTS.filter(p => Object.keys(p.variables).length === 0)
    expect(empty.map(p => p.key)).toEqual([])
  })
})
