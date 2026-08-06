/**
 * MCP IPC 桥接
 *
 * 在 Electron 主进程注册 MCP 相关的 IPC 处理器，
 * 让渲染进程能够通过 IPC 管理和调用 MCP 服务器。
 */

import { ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { mcpManager } from './mcp-manager'
import { logger } from '../utils/logger'
import { t } from '../../src/shared/locale'
import { safeErrorMessage } from '../utils/error-utils'

/** MCP 配置文件路径（与 mcpManager.getDefaultConfigPath 一致） */
function mcpConfigPath(): string {
  return path.join(app.getPath('home'), '.vela', 'mcp_config.json')
}

/** 读写 MCP 配置（Claude Desktop 兼容格式 { mcpServers: { id: { command, args, env } } }） */
async function readMcpConfig(): Promise<Record<string, { command: string; args?: string[]; env?: Record<string, string> }>> {
  try {
    const raw = await fs.readFile(mcpConfigPath(), 'utf-8')
    const cfg = JSON.parse(raw)
    return cfg.mcpServers ?? {}
  } catch {
    return {}
  }
}

async function writeMcpConfig(
  servers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>,
): Promise<void> {
  await fs.mkdir(path.dirname(mcpConfigPath()), { recursive: true })
  await fs.writeFile(mcpConfigPath(), JSON.stringify({ mcpServers: servers }, null, 2), 'utf-8')
}

/**
 * 注册所有 MCP IPC 处理器
 * 在 main.ts 中调用
 */
export function registerMCPHandlers(): void {
  // 加载配置文件
  ipcMain.handle('mcp:load-config', async (_event, configPath?: string) => {
    try {
      const configs = await mcpManager.loadConfig(configPath)
      return { success: true, configs }
    } catch (error) {
      return { success: false, configs: [], error: safeErrorMessage(error) }
    }
  })

  // 连接服务器
  ipcMain.handle('mcp:connect', async (_event, config) => {
    try {
      await mcpManager.connect(config)
      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  // 断开服务器
  ipcMain.handle('mcp:disconnect', async (_event, serverId: string) => {
    try {
      await mcpManager.disconnect(serverId)
      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  // 断开所有
  ipcMain.handle('mcp:disconnect-all', async () => {
    try {
      await mcpManager.disconnectAll()
      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  // 获取所有可用 Tool
  ipcMain.handle('mcp:list-tools', async () => {
    return mcpManager.getAllTools()
  })

  // 获取所有可用资源
  ipcMain.handle('mcp:list-resources', async () => {
    return mcpManager.getAllResources()
  })

  // 调用 MCP Tool
  ipcMain.handle('mcp:call-tool', async (_event, serverId: string, toolName: string, args: Record<string, unknown>) => {
    return await mcpManager.callTool(serverId, toolName, args)
  })

  // 获取服务器状态
  ipcMain.handle('mcp:get-servers-status', async () => {
    return mcpManager.getServersStatus()
  })

  // 添加服务器（写入 mcp_config.json）
  ipcMain.handle('mcp:add-server', async (_event, payload: {
    id: string; command: string; args?: string[]; env?: Record<string, string>
  }) => {
    try {
      const id = payload?.id?.trim()
      const command = payload?.command?.trim()
      if (!id || !command) return { success: false, error: '服务器 ID 与启动命令不能为空' }
      const servers = await readMcpConfig()
      servers[id] = { command, args: payload.args, env: payload.env }
      await writeMcpConfig(servers)
      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  // 删除服务器（从 mcp_config.json 移除）
  ipcMain.handle('mcp:remove-server', async (_event, serverId: string) => {
    try {
      const servers = await readMcpConfig()
      if (!(serverId in servers)) return { success: false, error: `服务器不存在: ${serverId}` }
      delete servers[serverId]
      await writeMcpConfig(servers)
      await mcpManager.disconnect(serverId).catch(() => { /* 未连接则忽略 */ })
      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  // 获取默认配置文件路径
  ipcMain.handle('mcp:get-config-path', async () => {
    return mcpManager.getDefaultConfigPath()
  })

  logger.info('MCP', t('log.ipc.handlersRegistered'))
}
