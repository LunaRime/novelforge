/**
 * list_outline — 一次调用汇总「小说大纲」相关的全部数据源
 *
 * 为什么需要它（真机反馈 2026-09-13）：用户问「列出小说大纲」时，Agent 只能自己猜该调哪个工具，
 * 于是先后读了 read_architecture → read_project_state → list_chapters 三轮，才拼出结论
 * 「架构空 / 蓝图空 / 草稿 0 章」，期间把工具调用预算烧掉大半，最后撞上轮次上限。
 * 本工具把这些数据源**一次读完**，并对每一节显式标注「空」，末尾给出明确的下一步指引。
 *
 * 只读、免确认（与 read_architecture / read_project_state 同类）。
 */
import { t } from '../../../shared/locale'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'

/** 架构字段预览长度上限——避免把整篇世界观灌进上下文（需要全文时让 LLM 调 read_architecture） */
const PREVIEW_LIMIT = 200

function preview(text: string | undefined | null): string {
  const s = (text ?? '').trim()
  if (!s) return t('tool.listOutlineEmptyItem')
  return s.length > PREVIEW_LIMIT ? s.slice(0, PREVIEW_LIMIT) + '…' : s
}

export const listOutlineTool = buildAgentTool({
  name: 'list_outline',
  description: t('tool.listOutlineDesc'),
  source: 'builtin',
  inputSchema: { type: 'object', properties: {} },
  requiresConfirmation: false,
  isReadOnly: true,
  execute: async () => {
    const project = useProjectStore.getState().currentProject
    if (!project) {
      return { success: false, content: '', error: t('error.noProject') }
    }

    try {
      // 三个数据源并发读（都是只读通道）
      const [core, blueprints, draftChapters] = await Promise.all([
        ipc.invoke('db:project-core-get'),
        ipc.invoke('db:blueprint-get-all'),
        ipc.invoke('db:draft-get-all-chapter-numbers'),
      ])

      const parts: string[] = []

      // ===== 1. 故事架构 =====
      const arch: Array<[string, string]> = [
        [t('tool.listOutlinePremise'), preview(core?.premise)],
        [t('tool.listOutlineWorld'), preview(core?.worldbuilding)],
        [t('tool.listOutlineCharacters'), preview(core?.charactersArch)],
        [t('tool.listOutlineSynopsis'), preview(core?.synopsis)],
      ]
      parts.push(`## ${t('tool.listOutlineArchHeader')}\n` + arch.map(([k, v]) => `- ${k}：${v}`).join('\n'))

      // ===== 2. 章节蓝图 =====
      const bpNumbers = (blueprints ?? []).map(b => b.chapterNumber).sort((a, b) => a - b)
      parts.push(
        `## ${t('tool.listOutlineBlueprintHeader')}\n`
        + (bpNumbers.length === 0
          ? t('tool.listOutlineEmptyItem')
          : t('tool.listOutlineBlueprintCount')
            .replace('{count}', String(bpNumbers.length))
            .replace('{chapters}', bpNumbers.slice(0, 20).join(', ') + (bpNumbers.length > 20 ? ' …' : ''))),
      )

      // ===== 3. 章节草稿 =====
      const draftCount = (draftChapters ?? []).length
      parts.push(
        `## ${t('tool.listOutlineDraftHeader')}\n`
        + (draftCount === 0
          ? t('tool.listOutlineEmptyItem')
          : t('tool.listOutlineDraftCount').replace('{count}', String(draftCount))),
      )

      // ===== 4. 全空时给出明确的下一步（这是本次新增的核心价值：不让 Agent/用户猜）=====
      const archEmpty = arch.every(([, v]) => v === t('tool.listOutlineEmptyItem'))
      if (archEmpty && bpNumbers.length === 0 && draftCount === 0) {
        parts.push(`> ${t('tool.listOutlineAllEmpty')}`)
      }

      return { success: true, content: parts.join('\n\n') }
    } catch (error) {
      return { success: false, content: '', error: t('tool.listOutlineFailed').replace('{error}', String(error)) }
    }
  },
})
