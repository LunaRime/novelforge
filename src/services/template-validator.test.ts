import { describe, it, expect } from 'vitest'
import { validateCharacterTemplate } from './template-validator'

/**
 * 角色卡模板校验 — ~/.vela/templates/ 模板文件格式：
 * { "schema": "character", "name": "模板名", "description": "...", "data": { 角色卡字段 } }
 */
describe('validateCharacterTemplate', () => {
  it('合法 character 模板通过（提取元信息）', () => {
    const r = validateCharacterTemplate({
      schema: 'character',
      name: '清冷剑仙',
      description: '外冷内热的剑修角色',
      data: { name: '苏晚', gender: '女', personality: '清冷', background: '天玄门' },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.name).toBe('清冷剑仙')
      expect(r.description).toBe('外冷内热的剑修角色')
      expect(r.data.name).toBe('苏晚')
    }
  })

  it('缺 schema / 非法 schema 拒绝', () => {
    expect(validateCharacterTemplate({ name: 'x', data: {} }).ok).toBe(false)
    expect(validateCharacterTemplate({ schema: 'unknown', name: 'x', data: {} }).ok).toBe(false)
  })

  it('data 非对象或缺失拒绝', () => {
    expect(validateCharacterTemplate({ schema: 'character', name: 'x', data: 'not-object' }).ok).toBe(false)
    expect(validateCharacterTemplate({ schema: 'character', name: 'x' }).ok).toBe(false)
  })

  it('模板名缺失/空拒绝', () => {
    expect(validateCharacterTemplate({ schema: 'character', name: '', data: {} }).ok).toBe(false)
    expect(validateCharacterTemplate({ schema: 'character', data: {} }).ok).toBe(false)
  })
})
