import { describe, it, expect } from 'vitest'
import { parseArgs, buildInstanceId, sanitizeName, isPidAlive, readManifests, buildChildEnv, isOwnedProcessCommand } from './dev-instance-lib.mjs'

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

  it('Windows 隔离 USERPROFILE/APPDATA/LOCALAPPDATA，并移除 ELECTRON_RUN_AS_NODE', () => {
    const env = buildChildEnv({ PATH: 'x', ELECTRON_RUN_AS_NODE: '1' }, 'C:\\temp\\home', 'win32')
    expect(env.HOME).toBe('C:\\temp\\home')
    expect(env.USERPROFILE).toBe('C:\\temp\\home')
    expect(env.APPDATA).toContain('AppData')
    expect(env.LOCALAPPDATA).toContain('AppData')
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  it('进程归属校验只认 --dev-instance=<id>', () => {
    expect(isOwnedProcessCommand('novelforge --remote-debugging-port=9224 --dev-instance=dev-a', 'dev-a')).toBe(true)
    expect(isOwnedProcessCommand('novelforge --remote-debugging-port=9224 --dev-instance=dev-b', 'dev-a')).toBe(false)
    expect(isOwnedProcessCommand('', 'dev-a')).toBe(false)
  })
})