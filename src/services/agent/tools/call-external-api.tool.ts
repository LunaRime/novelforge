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
import { t } from '../../../shared/locale'
import { ipc } from '../../ipc-client'

export const callExternalApiTool = buildAgentTool({
  name: 'call_external_api',
  description: t('tool.externalApiDesc'),
  source: 'builtin',
  requiresConfirmation: true,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: t('tool.externalApiPath') },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], description: t('tool.externalApiMethod') },
      body: { type: 'string', description: t('tool.externalApiBody') },
    },
    required: ['path'],
  },
  execute: async (args) => {
    // 缺 path 报错（与其他工具缺参约定一致；空 path 静默调根路径语义不明确）
    if (typeof args.path !== 'string' || !args.path.trim()) {
      return { success: false, content: '', error: t('tool.externalApiMissingPath') }
    }
    const path = args.path.trim()
    const method = (['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const).includes(args.method as never)
      ? args.method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
      : 'GET'
    const body = typeof args.body === 'string' ? args.body : undefined

    const res = await ipc.invoke('dev:invoke', { path, method, body })
    if (!res.success) {
      return {
        success: false,
        content: '',
        error: res.error ?? t('tool.externalApiCallFailed'),
      }
    }
    return {
      success: true,
      content: `HTTP ${res.status ?? 200}${res.content ? `\n${res.content}` : ''}`,
    }
  },
})
