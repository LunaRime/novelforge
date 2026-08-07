import { describe, it, expect } from 'vitest'
import { buildRoleplaySystemPrompt } from './roleplay-prompt'
import type { CharacterData } from '../../electron/repositories/character-repository'

function char(patch: Partial<CharacterData> = {}): CharacterData {
  return {
    name: '苏晚',
    role: 'protagonist',
    gender: '女',
    age: '18',
    appearance: '清冷白衣',
    personality: '外冷内热，行事果决',
    background: '天玄门弃徒',
    abilities: '',
    motivation: '查明灭门真相',
    relationships: '',
    arc: '',
    notes: '',
    tier: 1,
    tags: '["清冷"]',
    appearChapters: '[1]',
    relations: '[]',
    ...patch,
  }
}

/**
 * 角色试演 system prompt — 以角色卡驱动 LLM 扮演（性格/背景/动机/当前状态/OOC 约束）
 */
describe('buildRoleplaySystemPrompt', () => {
  it('包含角色名/性格/背景/动机', () => {
    const p = buildRoleplaySystemPrompt(char())
    expect(p).toContain('苏晚')
    expect(p).toContain('外冷内热')
    expect(p).toContain('天玄门弃徒')
    expect(p).toContain('查明灭门真相')
  })

  it('currentState 存在时注入当前状态（位置/最近经历）', () => {
    const p = buildRoleplaySystemPrompt(char({
      currentState: { location: '雪夜谷', powerLevel: '练气五层', physicalState: '', mentalState: '', keyItems: '', recentEvents: '击败了追兵', updatedAtChapter: 3 },
    }))
    expect(p).toContain('雪夜谷')
    expect(p).toContain('击败了追兵')
  })

  it('currentState 缺失时降级（不崩、不含状态段）', () => {
    const p = buildRoleplaySystemPrompt(char({ currentState: undefined }))
    expect(p).not.toContain('【当前所在】')
    expect(p).toContain('苏晚')
  })

  it('包含 OOC 约束（不跳出角色、不承认 AI、回避创作者视角）', () => {
    const p = buildRoleplaySystemPrompt(char())
    expect(p).toContain('完全代入角色')
    expect(p).toContain('不承认自己是 AI')
    expect(p).toContain('创作者视角')
  })

  it('空字段角色不产生空段落', () => {
    const p = buildRoleplaySystemPrompt(char({ personality: '', background: '', motivation: '' }))
    expect(p).not.toContain('【性格】')
    expect(p).not.toContain('【背景】')
    expect(p).toContain('苏晚')
  })
})
