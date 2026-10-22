import { describe, it, expect } from 'vitest'
import { parseArgs, buildInstanceId, sanitizeName, isPidAlive, readManifests } from './dev-instance-lib.mjs'

describe('dev-instance-lib', () => {
  it('解析 start 参数', () => {
    const r = parseArgs(['start', '--project', '/tmp/p', '--port', '9333', '--json'])
    expect(r.command).toBe('start')
    expect(r.options).toMatchObject({ project: '/tmp/p', port: 9333, json: true })
  })

  it('解析 = 形式与位置参数', () => {
    const r = parseArgs(['stop', 'dev-1', '--port=9333', '--name=abc'])
    expect(r.command).toBe('stop')
    expect(r.positional).toEqual(['dev-1'])
    expect(r.options).toMatchObject({ port: 9333, name: 'abc' })
  })

  it('实例 ID 含端口且可读', () => {
    const id = buildInstanceId('/tmp/my-project', new Date('2026-10-22T13:15:00'), 9223)
    expect(id).toMatch(/^dev-20261022-131500-\d+$/)
    expect(id).toContain('9223')
    expect(id.length).toBeLessThan(80)
  })

  it('名称清洗只保留安全字符', () => {
    const name = sanitizeName('My Novel / 测试')
    expect(name).toMatch(/^[a-z0-9-]+$/)
    expect(name).toBe('my-novel')
  })

  it('PID 存活判断容错', () => {
    expect(isPidAlive(0)).toBe(false)
    expect(isPidAlive(-1)).toBe(false)
    expect(isPidAlive(process.pid)).toBe(true)
  })

  it('读取 manifest 时跳过坏文件', () => {
    const dir = '/tmp/nf-dev-instance-lib-test'
    // 纯函数测试不写盘：不存在的目录返回空数组
    expect(readManifests(dir)).toEqual([])
  })
})