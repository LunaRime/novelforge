import { describe, it, expect } from 'vitest'
import { safeErrorMessage } from './error-utils'

describe('safeErrorMessage', () => {
  it('returns message from Error object', () => {
    expect(safeErrorMessage(new Error('something broke'))).toBe('something broke')
  })

  it('returns string as-is', () => {
    expect(safeErrorMessage('plain string error')).toBe('plain string error')
  })

  it('JSON-stringifies plain objects', () => {
    expect(safeErrorMessage({ code: 500, reason: 'timeout' }))
      .toBe('{"code":500,"reason":"timeout"}')
  })

  it('falls back to String() for non-serializable values', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const result = safeErrorMessage(circular)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('handles null/undefined gracefully', () => {
    expect(safeErrorMessage(null)).toBe('null')
    expect(safeErrorMessage(undefined)).toBe('undefined')
  })

  it('handles number errors', () => {
    expect(safeErrorMessage(404)).toBe('404')
  })
})
