/**
 * Agent 核心引擎 — ReAct（Reasoning + Acting）循环
 *
 * 这是 Agent 的大脑，负责：
 * 1. 将用户消息、系统提示、Tool 描述组装为 LLM 输入
 * 2. 解析 LLM 输出中的 <tool_call> 标签
 * 3. 执行 Tool 并将结果注入为 observation
 * 4. 循环直到 LLM 不再调用 Tool 或达到最大循环次数
 *
 * 参考 Claude Code 的 query.ts 和 QueryEngine 设计，
 * 但简化为 NovelForge 的 Electron + React 架构。
 */

import { t } from '../../shared/locale'
import { toolRegistry, type ToolResult, type ToolArtifact } from './tool-registry'
import { outputPostProcessor } from './output-post-processor'
import { ProgressTracker, type AgentProgress } from './progress-tracker'
import { estimateTokens, truncateToTokenBudget } from './token-budget'

// ===== 常量 =====

/** ReAct 循环最大次数（防止死循环） */
const MAX_TOOL_ROUNDS = 8

/** Tool 执行超时（毫秒） */
const TOOL_TIMEOUT_MS = 30_000

/** Tool 返回内容最大 Token 数（read-file.tool 的 READ_MAX_CHARS 按此校准，见其锁定用例） */
export const TOOL_RESULT_MAX_TOKENS = 800

/** 默认消息压缩预算（无模型窗口信息 / 小窗口模型）——与既有行为一致 */
const DEFAULT_MESSAGE_BUDGET_TOKENS = 16_000
/** 动态预算工程上限（128k 窗口模型也不无限放大——成本/延迟裁决） */
const MAX_MESSAGE_BUDGET_TOKENS = 32_000
/** 动态预算输出空间预留（对话单次输出通常 <2k，4k 保守） */
const OUTPUT_RESERVE_TOKENS = 4_000
/** 启用动态预算的最小模型窗口（小窗口模型压缩语义不变——压缩是成本控制非防超窗） */
const MIN_DYNAMIC_WINDOW_TOKENS = 16_000
/** 恢复阶梯降档预算下限（对话质量底线） */
const MIN_RECOVERY_BUDGET_TOKENS = 8_000
/** 连续可恢复失败熔断阈值（CC 遥测 MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES=3 简化） */
const MAX_CONSECUTIVE_RECOVERY_FAILURES = 3

/** 写盘引用摘要上限（tokens）——路径+摘要合计 ≤ ~250 tokens，远小于 800 截断注入 */
const RESULT_SUMMARY_MAX_TOKENS = 200
/** 写盘内容上限（字符）——超出回退截断注入（read_file 再读受 fs:read-external-file 1MB 限制） */
const MAX_SPILL_CHARS = 512 * 1024

// ===== 类型 =====

/** Tool 调用信息 */
export interface ToolCallInfo {
  id: string
  toolName: string
  arguments: Record<string, unknown>
  status: 'pending' | 'running' | 'completed' | 'failed' | 'waiting_confirm'
  result?: string
  error?: string
  /** Tool 来源标记 */
  source?: string
}

/** Agent Engine 回调 */
export interface AgentEngineCallbacks {
  /** 流式文本片段 */
  onTextChunk: (chunk: string) => void
  /** Tool 调用开始 */
  onToolCallStart: (toolCall: ToolCallInfo) => void
  /** Tool 调用完成 */
  onToolCallComplete: (toolCall: ToolCallInfo) => void
  /** Tool 需要用户确认 */
  onToolCallConfirmRequired: (toolCall: ToolCallInfo) => Promise<boolean>
  /** 进度更新 */
  onProgress?: (progress: AgentProgress) => void
  /** 全部完成 */
  onDone: (fullText: string, toolCalls: ToolCallInfo[], artifacts: ToolArtifact[]) => void
  /** 错误 */
  onError: (error: string) => void
}

