/**
 * read_project_state — 读取项目全局状态
 */
import { t } from '../../../shared/locale'
import { buildAgentTool } from '../tool-registry'
import { useProjectStore } from '../../../stores/project-store'
import { ipc } from '../../ipc-client'


export const readProjectStateTool = buildAgentTool({
  name: 'read_project_state',
  description: t('tool.readStateDesc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      include_config: {
        type: 'boolean',
        description: t('tool.readStateFullConfig'),
        default: true,
      },
      include_summary: {
        type: 'boolean',
        description: t('tool.readStateNotes'),
        default: true,
      },
    },
  },
  requiresConfirmation: false,
  execute: async (args) => {
    const project = useProjectStore.getState().currentProject
    if (!project) {
      return { success: false, content: '', error: t('error.noProject') }
    }

    const includeConfig = (args.include_config as boolean) !== false
    const includeSummary = (args.include_summary as boolean) !== false

    const parts: string[] = [t('tool.readStateHeader').replace('{name}', project.name)]

    if (includeConfig) {
      // 读取小说配置
      try {
        const core = await ipc.invoke('db:project-core-get')
        if (core) {
          parts.push(t('tool.readStateConfigSection').replace('{json}', JSON.stringify({
            projectName: core.projectName,
            genre: core.genre,
            subGenre: core.subGenre,
            targetAudience: core.targetAudience,
            totalChapters: core.totalChapters,
            wordsPerChapter: core.wordsPerChapter,
            plotStructure: core.plotStructure,
            narrativePov: core.narrativePov,
            writingStyle: core.writingStyle
          }, null, 2)))
        }
      } catch {
        // Fallback
        parts.push(t('tool.readStateConfigFailed'))
      }
    }

    if (includeSummary) {
      // 读取最近 5 章蓝图的 notes 字段作为进度摘要
      const notesParts: string[] = []
      try {
        const bps = await ipc.invoke('db:blueprint-get-all')
        if (bps && Array.isArray(bps)) {
          // 倒序遍历
          const sorted = bps.sort((a, b) => b.chapterNumber - a.chapterNumber)
          for (const bp of sorted) {
            if (bp.notes && bp.notes.trim()) {
              notesParts.unshift(t('tool.readStateNoteItem')
                .replace('{chapter}', String(bp.chapterNumber))
                .replace('{title}', bp.title || '')
                .replace('{notes}', bp.notes))
              if (notesParts.length >= 5) break
            }
          }
        }
      } catch { /* 忽略 */ }

      if (notesParts.length > 0) {
        parts.push(t('tool.readStateNotesSection').replace('{notes}', notesParts.join('\n\n')))
      } else {
        parts.push(t('tool.readStateNoNotes'))
      }
    }

    return { success: true, content: parts.join('\n\n') }
  },
})

