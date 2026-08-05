/**
 * 开发者模式 Controller — 外部 API 接入（主进程代理 fetch）
 *
 * 为什么走主进程：渲染进程 CSP `connect-src` 白名单限制自定义端点（尤其本地 http 服务），
 * 主进程 net.fetch 不受渲染 CSP 限制。
 *
 * 安全设计：
 * - base URL 由主进程从配置读取——LLM/渲染层只能传相对 path，防任意 URL 调用（SSRF 面收窄到配置的单一端点）
 * - http/https 白名单校验（拒绝 file://、ftp:// 等）
 * - 超时（配置 timeoutMs，默认 15s，AbortController）
 * - 响应大小限制（1MB 截断，防大响应拖垮主进程）
 * - 错误信息 sanitize（不含敏感请求头）
 */
import { ipcMain } from 'electron'
import { readJsonFile, GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG } from '../utils/config-utils'
import { logger } from '../utils/logger'
import { safeErrorMessage } from '../utils/error-utils'
import { isValidHttpUrl, isValidRelativePath, buildDevApiUrl, truncateResponse } from '../utils/dev-api-utils'
import type { DevApiRequest, DevApiResponse, GlobalConfig } from '../../src/shared/ipc-channels'

/** 响应体最大字节数（1MB，超出截断） */
const MAX_RESPONSE_BYTES = 1024 * 1024
/** 默认超时（ms） */
const DEFAULT_TIMEOUT_MS = 15000

/** 读取开发者模式配置（未配置时返回 null） */
function getDevConfig(): GlobalConfig['devMode'] | null {
  try {
    const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
    const dev = config.devMode
    if (!dev || !dev.enabled) return null
    return dev
  } catch {
    return null
  }
}

/** 执行一次外部 API 请求（核心：配置校验 → fetch → 大小截断 → sanitize 错误） */
async function invokeDevApi(req: DevApiRequest): Promise<DevApiResponse> {
  const dev = getDevConfig()
  if (!dev) {
    return { success: false, error: '开发者模式未启用（设置 → 开发者模式）' }
  }
  if (!dev.apiBaseUrl || !isValidHttpUrl(dev.apiBaseUrl)) {
    return { success: false, error: '开发者模式 API 地址无效（需 http/https）' }
  }

  const method = req.method ?? 'GET'
  const path = (req.path ?? '').trim()
  // path 白名单：不允许绝对 URL / 协议注入（只接受相对路径，base URL 由配置决定）
  if (!isValidRelativePath(path)) {
    return { success: false, error: 'path 仅支持相对路径（base URL 由开发者模式配置决定）' }
  }

  const url = buildDevApiUrl(dev.apiBaseUrl, path)
  if (!url) {
    return { success: false, error: '拼接后的 URL 无效（需 http/https）' }
  }

  const timeoutMs = Number.isFinite(dev.timeoutMs) && dev.timeoutMs > 0 ? dev.timeoutMs : DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method,
      headers: dev.headers ?? {},
      body: (method === 'GET' || method === 'DELETE') ? undefined : (req.body ?? undefined),
      signal: controller.signal,
    })
    const buf = Buffer.from(await res.arrayBuffer())
    const { content } = truncateResponse(buf, MAX_RESPONSE_BYTES)
    return {
      success: true,
      status: res.status,
      content,
    }
  } catch (e) {
    const msg = safeErrorMessage(e)
    return { success: false, error: msg.includes('abort') ? `请求超时（${timeoutMs}ms）` : msg }
  } finally {
    clearTimeout(timer)
  }
}

export function registerDevController() {
  /** 调用外部 API（AI 工具 call_external_api 与设置页测试共用） */
  ipcMain.handle('dev:invoke', async (_event, req: DevApiRequest): Promise<DevApiResponse> => {
    try {
      return await invokeDevApi(req)
    } catch (e) {
      logger.error('Dev', `dev:invoke 异常: ${safeErrorMessage(e)}`)
      return { success: false, error: safeErrorMessage(e) }
    }
  })

  /** 测试连接（GET baseUrl 根路径） */
  ipcMain.handle('dev:test', async (): Promise<{ success: boolean; status?: number; error?: string }> => {
    const res = await invokeDevApi({ path: '', method: 'GET' })
    if (res.success) return { success: true, status: res.status }
    return { success: false, error: res.error }
  })
}
