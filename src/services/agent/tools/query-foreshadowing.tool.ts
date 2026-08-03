/**
 * query_foreshadowing — 未回收伏笔查询工具
 *
 * 写稿/规划剧情前调用：返回尚未回收的伏笔清单（含埋设章节），
 * LLM 据此自然回应旧伏笔、避免断裂或提前回收。
 */
import { buildAgentTool } from '../tool-registry'
import { loadAllForeshadowing, formatPendingForPrompt } from '../../foreshadowing-manager'
import { useProjectStore } from '../../../stores/project-store'
import { t } from '../../../shared/locale'

/** 单次注入上限（避免 prompt 膨胀，超出取最近埋设的） */
const MAX_ITEMS = 5

export const queryForeshadowingTool = buildAgentTool({
  name: 'query_foreshadowing',
  description: '查询尚未回收的伏笔（埋设章节 + 内容 + 类型）。写稿或规划剧情前调用，最多返回 5 条最近埋设的伏笔，据此在后续章节中自然回应或回收。',
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      chapter_number: {
        type: 'number',
        description: '当前章节号（用于筛选：只返回埋设于本章之前的伏笔）',
      },
      max_items: {
        type: 'number',
        description: '返回条数上限（默认 5，最大 10）',
        default: 5,
      },
    },
  },
  requiresConfirmation: false,
  execute: async (args) => {
    const project = useProjectStore.getState().currentProject
    if (!project) {
      return { success: false, content: '', error: t('error.noProject') }
    }

    try {
      const all = await loadAllForeshadowing()
      const pending = all.filter(f => !f.resolved)

      // 按当前章节过滤：仅埋设于本章之前（至少相隔 1 章）
      const chapterNum = args.chapter_number as number | undefined
      let eligible = pending
      if (chapterNum !== undefined) {
        eligible = pending.filter(f => (f.setChapter ?? 0) < chapterNum)
      }
      // 取最近埋设的
      eligible = [...eligible].sort((a, b) => (b.setChapter ?? 0) - (a.setChapter ?? 0))

      const maxItems = Math.min(Math.max(Number(args.max_items ?? MAX_ITEMS), 1), 10)
      const top = eligible.slice(0, maxItems)

      if (top.length === 0) {
        return { success: true, content: pending.length === 0
          ? '当前没有未回收的伏笔。'
          : `共有 ${pending.length} 条未回收伏笔，但均埋设于本章或之后，暂不适用。` }
      }

      const list = formatPendingForPrompt(top)
      return {
        success: true,
        content: `📌 未回收伏笔（共 ${pending.length} 条，展示最近 ${top.length} 条）\n${list}\n\n（仅作上下文参考：本章可自然回应 1-2 条，不必全部回收）`,
      }
    } catch (e) {
      return { success: false, content: '', error: `伏笔查询失败：${String(e)}` }
    }
  },
})
