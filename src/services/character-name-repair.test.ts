/**
 * computeNameRepairPlan — 存量角色名括号别名修复计划（#34 方案 5）
 * 改名（无冲突）/ 合并（有冲突）/ relations 引用替换 / 幂等零操作。
 */
import { describe, it, expect } from 'vitest'
import { computeNameRepairPlan } from './character-name-repair'

const base = (name: string, extra: Record<string, unknown> = {}) => ({
  name, role: 'supporting', gender: '', age: '', appearance: '', personality: '',
  background: '', abilities: '', motivation: '', relationships: '', arc: '', notes: '',
  tier: 2, tags: '', appearChapters: '[]', relations: '[]', ...extra,
})

describe('computeNameRepairPlan', () => {
  it('无括号名 → 零操作（幂等）', () => {
    const chars = [base('苏晚晴'), base('李雷')]
    const plan = computeNameRepairPlan(chars)
    expect(plan.upserts).toEqual([])
    expect(plan.deletes).toEqual([])
  })

  it('无冲突：带括号名改名（剥离别名）', () => {
    const chars = [base('无名老乞丐（前魂师）', { role: 'supporting' })]
    const plan = computeNameRepairPlan(chars)
    expect(plan.renamed).toBe(1)
    expect(plan.merged).toBe(0)
    expect(plan.deletes).toEqual([])
    expect(plan.upserts).toHaveLength(1)
    expect(plan.upserts[0].name).toBe('无名老乞丐')
  })

  it('有冲突：目标名已存在 → 合并（空白字段补齐 + 删除别名行）', () => {
    const chars = [
      base('无名老乞丐', { motivation: '找回前生记忆' }),
      base('无名老乞丐（前魂师）', { motivation: '', appearance: '破衣烂衫' }),
    ]
    const plan = computeNameRepairPlan(chars)
    expect(plan.merged).toBe(1)
    expect(plan.renamed).toBe(0)
    expect(plan.deletes).toEqual(['无名老乞丐（前魂师）'])
    // 目标行 upsert：motivation 保留已有值，appearance 用别名行补齐
    const target = plan.upserts.find(u => u.name === '无名老乞丐')
    expect(target?.motivation).toBe('找回前生记忆')
    expect(target?.appearance).toBe('破衣烂衫')
  })

  it('合并：relations 去重合并', () => {
    const chars = [
      base('无名老乞丐', { relations: JSON.stringify([{ target: '李雷', label: '同门' }]) }),
      base('无名老乞丐（前魂师）', { relations: JSON.stringify([{ target: '李雷', label: '同门' }, { target: '王五', label: '旧识' }]) }),
    ]
    const plan = computeNameRepairPlan(chars)
    const target = plan.upserts.find(u => u.name === '无名老乞丐')
    const rels = JSON.parse(String(target?.relations))
    expect(rels).toEqual([{ target: '李雷', label: '同门' }, { target: '王五', label: '旧识' }])
  })

  it('改名：其他角色 relations 引用旧名 → 新名', () => {
    const chars = [
      base('无名老乞丐（前魂师）'),
      base('李雷', { relations: JSON.stringify([{ target: '无名老乞丐（前魂师）', label: '兄弟' }]) }),
    ]
    const plan = computeNameRepairPlan(chars)
    const rel = plan.upserts.find(u => u.name === '李雷')
    expect(JSON.parse(String(rel?.relations))).toEqual([{ target: '无名老乞丐', label: '兄弟' }])
  })

  it('多个带括号名批量修复', () => {
    const chars = [
      base('甲（别名一）'),
      base('乙(别名二)'),
      base('正常角色'),
    ]
    const plan = computeNameRepairPlan(chars)
    expect(plan.renamed).toBe(2)
    const names = plan.upserts.map(u => u.name).sort()
    expect(names).toEqual(['乙', '甲'])
  })
})
