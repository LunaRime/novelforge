import type { WorkflowContext, StepCallbacks, WorkflowStep } from '../../../stores/workflow-store'
import { useLLMStore } from '../../../stores/llm-store'
import { globalEventBus, EventPayloadMap } from '../../../shared/event-bus'
import type { BasePromptBuilder } from '../../prompts/prompt-builder'
import { ipc } from '../../ipc-client'
import { robustParseJSON } from '../workflow-utils'
import { retrieveContextForQuery, DEFAULT_RAG_CONFIG } from '../../agent/rag-context-provider'
import { structureForCache, hashStaticContext, generateCacheKey, calculateCost, type CacheScope } from '../../llm/prompt-cache'

export interface CommandExecuteParams {
  step: Partial<WorkflowStep> & { [extra: string]: unknown }
  context: WorkflowContext
  callbacks: StepCallbacks
}

/**
 * 工作流执行环节的抽象基类 (Command Pattern)
 * 将原本混乱的 workflow 闭包拆分为可独立测试、状态解耦的命令单元。
 */
export abstract class BaseWorkflowCommand<TResult = string> {

  /** 抽象执行入口 */
  abstract execute(params: CommandExecuteParams): Promise<TResult>

  /** 获取 LLM 大模型连接代理（支持取消 + Prompt 缓存） */
  protected async callLLM(
    prompt: string,
    systemPrompt: string,
    callbacks: StepCallbacks,
    options?: { responseFormat?: { type: string }; thinking?: boolean; cacheScope?: CacheScope },
    context?: WorkflowContext
  ): Promise<string> {
    const llmStore = useLLMStore.getState()
    if (!llmStore.defaultModelId) throw new Error('未配置默认 AI 模型')

    const modelId = llmStore.defaultModelId
    const model = llmStore.models.find(m => m.id === modelId)
    const startTime = Date.now()

    callbacks.setProgress(10)

    return new Promise((resolve, reject) => {
      let fullContent = ''
      let streamRequestId = ''

      // 取消监听：轮询 context.cancelled，主动中断 LLM 流
      let cancelCheckTimer: ReturnType<typeof setInterval> | null = null
      if (context) {
        cancelCheckTimer = setInterval(() => {
          if (context.cancelled && streamRequestId) {
            clearInterval(cancelCheckTimer!)
            cancelCheckTimer = null
            llmStore.cancelGeneration(streamRequestId).catch(() => { })
            reject(new Error('工作流已取消'))
          }
        }, 200)
      }

      const cleanup = () => {
        if (cancelCheckTimer) {
          clearInterval(cancelCheckTimer)
          cancelCheckTimer = null
        }
      }

      const logLLMCall = (success: boolean, errorMessage?: string) => {
        const duration = Date.now() - startTime
        ipc.invoke('db:log-llm-call', {
          model_id: modelId,
          model_name: model?.name ?? model?.modelName ?? '',
          purpose: 'workflow',
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          duration_ms: duration,
          success: success ? 1 : 0,
          error_message: errorMessage ?? '',
        }).catch(() => { /* 日志失败不影响主流程 */ })
      }

      // 缓存优化：将稳定内容前置以最大化 API 缓存命中
      const cacheKey = options?.cacheScope
        ? generateCacheKey(options.cacheScope, modelId, hashStaticContext(systemPrompt + prompt.slice(0, 200)))
        : undefined

      const cachedMessages = structureForCache(systemPrompt, '', prompt)
      llmStore.generateStream(
        cachedMessages,
        {
          onChunk: (chunk) => {
            // 取消后不再追加输出
            if (context?.cancelled) return
            fullContent += chunk
            callbacks.appendText(chunk)
          },
          onDone: (text, usage) => {
            cleanup()
            // 费用追踪
            if (usage && model) {
              const cost = calculateCost(model, usage.promptTokens, usage.completionTokens, !!cacheKey)
              callbacks.log(`💰 $${cost.totalCost.toFixed(4)} (${cost.cached ? '缓存命中' : '全价'})`)
              // 记录到全局用量 Store
              import('../../../stores/usage-store').then(m =>
                m.useUsageStore.getState().recordCall({
                  model, promptTokens: usage.promptTokens,
                  completionTokens: usage.completionTokens,
                  cacheHit: !!cacheKey,
                })
              ).catch(() => {})
            }
            // 取消后不 resolve，让 reject 生效
            if (context?.cancelled) {
              logLLMCall(false, '工作流已取消')
              reject(new Error('工作流已取消'))
              return
            }
            // 更新 token 用量（如果 provider 提供了 usage）
            if (usage) {
              ipc.invoke('db:log-llm-call', {
                model_id: modelId,
                model_name: model?.name ?? model?.modelName ?? '',
                purpose: 'workflow',
                prompt_tokens: usage.promptTokens,
                completion_tokens: usage.completionTokens,
                total_tokens: usage.totalTokens,
                duration_ms: Date.now() - startTime,
                success: 1,
              }).catch(() => { })
            } else {
              logLLMCall(true)
            }
            callbacks.setProgress(90)
            const raw = text || fullContent
            const cleaned = this.stripThinkingTags(raw)
            resolve(cleaned)
          },
          onError: (err) => {
            cleanup()
            logLLMCall(false, err || '流式生成失败')
            reject(new Error(err || '流式生成失败'))
          }
        },
        undefined,
        options
      ).then(reqId => {
        streamRequestId = reqId
        // 如果在 generateStream 返回前已经取消
        if (context?.cancelled) {
          llmStore.cancelGeneration(reqId).catch(() => { })
          cleanup()
          logLLMCall(false, '工作流已取消')
          reject(new Error('工作流已取消'))
        }
      }).catch(err => {
        cleanup()
        logLLMCall(false, String(err))
        reject(err)
      })
    })
  }

