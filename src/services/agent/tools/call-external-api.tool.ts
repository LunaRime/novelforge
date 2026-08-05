/**
 * call_external_api — 调用开发者模式配置的外部 API（如本地浏览器服务）
 *
 * 用途：程序内 AI 通过开发者模式接入其他程序的 HTTP API。
 * 安全：
 * - base URL 由主进程从配置读取（LLM 只能传相对 path，防任意 URL 调用）
 * - 未启用开发者模式 → 返回引导性错误（LLM 可据此告知用户去设置开启）
 * - requiresConfirmation：外部 API 有副作用，调用前需用户确认
 */
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'

export const callExternalApiTool = buildAgentTool({
  name: 'call_external_api',
  description: '调用开发者模式配置的外部程序 API（在设置 → 开发者模式中配置基础地址与请求头）。传入相对路径 path（如 /search?q=xxx）、方法（默认 GET）与 JSON 字符串 body。用于接入浏览器等其他程序的能力。',
  source: 'builtin',
  requiresConfirmation: true,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对路径（不含基础地址），如 /search?q=关键词 或 /api/v1/query' },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], description: 'HTTP 方法（默认 GET）' },
      body: { type: 'string', description: '请求体 JSON 字符串（POST/PUT/PATCH 时使用）' },
    },
    required: ['path'],
  },
  execute: async (args) => {
    const path = typeof args.path === 'string' ? args.path : ''
    const method = (['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const).includes(args.method as never)
      ? args.method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
      : 'GET'
    const body = typeof args.body === 'string' ? args.body : undefined

    const res = await ipc.invoke('dev:invoke', { path, method, body })
    if (!res.success) {
      return {
        success: false,
        content: '',
        error: res.error ?? '外部 API 调用失败',
      }
    }
    return {
      success: true,
      content: `HTTP ${res.status ?? 200}${res.content ? `\n${res.content}` : ''}`,
    }
  },
})