/** 引擎依赖注入（保持 agent-engine 无 electron 依赖可单测；agent-store 注入真实 IPC 实现） */
export interface AgentEngineDeps {
  /** 长工具结果写盘（>800 tokens 落盘引用；失败返回 success:false 时引擎回退截断注入） */
  writeResult?: (content: string) => Promise<{ success: boolean; path?: string; error?: string }>
}

/** Agent 引擎选项（D6/D7：动态压缩预算等） */
export interface AgentEngineOptions {
  /** 模型上下文窗口（tokens，来自 ModelProfile.maxTokens）；用于动态压缩预算（Task D7-1 消费） */
  modelContextWindow?: number
}

/** LLM 消息格式 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** LLM 生成函数签名（由 agent-store 提供实际实现）
 * 第三个参数 onChunk：可选流式回调。若提供且被调用，引擎将不再重复推送文本
 * （流式已实时显示），但 fullAssistantText 仍从返回的完整文本拼接。
 */
export type LLMGenerateFn = (
  messages: LLMMessage[],
  modelId: string,
  onChunk?: (chunk: string) => void,
) => Promise<string>

// ===== 核心引擎 =====

/**
 * 执行 Agent ReAct 循环
 *
 * 流程：
 * 1. 将系统提示（含 Tool 描述）+ 历史消息 + 用户消息发送给 LLM
 * 2. 解析 LLM 回复中的 <tool_call> 标签
 * 3. 如果有 tool_call → 执行 Tool → 将结果作为 observation 追加到消息历史 → 重新调用 LLM
 * 4. 循环直到 LLM 不再调用 Tool 或达到 MAX_TOOL_ROUNDS
 * 5. 返回最终文本回复
 */
