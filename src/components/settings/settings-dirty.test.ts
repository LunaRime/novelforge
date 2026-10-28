import { describe, expect, it, beforeEach } from 'vitest'
import { hasUnsavedSettings, markSettingsDirty, resetSettingsDirtyForTest } from './settings-dirty'

describe('settings-dirty — 关闭设置页前的脏数据判定', () => {
  beforeEach(() => { resetSettingsDirtyForTest() })

  it('无分区登记时视为干净', () => {
    expect(hasUnsavedSettings()).toBe(false)
  })

  it('任一分区登记脏即为脏，撤销登记后恢复干净', () => {
    markSettingsDirty('proxy', true)
    expect(hasUnsavedSettings()).toBe(true)
    markSettingsDirty('proxy', false)
    expect(hasUnsavedSettings()).toBe(false)
  })

  it('多分区互不影响：一个干净一个脏仍算脏', () => {
    markSettingsDirty('proxy', true)
    markSettingsDirty('mcp', false)
    expect(hasUnsavedSettings()).toBe(true)

    markSettingsDirty('mcp', true)
    markSettingsDirty('proxy', false)
    expect(hasUnsavedSettings()).toBe(true)

    markSettingsDirty('mcp', false)
    expect(hasUnsavedSettings()).toBe(false)
  })
})
