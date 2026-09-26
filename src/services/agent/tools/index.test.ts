/**
 * builtinTools 注册顺序守卫（B 档第一轮：评审 I1）
 *
 * 工具提示词有 1200 token 截断（context-builder），而提示词按注册序拼接 ——
 * `skill` 元工具是模型自主加载技能的**唯一入口**，排太后会被截断砍掉契约
 * （模型只知道名字、不知道参数名），因此必须排在首位。
 */
import { describe, it, expect } from 'vitest'
import { builtinTools } from './index'

describe('builtinTools 顺序（评审 I1）', () => {
  it('skill 元工具排在首位（截断后其工具契约仍可见）', () => {
    expect(builtinTools[0]?.name).toBe('skill')
  })

  it('工具清单里没有残留的 skill__ 前缀（已收敛为元工具）', () => {
    expect(builtinTools.some(t => t.name.startsWith('skill__'))).toBe(false)
  })
})
