import { describe, it, expect } from 'vitest'
import { extractPreferencePair } from './preferences'

describe('extractPreferencePair', () => {
  it('提取中间替换对（神色一凝 → 皱了皱眉）', () => {
    const ai = '他神色一凝，望向窗外。'
    const user = '他皱了皱眉，望向窗外。'
    const r = extractPreferencePair(ai, user)
    expect(r).toEqual({ ai: '神色一凝', user: '皱了皱眉' })
  })

  it('前后缀匹配容忍长度变化（用户扩写）', () => {
    const ai = '她淡淡说道。'
    const user = '她轻声细语地说道。'
    const r = extractPreferencePair(ai, user)
    expect(r).not.toBeNull()
    expect(r!.ai).toContain('淡淡')
    expect(r!.user).toContain('轻声')
  })

  it('相同文本不记录', () => {
    expect(extractPreferencePair('相同文本', '相同文本')).toBeNull()
  })

  it('整段重写（差异超 12 字）不记录——结构性改动非词汇偏好', () => {
    const ai = '他转身离去，消失在夜色中。'
    const user = '风起，街灯明灭，他的身影被长街吞没。'
    expect(extractPreferencePair(ai, user)).toBeNull()
  })

  it('含标点的差异不记录（句子级改动）', () => {
    const ai = '他缓缓说道。'
    const user = '他缓缓说道，语气低沉。'
    expect(extractPreferencePair(ai, user)).toBeNull()
  })

  it('单字替换不记录（噪声）', () => {
    expect(extractPreferencePair('他看向她', '他看着她')).toBeNull()
  })
})
