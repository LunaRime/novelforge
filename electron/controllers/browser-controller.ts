/**
 * 浏览器接入 Controller — 内置 CDP 桥接（开箱即用）
 *
 * Chrome/Edge 以 `--remote-debugging-port=9222` 启动后即暴露 CDP HTTP 端点：
 *   GET /json          → 标签页列表
 *   GET /json/version  → 版本信息
 * 本 controller 代理这些端点，AI 工具 browser_list_tabs 可直接查询浏览器。
 *
 * 安全设计：
 * - 仅回环 127.0.0.1（CDP 默认只绑 localhost；禁止配置为远程地址——防远程 CDP 探测）
 * - 端口校验（1-65535 整数）
 * - 超时（3s，本地快速失败） + 结果截断
 */
import { ipcMain } from 'electron'
import { readJsonFile, GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG } from '../utils/config-utils'
import { logger } from '../utils/logger'
import type { BrowserTabInfo, GlobalConfig } from '../../src/shared/ipc-channels'

/** CDP 查询超时（ms） */
const CDP_TIMEOUT_MS = 3000
/** 单标签 title/url 最大长度（截断防大响应） */
const MAX_FIELD_LEN = 500
/** 最大返回标签数 */
const MAX_TABS = 100

/** 读取浏览器接入配置（未启用返回 null） */
function getBrowserConfig(): GlobalConfig['devBrowser'] | null {
  try {
    const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
    const b = config.devBrowser
    if (!b || !b.enabled) return null
    return b
  } catch {
    return null
  }
}

/** 端口校验（1-65535 整数） */
function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

/** CDP 端点基础 URL（仅回环） */
function cdpBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`
}

/** 带超时的 CDP HTTP 请求（返回 JSON；失败返回 null） */
async function cdpFetchJson(port: number, endpoint: string): Promise<unknown | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CDP_TIMEOUT_MS)
  try {
    const res = await fetch(`${cdpBaseUrl(port)}${endpoint}`, { signal: controller.signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function registerBrowserController() {
  /** 查询标签页列表 */
  ipcMain.handle('browser:list-tabs', async (): Promise<{ success: boolean; tabs?: BrowserTabInfo[]; error?: string }> => {
    const b = getBrowserConfig()
    if (!b) return { success: false, error: '浏览器接入未启用（设置 → 开发者模式 → 浏览器接入）' }
    if (!isValidPort(b.cdpPort)) return { success: false, error: `CDP 端口无效: ${b.cdpPort}` }

    const data = await cdpFetchJson(b.cdpPort, '/json')
    if (!Array.isArray(data)) {
      return { success: false, error: `无法连接 CDP（${cdpBaseUrl(b.cdpPort)}/json）。请确认浏览器已用 --remote-debugging-port=${b.cdpPort} 启动` }
    }

    const tabs: BrowserTabInfo[] = data
      .filter((t: Record<string, unknown>) => typeof t === 'object' && t !== null)
      .map((t: Record<string, unknown>) => ({
        id: String(t.id ?? ''),
        title: String(t.title ?? '').slice(0, MAX_FIELD_LEN),
        url: String(t.url ?? '').slice(0, MAX_FIELD_LEN),
        type: String(t.type ?? ''),
      }))
      // 仅页面类型 + 非空白页优先
      .filter(t => t.type === 'page' && t.title !== '')
      .slice(0, MAX_TABS)
      .sort((a, b) => a.title.localeCompare(b.title))

    return { success: true, tabs }
  })

  /** 测试 CDP 连接（cdpPort 可选覆盖——设置页未保存也能测 UI 当前值） */
  ipcMain.handle('browser:test', async (_event, override?: { cdpPort?: number }): Promise<{ success: boolean; version?: string; error?: string }> => {
    const b = getBrowserConfig()
    // 覆盖端口优先（UI 测试用）；否则要求已启用
    const port = override?.cdpPort ?? b?.cdpPort
    if (!b && override?.cdpPort === undefined) return { success: false, error: '浏览器接入未启用' }
    if (!isValidPort(port ?? 0)) return { success: false, error: `CDP 端口无效: ${port}` }

    const data = await cdpFetchJson(port as number, '/json/version') as Record<string, unknown> | null
    if (!data || typeof data !== 'object') {
      return { success: false, error: `无法连接 CDP（端口 ${port}）。请确认浏览器已用 --remote-debugging-port=${port} 启动` }
    }
    return { success: true, version: String(data['Browser'] ?? data['Protocol-Version'] ?? 'unknown') }
  })

  logger.info('Browser', '浏览器接入 Controller 已注册')
}
