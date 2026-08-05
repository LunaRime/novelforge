import { describe, it, expect } from 'vitest'
import { isValidHttpUrl, isValidRelativePath, buildDevApiUrl, truncateResponse } from './dev-api-utils'

describe('isValidHttpUrl', () => {
  it('http/https 合法', () => {
    expect(isValidHttpUrl('http://localhost:9223')).toBe(true)
    expect(isValidHttpUrl('https://api.example.com')).toBe(true)
  })

  it('危险协议拒绝（file/ftp/javascript/data）', () => {
    expect(isValidHttpUrl('file:///etc/passwd')).toBe(false)
    expect(isValidHttpUrl('ftp://example.com')).toBe(false)
    expect(isValidHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isValidHttpUrl('data:text/html,<b>hi</b>')).toBe(false)
    expect(isValidHttpUrl('不是 URL')).toBe(false)
  })
})

describe('isValidRelativePath', () => {
  it('相对路径合法', () => {
    expect(isValidRelativePath('')).toBe(true)
    expect(isValidRelativePath('/search?q=关键词')).toBe(true)
    expect(isValidRelativePath('api/v1/query')).toBe(true)
  })

  it('绝对 URL / 协议相对 / 协议注入拒绝（防绕过 base URL 限制）', () => {
    expect(isValidRelativePath('http://evil.com/x')).toBe(false)
    expect(isValidRelativePath('https://evil.com/x')).toBe(false)
    expect(isValidRelativePath('//evil.com/x')).toBe(false)
    expect(isValidRelativePath('javascript:alert(1)')).toBe(false)
    expect(isValidRelativePath('data:text/html,x')).toBe(false)
  })
})

describe('buildDevApiUrl', () => {
  it('拼接相对路径（自动补斜杠/去尾斜杠）', () => {
    expect(buildDevApiUrl('http://localhost:9223', 'search?q=1')).toBe('http://localhost:9223/search?q=1')
    expect(buildDevApiUrl('http://localhost:9223/', '/api/v1')).toBe('http://localhost:9223/api/v1')
  })

  it('base 非法 → null', () => {
    expect(buildDevApiUrl('ftp://x', '/a')).toBeNull()
  })
})

describe('truncateResponse', () => {
  it('超限截断并提示', () => {
    const buf = Buffer.from('A'.repeat(100))
    const r = truncateResponse(buf, 50)
    expect(r.truncated).toBe(true)
    expect(r.content).toContain('[响应已截断')
    expect(r.content.length).toBeLessThan(100)
  })

  it('未超限原样返回', () => {
    const buf = Buffer.from('hello')
    const r = truncateResponse(buf, 100)
    expect(r.truncated).toBe(false)
    expect(r.content).toBe('hello')
  })
})
