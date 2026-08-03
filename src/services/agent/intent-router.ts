/**
 * 意图路由 + / 命令解析
 *
 * 负责：
 * 1. 解析 /command 格式的斜杠命令
 * 2. 解析 @mention 格式的上下文提及
 * 3. 路由用户消息到对应的处理逻辑
 */

import { skillRegistry, type LoadedSkill } from './skill-registry'
import { t } from '../../shared/locale'
import { useProjectStore } from '../../stores/project-store'

// ===== 类型定义 =====

/** / 命令 */
export interface SlashCommand {
  /** 命令名（不含 /） */
  name: string
  /** 显示名称 */
  displayName: string
  /** 描述 */
  description: string
  /** 来源类型 */
  source: 'builtin_command' | 'skill'
  /** 关联的 Skill（如有） */
  skill?: LoadedSkill
}

/** @ 提及目标 */
export interface MentionTarget {
  /** 提及类型 */
  type: 'chapter' | 'character' | 'architecture' | 'blueprint' | 'knowledge' | 'file'
  /** 显示名称 */
  displayName: string
  /** 提及值（传递给 Tool；文件目标 = 相对项目根的路径） */
  value: string
  /** 图标 emoji */
  icon: string
  /** 插入输入框的文本（默认 displayName；文件目标用路径以便发送时解析回文件） */
  insertText?: string
}

/** 提及解析结果 */
export interface ParsedMention {
  target: MentionTarget
  /** 在原文中的起止位置 */
  start: number
  end: number
}

// ===== / 命令管理 =====

/** 获取内置 / 命令列表（动态计算以支持 i18n） */
function getBuiltinCommands(): SlashCommand[] {
  return [
    {
      name: 'clear',
      displayName: t('cmd.clearChat'),
      description: t('cmd.clearChatDesc'),
      source: 'builtin_command',
    },
    {
      name: 'new',
      displayName: t('cmd.newChat'),
      description: t('cmd.newChatDesc'),
      source: 'builtin_command',
    },
    {
      name: 'help',
      displayName: t('cmd.help'),
      description: t('cmd.helpDesc'),
      source: 'builtin_command',
    },
    {
      name: 'status',
      displayName: t('cmd.projectStatus'),
      description: t('cmd.projectStatusDesc'),
      source: 'builtin_command',
    },
  ]
}

/**
 * 获取所有可用的 / 命令（内置 + Skill）
 */
export function getAllSlashCommands(): SlashCommand[] {
  const commands: SlashCommand[] = [...getBuiltinCommands()]

  // 把所有 Skill 也注册为 / 命令
  for (const skill of skillRegistry.listAll()) {
    if (skill.metadata.userInvocable !== false) {
      commands.push({
        name: skill.metadata.name,
        displayName: skill.metadata.displayName ?? skill.metadata.name,
        description: skill.metadata.description,
        source: 'skill',
        skill,
      })
    }
  }

  return commands
}

/**
 * 模糊搜索 / 命令
 */
export function searchSlashCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase()
  return getAllSlashCommands().filter(cmd =>
    cmd.name.toLowerCase().includes(q) ||
    cmd.displayName.toLowerCase().includes(q) ||
    cmd.description.toLowerCase().includes(q)
  )
}

/**
 * 判断用户输入是否以 / 开头
 */
export function isSlashCommand(input: string): boolean {
  return input.trimStart().startsWith('/')
}

/**
 * 解析 / 命令
 */
export function parseSlashCommand(input: string): {
  command: SlashCommand | null
  args: string
} {
  const trimmed = input.trimStart()
  if (!trimmed.startsWith('/')) {
    return { command: null, args: '' }
  }

  const withoutSlash = trimmed.slice(1)
  const spaceIndex = withoutSlash.indexOf(' ')
  const cmdName = spaceIndex > -1 ? withoutSlash.slice(0, spaceIndex) : withoutSlash
  const args = spaceIndex > -1 ? withoutSlash.slice(spaceIndex + 1).trim() : ''

  const command = getAllSlashCommands().find(c => c.name === cmdName) ?? null

  return { command, args }
}

// ===== @ 提及管理 =====

/**
 * 获取所有可 @ 提及的目标
 */
export function getAllMentionTargets(): MentionTarget[] {
  return [
    { type: 'architecture', displayName: t('mention.storyArch'), value: 'architecture', icon: '📐' },
    { type: 'character', displayName: t('mention.charCard'), value: 'characters', icon: '👤' },
    { type: 'blueprint', displayName: t('mention.blueprint'), value: 'blueprints', icon: '📋' },
    { type: 'knowledge', displayName: t('mention.knowledge'), value: 'knowledge', icon: '📚' },
    { type: 'chapter', displayName: t('mention.currentChapter'), value: 'current_chapter', icon: '📝' },
    // @文件 暂不可用：read_file 需要具体路径，而提及目标不含文件选择——
    // 保留会导致预取 read_file('') 必然失败，误导用户（2026-08-03 检查确认）
    // { type: 'file', displayName: t('mention.projectFiles'), value: 'file', icon: '📄' },
  ]
}