  /**
   * 使用 Builder 的 systemRole + prompt 一键调用 LLM
   * 角色定位由模板自带，command 不再需要硬编码 system message
   */
  protected async callLLMWithBuilder(
    builder: BasePromptBuilder,
    callbacks: StepCallbacks,
    options?: { responseFormat?: { type: string }; thinking?: boolean },
    context?: WorkflowContext
  ): Promise<string> {
    return this.callLLM(builder.build(), builder.getSystemRole(), callbacks, options, context)
  }

  /**
   * 去除 DeepSeek 等模型的 <think> 标签，保证落盘纯净
   */
  protected stripThinkingTags(text: string): string {
    return text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim()
  }

  /**
   * 全局容错 JSON 解析器
   * 复用 workflow-utils 中的健壮解析逻辑，统一处理 AI 输出格式错误
   *
   * ★ AI 自检增强：解析失败时提供详细诊断信息，可反馈给 LLM 自我修正
   */
  protected parseJSON<T>(text: string): T {
    // 先尝试对象解析（AI 通常返回 JSON 对象），再尝试数组
    let result = robustParseJSON(text, false)
    if (!result) {
      result = robustParseJSON(text, true)
    }

    if (result === null) {
      const diagnostic = this.buildJSONParseDiagnostic(text)
      throw new Error(diagnostic)
    }

    return result as T
  }

