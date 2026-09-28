import { describe, it, expect } from 'vitest'
import { LLM_PROTOCOLS } from './llm-protocols'
import { UI_TEXTS } from './locale'

describe('LLM 协议单源注册表', () => {
  it('含 openai / gemini / anthropic 三员（anthropic 为 2026-09-28 原生协议）', () => {
    expect(LLM_PROTOCOLS.map(p => p.id)).toEqual(['openai', 'gemini', 'anthropic'])
  })

  it('每个协议的 labelKey 都有三语文案（UI 下拉直接消费，不得漏）', () => {
    for (const p of LLM_PROTOCOLS) {
      const entry = UI_TEXTS[p.labelKey]
      expect(entry, `${p.id} 的 labelKey「${p.labelKey}」不在 locale`).toBeTruthy()
      for (const loc of ['zh-CN', 'en-US', 'ru-RU'] as const) {
        expect(entry[loc], `${p.labelKey} 缺 ${loc}`).toBeTruthy()
      }
    }
  })
})
