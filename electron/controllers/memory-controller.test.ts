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

// CI 装依赖时设 ELECTRON_SKIP_BINARY_DOWNLOAD=1，node_modules/electron 无 path.txt →
// 真实 electron 模块 import 即抛「Electron failed to install correctly」。
// 本文件只测纯函数，故按需打桩 ipcMain（模块顶层有 ipcMain.handle 注册）。
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}))

import { assertSafeMemoryFileName, classifyMemoryFileKind, buildMemoryFileMeta } from './memory-controller'

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

  it('shared.md → shared（P3：cross-session 可复用事实参与 M2 注入）', () => {
    expect(classifyMemoryFileKind('shared.md')).toBe('shared')
    // frontmatter type: shared 兜底识别（手编文件名非 shared.md 也可参与）
    expect(classifyMemoryFileKind('facts.md', '---\ntype: shared\n---\n\n- 事实A')).toBe('shared')
    // 无 type: shared 不误判
    expect(classifyMemoryFileKind('facts.md', '# 普通笔记')).toBe('unknown')
  })
})

describe('buildMemoryFileMeta（C 档第一轮：列表回传分层与 brief）', () => {
  it('声明 resident → loadMode=resident；缺省 → auto', () => {
    expect(buildMemoryFileMeta('book-state.md', '---\nload_mode: resident\n---\n# 全书精要\n主角是苏晚晴', 1).loadMode).toBe('resident')
    expect(buildMemoryFileMeta('book-state.md', '# 全书精要\n主角是苏晚晴', 1).loadMode).toBe('auto')
  })

  it('非法值回落 auto（坏 frontmatter 不放大成「每轮全文注入」）', () => {
    expect(buildMemoryFileMeta('shared.md', '---\nload_mode: always\n---\n- 事实', 1).loadMode).toBe('auto')
  })

  it('brief 与 kind 一并回传（列表读盘本来就为了分类，零额外 IO）', () => {
    const meta = buildMemoryFileMeta('shared.md', '---\ntype: shared\n---\n\n# 跨会话可复用事实\n- 用户偏好爽文节奏', 3)
    expect(meta).toMatchObject({ file: 'shared.md', kind: 'shared', loadMode: 'auto', brief: '用户偏好爽文节奏', stale: false, mtime: 3 })
  })

  it('chapters 文件带 range、stale 标记沿用既有口径', () => {
    const meta = buildMemoryFileMeta('chapters-001-015.md', '---\nstatus: stale\n---\n\n# 章节记忆 001-015\n\n## 第 1 章 · 开局\n- 关键事件：主角觉醒', 7)
    expect(meta).toMatchObject({ kind: 'chapters', range: '001-015', stale: true, brief: '关键事件：主角觉醒' })
  })
})
