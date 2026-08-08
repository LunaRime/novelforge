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
import { t, getCurrentLocale } from '../../shared/locale'
import { appendOutputLanguage } from '../prompt-templates'
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
    // 截断发生在头部预算内时，补一份完整工具名清单，避免列表靠后的工具（含写入类）对 Agent 不可见
    const isTruncated = truncated.length < toolPrompt.length
    sections.push(isTruncated
      ? `${truncated}\n\n${t('engine.toolTruncatedNotice').replace('{tools}', toolRegistry.listAll().map(tool => tool.name).join(', '))}`
      : truncated)
  }

  const fullPrompt = sections.join('\n\n---\n\n')
  const totalTokens = estimateTokens(fullPrompt)

  // 如果总 token 超出 3500，按优先级裁剪
  if (totalTokens > 3500) {
    console.warn(
      `[ContextBuilder] 系统提示词过大 (${totalTokens} tokens)，按优先级裁剪`,
    )
    // 裁剪 L1 和 Tool 部分
    const l1Index = sections.findIndex(s => s.startsWith(t('engine.contextEditorHeader')))
    if (l1Index >= 0) {
      sections[l1Index] = `${t('engine.contextEditorHeader')}\n${t('engine.contextEditorOmitted')}`
    }
    const trimmed = sections.join('\n\n---\n\n')
    const trimmedTokens = estimateTokens(trimmed)
    if (trimmedTokens > 3500) {
      // 进一步裁剪 Tool 部分
      const toolIndex = sections.findIndex(s => s.startsWith(t('engine.toolSystemTitle')))
      if (toolIndex >= 0 && sections[toolIndex].length > 500) {
        sections[toolIndex] = sections[toolIndex].slice(0, 500) + '\n\n…' + t('engine.toolListTruncated')
      }
    }
    return appendOutputLanguage(sections.join('\n\n---\n\n'), getCurrentLocale())
  }

  // #30：末尾追加明确输出语言约束（此前仅 identityRuleLanguage 弱约束
  // "Reply in the user's language" 不指明具体语言，英文界面下 Agent 仍回中文）
  return appendOutputLanguage(fullPrompt, getCurrentLocale())
}

// ===== 内部构建方法 =====

/** Agent 身份提示词 */
function buildIdentityPrompt(mode: AgentMode): string {
  const modeDesc = mode === 'max'
    ? t('engine.modeMax')
    : mode === 'deep'
      ? t('engine.modeDeep')
      : mode === 'reflective'
        ? t('engine.modeReflective')
        : mode === 'balanced'
          ? t('engine.modeBalanced')
          : mode === 'swift'
            ? t('engine.modeSwift')
            : t('engine.modeQuick')

  return `${t('engine.identityTitle')}

${t('engine.identityIntro')}

${modeDesc}

${t('engine.identityCapabilitiesHeader')}
${t('engine.identityCapabilityArchitecture')}
${t('engine.identityCapabilityTools')}
${t('engine.identityCapabilityWorkflows')}
${t('engine.identityCapabilityRag')}

${t('engine.identityRulesHeader')}
${t('engine.identityRuleLanguage')}
${t('engine.identityRuleProfessional')}
${t('engine.identityRuleUseTools')}
${t('engine.identityRuleExplainWriteOps')}
${t('engine.identityRuleMultiStep')}`
}

/**
 * L0 — 始终注入的项目上下文
 * Token 预算：~800 tokens
 */
