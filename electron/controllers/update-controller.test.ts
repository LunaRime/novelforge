/**
 * update-controller 版本比较测试（2026-10-14）
 *
 * compareSemver 是「是否有更新」的判定核心，钉死 SemVer + prerelease 比较规则。
 * ⚠️ CI 无 electron 二进制（AGENTS.md），import electron 的模块必须 vi.mock('electron')。
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getVersion: () => '0.1.7-beta.2', getName: () => 'NovelForge', getPath: () => '' },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showMessageBox: async () => ({ response: 0 }) },
  shell: { openExternal: () => {} },
}))

import { compareSemver, parseSemver } from './update-controller'

describe('compareSemver', () => {
  it('正式版大于其 prerelease', () => {
    expect(compareSemver('0.1.7', '0.1.7-beta.2')).toBeGreaterThan(0)
    expect(compareSemver('0.1.7-beta.2', '0.1.7')).toBeLessThan(0)
  })

  it('同 base 下 beta.N 递增', () => {
    expect(compareSemver('0.1.7-beta.3', '0.1.7-beta.2')).toBeGreaterThan(0)
    expect(compareSemver('0.1.7-beta.10', '0.1.7-beta.9')).toBeGreaterThan(0)
  })

  it('patch/minor 递增', () => {
    expect(compareSemver('0.1.8', '0.1.7')).toBeGreaterThan(0)
    expect(compareSemver('0.2.0', '0.1.9')).toBeGreaterThan(0)
  })

  it('相等返回 0', () => {
    expect(compareSemver('0.1.7-beta.2', '0.1.7-beta.2')).toBe(0)
    expect(compareSemver('0.1.7', '0.1.7')).toBe(0)
  })

  it('高 base 的 beta 大于低 base 的正式版', () => {
    expect(compareSemver('0.1.8-beta.1', '0.1.7')).toBeGreaterThan(0)
  })
})

describe('parseSemver', () => {
  it('解析带 prerelease 的版本', () => {
    expect(parseSemver('0.1.7-beta.2')).toEqual({ main: [0, 1, 7], pre: ['beta', 2] })
  })

  it('解析正式版（无 prerelease）', () => {
    expect(parseSemver('0.1.7')).toEqual({ main: [0, 1, 7], pre: [] })
  })

  it('畸形版本返回 null', () => {
    expect(parseSemver('v0.1.7')).toBeNull()
    expect(parseSemver('abc')).toBeNull()
  })
})
