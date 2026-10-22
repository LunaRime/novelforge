import { describe, it, expect, beforeEach } from 'vitest'
import {
  recordIpcCall, getIpcMetrics, clearIpcMetrics, redactSecrets, setIpcMetricsEnabled,
} from './ipc-metrics'

describe('ipc-metrics', () => {
  beforeEach(() => { clearIpcMetrics(); setIpcMetricsEnabled(true) })

  it('聚合调用次数/错误/耗时', () => {
    recordIpcCall('db:test', 10)
    recordIpcCall('db:test', 30, new Error('boom sk-abc123456789'))
    const m = getIpcMetrics().metrics.find(x => x.channel === 'db:test')!
    expect(m.calls).toBe(2)
    expect(m.errors).toBe(1)
    expect(m.totalMs).toBe(40)
    expect(m.lastError).toContain('sk-***')
  })

  it('recent 环上限 500', () => {
    for (let i = 0; i < 510; i++) recordIpcCall('x', 1)
    expect(getIpcMetrics().recent).toHaveLength(500)
    expect(getIpcMetrics().recent[499].channel).toBe('x')
  })

  it('关闭后不记录', () => {
    setIpcMetricsEnabled(false)
    recordIpcCall('x', 1)
    expect(getIpcMetrics().metrics).toHaveLength(0)
    expect(getIpcMetrics().recent).toHaveLength(0)
  })

  it('不记录 dev:ipc-* 自身，避免自增噪声', () => {
    recordIpcCall('dev:ipc-metrics', 5)
    recordIpcCall('dev:ipc-clear', 5)
    expect(getIpcMetrics().metrics).toHaveLength(0)
  })

  it('脱敏 Bearer / 字段式 token', () => {
    const text = redactSecrets('Authorization: Bearer abc.def.ghi apiKey=sk-1234567890 token: xyz')
    expect(text).not.toContain('abc.def.ghi')
    expect(text).not.toContain('sk-1234567890')
    expect(text).not.toContain('xyz')
  })

  it('脱敏 JSON 引号值 / Basic / access_token / URL key', () => {
    const cases = [
      '{"apiKey":"AIzaSyABC123"}',
      'Authorization: Basic dXNlcjpwYXNz',
      'access_token=secret123',
      'refresh_token: abc.def',
      'client_secret=topsecret',
      'https://example.com/v1?key=AIzaSyABC123&x=1',
    ]
    const text = redactSecrets(cases.join('\n'))
    for (const secret of ['AIzaSyABC123', 'dXNlcjpwYXNz', 'secret123', 'abc.def', 'topsecret']) {
      expect(text).not.toContain(secret)
    }
  })
})