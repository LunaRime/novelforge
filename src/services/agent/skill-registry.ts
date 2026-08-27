/**
 * Skill 注册中心
 *
 * 管理所有可用的 Skill（基于 SKILL.md 的模块化知识包）。
 * 支持：
 * - 内置 Skill（随 NovelForge 发布的预设 Skill）
 * - 用户 Skill（用户放在 ~/.novelforge/skills/ 下的自定义 Skill）
 * - 项目 Skill（放在项目的 .novelforge/skills/ 下的项目级 Skill）
 *
 * Skill 格式兼容 Cursor 的 SKILL.md 生态。
 */

import { ipc } from '../ipc-client'
import { useProjectStore } from '../../stores/project-store'
import { toolRegistry, type AgentTool } from './tool-registry'
import { t } from '../../shared/locale'
import { DIR_VELA_INTERNAL } from '../../shared/project-paths'

// ===== 类型定义 =====

/** Skill 来源 */
export type SkillSource = 'builtin' | 'user' | 'project'

/** Skill 元数据（从 SKILL.md frontmatter 解析） */
export interface SkillMetadata {
  /** Skill 唯一名称 */
  name: string
  /** 显示名称 */
  displayName?: string
  /** 功能描述 */
  description: string
  /** 使用场景（用于 Agent 自动匹配） */
  whenToUse?: string
  /** 版本 */
  version?: string
  /** 允许的工具列表（白名单） */
  allowedTools?: string[]
  /** 参数提示 */
  argumentHint?: string
  /** 是否可由模型自动调用 */
  userInvocable?: boolean
}

/** 加载后的 Skill */
export interface LoadedSkill {
  /** 元数据 */
  metadata: SkillMetadata
  /** Skill 内容（Markdown 提示词） */
  content: string
  /** 来源 */
  source: SkillSource
  /** 文件所在目录 */
  baseDir: string
  /** SKILL.md 文件路径 */
  filePath: string
}

// ===== Skill Registry =====

class SkillRegistryImpl {
  private skills: Map<string, LoadedSkill> = new Map()

  /** 注册一个 Skill */
  register(skill: LoadedSkill): void {
    this.skills.set(skill.metadata.name, skill)
  }

  /** 查找 Skill */
  get(name: string): LoadedSkill | undefined {
    return this.skills.get(name)
  }

  /** 列出所有 Skill */
  listAll(): LoadedSkill[] {
    return Array.from(this.skills.values())
  }

  /** 按来源列出 */
  listBySource(source: SkillSource): LoadedSkill[] {
    return this.listAll().filter(s => s.source === source)
  }

  /** Skill 数量 */
  get size(): number {
    return this.skills.size
  }

  /** 清空 */
  clear(): void {
    this.skills.clear()
  }

  /**
   * 从目录加载 Skills
   *
   * 扫描指定目录下的 skill-name/SKILL.md 格式
   */
  async loadFromDirectory(dir: string, source: SkillSource): Promise<number> {
    let count = 0
    try {
      const entries = await ipc.invoke('fs:list-dir', dir)
      for (const entry of entries) {
        if (!entry.isDir) continue

        const skillFile = `${entry.path}/SKILL.md`
        try {
          const exists = await ipc.invoke('fs:check-exists', skillFile)
          if (!exists) continue

          const result = await ipc.invoke('fs:read-file', skillFile)
          if (!result.success) continue

          const skill = parseSkillMd(result.content, entry.name, source, entry.path, skillFile)
          if (skill) {
            this.register(skill)
            count++
          }
        } catch {
          // 单个 Skill 加载失败不影响整体
        }
      }
    } catch {
      // 目录不存在等情况，静默处理
    }
    return count
  }

  /**
   * 加载所有 Skill（内置 + 用户 + 项目）
   */
  async loadAll(): Promise<void> {
    this.clear()

    // 注册内置 Skill
    registerBuiltinSkills(this)

    // 加载用户 Skill（~/.novelforge/skills/）
    try {
      const velaHome = await ipc.invoke('config:get-vela-home')
      const userSkillsDir = `${velaHome}/skills`
      const userCount = await this.loadFromDirectory(userSkillsDir, 'user')
      if (userCount > 0) {
        console.log(`[Skills] 加载了 ${userCount} 个用户 Skill`)
      }
    } catch {
      // 静默处理
    }

    // 加载项目 Skill（项目/.novelforge/skills/）
    const project = useProjectStore.getState().currentProject
    if (project) {
      const projectSkillsDir = `${project.path}/${DIR_VELA_INTERNAL}/skills`
      const projectCount = await this.loadFromDirectory(projectSkillsDir, 'project')
      if (projectCount > 0) {
        console.log(`[Skills] 加载了 ${projectCount} 个项目 Skill`)
      }
    }

    // 将所有 Skill 注册为 Agent Tool
    this.registerToToolRegistry()

    console.log(`[Skills] 共加载 ${this.size} 个 Skill`)
  }

