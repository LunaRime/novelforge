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
        // 查找指定角色——精确匹配优先（P1 修复：此前子串 includes 取第一个命中，
        // 查询「林」可能命中「林峰」而非主角「林晓」，返回卡片与意图不符且无提示）
        const query = charName.trim()
        const exact = chars.find((c) => String(c.name) === query)
        const target = exact ?? chars.find((c) =>
          String(c.name).toLowerCase().includes(query.toLowerCase())
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

      // P1-4：列表压缩——主要角色（主角/反派）全量，配角/龙套只给前 10 个 + 总数；
      // status 标注（退场/死亡）
      const statusTag = (c: { status?: string }): string =>
        c.status === 'dead' ? t('tool.readCharsDead')
          : c.status === 'departed' ? t('tool.readCharsDeparted')
          : ''
      const core = chars.filter(c => String(c.role) === 'protagonist' || String(c.role) === 'antagonist')
      const others = chars.filter(c => String(c.role) !== 'protagonist' && String(c.role) !== 'antagonist')
      const fmt = (c: Record<string, unknown>): string => `  - ${statusTag(c)}${String(c.name)} (${String(c.role)})`
      const coreList = core.map(fmt).join('\n')
      const OTHERS_CAP = 10
      const shownOthers = others.slice(0, OTHERS_CAP).map(fmt).join('\n')
      const hiddenOthers = others.length - shownOthers.split('\n').filter(Boolean).length
      const sections: string[] = []
      if (coreList) sections.push(t('tool.readCharsCore').replace('{list}', coreList))
      if (shownOthers) {
        const suffix = hiddenOthers > 0 ? t('tool.readCharsMore').replace('{n}', String(hiddenOthers)) : ''
        sections.push(t('tool.readCharsOthers').replace('{n}', String(others.length)).replace('{list}', shownOthers + suffix))
      }
      const list = sections.join('\n')
      return { success: true, content: t('tool.readCharsList').replace('{count}', String(chars.length)).replace('{list}', list) }
    } catch (error) {
      return { success: false, content: '', error: t('tool.readCharsFailed').replace('{error}', String(error)) }
    }
  },
})