export async function runAgentLoop(
  systemPrompt: string,
  historyMessages: LLMMessage[],
  userMessage: string,
  modelId: string,
  generateFn: LLMGenerateFn,
  callbacks: AgentEngineCallbacks,
  abortSignal?: AbortSignal,
  options?: AgentEngineOptions, // 动态压缩预算：modelContextWindow（Task D7-1）
  deps?: AgentEngineDeps,
): Promise<void> {
  const allToolCalls: ToolCallInfo[] = []
  const allArtifacts: ToolArtifact[] = []

  // 构建消息列表
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    ...historyMessages,
    { role: 'user', content: userMessage },
  ]

  // 初始化进度追踪
  const progress = new ProgressTracker()
  progress.start(MAX_TOOL_ROUNDS)

  let rounds = 0
  let fullAssistantText = ''

  // 恢复阶梯状态（withhold-then-recover，P0-2）：可恢复错误先恢复后放行；
  // 单次调用生命周期（跨调用持久化 deferred）；重试消耗 rounds 计数（最多 3 round，MAX=8 仍剩 5 轮工具循环）
  type RecoveryStage = 'none' | 'compacting' | 'meta-injected'
  let recoveryStage: RecoveryStage = 'none'
  let consecutiveRecoveryFailures = 0
  let currentBudget = computeMessageBudget(options?.modelContextWindow)

  while (rounds < MAX_TOOL_ROUNDS) {
    // 检查中止信号
    if (abortSignal?.aborted) {
      callbacks.onDone(fullAssistantText + '\n\n_' + t('agent.stoppedGenerating') + '_', allToolCalls, allArtifacts)
      return
    }

    rounds++

    // 调用 LLM（支持流式：onChunk 实时推送文本，引擎收到流式文本后不再重复输出）
    // 发送前按当前预算压缩消息副本（完整 messages 仍保留给后处理使用）
    let budgetedMessages = compressMessagesToBudget(messages, currentBudget)
    let llmResponse: string
    let streamed = false
    try {
      llmResponse = await generateFn(budgetedMessages, modelId, (chunk) => {
        streamed = true
        callbacks.onTextChunk(chunk)
      })
      // 调用成功：恢复计数清零、预算复原（下次调用生效）
      consecutiveRecoveryFailures = 0
      recoveryStage = 'none'
      currentBudget = computeMessageBudget(options?.modelContextWindow)
    } catch (error) {
      // 取消导致的生成中断走"已停止"而不是错误提示
      if (abortSignal?.aborted) {
        callbacks.onDone(fullAssistantText + '\n\n_' + t('agent.stoppedGenerating') + '_', allToolCalls, allArtifacts)
        return
      }
      // 可恢复错误（上下文超限类）→ withhold-then-recover：降档压缩 → meta 注入 → 熔断放行。
      // 非可恢复错误直接放行（无额外调用 = 无额外费用）。
      const errText = String(error)
      // 已到最后一轮（rounds >= MAX_TOOL_ROUNDS）：continue 会退出循环 → 走 maxToolRoundsReached
      // 误报并吞掉真实错误——重试无意义时错误透传（final review 回归：工具循环后段超限错误最高发）
      if (rounds >= MAX_TOOL_ROUNDS) {
        callbacks.onError(t('agent.llmCallFailed').replace('{error}', errText))
        return
      }
      // 连续失败计数先增后判：第 MAX(3) 次连续失败即熔断（本阶梯仅 2 个可恢复动作：
      // compacting / meta-injected，第 3 次失败 = 熔断，不再发起调用——与测试契约一致）
      consecutiveRecoveryFailures++
      if (isRecoverableError(errText) && consecutiveRecoveryFailures < MAX_CONSECUTIVE_RECOVERY_FAILURES) {
        if (recoveryStage === 'none') {
          recoveryStage = 'compacting'
          console.warn(`[AgentEngine] 恢复重试 compacting（失败 ${consecutiveRecoveryFailures}/${MAX_CONSECUTIVE_RECOVERY_FAILURES}）：${errText}`)
        } else if (recoveryStage === 'compacting') {
          recoveryStage = 'meta-injected'
          messages.push({ role: 'user', content: t('engine.resumeDirectly') })
          console.warn(`[AgentEngine] 恢复重试 meta-injected（失败 ${consecutiveRecoveryFailures}/${MAX_CONSECUTIVE_RECOVERY_FAILURES}）：${errText}`)
        }
        // 降档压缩重试（决策冻结：压缩只从尾部加深截断，前缀稳定）
        currentBudget = Math.max(MIN_RECOVERY_BUDGET_TOKENS, Math.floor(currentBudget / 2))
        budgetedMessages = compressMessagesToBudget(messages, currentBudget)
        continue
      }
      callbacks.onError(t('agent.llmCallFailed').replace('{error}', errText))
      return
    }

    // 检查中止
    if (abortSignal?.aborted) {
      callbacks.onDone(fullAssistantText + '\n\n_' + t('agent.stoppedGenerating') + '_', allToolCalls, allArtifacts)
      return
    }

    // 解析 LLM 回复：分离文本和 tool_call
    const { textParts, toolCalls, parseErrors } = parseToolCalls(llmResponse)
    // 部分失败场景的诊断反馈（每轮重置；仅部分成功 + 部分解析失败时被赋值，
    // 延迟到 observation 组装时注入，避免与全失败路径重复 push）
    let parseFeedbackForObservation: string | undefined

    // 输出文本部分（清理可能残留的 tool_call/tool_result 标记）
    let textContent = textParts.join('')
    textContent = textContent
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
      .replace(/<tool_result[\s\S]*?<\/tool_result>/g, '')
      .replace(/<\/?tool_call>/g, '')      // 清理孤立的开/闭标签
      .replace(/<\/?tool_result>/g, '')     // 清理孤立的 result 标签
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    if (textContent) {
      // 流式模式下文本已通过 onChunk 实时推送，避免重复输出
      if (!streamed) callbacks.onTextChunk(textContent)
      fullAssistantText += textContent
    }

    // ★ 工具调用解析失败诊断（逐条反馈，不静默）：
    //    部分成功 + 部分解析失败时，失败项也注入 observation，让 LLM 知道哪些调用没被理解
    if (parseErrors.length > 0) {
      const errorFeedback = formatParseErrorsForLLM(parseErrors)
      if (toolCalls.length === 0) {
        // 全失败：独立 user 消息触发自我修正（既有行为）
        messages.push({ role: 'assistant', content: llmResponse })
        messages.push({
          role: 'user',
          content: t('engine.parseDiagnosis').replace('{feedback}', errorFeedback),
        })
        console.warn('[AgentEngine] 注入解析错误反馈给 LLM，触发自我修正')
        continue
      }
      // 部分失败：解析诊断追加到本轮 observation 头部（toolCalls 继续正常执行）
      // 诊断段延迟到 observation 组装时注入——此处仅保存，避免重复 push
      parseFeedbackForObservation = errorFeedback
    }

    // 如果没有 tool_call，循环结束
    if (toolCalls.length === 0) {
      progress.setPhase('generating')
      callbacks.onProgress?.(progress.getProgress())

      // 运行后处理管道
      try {
        const processed = await outputPostProcessor.process(fullAssistantText, {
          artifacts: allArtifacts,
          messages: messages,
          modelId,
        })
        progress.complete()
        callbacks.onProgress?.(progress.getProgress())
        // 在最终文本前附加思考内容（可选）
        const finalText = processed.thinkingContent
          ? `_${t('agent.thinkingPrefix')}_\n> ${processed.thinkingContent.replace(/\n/g, '\n> ')}\n\n${processed.cleanedOutput}`
          : processed.cleanedOutput
        callbacks.onDone(finalText, allToolCalls, processed.extractedArtifacts)
      } catch {
        // 后处理失败不影响主流程
        progress.complete()
        callbacks.onDone(fullAssistantText, allToolCalls, allArtifacts)
      }
      return
    }

    // 将 LLM 的完整回复加入历史（包含 tool_call 标签）
    messages.push({ role: 'assistant', content: llmResponse })

    // 依次执行每个 tool_call
    const observationParts: string[] = []

    progress.setPhase('tool_execution')
    progress.setCurrentTool(toolCalls[0].name, toolCalls.length)
    callbacks.onProgress?.(progress.getProgress())

    for (const tc of toolCalls) {
      const toolCallInfo: ToolCallInfo = {
        id: crypto.randomUUID(),
        toolName: tc.name,
        arguments: tc.arguments,
        status: 'pending',
      }
      allToolCalls.push(toolCallInfo)

      // 查找 Tool
      const tool = toolRegistry.get(tc.name)
      if (!tool) {
        toolCallInfo.status = 'failed'
        toolCallInfo.error = t('agent.unknownTool').replace('{name}', tc.name)
        callbacks.onToolCallComplete(toolCallInfo)
        observationParts.push(`<tool_result name="${tc.name}" error="true">\n${t('engine.unknownToolAvailable').replace('{name}', tc.name).replace('{tools}', toolRegistry.listAll().map(tool => tool.name).join(', '))}\n</tool_result>`)
        continue
      }

      // 记录来源
      toolCallInfo.source = tool.source

      // 需要用户确认的 Tool
      if (tool.requiresConfirmation) {
        toolCallInfo.status = 'waiting_confirm'
        callbacks.onToolCallStart(toolCallInfo)

        const confirmed = await callbacks.onToolCallConfirmRequired(toolCallInfo)
        if (!confirmed) {
          toolCallInfo.status = 'failed'
          toolCallInfo.error = t('agent.userRejected')
          callbacks.onToolCallComplete(toolCallInfo)
          observationParts.push(`<tool_result name="${tc.name}" error="true">\n${t('engine.userRejectedAction')}\n</tool_result>`)
          continue
        }
      }

      // 执行 Tool
      toolCallInfo.status = 'running'
      callbacks.onToolCallStart(toolCallInfo)

      try {
        const result = await executeToolWithTimeout(tool.execute, tc.arguments, TOOL_TIMEOUT_MS)

        // 截断过长的结果
        const truncatedContent = truncateResult(result.content, TOOL_RESULT_MAX_TOKENS)

        toolCallInfo.status = result.success ? 'completed' : 'failed'
        toolCallInfo.result = truncatedContent
        if (result.error) toolCallInfo.error = result.error
        if (result.artifacts) allArtifacts.push(...result.artifacts)

        callbacks.onToolCallComplete(toolCallInfo)

        if (result.success) {
          // 长结果写盘引用（P0-1）：原始内容 > 注入上限且 ≤ 512KB → 全文落盘，
          // 上下文只进「路径 + 摘要」，LLM 按需用 read_file 再读（绝对路径分支）。
          // read_file 工具天然豁免：自身按引擎截断线校准（READ_MAX_CHARS=440），结果永不超限。
          const rawContent = result.content ?? ''
          const shouldSpill = estimateTokens(rawContent) > TOOL_RESULT_MAX_TOKENS && rawContent.length <= MAX_SPILL_CHARS
          if (shouldSpill && deps?.writeResult) {
            const writeRes = await deps.writeResult(rawContent)
            if (writeRes.success && writeRes.path) {
              const summary = truncateToTokenBudget(rawContent, RESULT_SUMMARY_MAX_TOKENS)
              observationParts.push(`<tool_result name="${tc.name}">\n${t('engine.resultSpilledToDisk').replace('{total}', String(estimateTokens(rawContent))).replace('{path}', writeRes.path)}\n\n${sanitizeObservation(summary)}\n</tool_result>`)
            } else {
              observationParts.push(`<tool_result name="${tc.name}">\n${sanitizeObservation(truncatedContent)}\n</tool_result>`)
            }
          } else {
            // 空结果占位（D6-1）：成功但无内容（或纯空白）→ 注入占位文本，防模型把空 <tool_result>
            // 当回合边界停止生成（CC 事故：capybara 对空结果误判 \n\nHuman: 停止序列）
            const content = truncatedContent.trim() === ''
              ? t('engine.emptyToolResult').replace('{toolName}', tc.name)
              : sanitizeObservation(truncatedContent)
            observationParts.push(`<tool_result name="${tc.name}">\n${content}\n</tool_result>`)
          }
        } else {
          observationParts.push(`<tool_result name="${tc.name}" error="true">\n${sanitizeObservation(result.error ?? truncatedContent)}\n</tool_result>`)
        }
      } catch (error) {
        toolCallInfo.status = 'failed'
        toolCallInfo.error = t('agent.executionError').replace('{error}', sanitizeErrorText(error))
        callbacks.onToolCallComplete(toolCallInfo)
        observationParts.push(`<tool_result name="${tc.name}" error="true">\n${t('agent.executionError').replace('{error}', sanitizeErrorText(error))}\n</tool_result>`)
      }
    }

    // 将所有 tool 结果作为 user role 的 observation 注入
    // 加上明确提示，防止 LLM 误以为这是用户新发言
    const observationPartsWithDiagnosis = parseFeedbackForObservation
      ? [`${t('engine.parsePartialDiagnosis')}\n${parseFeedbackForObservation}`, ...observationParts]
      : observationParts
    const observation = `${t('engine.observationHeader')}\n\n${observationPartsWithDiagnosis.join('\n\n')}\n\n${t('engine.observationFooter')}`
    messages.push({ role: 'user', content: observation })
  }

  // 达到最大循环次数
  if (rounds >= MAX_TOOL_ROUNDS) {
    fullAssistantText += '\n\n⚠️ ' + t('agent.maxToolRoundsReached')
  }

  // 运行后处理管道
  try {
    const processed = await outputPostProcessor.process(fullAssistantText, {
      artifacts: allArtifacts,
      messages: messages,
      modelId,
    })
    progress.complete()
    callbacks.onProgress?.(progress.getProgress())
    const finalText = processed.thinkingContent
      ? `_${t('agent.thinkingPrefix')}_\n> ${processed.thinkingContent.replace(/\n/g, '\n> ')}\n\n${processed.cleanedOutput}`
      : processed.cleanedOutput
    callbacks.onDone(finalText, allToolCalls, processed.extractedArtifacts)
  } catch {
    progress.complete()
    callbacks.onDone(fullAssistantText, allToolCalls, allArtifacts)
  }
}

