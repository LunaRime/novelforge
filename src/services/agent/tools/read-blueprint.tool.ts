/**
 * read_blueprint — 读取章节蓝图
 */
import { t } from '../../../shared/locale'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'


export const readBlueprintTool = buildAgentTool({
  name: 'read_blueprint',
  description: t('tool.readBlueprintDesc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      chapter_number: {
        type: 'number',
        description: t('tool.readBlueprintChapter'),
      },
    },
  },
  requiresConfirmation: false,
  execute: async (args) => {
    const project = useProjectStore.getState().currentProject
    if (!project) {
      return { success: false, content: '', error: t('error.noProject') }
    }

    const chapterNum = args.chapter_number as number | undefined

    if (chapterNum !== undefined) {
      // 读取指定章节蓝图
      const bp = await ipc.invoke('db:blueprint-get', chapterNum)
      if (!bp) {
        return { success: false, content: '', error: t('tool.readBlueprintNotFound').replace('{chapter}', String(chapterNum)) }
      }
      return { success: true, content: t('tool.readBlueprintDetail')
        .replace('{chapter}', String(chapterNum))
        .replace('{title}', bp.title)
        .replace('{role}', bp.role)
        .replace('{purpose}', bp.purpose)
        .replace('{keyEvents}', bp.keyEvents)
        .replace('{characters}', bp.characters.join(', '))
        .replace('{suspense}', bp.suspenseHook)
        .replace('{notes}', bp.notes)
        .replace('{guidance}', bp.userGuidance) }
    }

    // 列出所有蓝图文件
    try {
      const bps = await ipc.invoke('db:blueprint-get-all')
      if (!bps || bps.length === 0) {
        return { success: true, content: t('tool.readBlueprintEmpty') }
      }

      const list = bps.map((b: unknown) => t('tool.readBlueprintItem')
        .replace('{chapter}', String((b as { chapterNumber?: number }).chapterNumber))
        .replace('{title}', (b as { title?: string }).title || t('tool.noTitle'))).join('\n')
      return { success: true, content: t('tool.readBlueprintList').replace('{count}', String(bps.length)).replace('{list}', list) }
    } catch (error) {
      return { success: false, content: '', error: t('tool.readBlueprintFailed').replace('{error}', String(error)) }
    }
  },
})
