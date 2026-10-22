import { describe, it, expect } from 'vitest'
import { validateStartInput, parseInstanceList, isValidInstanceId } from './instance-utils'

describe('instance-utils', () => {
  it('接受合法端口/项目/名称', () => {
    expect(validateStartInput({ port: 9222, project: '/tmp/p', name: 'a' })).toEqual({
      ok: true, value: { port: 9222, project: '/tmp/p', name: 'a' },
    })
  })

  it('拒绝特权端口与越界/非数字端口', () => {
    expect(validateStartInput({ port: 80 }).ok).toBe(false)
    expect(validateStartInput({ port: 70000 }).ok).toBe(false)
    expect(validateStartInput({ port: '9222' as never }).ok).toBe(false)
  })

  it('拒绝非字符串项目/名称', () => {
    expect(validateStartInput({ project: 123 as never }).ok).toBe(false)
    expect(validateStartInput({ name: 5 as never }).ok).toBe(false)
  })

  it('空输入合法（默认项目/端口）', () => {
    expect(validateStartInput(undefined)).toEqual({ ok: true, value: {} })
  })

  it('解析实例列表 JSON（坏数据返回空数组）', () => {
    const list = parseInstanceList(JSON.stringify([{
      id: 'dev-20261022-131500-9223', pid: 1, port: 9223, project: '/tmp/p',
      home: '/tmp/h', log: '/tmp/l', startedAt: 123, status: 'running', alive: true,
    }]))
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'dev-20261022-131500-9223', port: 9223, alive: true })
    expect(parseInstanceList('not json')).toEqual([])
    expect(parseInstanceList('{"id":1}')).toEqual([])
  })

  it('实例 ID 只接受 CLI 生成的格式', () => {
    expect(isValidInstanceId('dev-20261022-131500-9223')).toBe(true)
    expect(isValidInstanceId('../evil')).toBe(false)
    expect(isValidInstanceId('dev-x')).toBe(false)
  })
})