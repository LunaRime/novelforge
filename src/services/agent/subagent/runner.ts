/**
 * 子 agent 运行体（C 档第二轮）。
 *
 * 支点：`runAgentLoop` 不碰任何 store（agent-engine.ts 全文件零 store 导入），
 * 故子 agent 只需再调一次它、用自己的 callbacks 写自己的转录 —— 父的模块级单例
 * （activeAbortController / pendingConfirmations / 前缀记账）只在「取消传播」与
 * 「审批路由」两处被 agent-store 显式接线。
 */
import { t } from '../../../shared/locale'
import { runAgentLoop, type AgentEngineCallbacks, type LLMGenerateFn } from '../agent-engine'
import { estimateTokens, truncateToTokenBudget } from '../token-budget'
import type { AgentMessage } from '../../../stores/agent-store'
import type { ToolCallInfo } from '../agent-engine'
import {
  MAX_SUBAGENT_MESSAGES, SUBAGENT_MAX_MS, SUBAGENT_RESULT_MAX_TOKENS,
  type SubAgentSession, type SubAgentTask,
} from './types'

export interface SubAgentDeps {
  generate: LLMGenerateFn
  /** 系统提示词装配（注入以便单测；真实实现 = buildSubAgentPrompt） */
  buildPrompt: (task: SubAgentTask) => Promise<string>
  /** 写操作审批（注入以便单测；真实实现 = agent-store 的父方审批卡） */
  confirm: (toolCall: ToolCallInfo) => Promise<boolean>
  /** 父的取消信号（与父的 AbortController 绑定） */
  signal?: AbortSignal
  /** 转录/状态回写（父端 50ms 缓冲 flush） */
  onUpdate?: (session: SubAgentSession) => void
  /** 时钟注入（墙钟判定可测，不依赖真实时间） */
  now?: () => number
}

/**
 * 流式文本清洗（与父 `agent-store` 的 onTextChunk 同口径，评审 I3）：
 * 清掉**完整对**与孤立片段的 tool_call / tool_result 标签 —— 否则转录首条就是
 * `<tool_call>{"name":"read_drafts"…}</tool_call>` 这样的原始 JSON：卡片把它给用户看、
 * 归档净化会因此删掉整条消息（转录静默少步）、回放还会把它灌回父上下文。
 * 跨 chunk 被切开的标签由 onDone 的全文重写兜住（父也是这么兜的）。
 */
function stripToolTags(text: string): string {
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .replace(/<\/?tool_call>/g, '')
    .replace(/<\/?tool_result[^>]*>/g, '')
}

/** 转录尾部追加文本（末条 assistant 若仍在流式则续写，否则新起一条） */
function appendText(session: SubAgentSession, text: string): void {
  const last = session.messages[session.messages.length - 1]
  if (last?.role === 'assistant' && last.streaming) {
    last.content += text
    return
  }
  session.messages.push({
    id: `sa-${session.messages.length}`,
    role: 'assistant',
    content: text,
    createdAt: Date.now(),
    streaming: true,
    toolCalls: [],
  })
}

/** 工具调用写进转录（按 id 覆盖或追加，并挂到最后一条 assistant 消息上——与父同形，便于复用渲染） */
function upsertToolCall(session: SubAgentSession, tc: ToolCallInfo): void {
  const idx = session.toolCalls.findIndex(x => x.id === tc.id)
  if (idx >= 0) session.toolCalls[idx] = tc
  else session.toolCalls.push(tc)
  const last = session.messages[session.messages.length - 1]
  if (!last || last.role !== 'assistant') {
    session.messages.push({ id: `sa-${session.messages.length}`, role: 'assistant', content: '', createdAt: Date.now(), toolCalls: [tc] })
    return
  }
  const list = last.toolCalls ?? []
  const i = list.findIndex(x => x.id === tc.id)
  last.toolCalls = i >= 0 ? list.map(x => (x.id === tc.id ? tc : x)) : [...list, tc]
}

