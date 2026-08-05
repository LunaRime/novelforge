import { describe, it, expect, afterEach } from 'vitest'
import { detectLogEnvironment, formatMessage, shouldUseColors, LogEnvironment, LogLevel } from './logger'

describe('detectLogEnvironment', () => {
  it('dev mode (VITE_DEV_SERVER_URL) → Dev 环境', () => {
    expect(detectLogEnvironment(true, '0.1.5')).toBe(LogEnvironment.Dev)
  })

  it('内测版编号式 prerelease（-alpha.N）→ Dev 环境', () => {
    expect(detectLogEnvironment(false, '0.1.5-alpha.1')).toBe(LogEnvironment.Dev)
    expect(detectLogEnvironment(false, '0.1.5-alpha.12')).toBe(LogEnvironment.Dev)
  })

  it('历史日期式内测版（-YYYYMMDD）→ Dev 环境', () => {
    expect(detectLogEnvironment(false, '0.1.4-20260804')).toBe(LogEnvironment.Dev)
  })

  it('公测版（-beta.N）→ Release 环境', () => {
    expect(detectLogEnvironment(false, '0.1.5-beta.1')).toBe(LogEnvironment.Release)
  })

  it('正式版（0.x.y）→ Release 环境', () => {
    expect(detectLogEnvironment(false, '0.1.5')).toBe(LogEnvironment.Release)
    expect(detectLogEnvironment(false, '1.0.0')).toBe(LogEnvironment.Release)
  })
})

describe('formatMessage', () => {
  it('包含 ISO 时间戳、补齐 5 位的等级标签、来源与消息', () => {
    const line = formatMessage(LogLevel.INFO, 'Main', '启动完成')
    expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO \] \[Main\] 启动完成$/)
  })

  it('不同等级标签长度一致（文件对齐）', () => {
    expect(formatMessage(LogLevel.DEBUG, 'S', 'x')).toContain('[DEBUG]')
    expect(formatMessage(LogLevel.WARN, 'S', 'x')).toContain('[WARN ]')
    expect(formatMessage(LogLevel.ERROR, 'S', 'x')).toContain('[ERROR]')
  })
})

describe('shouldUseColors', () => {
  afterEach(() => {
    delete process.env.NO_COLOR
    delete process.env.TERM
  })

  it('NO_COLOR 环境变量存在 → 禁用颜色（防 CI/管道垃圾）', () => {
    process.env.NO_COLOR = '1'
    expect(shouldUseColors()).toBe(false)
  })

  it('TERM=dumb → 禁用颜色', () => {
    process.env.TERM = 'dumb'
    expect(shouldUseColors()).toBe(false)
  })

  it('测试环境（非 TTY）→ 禁用颜色（纯文本输出）', () => {
    // vitest 的 stdout/stderr 非 TTY
    expect(shouldUseColors()).toBe(false)
  })
})
