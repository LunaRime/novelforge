/**
 * NovelForge Agent Tool 注册表
 *
 * 统一管理所有 Agent 可调用的工具（内置 Tool / MCP Tool / Skill Tool）。
 * 参考 Claude Code 的 Tool 系统设计，但针对小说创作场景做了精简。
 *
 * 设计要点：
 * 1. 统一的 AgentTool 接口 — 无论来源，Agent Engine 只看到这一个接口
 * 2. requiresConfirmation 字段控制安全性 — 只读工具自动执行，写入工具需用户确认
 * 3. source 字段标识来源 — 方便 UI 渲染不同的视觉标记
 */

import { t } from '../../shared/locale'

// ===== JSON Schema 简化类型 =====

/** 简化的 JSON Schema 描述（用于 Tool 参数定义） */
export interface ToolInputSchema {
  type: 'object'
  properties: Record<string, {
    type: string
    description: string
    enum?: string[]
    default?: unknown
  }>
  required?: string[]
}

// ===== Tool 执行结果 =====

/** Tool 执行产物（Agent 创建/修改的文件等） */
export interface ToolArtifact {
  type:
    | 'file_created'
    | 'file_modified'
    | 'workflow_started'
    | 'tab_opened'
    // 新增产物类型
    | 'blueprint_generated'
    | 'draft_generated'
    | 'review_completed'
    | 'character_extracted'
    | 'summary_updated'
    | 'verification_report'
    | 'embedding_indexed'
    | 'mutual_review_completed'
  /** 文件路径或资源标识 */
  path?: string
  /** 显示名称 */
  name: string
  /** 单行摘要（UI 快速预览） */
  summary?: string
  /** 结构化元数据 */
  metadata?: Record<string, unknown>
  /** 创建时间戳 */
  timestamp?: number
}

/** Tool 执行结果 */
export interface ToolResult {
  /** 是否执行成功 */
  success: boolean
  /** 文本结果（注入回 Agent 的对话上下文） */
  content: string
  /** 执行产物列表（可选） */
  artifacts?: ToolArtifact[]
  /** 错误信息（失败时） */
  error?: string
}

// ===== Tool 定义 =====

/** Tool 来源分类 */
export type ToolSource = 'builtin' | 'mcp' | 'skill'

/** Agent Tool 接口 — 所有种类的 Tool 都实现此接口 */
export interface AgentTool {
  /** 唯一标识符（MCP Tool 使用 mcp__serverId__toolName 命名空间） */
  name: string
  /** Tool 用途描述（Agent 凭此决定何时调用） */
  description: string
  /** 来源分类 — 影响 UI 渲染风格 */
  source: ToolSource
  /** 参数 JSON Schema */
  inputSchema: ToolInputSchema
  /** 是否需要用户确认后才执行（写入型操作 = true） */
  requiresConfirmation: boolean
  /** 是否为只读操作 */
  isReadOnly: boolean
  /** 执行函数 */
  execute: (args: Record<string, unknown>) => Promise<ToolResult>
  /** 可选的用户友好名称（UI 显示用，比 name 更可读） */
  userFacingName?: string
}

// ===== Tool 注册表 =====

/**
 * Tool 注册表 — 管理所有可用 Tool 的中央注册中心
 *
 * 支持：
 * - 注册/注销 Tool（支持动态注册 MCP Tool）
 * - 按名称查找 Tool
 * - 列出所有可用 Tool
 * - 生成 Tool 描述（注入系统提示词）
 */
class ToolRegistryImpl {
  private tools: Map<string, AgentTool> = new Map()

  /** 注册一个 Tool */
  register(tool: AgentTool): void {
    if (this.tools.has(tool.name)) {
      console.warn(`[ToolRegistry] Tool "${tool.name}" 已注册，将被覆盖`)
    }
    this.tools.set(tool.name, tool)
  }

  /** 批量注册 Tool */
  registerAll(tools: AgentTool[]): void {
    for (const tool of tools) {
      this.register(tool)
    }
  }

  /** 注销一个 Tool */
  unregister(name: string): boolean {
    return this.tools.delete(name)
  }

  /** 注销某个来源的所有 Tool（例如 MCP 断开连接时） */
  unregisterBySource(source: ToolSource): number {
    let count = 0
    for (const [name, tool] of this.tools) {
      if (tool.source === source) {
        this.tools.delete(name)
        count++
      }
    }
    return count
  }

  /** 按名称查找 Tool */
  get(name: string): AgentTool | undefined {
    return this.tools.get(name)
  }

  /** 列出所有已注册的 Tool */
  listAll(): AgentTool[] {
    return Array.from(this.tools.values())
  }

  /** 按来源列出 Tool */
  listBySource(source: ToolSource): AgentTool[] {
    return this.listAll().filter(t => t.source === source)
  }

  /** 获取已注册 Tool 数量 */
  get size(): number {
    return this.tools.size
  }

  /**
   * 生成所有 Tool 的系统提示词描述
   *
   * 格式：
   * ```
   * ## 可用工具
   * 当你需要获取项目数据或执行操作时，使用以下格式调用工具：
   * <tool_call>
   * {"name": "tool_name", "arguments": {"key": "value"}}
   * </tool_call>
   *
   * ### read_file
   * 读取项目内的文件内容
   * 参数：
   * - file_path (string, 必填): 相对于项目根目录的文件路径
   * ```
   */
  generateToolPrompt(): string {
    const tools = this.listAll()
    if (tools.length === 0) return ''

    let prompt = `${t('engine.toolSystemTitle')}\n\n${t('engine.toolSystemBody')}\n\n`
    for (const tool of tools) {
      const displayName = tool.userFacingName ?? tool.name
      const sourceTag = tool.source === 'mcp' ? ' [MCP]' : tool.source === 'skill' ? ' [Skill]' : ''
      const confirmTag = tool.requiresConfirmation ? t('engine.toolConfirmTag') : ''

      prompt += `#### ${displayName}${sourceTag}${confirmTag}\n`
      prompt += `${tool.description}\n`

      // 生成参数说明
      const { properties, required = [] } = tool.inputSchema
      if (Object.keys(properties).length > 0) {
        prompt += `${t('engine.toolParamHeader')}\n`
        for (const [key, schema] of Object.entries(properties)) {
          const isRequired = required.includes(key)
          const reqTag = isRequired ? t('engine.toolRequired') : t('engine.toolOptional')
          let paramDesc = `- ${key} (${schema.type}, ${reqTag}): ${schema.description}`
          if (schema.enum) {
            paramDesc += t('engine.toolEnumValues').replace('{values}', schema.enum.join(', '))
          }
          if (schema.default !== undefined) {
            paramDesc += t('engine.toolDefault').replace('{value}', JSON.stringify(schema.default))
          }
          prompt += paramDesc + '\n'
        }
      }
      prompt += '\n'
    }

    return prompt
  }

  /** 清空所有 Tool（用于重置状态） */
  clear(): void {
    this.tools.clear()
  }
}

/** 全局单例 Tool 注册表 */
export const toolRegistry = new ToolRegistryImpl()

// ===== 工具函数：创建 Tool 的便捷方法 =====

/**
 * buildAgentTool — 创建 Agent Tool 的便捷方法（参考 Claude Code 的 buildTool）
 *
 * 提供合理的默认值，减少样板代码。
 */
export function buildAgentTool(
  def: Omit<AgentTool, 'isReadOnly'> & { isReadOnly?: boolean }
): AgentTool {
  return {
    isReadOnly: !def.requiresConfirmation,
    ...def,
  }
}
