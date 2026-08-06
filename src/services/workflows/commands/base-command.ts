import type { WorkflowContext, StepCallbacks, WorkflowStep } from '../../../stores/workflow-store'
import { t } from '../../../shared/locale'
import { useLLMStore } from '../../../stores/llm-store'
import type { CallPurpose } from '../../llm/model-router'
import { globalEventBus, EventPayloadMap } from '../../../shared/event-bus'
import type { BasePromptBuilder } from '../../prompts/prompt-builder'
import { ipc } from '../../ipc-client'
import { robustParseJSON, stripThinkingTags } from '../workflow-utils'
import { retrieveContextForQuery, DEFAULT_RAG_CONFIG } from '../../agent/rag-context-provider'
import { structureForCache, calculateCost, type CacheScope } from '../../llm/prompt-cache'
import { renderLog } from '../../render-logger'

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

  /** 获取 LLM 大模型连接代理（支持取消 + Prompt 缓存）
   *
   * 选模（产品决策「路由优先，默认模型兜底」）：
   * - 传 purpose → getModelForPurpose(purpose)：用户配置了对应层路由则用路由模型
   * - 不传 purpose → 走 standard 层（default 用途）；路由未配置 → 用户默认模型
   */
  /**
   * 温度分派表（H 级降幻觉）：创作类高温探索、审稿/提取低温保真。
   * 显式传 temperature 时优先；未传时按 purpose 分派；default 走模型默认。
   */
  private static readonly PURPOSE_TEMPERATURE: Partial<Record<CallPurpose, number>> = {
    draft_chapter: 0.9,
    first_draft: 0.9,
    refine_chapter: 0.6,
    review_chapter: 0.2,
    style_analysis: 0.3,
    consistency_check: 0.2,
    extract_json: 0.3,
    blueprint_gen: 0.4,
    architecture_gen: 0.4,
    config_gen: 0.4,
    summarize: 0.3,
  }

  protected async callLLM(
    prompt: string,
    systemPrompt: string,
    callbacks: StepCallbacks,
    options?: { responseFormat?: { type: string }; thinking?: boolean; cacheScope?: CacheScope; staticContext?: string; purpose?: CallPurpose; temperature?: number },
    context?: WorkflowContext
  ): Promise<string> {
    const llmStore = useLLMStore.getState()
    if (!llmStore.defaultModelId) throw new Error(t('error.noDefaultModel'))

    // 路由优先，默认模型兜底（三层路由此前只对 generate-multi-drafts 生效）
    const modelId = llmStore.getModelForPurpose(options?.purpose ?? 'default')
    if (!modelId) throw new Error(t('error.noDefaultModel'))
    const model = llmStore.models.find(m => m.id === modelId)
    const startTime = Date.now()

    // 温度：显式 > purpose 分派 > 模型默认（undefined 透传）
    const temperature = options?.temperature
      ?? BaseWorkflowCommand.PURPOSE_TEMPERATURE[options?.purpose ?? 'default']
      ?? undefined

    // LLM 提取日志流：发起调用（debug 级，开发环境全量可见）
    renderLog('debug', 'LLM', t('log.render.llmCallStart')
      .replace('{model}', () => model?.name ?? modelId)
      .replace('{promptChars}', String(prompt.length))
      .replace('{systemChars}', String(systemPrompt.length))
      .replace('{cachePrefix}', () => options?.staticContext ? t('log.render.cacheIncluded') : t('log.render.cacheExcluded')))

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
            reject(new Error(t('error.workflowCancelled')))
          }
        }, 200)
      }

      const cleanup = () => {
        if (cancelCheckTimer) {
          clearInterval(cancelCheckTimer)
          cancelCheckTimer = null
        }
      }

      const logLLMCall = (success: boolean, errorMessage?: string, usage?: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number }) => {
        const duration = Date.now() - startTime
        // 费用：按模型单价计算（真实缓存命中按缓存价）
        const cost = success && usage && model
          ? calculateCost(model, usage.promptTokens, usage.completionTokens, (usage.cachedTokens ?? 0) > 0).totalCost
          : 0
        ipc.invoke('db:log-llm-call', {
          model_id: modelId,
          model_name: model?.name ?? model?.modelName ?? '',
          purpose: 'workflow',
          prompt_tokens: usage?.promptTokens ?? 0,
          completion_tokens: usage?.completionTokens ?? 0,
          total_tokens: usage?.totalTokens ?? 0,
          duration_ms: duration,
          success: success ? 1 : 0,
          error_message: errorMessage ?? '',
          cost,
        }).catch(() => { /* 日志失败不影响主流程 */ })

        // LLM 提取日志流：结果与失败原因落盘（info/error 级在公测/正式版也保留）
        if (success && usage) {
          const cacheHit = (usage.cachedTokens ?? 0) > 0
          renderLog('info', 'LLM', t('log.render.llmCallDone')
            .replace('{ms}', String(duration))
            .replace('{total}', String(usage.totalTokens))
            .replace('{prompt}', String(usage.promptTokens))
            .replace('{completion}', String(usage.completionTokens))
            .replace('{cost}', () => '$' + cost.toFixed(4))
            .replace('{cacheHit}', () => cacheHit ? t('log.render.cacheHit') : ''))
        } else if (success) {
          renderLog('info', 'LLM', t('log.render.llmCallDoneNoUsage').replace('{ms}', String(duration)))
        } else {
          renderLog('error', 'LLM', t('log.render.llmCallFailed')
            .replace('{ms}', String(duration))
            .replace('{error}', () => errorMessage ?? t('log.render.unknownError')))
        }
      }

      // 缓存优化：将稳定内容前置以最大化 API 缓存命中（命中与否由 API 返回的 cachedTokens 判定）
      // staticContext（架构/世界观等）放入 system 前缀：同项目连续调用前缀稳定命中，
      // 且静态上下文在 system 中模型遵从度更高（降低幻觉）
      const cachedMessages = structureForCache(systemPrompt, options?.staticContext ?? '', prompt)
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
            // 费用追踪（真实缓存命中 = API 返回 cachedTokens > 0，非"启用了缓存机制"）
            if (usage && model) {
              const cacheHit = (usage.cachedTokens ?? 0) > 0
              const cost = calculateCost(model, usage.promptTokens, usage.completionTokens, cacheHit)
              callbacks.log(t('log.llm.cost')
                .replace('{cost}', cost.totalCost.toFixed(4))
                .replace('{cacheStatus}', cost.cached ? t('log.llm.cacheHit') : t('log.llm.fullPrice')))
              // 记录到全局用量 Store
              import('../../../stores/usage-store').then(m =>
                m.useUsageStore.getState().recordCall({
                  model, promptTokens: usage.promptTokens,
                  completionTokens: usage.completionTokens,
                  cacheHit,
                })
              ).catch(() => {})
            }
            // 取消后不 resolve，让 reject 生效
            if (context?.cancelled) {
              logLLMCall(false, t('error.workflowCancelled'))
              reject(new Error(t('error.workflowCancelled')))
              return
            }
            // 更新 token 用量（如果 provider 提供了 usage）
            if (usage) {
              logLLMCall(true, undefined, usage)
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
            logLLMCall(false, err || t('log.render.llmStreamFailed'))
            reject(new Error(err || t('log.render.llmStreamFailed')))
          }
        },
        undefined,
        { ...options, temperature }
      ).then(reqId => {
        streamRequestId = reqId
        // 如果在 generateStream 返回前已经取消
        if (context?.cancelled) {
          llmStore.cancelGeneration(reqId).catch(() => { })
          cleanup()
          logLLMCall(false, t('error.workflowCancelled'))
          reject(new Error(t('error.workflowCancelled')))
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
    options?: { responseFormat?: { type: string }; thinking?: boolean; staticContext?: string; purpose?: CallPurpose },
    context?: WorkflowContext
  ): Promise<string> {
    return this.callLLM(builder.build(), builder.getSystemRole(), callbacks, options, context)
  }

  /**
   * 去除 DeepSeek 等模型的 <think> 标签，保证落盘纯净
   * （统一委托 workflow-utils 单一出口，与 architecture.command 等一致）
   */
  protected stripThinkingTags(text: string): string {
    return stripThinkingTags(text)
  }

  /**
   * 全局容错 JSON 解析器
   * 复用 workflow-utils 中的健壮解析逻辑，统一处理 AI 输出格式错误
   *
   * ★ AI 自检增强：解析失败时提供详细诊断信息，可反馈给 LLM 自我修正
   */
  protected parseJSON<T>(text: string): T {
    // LLM 提取日志流：解析过程可见（debug 级，开发环境全量）
    renderLog('debug', 'Parse', t('log.render.jsonParseStart').replace('{chars}', String(text.length)))

    // 先尝试对象解析（AI 通常返回 JSON 对象），再尝试数组
    let result = robustParseJSON(text, false)
    if (!result) {
      // 对象失败 → 数组回退（常见于角色卡/多蓝图场景）
      renderLog('warn', 'Parse', t('log.render.jsonParseObjectFallback'))
      result = robustParseJSON(text, true)
    }

    if (result === null) {
      const diagnostic = this.buildJSONParseDiagnostic(text)
      // 完整诊断落盘——"为什么提取失败"的核心（error 级，公测/正式版也保留）
      renderLog('error', 'Parse', t('log.render.jsonParseFailed').replace('{diagnostic}', () => diagnostic))
      throw new Error(diagnostic)
    }

    renderLog('debug', 'Parse', Array.isArray(result)
      ? t('log.render.jsonParseSuccessArray').replace('{count}', String(result.length))
      : t('log.render.jsonParseSuccessObject'))
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
      issues.push(t('log.render.diagTripleQuotes'))
    }
    if (trimmed.includes("'") && !trimmed.includes('"')) {
      issues.push(t('log.render.diagSingleQuotes'))
    }
    if (/,\s*[}\]]/.test(trimmed)) {
      issues.push(t('log.render.diagTrailingComma'))
    }
    if (/[{,]\s*['"]?\w+['"]?\s*:/g.test(trimmed) === false && trimmed.includes(':')) {
      issues.push(t('log.render.diagMissingBraces'))
    }
    if (trimmed.startsWith('```')) {
      issues.push(t('log.render.diagMarkdownBlock'))
    }
    const openBraces = (trimmed.match(/\{/g) || []).length
    const closeBraces = (trimmed.match(/\}/g) || []).length
    if (openBraces !== closeBraces) {
      issues.push(t('log.render.diagBraceMismatch')
        .replace('{open}', String(openBraces))
        .replace('{close}', String(closeBraces)))
    }
    const openBrackets = (trimmed.match(/\[/g) || []).length
    const closeBrackets = (trimmed.match(/\]/g) || []).length
    if (openBrackets !== closeBrackets) {
      issues.push(t('log.render.diagBracketMismatch')
        .replace('{open}', String(openBrackets))
        .replace('{close}', String(closeBrackets)))
    }

    // 截取末端供人工排查
    const tail = trimmed.length > 200 ? '…' + trimmed.slice(-200) : trimmed
    const head = trimmed.length > 150 ? trimmed.slice(0, 150) + '…' : trimmed

    let diagnostic = t('log.render.diagHeader') + '\n\n'
    diagnostic += t('log.render.diagContentHead').replace('{content}', () => head) + '\n'
    diagnostic += t('log.render.diagContentTail').replace('{content}', () => tail) + '\n'
    if (issues.length > 0) {
      diagnostic += '\n' + t('log.render.diagIssuesHeader') + '\n' + issues.join('\n') + '\n'
    }
    diagnostic += '\n' + t('log.render.diagFixSuggestion')
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

        // LLM 提取日志流：自检重试过程可见
        renderLog('info', 'Parse', t('log.render.jsonSelfCheckRetry')
          .replace('{attempt}', String(attempt + 1))
          .replace('{max}', String(maxRetries))
          .replace('{error}', () => err instanceof Error ? err.message.slice(0, 100) : String(err)))

        // 构建反馈消息，让 LLM 自我修正
        const feedback = t('log.render.selfCheckFeedback').replace('{diagnostic}', () => lastError)
        try {
          currentText = await retryLLM(feedback)
        } catch {
          break // LLM 调用也失败了，不再重试
        }
      }
    }

    renderLog('error', 'Parse', t('log.render.jsonSelfCheckExhausted')
      .replace('{count}', String(maxRetries))
      .replace('{error}', () => lastError.slice(0, 300)))
    throw new Error(t('log.render.jsonParseFailedAfterRetries')
      .replace('{count}', String(maxRetries))
      .replace('{error}', () => lastError))
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