export async function runSubAgent(task: SubAgentTask, deps: SubAgentDeps): Promise<SubAgentSession> {
  const now = deps.now ?? ((): number => Date.now())
  const startedAt = now()
  const session: SubAgentSession = {
    id: task.taskId, taskId: task.taskId, description: task.description, prompt: task.prompt,
    allowedTools: task.allowedTools, status: 'running', toolCalls: [], artifacts: [], result: '', startedAt,
    // 转录以「任务」开头：回放时用户/模型要能看到**派了什么**，而不是只有子 agent 的独白
    messages: [{ id: 'sa-0', role: 'user', content: task.prompt, createdAt: startedAt }],
  }
  const emit = (): void => deps.onUpdate?.(session)

  const controller = new AbortController()
  let timedOut = false
  // 真实定时器是**兜底**：LLM 调用真的挂住时用它中断；正常路径由「跑完后的墙钟比对」判定
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, SUBAGENT_MAX_MS)
  const onParentAbort = (): void => controller.abort()
  deps.signal?.addEventListener('abort', onParentAbort, { once: true })
  emit()

  const callbacks: AgentEngineCallbacks = {
    onTextChunk: (chunk) => {
      const cleaned = stripToolTags(chunk).trim()
      if (cleaned) { appendText(session, cleaned); emit() }
    },
    onToolCallStart: (tc) => { upsertToolCall(session, tc); emit() },
    onToolCallComplete: (tc) => { upsertToolCall(session, tc); emit() },
    onToolCallConfirmRequired: (tc) => deps.confirm(tc),
    onDone: (fullText, toolCalls, artifacts) => {
      session.result = fullText
      session.toolCalls = toolCalls
      session.artifacts = artifacts
      // 用清洗后的全文**重写**最后一条 assistant 消息（跨 chunk 切开的标签只有这里能清干净）
      const cleanedFull = stripToolTags(fullText)
      const last = session.messages[session.messages.length - 1]
      if (last?.role === 'assistant') last.content = cleanedFull
      else if (cleanedFull) session.messages.push({ id: `sa-${session.messages.length}`, role: 'assistant', content: cleanedFull, createdAt: Date.now() })
    },
    onError: (error) => { session.error = error },
  }

  /** 终态判定：超时 → failed（spec §3.9）；父取消 → cancelled；引擎报错 → failed；否则 completed */
  const settle = (): void => {
    const elapsed = now() - startedAt
    if (timedOut || elapsed > SUBAGENT_MAX_MS) {
      session.status = 'failed'
      session.error = t('subagent.timeout')
    } else if (controller.signal.aborted) {
      session.status = 'cancelled'
      session.error = t('subagent.cancelled')
    } else if (session.error) {
      session.status = 'failed'
    } else {
      session.status = 'completed'
    }
  }

  try {
    const systemPrompt = await deps.buildPrompt(task)
    await runAgentLoop(
      systemPrompt, [], task.prompt, task.modelId, deps.generate, callbacks, controller.signal,
      { allowedTools: task.allowedTools },
      { allowedTools: task.allowedTools },
    )
    settle()
  } catch (e) {
    session.error = String(e)
    settle()
  } finally {
    clearTimeout(timer)
    deps.signal?.removeEventListener('abort', onParentAbort)
    session.endedAt = now()
    session.messages = session.messages
      .map((m): AgentMessage => ({ ...m, streaming: false }))
      .slice(-MAX_SUBAGENT_MESSAGES)
    emit()
  }
  return session
}

/**
 * 注入父端的结果（untrusted 标注 + 截断 + 回放提示）。
 * 截断只作用于「回收」这一侧——回放（formatSubAgentTranscript）给全文。
 */
export function formatSubAgentResult(session: SubAgentSession): string {
  const header = t('subagent.resultHeader').replace('{description}', session.description)
  const notice = t('subagent.untrustedNotice')
  const body = session.status === 'completed'
    ? truncateToTokenBudget(session.result || t('subagent.emptyResult'), SUBAGENT_RESULT_MAX_TOKENS)
    : t('subagent.failedResult').replace('{reason}', session.error ?? session.status)
  const footer = t('subagent.resultFooter')
    .replace('{id}', session.id)
    .replace('{steps}', String(session.messages.length))
    .replace('{tools}', String(session.toolCalls.length))
    .replace('{tokens}', String(estimateTokens(session.result)))
  return `${header}\n${notice}\n\n${body}\n\n${footer}`
}

/** 回放（`task(task_id)`）：完整转录 + 同样的 untrusted 标注（回放内容仍是被委派方的产物） */
export function formatSubAgentTranscript(session: SubAgentSession): string {
  const header = t('subagent.replayHeader').replace('{description}', session.description).replace('{id}', session.id)
  const notice = t('subagent.untrustedNotice')
  const lines = session.messages.map(m => {
    const who = m.role === 'user' ? t('subagent.replayUser') : t('subagent.replayAssistant')
    const tools = (m.toolCalls ?? []).map(tc => `  ↳ ${tc.toolName} (${tc.status})`).join('\n')
    return `${who}\n${m.content}${tools ? `\n${tools}` : ''}`
  })
  const footer = session.error ? `\n\n${t('subagent.failedResult').replace('{reason}', session.error)}` : ''
  return `${header}\n${notice}\n\n${lines.join('\n\n')}${footer}`
}
