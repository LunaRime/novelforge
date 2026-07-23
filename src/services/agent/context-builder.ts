/**
 * Agent 智能上下文构建器
 *
 * 采用三级注入策略 + Token 预算管理：
 * - L0 始终注入（~800 token 预算）：项目名称/类型/进度/一句话大纲
 * - L1 编辑器感知（~600 token 预算）：当前打开的 Tab 信息
 * - L2 按需获取：通过 Tool 调用获取详细数据
 *
 * 系统提示词总上限 ~3000 tokens。
 */

import { useProjectStore } from '../../stores/project-store'
import { useEditorStore } from '../../stores/editor-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import type { AgentMode } from '../../stores/agent-store'
import { toolRegistry } from './tool-registry'
import { estimateTokens, truncateToTokenBudget } from './token-budget'

// ===== 上下文构建 =====

/**
 * 构建 Agent 系统提示词（含上下文和 Tool 描述）
 *
 * 所有部分都受 Token 预算约束。
 */
export function buildAgentSystemPrompt(mode: AgentMode): string {
  const sections: string[] = []

  // 1. Agent 身份与行为指导 (~400 tokens)
  sections.push(buildIdentityPrompt(mode))

  // 2. L0 — 始终注入的项目上下文 (~800 tokens 预算)
  const l0 = buildL0ProjectContext()
  if (l0) sections.push(l0)

  // 3. L1 — 编辑器感知上下文 (~600 tokens 预算)
  const l1 = buildL1EditorContext()
  if (l1) sections.push(l1)

  // 4. Tool 系统提示词 (~1200 tokens 预算)
  const toolPrompt = toolRegistry.generateToolPrompt()
  if (toolPrompt) {
    const truncated = truncateToTokenBudget(toolPrompt, 1200)
    sections.push(truncated)
  }

  const fullPrompt = sections.join('\n\n---\n\n')
  const totalTokens = estimateTokens(fullPrompt)

  // 如果总 token 超出 3500，按优先级裁剪
  if (totalTokens > 3500) {
    console.warn(
      `[ContextBuilder] 系统提示词过大 (${totalTokens} tokens)，按优先级裁剪`,
    )
    // 裁剪 L1 和 Tool 部分
    const l1Index = sections.findIndex(s => s.startsWith('## 编辑器状态'))
    if (l1Index >= 0) {
      sections[l1Index] = '## 编辑器状态\n（内容过长已省略，可使用 read_file 工具获取）'
    }
    const trimmed = sections.join('\n\n---\n\n')
    const trimmedTokens = estimateTokens(trimmed)
    if (trimmedTokens > 3500) {
      // 进一步裁剪 Tool 部分
      const toolIndex = sections.findIndex(s => s.startsWith('## 工具系统'))
      if (toolIndex >= 0 && sections[toolIndex].length > 500) {
        sections[toolIndex] = sections[toolIndex].slice(0, 500) + '\n\n…（工具列表已截断）'
      }
    }
    return sections.join('\n\n---\n\n')
  }

  return fullPrompt
}

// ===== 内部构建方法 =====

/** Agent 身份提示词 */
function buildIdentityPrompt(mode: AgentMode): string {
  const modeDesc = mode === 'planning'
    ? '当前处于 Planning 模式：你可以先规划再执行，适合复杂的多步骤任务。请先分析需求，制定方案，再逐步执行。'
    : '当前处于 Fast 模式：你直接高效地完成任务，适合简单快速的操作。'

  return `# NovelForge AI 创作助手

你是 NovelForge 智能创作助手，专注于帮助作家进行长篇小说创作。

${modeDesc}

## 核心能力
- 📖 深入理解小说项目的架构、人物、情节，提供专业的创作建议
- 🔍 通过工具调用主动获取项目数据（架构文件、角色卡、蓝图、草稿等）
- ✏️ 通过工具触发创作工作流（写稿、修稿、审计、定稿）
- 🧠 结合知识库做检索增强生成（RAG）

## 行为规范
- 使用中文回复
- 回答应当专业、具体、富有创意
- 主动使用工具获取所需信息，而非要求用户提供
- 对于写入型操作（修改文件、触发工作流），先说明你要做什么，再调用工具
- 如果需要多步操作，可以逐步调用多个工具`
}

/**
 * L0 — 始终注入的项目上下文
 * Token 预算：~800 tokens
 */