/**
 * 模糊搜索 @ 提及目标
 * 固定目标（架构/角色/蓝图/知识库/章节）在前，项目文件搜索结果在后
 */
export function searchMentionTargets(query: string): MentionTarget[] {
  const q = query.toLowerCase()
  const fixed = getAllMentionTargets().filter(t =>
    t.displayName.toLowerCase().includes(q) ||
    t.value.toLowerCase().includes(q)
  )
  return [...fixed, ...searchProjectFiles(q)]
}

// ===== 项目文件 @ 提及（2026-08-03 新增：可添加可读文件） =====

/** 可读文件扩展名（文本类，排除二进制与内部目录） */
const READABLE_EXTS = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.csv'])

/** 递归收集可读文件（相对项目根路径）；跳过内部/依赖目录 */
function flattenReadableFiles(
  nodes: Array<{ name: string; isDir: boolean; children?: unknown[] }>,
  prefix = '',
): Array<{ name: string; path: string }> {
  const out: Array<{ name: string; path: string }> = []
  for (const n of nodes) {
    if (n.isDir) {
      if (n.name === '.vela' || n.name === 'node_modules' || n.name === '.git') continue
      out.push(...flattenReadableFiles((n.children as Array<{ name: string; isDir: boolean; children?: unknown[] }>) ?? [], prefix + n.name + '/'))
    } else {
      const lower = n.name.toLowerCase()
      if (READABLE_EXTS.has(lower.slice(lower.lastIndexOf('.')))) {
        out.push({ name: n.name, path: prefix + n.name })
      }
    }
  }
  return out
}

/**
 * 从项目文件树搜索可读文件（按文件名优先、路径其次模糊匹配）
 * 供 @ 提及选择文件 → 插入路径 → 发送时 read_file 预取内容
 */
export function searchProjectFiles(query: string, limit = 8): MentionTarget[] {
  const tree = useProjectStore.getState().fileTree
  if (!tree || tree.length === 0) return []
  const q = query.trim().toLowerCase()
  const files = flattenReadableFiles(tree)
  const matched = files.filter(f =>
    f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
  )
  // 文件名命中优先于路径命中；同组内按名称排序；空查询时返回名称排序前 limit
  const sorted = [...matched].sort((a, b) => {
    const rank = (f: { name: string; path: string }) => (q ? (f.name.toLowerCase().includes(q) ? 0 : 1) : 0)
    return rank(a) - rank(b) || a.name.localeCompare(b.name)
  })
  return sorted.slice(0, limit).map(f => ({
    type: 'file' as const,
    displayName: f.name,
    value: f.path,
    icon: '📄',
    insertText: f.path,
  }))
}

/**
 * 解析输入中的 @ 提及
 * 注意：\S+ 会把紧跟提及的中文标点（如"@故事架构，"）也吞进匹配，
 * 导致 find 失败、提及静默失效。排除常见中文标点后按尾部截断做前缀匹配。
 */
export function parseMentions(input: string): ParsedMention[] {
  const mentions: ParsedMention[] = []
  const regex = /@([^\s，。！？；：、（）《》【】·—…""'']+)/g
  let match: RegExpExecArray | null = null

  while ((match = regex.exec(input)) !== null) {
    const value = match[1]
    const targets = getAllMentionTargets()
    // 精确匹配 value / displayName；若用户输入是 displayName 的前缀（输入法尚未完成）则跳过，
    // 仅在完整匹配时生效——避免"@故事"误匹配到不存在的目标
    const target = targets.find(t => t.value === value || t.displayName === value)
      ?? searchProjectFiles(value, 1)[0]  // 文件提及：插入的是相对路径，按路径/文件名匹配回文件
    if (target) {
      mentions.push({
        target,
        start: match.index,
        end: match.index + match[0].length,
      })
    }
  }

  return mentions
}

/**
 * 将提及转换为 Tool 调用上下文
 * 返回需要预先调用的 Tool 名称和参数列表
 */
export function mentionsToToolCalls(mentions: ParsedMention[]): Array<{
  toolName: string
  args: Record<string, unknown>
}> {
  return mentions.map(m => {
    switch (m.target.type) {
      case 'architecture':
        return { toolName: 'read_architecture', args: {} }
      case 'character':
        return { toolName: 'read_characters', args: {} }
      case 'blueprint':
        return { toolName: 'read_blueprint', args: {} }
      case 'knowledge':
        return { toolName: 'search_knowledge', args: { query: '' } }
      case 'chapter':
        return { toolName: 'list_chapters', args: {} }
      case 'file':
        return { toolName: 'read_file', args: { file_path: m.target.value } }
      default:
        return { toolName: 'read_project_state', args: {} }
    }
  })
}
