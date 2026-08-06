/**
 * read_drafts — 读取草稿内容及状态
 */
import { t } from '../../../shared/locale'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'


export const readDraftsTool = buildAgentTool({
  name: 'read_drafts',
  description: t('tool.readDraftsDesc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      chapter_number: {
        type: 'number',
        description: t('tool.readDraftsChapter'),
      },
      draft_type: {
        type: 'string',
        description: t('tool.readDraftsType'),
        enum: ['draft_v1', 'revised', 'latest'],
        default: 'latest',
      },
    },
    required: ['chapter_number'],
  },
  requiresConfirmation: false,
  execute: async (args) => {
    const project = useProjectStore.getState().currentProject
    if (!project) {
      return { success: false, content: '', error: t('error.noProject') }
    }

    // 数值归一化（LLM 可能传字符串 "10"——此前透传 SQLite）
    const chapterNumRaw = args.chapter_number
    const chapterNum = Number(chapterNumRaw)
    if (!Number.isFinite(chapterNum)) {
      return { success: false, content: '', error: t('tool.invalidChapterNumber').replace('{value}', String(chapterNumRaw)) }
    }
    const draftType = (args.draft_type as string) ?? 'latest'

    try {
      // 从数据库获取章节的草稿列表
      const draftsResult = await ipc.invoke('db:draft-list', chapterNum)
      const drafts = (Array.isArray(draftsResult) ? draftsResult : []) as unknown as Array<Record<string, unknown>>
      if (!drafts || drafts.length === 0) {
        return { success: true, content: t('tool.readDraftsNone').replace('{chapter}', String(chapterNum)) }
      }

      let targetId: number | null = null
      let targetName = ''

      if (draftType === 'latest') {
        const latest = drafts[0] // 默认查询回来是按 version 倒序排列的
        targetId = latest.id as number
        targetName = `v${latest.version as number}`
      } else {
        // 查找指定类型的草稿
        const target = drafts.find(d => {
          if (draftType === 'draft_v1') return (d.version as number) === 1
          if (draftType === 'revised') return (d.version as number) > 1
          return false
        })

        if (!target) {
          const available = drafts.map(d => `v${d.version as number}`).join('、')
          return { success: false, content: '', error: t('tool.readDraftsTypeNotFound').replace('{type}', draftType).replace('{available}', available) }
        }
        targetId = target.id as number
        targetName = `v${target.version as number}`
      }

      const fullDraft = await ipc.invoke('db:draft-get-full', targetId as number) as { content?: string } | null
      if (!fullDraft) {
        return { success: false, content: '', error: t('tool.readDraftsContentFailed').replace('{id}', String(targetId)) }
      }
      return { success: true, content: t('tool.readDraftsContent')
        .replace('{chapter}', String(chapterNum))
        .replace('{name}', targetName)
        .replace('{content}', fullDraft.content ?? '') }
    } catch (error) {
      return { success: false, content: '', error: t('tool.readDraftsFailed').replace('{error}', String(error)) }
    }
  },
})
