/**
 * prefix-baseline — 跨轮前缀基线的契约（P0-1 修复）：
 * 首轮/刚切会话**无基线**（观测不渲染前缀行）；有基线时变化可见；重置后回到无基线。
 * 抽出该模块的原因：基线此前是 agent-store 的两个裸变量（只有写没有重置），
 * 切会话后首轮会拿**上一个会话**的 system 段作比较 —— 面板与日志都说谎且无法单测。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  getLastPrefixText, getLastCachedTokens, updatePrefixBaseline, resetPrefixBaseline, peekPrefixChange,
} from './prefix-baseline'

describe('prefix-baseline', () => {
  beforeEach(() => { resetPrefixBaseline() })

  it('无基线（首轮 / 刚切会话）→ undefined，调用方据此不渲染前缀行', () => {
    expect(getLastPrefixText()).toBe('')
    expect(getLastCachedTokens()).toBe(0)
    expect(peekPrefixChange('任何 system 段')).toBeUndefined()
  })

  it('有基线：同文本 → changed=false；尾部追加 → changed=true 且共享字符数正确', () => {
    updatePrefixBaseline('身份提示词', 120)
    expect(peekPrefixChange('身份提示词')).toEqual({ changed: false, sharedChars: 0 })
    const grown = peekPrefixChange('身份提示词\n\n[摘要] 新内容')
    expect(grown?.changed).toBe(true)
    expect(grown?.sharedChars).toBe('身份提示词'.length)
    expect(getLastCachedTokens()).toBe(120)
  })

  it('peek 是只读的：不推进基线（基线只在请求真的发出后由 updatePrefixBaseline 推进）', () => {
    updatePrefixBaseline('A', 1)
    peekPrefixChange('B')
    expect(getLastPrefixText()).toBe('A')
    updatePrefixBaseline('B', 0)
    expect(getLastPrefixText()).toBe('B')
  })

  it('重置 → 回到无基线（新会话不与上一会话比较），缓存命中数一并清零', () => {
    updatePrefixBaseline('上一会话的 system', 500)
    expect(peekPrefixChange('新会话的 system')?.changed).toBe(true)
    resetPrefixBaseline()
    expect(peekPrefixChange('新会话的 system')).toBeUndefined()
    expect(getLastCachedTokens()).toBe(0)
  })
})
