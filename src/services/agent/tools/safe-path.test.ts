/**
 * safe-path 数据目录保护测试（I-1 修复）——resolveSafeRelativePath / isProtectedRelativePath /
 * validatePath 的 relativePath 契约。node 环境（safe-path 仅依赖 locale，localStorage 有 try/catch 兜底）。
 */
import { describe, it, expect } from 'vitest'
import { isProtectedRelativePath, resolveSafeRelativePath, validatePath } from './safe-path'

describe('resolveSafeRelativePath（规范化相对路径，与落盘同解析链）', () => {
  it('反斜杠归一化 + 去除空段与 ./', () => {
    expect(resolveSafeRelativePath('a\\b/c.md')).toBe('a/b/c.md')
    expect(resolveSafeRelativePath('./chap1.md')).toBe('chap1.md')
    expect(resolveSafeRelativePath('.novelforge/vela.db')).toBe('.novelforge/vela.db')
  })

  it('解析 ..：x/../.novelforge/… 归一化为 .novelforge/…（I-1 绕过形态现形）', () => {
    expect(resolveSafeRelativePath('x/../.novelforge/prompts/main.json')).toBe('.novelforge/prompts/main.json')
    expect(resolveSafeRelativePath('a/b/../../chap.md')).toBe('chap.md')
  })

  it('越界（.. 溢出）→ null', () => {
    expect(resolveSafeRelativePath('../x.md')).toBeNull()
    expect(resolveSafeRelativePath('a/../../x.md')).toBeNull()
  })

  it('空/纯点 → 空相对路径', () => {
    expect(resolveSafeRelativePath('')).toBe('')
    expect(resolveSafeRelativePath('.')).toBe('')
  })
})

describe('isProtectedRelativePath（规范化相对路径首段判定）', () => {
  it('四类数据目录直形命中（目录本身与目录下文件）', () => {
    expect(isProtectedRelativePath('.novelforge/vela.db')).toBe(true)
    expect(isProtectedRelativePath('.novelforge')).toBe(true)
    expect(isProtectedRelativePath('.vela/x.md')).toBe(true)
    expect(isProtectedRelativePath('.git/config')).toBe(true)
    expect(isProtectedRelativePath('node_modules/pkg/a.js')).toBe(true)
  })

  it('归一化后命中：./ 与 x/../ 混淆形态（I-1 回归）', () => {
    expect(isProtectedRelativePath(resolveSafeRelativePath('./.novelforge/vela.db')!)).toBe(true)
    expect(isProtectedRelativePath(resolveSafeRelativePath('x/../.novelforge/prompts/main.json')!)).toBe(true)
    expect(isProtectedRelativePath(resolveSafeRelativePath('x\\..\\.git\\config')!)).toBe(true)
  })

  it('正常文件/子目录不误报；相似名前缀不误伤', () => {
    expect(isProtectedRelativePath('chap1.md')).toBe(false)
    expect(isProtectedRelativePath('稿子/第一章.md')).toBe(false)
    expect(isProtectedRelativePath('.novelforge-backup/x.md')).toBe(false) // 首段精确匹配，非前缀
    expect(isProtectedRelativePath('')).toBe(false)
  })
})

describe('validatePath 相对路径契约（保护判定与落盘同源）', () => {
  it('valid 分支暴露规范化 relativePath（x/../ 归一化后与 fullPath 同链）', () => {
    const r = validatePath('/tmp/p', 'x/../.novelforge/prompts/main.json')
    expect(r.valid).toBe(true)
    if (r.valid) {
      expect(r.relativePath).toBe('.novelforge/prompts/main.json')
      expect(r.fullPath).toBe('/tmp/p/.novelforge/prompts/main.json')
      expect(isProtectedRelativePath(r.relativePath)).toBe(true)
    }
  })

  it('正常文件 relativePath 原样', () => {
    const r = validatePath('/tmp/p', './稿子/第一章.md')
    expect(r.valid).toBe(true)
    if (r.valid) {
      expect(r.relativePath).toBe('稿子/第一章.md')
      expect(isProtectedRelativePath(r.relativePath)).toBe(false)
    }
  })

  it('越界仍 invalid（行为兼容）', () => {
    expect(validatePath('/tmp/p', '../evil.md').valid).toBe(false)
    expect(validatePath('/tmp/p', '').valid).toBe(false)
  })
})
