/**
 * setting_sampler — 冷门设定采样工具
 *
 * 对抗"创意撞车"：从知识库中采样低相关度（冷门）片段，
 * 作为可选参考喂给 LLM，提示在合适契机化用、避免套路。
 * 判定标准：用随机低频词检索，取相关度最低的尾部结果。
 */
import { buildAgentTool } from '../tool-registry'
import { t } from '../../../shared/locale'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'

/** 低频检索词池（与常见网文套路词拉开距离） */
const COLD_QUERY_POOL = [
  '古籍残页', '锈蚀机关', '边疆驿道', '老匠人', '废弃祭坛',
  '旧信札', '织机', '沙漏', '灯塔', '渡口', '石窟壁画', '铜铃',
]

/**
 * 从知识库采样冷门设定片段（低相关度尾部）
 * @param count 采样条数
 */
export async function sampleColdSettings(count = 2): Promise<string> {
  const project = useProjectStore.getState().currentProject
  if (!project) return ''

  try {
    // 随机选一个低频词检索，取尾部（低相关度）结果
    const query = COLD_QUERY_POOL[Math.floor(Math.random() * COLD_QUERY_POOL.length)]
    const results = (await ipc.invoke('kb:search', query, 8)) as Array<{
      text: string; fileName: string; score: number
    }> | null

    if (!results || results.length === 0) return ''

    // 按相关度升序取尾部（最不相关 = 最冷门），最多 count 条
    const cold = [...results].sort((a, b) => a.score - b.score).slice(0, Math.min(count, results.length))
    if (cold.length === 0) return ''

    return cold.map((r, i) => t('tool.samplerItem')
      .replace('{index}', String(i + 1))
      .replace('{name}', r.fileName)
      .replace('{score}', (r.score * 100).toFixed(0))
      .replace('{text}', r.text.slice(0, 300))).join('\n\n')
  } catch {
    return ''
  }
}

export const settingSamplerTool = buildAgentTool({
  name: 'setting_sampler',
  description: t('tool.samplerDesc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      count: {
        type: 'number',
        description: t('tool.samplerCount'),
        default: 2,
      },
    },
  },
  requiresConfirmation: false,
  execute: async (args) => {
    const project = useProjectStore.getState().currentProject
    if (!project) {
      return { success: false, content: '', error: t('error.noProject') }
    }
    const count = Math.min(Math.max(Number(args.count ?? 2), 1), 3)
    const sampled = await sampleColdSettings(count)
    if (!sampled) {
      return { success: true, content: t('tool.samplerEmpty') }
    }
    return {
      success: true,
      content: t('tool.samplerResult').replace('{sampled}', sampled),
    }
  },
})