  /**
   * 将 Skill 注册为 Agent Tool
   */
  private registerToToolRegistry(): void {
    // 先清理旧的 Skill Tool
    toolRegistry.unregisterBySource('skill')

    for (const skill of this.listAll()) {
      // allowedTools 白名单提示：SKILL.md frontmatter 声明的工具约束注入描述
      // （此前解析后从未执行——LLM 加载技能后仍可调全部工具；至少以提示约束收窄）
      const allowedHint = skill.metadata.allowedTools?.length
        ? ` — ${t('skill.allowedToolsHint')}: ${skill.metadata.allowedTools.join(', ')}`
        : ''
      const agentTool: AgentTool = {
        name: `skill__${skill.metadata.name}`,
        description: skill.metadata.description
          + (skill.metadata.whenToUse ? ` — ${skill.metadata.whenToUse}` : '')
          + allowedHint,
        source: 'skill',
        inputSchema: {
          type: 'object',
          properties: {
            args: {
              type: 'string',
              description: skill.metadata.argumentHint ?? t('skill.optionalArgs'),
            },
          },
        },
        requiresConfirmation: false,
        isReadOnly: true,
        userFacingName: skill.metadata.displayName ?? skill.metadata.name,
        execute: async (toolArgs) => {
          const userArgs = (toolArgs.args as string) ?? ''
          // 变量替换
          let content = skill.content
          if (userArgs) {
            content = content.replace(/\$\{args\}/g, userArgs)
            content = content.replace(/\$1/g, userArgs)
          }
          content = content.replace(/\$\{SKILL_DIR\}/g, skill.baseDir)

          return {
            success: true,
            content: `[Skill: ${skill.metadata.displayName ?? skill.metadata.name}]\n\n${content}`,
          }
        },
      }
      toolRegistry.register(agentTool)
    }
  }
}

/** 全局 Skill 注册中心 */
export const skillRegistry = new SkillRegistryImpl()

// ===== SKILL.md 解析 =====

/**
 * 解析 SKILL.md 文件内容
 *
 * 格式：
 * ```
 * ---
 * name: skill-name
 * description: 功能描述
 * when_to_use: 什么时候使用
 * allowed-tools: [read_file, search_knowledge]
 * ---
 *
 * # Skill 提示词内容
 * ...
 * ```
 */
function parseSkillMd(
  raw: string,
  fallbackName: string,
  source: SkillSource,
  baseDir: string,
  filePath: string,
): LoadedSkill | null {
  // 解析 frontmatter
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n/)
  const frontmatter: Record<string, unknown> = {}
  let content = raw

  if (fmMatch) {
    const fmText = fmMatch[1]
    content = raw.slice(fmMatch[0].length)

    // 简单的 YAML 解析（支持 key: value 和 key: [items]）
    for (const line of fmText.split('\n')) {
      const kvMatch = line.match(/^\s*([^:]+):\s*(.*)$/)
      if (!kvMatch) continue
      const key = kvMatch[1].trim()
      let val: unknown = kvMatch[2].trim()

      // 解析数组 [a, b, c]
      if (typeof val === 'string' && val.startsWith('[') && val.endsWith(']')) {
        val = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean)
      }
      // 解析布尔值
      if (val === 'true') val = true
      if (val === 'false') val = false

      frontmatter[key] = val
    }
  }

  const metadata: SkillMetadata = {
    name: (frontmatter['name'] as string) || fallbackName,
    displayName: frontmatter['display_name'] as string,
    description: (frontmatter['description'] as string) || `Skill: ${fallbackName}`,
    whenToUse: frontmatter['when_to_use'] as string,
    version: frontmatter['version'] as string,
    allowedTools: frontmatter['allowed-tools'] as string[],
    argumentHint: frontmatter['argument-hint'] as string,
    userInvocable: frontmatter['user-invocable'] !== false,
  }

  return {
    metadata,
    content: content.trim(),
    source,
    baseDir,
    filePath,
  }
}

// ===== 内置 Skills =====

