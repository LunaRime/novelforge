/**
 * mergeCardRows — LLM 提取/导入角色卡仅填空合并（#34 块 A）
 * 已存在角色：LLM 非空字段覆盖、空白/缺失保留 DB 现值；新角色 INSERT 补默认值。
 */
import { describe, it, expect } from 'vitest'
import { mergeCardRows } from './character-card-merge'

const existingRow = (name: string, extra: Record<string, unknown> = {}) => ({
  name, role: 'supporting', gender: '', age: '', appearance: '', personality: '',
  background: '旧背景', abilities: '', motivation: '旧动机', relationships: '', arc: '',
  notes: '', tier: 2, tags: '["旧标签"]', appearChapters: '[1]', relations: '[{"target":"李雷"}]',
  currentState: { location: '旧位置', updatedAtChapter: 3 },
  ...extra,
})

describe('mergeCardRows 已存在角色', () => {
  it('LLM 非空字段覆盖，空白/缺失字段保留 DB 现值', () => {
    const existing = [existingRow('苏晚晴')]
    const cards = [{ name: '苏晚晴', role: 'protagonist', appearance: '新外貌' }]
    const { rows, stats } = mergeCardRows(existing, cards)
    expect(stats.merged).toBe(1)
    expect(stats.created).toBe(0)
    const row = rows[0]
    expect(row.name).toBe('苏晚晴')
    expect(row.appearance).toBe('新外貌')      // LLM 非空 → 覆盖
    expect(row.background).toBe('旧背景')      // LLM 缺失 → 保留
    expect(row.motivation).toBe('旧动机')      // 保留
    expect(row.tags).toBe('["旧标签"]')        // 保留
    expect(row.relations).toBe('[{"target":"李雷"}]') // 保留
    expect(row.currentState).toEqual({ location: '旧位置', updatedAtChapter: 3 }) // 保留
  })

  it('role 仅 LLM 非空时覆盖（normalize 兜底不降级已有 role）', () => {
    const existing = [existingRow('苏晚晴', { role: 'antagonist' })]
    const cards = [{ name: '苏晚晴' }] // LLM 没给 role
    const { rows } = mergeCardRows(existing, cards)
    expect(rows[0].role).toBe('antagonist')
  })

  it('tags 哨兵不覆盖（空/[]）', () => {
    const existing = [existingRow('苏晚晴')]
    const cards = [{ name: '苏晚晴', tags: '[]' }]
    const { rows } = mergeCardRows(existing, cards)
    expect(rows[0].tags).toBe('["旧标签"]')
  })

  it('括号别名匹配已存在角色（存量旧数据）', () => {
    const existing = [existingRow('无名老乞丐（前魂师）')]
    const cards = [{ name: '无名老乞丐', appearance: '新外貌' }]
    const { rows, stats } = mergeCardRows(existing, cards)
    expect(stats.merged).toBe(1)
    expect(rows[0].name).toBe('无名老乞丐（前魂师）') // 用 DB 规范名
    expect(rows[0].appearance).toBe('新外貌')
  })
})

describe('mergeCardRows 新角色', () => {
  it('新角色 INSERT 并补默认值（role 归一化 + tier 推导）', () => {
    const { rows, stats } = mergeCardRows([], [{ name: '王五', role: 'Protagonist', personality: '果断' }])
    expect(stats.created).toBe(1)
    const row = rows[0]
    expect(row.name).toBe('王五')
    expect(row.role).toBe('protagonist')
    expect(row.tier).toBe(1)
    expect(row.relations).toBe('[]')
    expect(row.appearChapters).toBe('[]')
    expect(row.personality).toBe('果断')
  })

  it('剥离括号别名后落库', () => {
    const { rows } = mergeCardRows([], [{ name: '新角色（试炼者）' }])
    expect(rows[0].name).toBe('新角色')
  })
})
