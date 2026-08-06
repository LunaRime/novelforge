/**
 * read_characters — 读取角色卡档案
 */
import { t } from '../../../shared/locale'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'


export const readCharactersTool = buildAgentTool({
  name: 'read_characters',
  description: t('tool.readCharsDesc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      character_name: {
        type: 'string',
        description: t('tool.readCharsName'),
      },
    },
  },
  requiresConfirmation: false,
  execute: async (args) => {
    const project = useProjectStore.getState().currentProject
    if (!project) {
      return { success: false, content: '', error: t('error.noProject') }
    }

    const charName = args.character_name as string | undefined

    try {
      const charsResult = await ipc.invoke('db:character-get-all')
      const chars = (Array.isArray(charsResult) ? charsResult : []) as unknown as Array<Record<string, unknown>>
      if (!chars || chars.length === 0) {
        return { success: true, content: t('tool.readCharsEmpty') }
      }

      if (charName) {
        // 查找指定角色
        const target = chars.find((c) =>
          String(c.name).toLowerCase().includes(charName.toLowerCase())
        )
        if (!target) {
          const available = chars.map((c) => String(c.name)).join('、')
          return { success: false, content: '', error: t('tool.readCharsNotFound').replace('{name}', charName).replace('{available}', available) }
        }

        const formatted = Object.entries(target)
          .filter(([k, v]) => v && k !== 'id')
          .map(([k, v]) => `**${k}**: ${typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)}`)
          .join('\n')
        return { success: true, content: t('tool.readCharsCard').replace('{name}', String(target.name)).replace('{formatted}', formatted) }
      }

      // 列出所有角色
      const list = chars.map((c) => `  - ${c.name} (${c.role})`).join('\n')
      return { success: true, content: t('tool.readCharsList').replace('{count}', String(chars.length)).replace('{list}', list) }
    } catch (error) {
      return { success: false, content: '', error: t('tool.readCharsFailed').replace('{error}', String(error)) }
    }
  },
})