// ===== 工具函数 =====

/** 解析的 Tool 调用 */
interface ParsedToolCall {
  name: string
  arguments: Record<string, unknown>
}

/** Tool 调用解析错误详情（供 AI 自检反馈） */
export interface ToolParseError {
  /** 原始 tool_call 内容（截断到 300 字符） */
  rawContent: string
  /** 错误原因 */
  reason: string
  /** 修复建议 */
  suggestion: string
}

/**
 * 从 LLM 输出中解析 <tool_call>...</tool_call> 标签
 *
 * 返回分离后的文本片段、tool 调用列表和解析错误详情。
 * 增强版：支持 JSON 前后有多余文字的容错解析 + 详细错误诊断。
 */
export function parseToolCalls(text: string): {
  textParts: string[]
  toolCalls: ParsedToolCall[]
  /** AI 自检：解析失败的错误详情，可反馈给 LLM 让其自我修正 */
  parseErrors: ToolParseError[]
} {
  const toolCalls: ParsedToolCall[] = []
  const textParts: string[] = []
  const parseErrors: ToolParseError[] = []

  // 匹配 <tool_call>...</tool_call> 标签
  const regex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g
  let lastIndex = 0
  let match: RegExpExecArray | null = null

  while ((match = regex.exec(text)) !== null) {
    // 收集标签前的文本
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim()
      if (before) textParts.push(before)
    }
    lastIndex = regex.lastIndex

    // 解析 JSON（增强容错 + 详细错误诊断）
    const rawContent = match[1].trim()
    let parsed = false

    // 策略 1：直接解析整个内容
    try {
      const data = JSON.parse(rawContent)
      if (data.name && typeof data.name === 'string') {
        toolCalls.push({ name: data.name, arguments: data.arguments ?? {} })
        parsed = true
      } else {
        parseErrors.push({
          rawContent: rawContent.slice(0, 300),
          reason: t('engine.parseReasonMissingName'),
          suggestion: t('engine.parseSuggestionMissingName'),
        })
      }
    } catch (e1) {
      const errMsg1 = e1 instanceof SyntaxError ? e1.message : String(e1)
      // 策略 2：从内容中提取 JSON 对象（LLM 可能在 JSON 前后加了额外文字）
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[0])
          if (data.name && typeof data.name === 'string') {
            toolCalls.push({ name: data.name, arguments: data.arguments ?? {} })
            parsed = true
          } else {
            parseErrors.push({
              rawContent: rawContent.slice(0, 300),
              reason: t('engine.parseReasonExtractedMissingName').replace('{detail}', jsonMatch[0].slice(0, 100)),
              suggestion: t('engine.parseSuggestionObjectFields'),
            })
          }
        } catch (e2) {
          const errMsg2 = e2 instanceof SyntaxError ? e2.message : String(e2)
          parseErrors.push({
            rawContent: rawContent.slice(0, 300),
            reason: t('engine.parseReasonJsonFailed').replace('{e1}', errMsg1.slice(0, 80)).replace('{e2}', errMsg2.slice(0, 80)),
            suggestion: t('engine.parseSuggestionJsonRules'),
          })
        }
      } else {
        parseErrors.push({
          rawContent: rawContent.slice(0, 300),
          reason: t('engine.parseReasonNoJson').replace('{detail}', errMsg1.slice(0, 80)),
          suggestion: t('engine.parseSuggestionNeedJson'),
        })
      }
    }

    if (!parsed) {
      console.warn('[AgentEngine] tool_call 标签解析失败，已诊断:', {
        content: rawContent.slice(0, 100),
        error: parseErrors[parseErrors.length - 1]?.reason,
      })
    }
  }

  // 收集最后一个标签后的文本
  if (lastIndex < text.length) {
    const after = text.slice(lastIndex).trim()
    if (after) textParts.push(after)
  }

  // 如果没有匹配到任何标签，整个文本都是 textParts
  if (toolCalls.length === 0 && textParts.length === 0) {
    textParts.push(text)
  }

  return { textParts, toolCalls, parseErrors }
}

