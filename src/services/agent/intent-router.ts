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
export const READABLE_EXTS = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.csv'])

/** 从路径提取文件名（兼容 \ 与 / 分隔符） */
function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

/**
 * 截断绝对路径后的尾随文字。
 * 绝对路径正则允许空格（"C:\My Documents\笔记.md"），但路径后的
 * " 帮我看看"（空格+描述）也会被吞——用扩展名锚点截断：
 * 匹配"扩展名 + 空白 + 其余"→ 只保留扩展名前的路径。
 */
function trimPathTail(value: string): string {
  const exts = [...READABLE_EXTS, '.markdown'].map(e => e.slice(1)).join('|')
  const m = value.match(new RegExp(`^(.+?\\.(?:${exts}))\\s.*$`, 'i'))
  return m ? m[1] : value
}

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
 * 两阶段匹配：
 * 1. 绝对路径提及（项目外文件）——路径可含空格/括号/中文，以中文句读或行尾结束
 *    （不能用 \S+：`C:\My Documents\笔记.md` 会在空格处被截断）
 * 2. 通用提及——排除空格与常见中文标点（"@故事架构，" 不被吞标点导致失效）
 */
export function parseMentions(input: string): ParsedMention[] {
  const mentions: ParsedMention[] = []
  // 已占用的区间（绝对路径命中后，通用正则跳过，避免截断残留误匹配）
  const absSpans: Array<[number, number]> = []

  // ===== 阶段 1：项目外文件（绝对路径）=====
  // 排除 @：避免吞掉同一行后续的 @提及（"@C:\a.md 然后 @架构"）
  const absRegex = /@((?:[a-zA-Z]:[\\/]|\\\\)[^，。！？；：\r\n@]*)/g
  let match: RegExpExecArray | null = null
  while ((match = absRegex.exec(input)) !== null) {
    const value = trimPathTail(match[1])
    if (!value) continue
    const target: MentionTarget = {
      type: 'file',
      displayName: basename(value),
      value,
      icon: '📄',
      insertText: value,
    }
    mentions.push({ target, start: match.index, end: match.index + match[0].length })
    absSpans.push([match.index, match.index + match[0].length])
  }

  // ===== 阶段 2：通用提及（固定目标 / 项目内文件）=====
  const regex = /@([^\s，。！？；：、（）《》【】·—…""'']+)/g
  while ((match = regex.exec(input)) !== null) {
    // 命中在绝对路径区间内（@C:\My 之类被截断的残留）→ 跳过
    if (absSpans.some(([s, e]) => match!.index >= s && match!.index < e)) continue
    const value = match[1]
    const targets = getAllMentionTargets()
    // 精确匹配 value / displayName；若用户输入是 displayName 的前缀（输入法尚未完成）则跳过，
    // 仅在完整匹配时生效——避免"@故事"误匹配到不存在的目标
    const target = targets.find(t => t.value === value || t.displayName === value)
      ?? searchProjectFiles(value, 1)[0]  // 项目内文件：插入的是相对路径，按路径/文件名匹配回文件
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