  /**
   * ★ AI 自检：构建 JSON 解析失败的详细诊断信息
   *
   * 分析 AI 输出中的常见问题并生成可操作的修复建议，
   * 可用于抛错或反馈给 LLM 进行自我修正。
   */
  protected buildJSONParseDiagnostic(text: string): string {
    const issues: string[] = []
    const trimmed = text.trim()

    // 检测常见问题
    if (trimmed.includes("'''") || trimmed.includes('"""')) {
      issues.push('• 使用了 Python 风格的三引号，应改用标准 JSON 双引号 (")')
    }
    if (trimmed.includes("'") && !trimmed.includes('"')) {
      issues.push('• 使用了单引号，JSON 标准要求双引号 (")')
    }
    if (/,\s*[}\]]/.test(trimmed)) {
      issues.push('• 存在尾随逗号（对象或数组末尾多余的逗号）')
    }
    if (/[{,]\s*['"]?\w+['"]?\s*:/g.test(trimmed) === false && trimmed.includes(':')) {
      issues.push('• 可能缺少 JSON 根对象的花括号 {} 包裹')
    }
    if (trimmed.startsWith('```')) {
      issues.push('• 内容被 Markdown 代码块包裹，应只输出纯 JSON')
    }
    const openBraces = (trimmed.match(/\{/g) || []).length
    const closeBraces = (trimmed.match(/\}/g) || []).length
    if (openBraces !== closeBraces) {
      issues.push(`• 花括号不匹配（{${openBraces} 开 / ${closeBraces} 闭}），JSON 结构不完整`)
    }
    const openBrackets = (trimmed.match(/\[/g) || []).length
    const closeBrackets = (trimmed.match(/\]/g) || []).length
    if (openBrackets !== closeBrackets) {
      issues.push(`• 方括号不匹配（[${openBrackets} 开 / ${closeBrackets} 闭]）`)
    }

    // 截取末端供人工排查
    const tail = trimmed.length > 200 ? '…' + trimmed.slice(-200) : trimmed
    const head = trimmed.length > 150 ? trimmed.slice(0, 150) + '…' : trimmed

    let diagnostic = `AI 返回的数据格式无法解析为有效 JSON。\n\n`
    diagnostic += `【内容头部】${head}\n`
    diagnostic += `【内容尾部】${tail}\n`
    if (issues.length > 0) {
      diagnostic += `\n【检测到的问题】\n${issues.join('\n')}\n`
    }
    diagnostic += `\n【修复建议】请确保输出为标准 JSON 格式：使用双引号、无尾随逗号、正确闭合所有括号。`
    return diagnostic
  }

  /**
   * ★ AI 自检循环：带 LLM 反馈的 JSON 解析
   *
   * 当 parseJSON 失败时，将详细错误反馈给 LLM 并要求其重新输出，
   * 最多重试 maxRetries 次。适用于对 JSON 格式要求严格的场景。
   *
   * @param text AI 原始输出
   * @param retryLLM 重试时调用 LLM 的函数（接收错误反馈，返回修正后的输出）
   * @param maxRetries 最大重试次数（默认 2）
   * @returns 解析结果
   */
  protected async parseJSONWithSelfCheck<T>(
    text: string,
    retryLLM: (errorFeedback: string) => Promise<string>,
    maxRetries: number = 2,
  ): Promise<T> {
    let currentText = text
    let lastError = ''

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return this.parseJSON<T>(currentText)
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        if (attempt >= maxRetries) break

        // 构建反馈消息，让 LLM 自我修正
        const feedback = `你上一次输出的 JSON 格式有误，请修正后重新输出。\n\n【解析错误诊断】\n${lastError}\n\n请只输出修正后的纯 JSON（不要包裹在 Markdown 代码块中，不要添加任何说明文字）。`
        try {
          currentText = await retryLLM(feedback)
        } catch {
          break // LLM 调用也失败了，不再重试
        }
      }
    }

    throw new Error(`JSON 解析失败（已重试 ${maxRetries} 次）: ${lastError}`)
  }

  /**
   * 统一的 RAG 上下文检索（供子类使用）
   *
   * @param query 搜索查询
   * @param maxChunks 最大片段数
   * @param chapterNumber 章节号（用于范围过滤）
   * @returns 格式化的上下文文本，或空字符串
   */
  protected async retrieveRAGContext(
    query: string,
    maxChunks: number = 5,
    chapterNumber?: number,
  ): Promise<string> {
    try {
      const result = await retrieveContextForQuery(
        query,
        { ...DEFAULT_RAG_CONFIG, maxChunks },
        chapterNumber,
      )
      return result?.formattedContext || ''
    } catch {
      return ''
    }
  }

  /**
   * 解耦的事件驱动：通知 UI 层去更新资产树，而无需去 import Zustand Store
   */
  protected notifyRefresh(resources: EventPayloadMap['REFRESH_RESOURCE']['resources']) {
    globalEventBus.emit('REFRESH_RESOURCE', { resources })
  }
}