/**
 * 将解析错误格式化为 LLM 可理解的反馈消息
 * 用于注入到 observation 中，让 LLM 自我修正
 */
export function formatParseErrorsForLLM(parseErrors: ToolParseError[]): string {
  if (parseErrors.length === 0) return ''

  const parts = parseErrors.map((err, i) =>
    t('engine.parseErrorBlock')
      .replace('{n}', String(i + 1))
      .replace('{raw}', err.rawContent)
      .replace('{reason}', err.reason)
      .replace('{suggestion}', err.suggestion)
  )

  return `${t('engine.parseFeedbackHeader')}

${parts.join('\n\n')}

${t('engine.parseFeedbackCommon')}
${t('engine.parseBulletQuotes')}
${t('engine.parseBulletTrailingComma')}
${t('engine.parseBulletStructure')}
${t('engine.parseBulletNoExtraText')}`
}

/**
 * 带超时的 Tool 执行
 *
 * 注意：Promise.race 超时后工具本身无法中止（副作用可能已发生），
 * 这里仅确保等待不无限期挂起，并在 settle 后清理计时器。
 */
async function executeToolWithTimeout(
  executeFn: (args: Record<string, unknown>) => Promise<ToolResult>,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<ToolResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      executeFn(args),
      new Promise<ToolResult>((_, reject) => {
        timer = setTimeout(() => reject(new Error(t('agent.toolTimeout').replace('{n}', String(timeoutMs / 1000)))), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 错误文本脱敏（P3 修复）：截断 + 去除绝对路径——原始异常常含绝对路径/DB 栈，
 * 直接注入 LLM 上下文会泄漏本机路径信息。
 */
function sanitizeErrorText(err: unknown): string {
  const s = err instanceof Error ? err.message : String(err)
  const masked = s
    .replace(/[a-zA-Z]:[\\/][^"'\s,;]+/g, '[path]')          // Windows 绝对路径
    .replace(/\/(?:Users|home|root|tmp|Users)\/[^"'\s,;]+/g, '[path]') // Unix/家目录路径
  return masked.length > 300 ? masked.slice(0, 300) + '…' : masked
}

/**
 * 清洗注入 observation 的工具结果，防止结果内容包含
 * <tool_result> / <tool_call> 标签时破坏 XML 结构（注入污染，P2 修复）。
 * 历史事故：只剥离 tool_result 未剥离 tool_call——读到含 <tool_call> 指令的不可信文件
 * （外部导入草稿/知识库文档）原样回喂 LLM，下一轮可能被 parseToolCalls 当真实工具调用执行。
 */
function sanitizeObservation(content: string): string {
  return content
    .replace(/<\/tool_result>/gi, '')
    .replace(/<tool_result/gi, '')
    .replace(/<\/tool_call>/gi, '')
    .replace(/<tool_call/gi, '')
}

/**
 * 按模型窗口计算消息压缩预算（P0-2 动态化）：
 * 无窗口 / 窗口 < 16k → 默认 16_000（现状不变）；否则 min(窗口 - 4k 预留, 32k 工程上限)。
 */
export function computeMessageBudget(modelContextWindow?: number): number {
  if (!modelContextWindow || modelContextWindow < MIN_DYNAMIC_WINDOW_TOKENS) return DEFAULT_MESSAGE_BUDGET_TOKENS
  return Math.min(modelContextWindow - OUTPUT_RESERVE_TOKENS, MAX_MESSAGE_BUDGET_TOKENS)
}

/** 可恢复错误识别（上下文超限类——压缩后重试真实有效；白名单收紧防误判烧钱）。 */
const RECOVERABLE_ERROR_PATTERNS: RegExp[] = [
  /context length/i,
  /maximum context/i,
  /context window/i,
  /too many tokens/i,
  /token limit/i,
  /context_length_exceeded/i,
  /\b413\b/,
  /request entity too large/i,
  /上下文长度/,
  /超(出|过).{0,4}(上限|限制|长度)/,
  /长度.{0,4}(超|超过)/,
]

export function isRecoverableError(message: string): boolean {
  return RECOVERABLE_ERROR_PATTERNS.some(p => p.test(message))
}

/**
 * 将消息列表压缩到 token 预算内（ReAct 多轮 observation 的上下文整体防线）。
 *
 * 压缩策略（保证 role 交替与最近上下文）：
 * 1. system 提示恒保留
 * 2. 从尾部向前保留最近的 (user, assistant) 轮次对，直到预算耗尽
 * 3. 末尾独立的 user（当前问题 / observation）单独保留
 *
 * 注意：仅作用于发送给 LLM 的副本，不修改引擎的完整消息记录。
 */
function compressMessagesToBudget(messages: LLMMessage[], budget: number): LLMMessage[] {
  const total = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  if (total <= budget) return messages

  const out: LLMMessage[] = []
  let used = 0

  // 1. system 提示恒保留（即使超预算也不能丢）
  if (messages[0]?.role === 'system') {
    out.push(messages[0])
    used += estimateTokens(messages[0].content)
  }

  const tail: LLMMessage[] = []
  const kept = new Set<number>()

  // 2a. 最后一条 user 消息无条件保留（当前问题/observation——丢弃会致 LLM
  //     无题可答、凭空编造；超预算时截断它本身而非跳过，H 级降幻觉）
  const last = messages.length - 1
  if (last >= 1 && messages[last].role === 'user') {
    let content = messages[last].content
    let tokens = estimateTokens(content)
    if (used + tokens > budget && budget - used > 64) {
      const maxChars = Math.max(64, Math.floor((budget - used) * 4))
      content = content.slice(0, maxChars) + '\n[内容已截断]'
      tokens = estimateTokens(content)
    }
    tail.unshift({ ...messages[last], content })
    used += tokens
    kept.add(last)
  }

  // 2b. 从尾部向前保留最近的轮次（user, assistant 对 / 独立 user）
  //     kept 防重复：工具轮 [assistant(tool_call), user(observation)] 中
  //     observation 已在 2a 保留——配对分支此前会再次 unshift 同一条（重复注入）
  for (let i = messages.length - 1; i >= 1; i--) {
    if (kept.has(i)) continue
    const m = messages[i]
    if (m.role === 'assistant' && messages[i - 1]?.role === 'user' && !kept.has(i - 1)) {
      const pairTokens = estimateTokens(messages[i - 1].content) + estimateTokens(m.content)
      if (used + pairTokens > budget) break
      tail.unshift(messages[i - 1], m)
      used += pairTokens
      kept.add(i - 1)
      kept.add(i)
      i--
    } else if (m.role === 'user') {
      // 末尾独立的 user（observation / 当前问题）：单独保留后继续向前配对
      const msgTokens = estimateTokens(m.content)
      if (used + msgTokens > budget) break
      tail.unshift(m)
      used += msgTokens
      kept.add(i)
    }
  }
  out.push(...tail)

  return out
}

/**
 * 截断过长的 Tool 结果（基于 Token 数）
 */
function truncateResult(content: string, maxTokens: number): string {
  if (estimateTokens(content) <= maxTokens) return content
  return truncateToTokenBudget(content, maxTokens) +
    '\n\n' + t('engine.resultTruncatedNotice').replace('{tokens}', String(estimateTokens(content)))
}
