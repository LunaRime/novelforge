/**
 * browser_list_tabs — 查询浏览器打开的标签页（内置 CDP 桥接，开箱即用）
 *
 * 前置：浏览器（Chrome/Edge）以 --remote-debugging-port 启动，并在
 * 设置 → 开发者模式 → 浏览器接入中启用并配置端口。
 * 只读工具（自动执行，无需确认）；未启用时返回引导性错误。
 */
import { buildAgentTool } from '../tool-registry'
import { t } from '../../../shared/locale'
import { ipc } from '../../ipc-client'

export const browserListTabsTool = buildAgentTool({
  name: 'browser_list_tabs',
  description: t('tool.browserTabsDesc'),
  source: 'builtin',
  requiresConfirmation: false,
  inputSchema: {
    type: 'object',
    properties: {},
  },
  execute: async () => {
    const res = await ipc.invoke('browser:list-tabs')
    if (!res.success) {
      return {
        success: false,
        content: '',
        error: res.error ?? '浏览器标签页查询失败',
      }
    }
    const tabs = res.tabs ?? []
    if (tabs.length === 0) {
      return { success: true, content: '浏览器当前没有打开的页面标签' }
    }
    const list = tabs.map((t, i) => `${i + 1}. ${t.title}\n   ${t.url}`).join('\n')
    return {
      success: true,
      content: `浏览器标签页（共 ${tabs.length} 个）：\n${list}`,
    }
  },
})
