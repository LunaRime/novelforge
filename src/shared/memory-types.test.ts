import { describe, it, expect } from 'vitest'
import { MEMORY_LOAD_MODES, normalizeLoadMode } from './memory-types'

describe('normalizeLoadMode（C 档第一轮：三值分层）', () => {
  it('三值原样通过', () => {
    expect(normalizeLoadMode('resident')).toBe('resident')
    expect(normalizeLoadMode('auto')).toBe('auto')
    expect(normalizeLoadMode('manual')).toBe('manual')
  })

  it('缺省/空/非法一律回落 auto（fail-safe，不抛）', () => {
    expect(normalizeLoadMode(undefined)).toBe('auto')
    expect(normalizeLoadMode(null)).toBe('auto')
    expect(normalizeLoadMode('')).toBe('auto')
    expect(normalizeLoadMode('always')).toBe('auto')
    expect(normalizeLoadMode('RESIDENT')).toBe('resident') // 大小写与空白宽容
    expect(normalizeLoadMode(' manual ')).toBe('manual')
  })

  it('三值集合固定（UI 选择器与解析共用同一枚举）', () => {
    expect([...MEMORY_LOAD_MODES]).toEqual(['resident', 'auto', 'manual'])
  })
})