function buildL0ProjectContext(): string | null {
  const project = useProjectStore.getState().currentProject
  if (!project) return null

  // 旧项目数据库可能缺 novelConfig（类型上非可选），运行时兜底避免崩溃
  const cfg = project.novelConfig ?? {}
  const parts: string[] = [
    t('engine.contextProjectHeader'),
    t('engine.contextProjectName').replace('{name}', project.name),
  ]

  if (cfg.genre) {
    parts.push(`${t('engine.contextGenre').replace('{genre}', cfg.genre)}${cfg.subGenre ? ' · ' + cfg.subGenre : ''}`)
  }
  if (cfg.targetAudience) {
    parts.push(t('engine.contextTargetAudience').replace('{audience}', cfg.targetAudience))
  }
  if (cfg.totalChapters) {
    parts.push(t('engine.contextTotalChapters').replace('{n}', String(cfg.totalChapters)))
  }
  if (cfg.wordsPerChapter) {
    parts.push(t('engine.contextWordsPerChapter').replace('{n}', String(cfg.wordsPerChapter)))
  }
  if (cfg.narrativePOV) {
    const povMap: Record<string, string> = {
      'third_limited': t('engine.povThirdLimited'),
      'first_person': t('engine.povFirstPerson'),
      'third_omniscient': t('engine.povThirdOmniscient'),
      'multi_pov': t('engine.povMulti'),
    }
    parts.push(t('engine.contextPov').replace('{pov}', povMap[cfg.narrativePOV] ?? cfg.narrativePOV))
  }
  if (cfg.coreOutline) {
    // Token 感知截断（~80 tokens 预算）
    const { text, truncated } = applyTokenTruncation(cfg.coreOutline, 80)
    parts.push(`${t('engine.contextCoreOutline').replace('{text}', text)}${truncated ? t('engine.truncatedHint') : ''}`)
  }
  if (cfg.writingStyle) {
    // Token 感知截断（~40 tokens 预算）
    const { text, truncated } = applyTokenTruncation(cfg.writingStyle, 40)
    parts.push(`${t('engine.contextWritingStyle').replace('{text}', text)}${truncated ? t('engine.truncatedHint') : ''}`)
  }

  // 检查 L0 总预算
  const full = parts.join('\n')
  if (estimateTokens(full) > 800) {
    // 裁剪大纲和风格部分（⚠️ 低风险修复：追加截断提示——模型曾把截断后的配置当完整内容回答）
    const trimmed = truncateToTokenBudget(full, 800)
    return trimmed + t('engine.truncatedHint')
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
    const activeTab = editorState.tabs.find(tab => tab.id === editorState.activeTabId)
    const tabSummaries = editorState.tabs.slice(0, 5).map(tab => {
      const active = tab.id === editorState.activeTabId ? t('engine.contextTabActive') : ''
      const dirty = tab.dirty ? t('engine.contextTabDirty') : ''
      return `  - ${tab.name} (${tab.type})${active}${dirty}`
    }).join('\n')

    let tabSection = `${t('engine.contextEditorHeader')}\n${t('engine.contextEditorOpenFiles')}\n${tabSummaries}`
    if (editorState.tabs.length > 5) {
      tabSection += `\n  …${t('engine.contextTabsMore').replace('{n}', String(editorState.tabs.length))}`
    }
    parts.push(tabSection)

    // 如果当前活跃 Tab 有内容且不太长，注入内容摘要
    if (activeTab?.content && activeTab.content.length > 0) {
      // Token 感知截断（~120 tokens 预算）
      const { text, truncated } = applyTokenTruncation(activeTab.content, 120)
      const fileHeader = `${t('engine.contextActiveFileHeader')}\n${t('engine.contextActiveFileName').replace('{name}', activeTab.name)}`
      if (truncated) {
        parts.push(`${fileHeader}\n\`\`\`\n${text}\n${t('engine.contextActiveFileTruncated')}\n\`\`\``)
      } else {
        parts.push(`${fileHeader}\n\`\`\`\n${text}\n\`\`\``)
      }
    }
  }

  // 当前工作流状态
  const workflowState = useWorkflowStore.getState()
  if (workflowState.hasActiveRun()) {
    const run = workflowState.currentRun
    if (run) {
      parts.push(`${t('engine.contextWorkflowHeader')}\n${t('engine.contextWorkflowRunning').replace('{title}', run.title).replace('{progress}', `${run.currentStepIndex + 1}/${run.steps.length}`)}`)
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
