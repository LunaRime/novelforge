/**
 * memory-controller — 记忆文件安全守卫与 kind 白名单分类测试（F7/F9）
 *
 * F7：safeFile 拒绝 ''/'.'/'..'/非 .md 后缀（防目录名、脚本文件、空名误写）；
 * 路径穿越输入归一化到 basename（不落地外部路径）。
 * F9：memory:list 的 kind 白名单——仅 book-state.md 归 book，
 * 用户手放的 notes.md 等未知前缀文件归 unknown（不参与 M2 节选注入）。
 */
import { describe, it, expect, vi } from 'vitest'

// 避免加载原生模块/Electron 绑定（测试仅覆盖纯函数）
vi.mock('better-sqlite3', () => ({ default: vi.fn() }))

import { assertSafeMemoryFileName, classifyMemoryFileKind } from './memory-controller'

describe('assertSafeMemoryFileName（F7 安全守卫）', () => {
  it('拒绝空名/./..', () => {
    expect(() => assertSafeMemoryFileName('')).toThrow()
    expect(() => assertSafeMemoryFileName('.')).toThrow()
    expect(() => assertSafeMemoryFileName('..')).toThrow()
  })

  it('拒绝非 .md 后缀', () => {
    expect(() => assertSafeMemoryFileName('notes.txt')).toThrow()
    expect(() => assertSafeMemoryFileName('notes')).toThrow()
    expect(() => assertSafeMemoryFileName('chapters-001-015')).toThrow()
  })

  it('接受合法 .md 名', () => {
    expect(assertSafeMemoryFileName('chapters-001-015.md')).toBe('chapters-001-015.md')
    expect(assertSafeMemoryFileName('book-state.md')).toBe('book-state.md')
    expect(assertSafeMemoryFileName('volume-001.md')).toBe('volume-001.md')
  })

  it('路径穿越输入归一化到 basename（不落地外部路径）', () => {
    expect(assertSafeMemoryFileName('..\\..\\evil.md')).toBe('evil.md')
    expect(assertSafeMemoryFileName('/etc/passwd.md')).toBe('passwd.md')
  })
})

describe('classifyMemoryFileKind（F9 白名单分类）', () => {
  it('book-state.md → book；chapters-/volume- 前缀 → 对应类', () => {
    expect(classifyMemoryFileKind('book-state.md')).toBe('book')
    expect(classifyMemoryFileKind('chapters-001-015.md')).toBe('chapters')
    expect(classifyMemoryFileKind('volume-001.md')).toBe('volume')
  })

  it('未知前缀 .md（用户手放文件）→ unknown，不归 book', () => {
    expect(classifyMemoryFileKind('notes.md')).toBe('unknown')
    expect(classifyMemoryFileKind('archive.md')).toBe('unknown')
    expect(classifyMemoryFileKind('book.md')).toBe('unknown') // 仅 book-state.md 归 book
    expect(classifyMemoryFileKind('my-notes.md')).toBe('unknown')
  })
})
