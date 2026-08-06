/**
 * query_foreshadowing — 未回收伏笔查询工具
 *
 * 写稿/规划剧情前调用：返回尚未回收的伏笔清单（含埋设章节），
 * LLM 据此自然回应旧伏笔、避免断裂或提前回收。
 */
import { buildAgentTool } from '../tool-registry'
import { t } from '../../../shared/locale'
import { loadAllForeshadowing, formatPendingForPrompt } from '../../foreshadowing-manager'
import { useProjectStore } from '../../../stores/project-store'

/** 单次注入上限（避免 prompt 膨胀，超出取最近埋设的） */
const MAX_ITEMS = 5

export const queryForeshadowingTool = buildAgentTool({
  name: 'query_foreshadowing',
  description: t('tool.foreshadowDesc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      chapter_number: {
        type: 'number',
        description: t('tool.foreshadowChapter'),
      },
      max_items: {
        type: 'number',
        description: t('tool.foreshadowLimit'),
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
      // 数值归一化：LLM 传 "10" 字符串时 "9" < "10" 字典序比较恒 false，过滤结果错误（P2 修复）
      const chapterNumRaw = args.chapter_number
      const chapterNum = chapterNumRaw === undefined ? undefined : Number(chapterNumRaw)
      if (chapterNum !== undefined && !Number.isFinite(chapterNum)) {
        return { success: false, content: '', error: t('tool.invalidChapterNumber').replace('{value}', String(chapterNumRaw)) }
      }
      let eligible = pending
      if (chapterNum !== undefined) {
        eligible = pending.filter(f => (f.setChapter ?? 0) < (chapterNum as number))
      }
      // 取最近埋设的
      eligible = [...eligible].sort((a, b) => (b.setChapter ?? 0) - (a.setChapter ?? 0))

      const maxItems = Math.min(Math.max(Number(args.max_items ?? MAX_ITEMS), 1), 10)
      const top = eligible.slice(0, maxItems)

      if (top.length === 0) {
        return { success: true, content: pending.length === 0
          ? t('tool.foreshadowNone')
          : t('tool.foreshadowNotEligible').replace('{count}', String(pending.length)) }
      }

      const list = formatPendingForPrompt(top)
      return {
        success: true,
        content: t('tool.foreshadowList')
          .replace('{total}', String(pending.length))
          .replace('{shown}', String(top.length))
          .replace('{list}', list),
      }
    } catch (e) {
      return { success: false, content: '', error: t('tool.foreshadowQueryFailed').replace('{error}', String(e)) }
    }
  },
})
