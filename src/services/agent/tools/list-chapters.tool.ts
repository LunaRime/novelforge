import { defaultAgentRuntimePorts, captureAgentProject, buildRuntimeAgentTool, type AgentRuntimePorts } from '../runtime-ports'
/**
 * list_chapters — 列出所有章节状态概览
 */
import { t } from '../../../shared/locale'
import { ipc } from '../../ipc-client'


export function createListChaptersTool(ports: AgentRuntimePorts = defaultAgentRuntimePorts) {
return buildRuntimeAgentTool(ports, {
  name: 'list_chapters',
  description: t('tool.listChaptersDesc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  requiresConfirmation: false,
  execute: async () => {
    const sourceProject = captureAgentProject(ports)
    const project = sourceProject.project
    if (!project) {
      return { success: false, content: '', error: t('error.noProject') }
    }

    try {
      const blueprints = await ipc.invoke('db:blueprint-get-all')
      const bpNums = new Set<number>((Array.isArray(blueprints) ? blueprints : []).map((b: unknown) => (b as { chapterNumber?: number }).chapterNumber).filter((n): n is number => n !== undefined))
      const draftNums = new Set<number>(ports.drafts.chapterNumbers())

      // 定稿状态从 DB 查询而非 FS 扫描
      const msNums = new Set<number>()
      for (const bp of (Array.isArray(blueprints) ? blueprints : [])) {
        if (!sourceProject.isCurrent()) return { success: false, content: '', error: t('error.noProject') }
        const finalized = await ipc.invoke('db:draft-get-finalized', bp.chapterNumber)
        if (finalized) msNums.add(bp.chapterNumber)
      }

      // 合并所有出现过的章节号
      const allNums = new Set([...bpNums, ...draftNums, ...msNums])
      if (allNums.size === 0) {
        return { success: true, content: t('tool.listChaptersEmpty') }
      }

      const sortedNums = Array.from(allNums).sort((a, b) => a - b)

      const rows = sortedNums.map(num => {
        const hasBp = bpNums.has(num) ? '✅' : '❌'
        const hasDraft = draftNums.has(num) ? '✅' : '❌'
        const hasMs = msNums.has(num) ? '✅' : '❌'
        return `| ${num} | ${hasBp} | ${hasDraft} | ${hasMs} |`
      })

      const table = `${t('tool.listChaptersTableHeader')}\n| --- | --- | --- | --- |\n${rows.join('\n')}`

      return {
        success: true,
        content: t('tool.listChaptersOverview')
          .replace('{table}', table)
          .replace('{chapters}', String(sortedNums.length))
          .replace('{blueprints}', String(bpNums.size))
          .replace('{drafts}', String(draftNums.size))
          .replace('{finalized}', String(msNums.size)),
      }
    } catch (e: unknown) {
      return { success: false, content: '', error: t('tool.listChaptersFailed').replace('{error}', e instanceof Error ? e.message : String(e)) }
    }
  },
})
}

export const listChaptersTool = createListChaptersTool()