function registerBuiltinSkills(registry: SkillRegistryImpl): void {
  const builtins: Array<{ metadata: SkillMetadata; content: string }> = [
    {
      metadata: {
        name: 'review-chapter',
        displayName: t('skill.chapterReview'),
        description: t('skill.chapterReviewDesc'),
        whenToUse: t('skill.chapterReviewUse'),
      },
      content: t('skillContent.review-chapter'),
    },
    {
      metadata: {
        name: 'brainstorm',
        displayName: t('skill.brainstorm'),
        description: t('skill.brainstormDesc'),
        whenToUse: t('skill.brainstormUse'),
      },
      content: t('skillContent.brainstorm'),
    },
    {
      metadata: {
        name: 'character-analysis',
        displayName: t('skill.characterAnalysis'),
        description: t('skill.characterAnalysisDesc'),
        whenToUse: t('skill.characterAnalysisUse'),
      },
      content: t('skillContent.character-analysis'),
    },
    {
      metadata: {
        name: 'continuity-check',
        displayName: t('skill.continuityCheck'),
        description: t('skill.continuityCheckDesc'),
        whenToUse: t('skill.continuityCheckUse'),
      },
      content: t('skillContent.continuity-check'),
    },
    {
      metadata: {
        name: 'writing-coach',
        displayName: t('skill.writingCoach'),
        description: t('skill.writingCoachDesc'),
        whenToUse: t('skill.writingCoachUse'),
      },
      content: t('skillContent.writing-coach'),
    },

    // ================================================================
    // ★ 新增 — 小说创作专用 Skills（v2.2）
    // ================================================================

    {
      metadata: {
        name: 'novel-outline',
        displayName: t('skill.outlineArchitect'),
        description: t('skill.outlineArchitectDesc'),
        whenToUse: t('skill.outlineArchitectUse'),
      },
      content: t('skillContent.novel-outline'),
    },
    {
      metadata: {
        name: 'chapter-architect',
        displayName: t('skill.chapterArchitect'),
        description: t('skill.chapterArchitectDesc'),
        whenToUse: t('skill.chapterArchitectUse'),
      },
      content: t('skillContent.chapter-architect'),
    },
    {
      metadata: {
        name: 'dialogue-craft',
        displayName: t('skill.dialogueCraft'),
        description: t('skill.dialogueCraftDesc'),
        whenToUse: t('skill.dialogueCraftUse'),
      },
      content: t('skillContent.dialogue-craft'),
    },
    {
      metadata: {
        name: 'description-master',
        displayName: t('skill.descriptionMaster'),
        description: t('skill.descriptionMasterDesc'),
        whenToUse: t('skill.descriptionMasterUse'),
      },
      content: t('skillContent.description-master'),
    },
    {
      metadata: {
        name: 'plot-weaver',
        displayName: t('skill.plotWeaver'),
        description: t('skill.plotWeaverDesc'),
        whenToUse: t('skill.plotWeaverUse'),
      },
      content: t('skillContent.plot-weaver'),
    },
    {
      metadata: {
        name: 'pacing-conductor',
        displayName: t('skill.paceDirector'),
        description: t('skill.paceDirectorDesc'),
        whenToUse: t('skill.paceDirectorUse'),
      },
      content: t('skillContent.pacing-conductor'),
    },
    {
      metadata: {
        name: 'world-forge',
        displayName: t('skill.worldForge'),
        description: t('skill.worldForgeDesc'),
        whenToUse: t('skill.worldForgeUse'),
      },
      content: t('skillContent.world-forge'),
    },
    {
      metadata: {
        name: 'character-arc-designer',
        displayName: t('skill.characterArc'),
        description: t('skill.characterArcDesc'),
        whenToUse: t('skill.characterArcUse'),
      },
      content: t('skillContent.character-arc-designer'),
    },
    {
      metadata: {
        name: 'json-output-guard',
        displayName: t('skill.jsonGuard'),
        description: t('skill.jsonGuardDesc'),
        whenToUse: t('skill.jsonGuardUse'),
        allowedTools: [],
      },
      content: t('skillContent.json-output-guard'),
    },
    {
      metadata: {
        name: 'self-review',
        displayName: t('skill.selfAudit'),
        description: t('skill.selfAuditDesc'),
        whenToUse: t('skill.selfAuditUse'),
      },
      content: t('skillContent.self-review'),
    },
    {
      metadata: {
        name: 'genre-compliance',
        displayName: t('skill.genreCompliance'),
        description: t('skill.genreComplianceDesc'),
        whenToUse: t('skill.genreComplianceUse'),
      },
      content: t('skillContent.genre-compliance'),
    },
    {
      metadata: {
        name: 'chapter-hook-designer',
        displayName: t('skill.hookDesigner'),
        description: t('skill.hookDesignerDesc'),
        whenToUse: t('skill.hookDesignerUse'),
      },
      content: t('skillContent.chapter-hook-designer'),
    },
  ]

  for (const { metadata, content } of builtins) {
    registry.register({
      metadata,
      content,
      source: 'builtin',
      baseDir: '',
      filePath: `builtin://${metadata.name}`,
    })
  }
}