function buildL0ProjectContext(): string | null {
  const project = useProjectStore.getState().currentProject
  if (!project) return null

  const cfg = project.novelConfig
  const parts: string[] = [
    `## 当前项目上下文`,
    `项目名称：《${project.name}》`,
  ]

  if (cfg.genre) {
    parts.push(`类型：${cfg.genre}${cfg.subGenre ? ' · ' + cfg.subGenre : ''}`)
  }
  if (cfg.targetAudience) {
    parts.push(`目标读者：${cfg.targetAudience}`)
  }
  if (cfg.totalChapters) {
    parts.push(`计划章节数：${cfg.totalChapters} 章`)
  }
  if (cfg.wordsPerChapter) {
    parts.push(`每章字数：约 ${cfg.wordsPerChapter} 字`)
  }
  if (cfg.narrativePOV) {
    const povMap: Record<string, string> = {
      'third_limited': '第三人称有限',
      'first_person': '第一人称',
      'third_omniscient': '第三人称全知',
      'multi_pov': '多视角',
    }
    parts.push(`叙事视角：${povMap[cfg.narrativePOV] ?? cfg.narrativePOV}`)
  }
  if (cfg.coreOutline) {
    // Token 感知截断（~80 tokens 预算）
    const { text, truncated } = applyTokenTruncation(cfg.coreOutline, 80)
    parts.push(`核心大纲：${text}${truncated ? '…' : ''}`)
  }
  if (cfg.writingStyle) {
    // Token 感知截断（~40 tokens 预算）
    const { text, truncated } = applyTokenTruncation(cfg.writingStyle, 40)
    parts.push(`写作风格：${text}${truncated ? '…' : ''}`)
  }

  // 检查 L0 总预算
  const full = parts.join('\n')
  if (estimateTokens(full) > 800) {
    // 裁剪大纲和风格部分
    const trimmed = truncateToTokenBudget(full, 800)
    return trimmed
  }

  return full
}

/**
 * L1 — 编辑器感知上下文
 * Token 预算：~600 tokens
 */
function buildL1EditorContext(): string | null {
  const parts: string[] = []

  // 当前打开的编辑器 Tab
  const editorState = useEditorStore.getState()
  if (editorState.tabs.length > 0) {
    const activeTab = editorState.tabs.find(t => t.id === editorState.activeTabId)
    const tabSummaries = editorState.tabs.slice(0, 5).map(t => {
      const active = t.id === editorState.activeTabId ? ' [当前活跃]' : ''
      const dirty = t.dirty ? ' [未保存]' : ''
      return `  - ${t.name} (${t.type})${active}${dirty}`
    }).join('\n')

    let tabSection = `## 编辑器状态\n打开的文件：\n${tabSummaries}`
    if (editorState.tabs.length > 5) {
      tabSection += `\n  …（共 ${editorState.tabs.length} 个文件，仅展示前 5 个）`
    }
    parts.push(tabSection)

    // 如果当前活跃 Tab 有内容且不太长，注入内容摘要
    if (activeTab?.content && activeTab.content.length > 0) {
      // Token 感知截断（~120 tokens 预算）
      const { text, truncated } = applyTokenTruncation(activeTab.content, 120)
      if (truncated) {
        parts.push(`### 当前活跃文件内容\n文件名：${activeTab.name}\n\`\`\`\n${text}\n…（已截断，可通过 read_file 获取完整内容）\n\`\`\``)
      } else {
        parts.push(`### 当前活跃文件内容\n文件名：${activeTab.name}\n\`\`\`\n${text}\n\`\`\``)
      }
    }
  }

  // 当前工作流状态
  const workflowState = useWorkflowStore.getState()
  if (workflowState.hasActiveRun()) {
    const run = workflowState.currentRun
    if (run) {
      parts.push(`## 工作流状态\n当前有工作流正在运行：${run.title}（进度：${run.currentStepIndex + 1}/${run.steps.length}）`)
    }
  }

  if (parts.length === 0) return null

  const full = parts.join('\n\n')
  if (estimateTokens(full) > 600) {
    return truncateToTokenBudget(full, 600)
  }

  return full
}

// ===== Token 截断辅助 =====

/** Token 感知截断的结果 */
interface TruncationResult {
  text: string
  truncated: boolean
  tokensUsed: number
}

/**
 * 在预算内截断文本，返回截断结果。
 * 统一所有上下文构建中的截断逻辑。
 */
function applyTokenTruncation(text: string, maxTokens: number): TruncationResult {
  const tokens = estimateTokens(text)
  if (tokens <= maxTokens) {
    return { text, truncated: false, tokensUsed: tokens }
  }
  const truncated = truncateToTokenBudget(text, maxTokens)
  return {
    text: truncated,
    truncated: truncated.length < text.length,
    tokensUsed: estimateTokens(truncated),
  }
}
