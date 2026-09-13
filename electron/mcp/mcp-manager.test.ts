/**
 * MCP connectById 安全加固测试（L4 S10）
 *
 * 背景：`mcp:connect` 原先接受渲染层传来的**完整配置**，直通
 * `spawn(command, args, { env: { ...process.env, ...env } })` —— 渲染层（或一次主帧 XSS）
 * 传 `{ command: 'cmd.exe', args: ['/c', '…'] }` 即可**任意代码执行**，绕过整个 fs 白名单。
 *
 * 现在只接受 id，command/args/env 一律取主进程自己从配置文件读到的值。
 * 本测试全部走 mock，**不会真的 spawn 任何进程**。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mcpManager, type MCPServerConfig } from './mcp-manager'

/** 假装配置文件里已登记的服务（注意 command 是文件里的值，不是调用方给的） */
const FILE_CONFIG: MCPServerConfig = {
  id: 'fs-server',
  name: 'fs-server',
  transport: 'stdio',
  command: 'node',
  args: ['server.js'],
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('connectById（L4 S10：渲染层不能指定要 spawn 的命令）', () => {
  it('空 / 纯空白 id → 拒绝，且不进入 connect（不 spawn）', async () => {
    const connectSpy = vi.spyOn(mcpManager, 'connect')
    await expect(mcpManager.connectById('')).rejects.toThrow()
    await expect(mcpManager.connectById('   ')).rejects.toThrow()
    // @ts-expect-error 运行时防御：非字符串（JS 调用方 / 绕过类型）也必须拒绝
    await expect(mcpManager.connectById(undefined)).rejects.toThrow()
    expect(connectSpy).not.toHaveBeenCalled()
  })

  it('未登记的 id（攻击者自造）→ 拒绝，且绝不调用 connect', async () => {
    vi.spyOn(mcpManager, 'loadConfig').mockResolvedValue([FILE_CONFIG])
    const connectSpy = vi.spyOn(mcpManager, 'connect').mockResolvedValue()

    await expect(mcpManager.connectById('attacker-server')).rejects.toThrow(/未登记/)
    expect(connectSpy).not.toHaveBeenCalled()
  })

  it('已登记 id → 用**配置文件里**的 command/args 调用 connect（调用方无从插手）', async () => {
    vi.spyOn(mcpManager, 'loadConfig').mockResolvedValue([FILE_CONFIG])
    const connectSpy = vi.spyOn(mcpManager, 'connect').mockResolvedValue()

    await mcpManager.connectById('fs-server')

    expect(connectSpy).toHaveBeenCalledTimes(1)
    // 关键断言：传给 connect 的整份配置来自文件，而不是任何调用方入参
    expect(connectSpy.mock.calls[0][0]).toEqual(FILE_CONFIG)
    expect(connectSpy.mock.calls[0][0].command).toBe('node')
  })
})
