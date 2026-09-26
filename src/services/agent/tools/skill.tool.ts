/**
 * skill — 技能元工具（B 档第一轮：模型自主懒加载）
 *
 * 替代此前「每个技能一个 `skill__<name>` 工具」的形态：那套把全部技能塞进工具提示词，
 * 而工具提示词有 1200 token 截断、技能又排在内置工具之后 → **先被砍掉的正是技能**。
 * 元工具把常驻成本压到一行描述，全文由模型按需取用。
 *
 * ⚠️ 必须注册为 builtin：`skill-registry` 的 `loadAll()` 会 `unregisterBySource('skill')`
 * 清掉所有标 skill 来源的注册（元工具若标成该来源会被自己清掉）。
 */
import { t } from '../../../shared/locale'
import { buildAgentTool } from '../tool-registry'
import { skillRegistry, sortSkillsBySource } from '../skill-registry'

/** 技能目录（模型据此决定要不要按名加载） */
export function buildSkillCatalog(): string {
  const skills = sortSkillsBySource(skillRegistry.listAll())
  if (skills.length === 0) return t('tool.skill.empty')
  return skills
    .map(s => {
      const when = s.metadata.whenToUse
        ? ` — ${t('tool.skill.whenPrefix')}${s.metadata.whenToUse}`
        : ''
      return `- ${s.metadata.displayName ?? s.metadata.name}（${s.metadata.name}）：${s.metadata.description}${when}`
    })
    .join('\n')
}

/** 应用 `${args}` / `$1` 替换（与 `/命令` 链路同语义，见 agent-store 的 default 分支） */
export function applySkillArgs(content: string, args: string): string {
  return content.replace(/\$\{args\}/g, args).replace(/\$1/g, args)
}

export const skillTool = buildAgentTool({
  name: 'skill',
  description: t('tool.skill.desc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: t('tool.skill.nameDesc') },
      args: { type: 'string', description: t('tool.skill.argsDesc') },
    },
  },
  requiresConfirmation: false,
  isReadOnly: true,
  execute: async (input) => {
    const name = typeof input.name === 'string' ? input.name.trim() : ''

    // 无参：列目录（模型的第一步）
    if (!name) {
      return {
        success: true,
        content: `${t('tool.skill.catalogTitle')}\n${buildSkillCatalog()}`,
      }
    }

    const skill = skillRegistry.get(name)
    if (!skill) {
      // 附带目录，便于模型下一轮自我纠正（而不是盲目重试）
      return {
        success: false,
        content: '',
        error: t('tool.skill.notFound')
          .replace('{name}', name)
          .replace('{catalog}', buildSkillCatalog()),
      }
    }

    const args = typeof input.args === 'string' ? input.args : ''
    let content = applySkillArgs(skill.content, args)

    // allowedTools 三态（B 档第一轮）：原实现用 `?.length` 判空，导致显式 `[]`（"禁止调用工具"）
    // 不产生任何提示、语义丢失。现在：未声明 → 无提示；显式空 → 禁止提示；非空 → 白名单提示。
    // 消费点随 `skill__*` 注册一并迁移到这里（加载全文时立即看到约束）。
    const tools = skill.metadata.allowedTools
    if (Array.isArray(tools)) {
      content += tools.length === 0
        ? `\n\n---\n${t('skill.allowedToolsNone')}`
        : `\n\n---\n${t('skill.allowedToolsHint')}: ${tools.join(', ')}`
    }

    return { success: true, content }
  },
})
