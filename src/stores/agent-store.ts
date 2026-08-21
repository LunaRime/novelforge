import { create } from 'zustand'
import { t } from '../shared/locale'
import { useLLMStore } from './llm-store'
import { buildAgentSystemPrompt } from '../services/agent/context-builder'
import { runAgentLoop, type ToolCallInfo, type LLMMessage } from '../services/agent/agent-engine'
import { registerBuiltinTools } from '../services/agent/tools'
import { buildRoleplaySystemPrompt } from '../services/roleplay-prompt'
import { useCharacterStore } from './character-store'
import { skillRegistry } from '../services/agent/skill-registry'
import { parseSlashCommand, parseMentions, mentionsToToolCalls } from '../services/agent/intent-router'
import { toolRegistry } from '../services/agent/tool-registry'
import type { ToolArtifact } from '../services/agent/tool-registry'
import { estimateTokens, truncateToTokenBudget, initTokenEngine } from '../services/agent/token-budget'
import { retrieveContextForQuery, DEFAULT_RAG_CONFIG, getRAGSummary } from '../services/agent/rag-context-provider'
import { calculateCost } from '../services/llm/prompt-cache'
import { serializeArchive, parseArchive, selectCompressionBatch, type CompressedBatch } from '../services/agent/archive-codec'
import { generateConversationSummary } from '../services/agent/ccr-summary'
import { ipc } from '../services/ipc-client'
import { useProjectStore } from './project-store'

// ===== 类型定义 =====

/** 对话模式：Planning（深度推理）/ Fast（快速执行） */
/** 思考等级（6 级）：quick → swift → balanced → reflective → deep → max */
export type AgentMode = 'quick' | 'swift' | 'balanced' | 'reflective' | 'deep' | 'max'

/** 单条消息 */
export interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number
  /** 是否正在流式生成中 */
  streaming?: boolean
  /** Tool 调用信息（Agent 回复时） */
  toolCalls?: ToolCallInfo[]
  /** 产物列表（Agent 创建/修改的文件、触发的工作流等） */
  artifacts?: ToolArtifact[]
}

/** 单个会话 */
export interface AgentConversation {
  id: string
  /** 会话标题（取自第一条用户消息前 20 个字符） */
  title: string
  messages: AgentMessage[]
  createdAt: number
  updatedAt: number
  /** 当前会话使用的模式 */
  mode: AgentMode
  /** 当前会话使用的模型 ID（null 表示使用默认） */
  modelId: string | null
  /** 角色试演：绑定的角色名（Agent 以该角色身份回复；无此字段为普通会话） */
  roleplayCharacter?: string
  /** CCR：已压缩批次（保留 2-3 代原文，供压缩卡片展开恢复） */
  compressed?: CompressedBatch[]
  /** CCR：滚动摘要（M1，注入 system 尾部标注节） */
  rollingSummary?: string
  /** 创建时项目快照（仅展示与恢复提示，P0 不做按快照注入） */
  projectPath?: string
  projectName?: string
}

// ===== Store 状态接口 =====

interface AgentState {
  /** 所有会话列表（最新的排在前面） */
  conversations: AgentConversation[]
  /** 当前活跃会话 ID */
  activeConversationId: string | null
  /** 是否显示历史面板 */
  showHistory: boolean
  /** 全局默认模式 */
  defaultMode: AgentMode
  /** 当前是否正在生成（用于 UI 状态） */
  generating: boolean
  /** 当前流式请求 ID（用于取消） */
  activeRequestId: string | null
  /** Tool 系统是否已初始化 */
  toolsInitialized: boolean

  // ===== 计算属性（Getters） =====
  /** 获取当前活跃会话 */
  getActiveConversation: () => AgentConversation | null

  // ===== Actions =====
  /** 初始化 Tool 系统 */
  initializeTools: () => void
  /** 新建会话并激活 */
  createConversation: (opts?: { roleplayCharacter?: string; title?: string }) => AgentConversation
  /** 激活指定会话 */
  selectConversation: (id: string) => void
  /** 删除指定会话 */
  deleteConversation: (id: string) => void
  /** 清空所有会话 */
  clearAll: () => void
  /** 切换历史面板 */
  toggleHistory: () => void
  /** 设置历史面板可见性 */
  setShowHistory: (show: boolean) => void
  /** 设置当前会话模式 */
  setMode: (mode: AgentMode) => void
  /** 设置当前会话使用的模型 */
  setModelId: (modelId: string | null) => void
  /** 发送消息（触发 Agent ReAct 循环） */
  sendMessage: (content: string) => Promise<void>
  /** 取消当前生成 */
  cancelGeneration: () => Promise<void>
  /** 响应 Tool 确认（用于 ConfirmCard） */
  resolveToolConfirmation: (toolCallId: string, confirmed: boolean) => void
  /** 启动恢复：扫描 ~/.vela/agent-archive 重建会话列表（loadSeq 防竞态） */
  restoreArchives: () => Promise<void>
  /** 持久化会话（防抖 500ms，fire-and-forget）；convId 缺省取当前活跃会话 */
  persistCurrent: (convId?: string) => Promise<void>
}

// ===== 工具函数 =====

/** 生成唯一 ID */
const genId = () => crypto.randomUUID()

/** 从消息内容生成会话标题 */
const generateTitle = (content: string): string => {
  const cleaned = content.replace(/\s+/g, ' ').trim()
  return cleaned.length > 24 ? cleaned.slice(0, 24) + '…' : cleaned
}

/** 生成 /help 命令的帮助文本 */
const generateHelpText = (): string => {
  const toolCount = toolRegistry.listAll().length
  const skillCount = skillRegistry.listAll().length
  const lines: string[] = [
    t('agent.helpTitle'),
    '',
    t('agent.helpCommands'),
    '',
    t('agent.helpMention'),
    '',
    t('agent.helpTools'),
    t('agent.helpToolCount').replace('{n}', String(toolCount)).replace('{m}', String(skillCount)),
    '',
    t('agent.helpSkills'),
  ]
  for (const s of skillRegistry.listAll()) {
    lines.push('- `/' + s.metadata.name + '` — ' + s.metadata.description)
  }
  lines.push('', t('agent.helpFooter'))
  return lines.join('\n')
}

// ===== Tool 确认回调管理 =====
/** 存储待确认的 Tool 回调 */
const pendingConfirmations = new Map<string, {
  resolve: (confirmed: boolean) => void
}>()

/** 当前活跃的 AbortController（用于取消 ReAct 循环） */
let activeAbortController: AbortController | null = null

/** 当前活跃的流式 LLM 请求 ID（llm:cancel 真正取消底层生成，替代无效的 assistantMsg.id） */
let activeStreamRequestId: string | null = null

/** 生成序号 — 取消后立即发新消息时，旧请求的 onDone/onError 晚到不覆盖新状态 */
let generationSeq = 0

/** archive 恢复请求序号 — 快速启动/重复调用时旧请求晚到不覆盖新状态 */
let archiveLoadSeq = 0
let persistTimer: ReturnType<typeof setTimeout> | null = null

// ===== Zustand Store =====

export const useAgentStore = create<AgentState>()((set, get) => ({
  conversations: [],
  activeConversationId: null,
  showHistory: false,
  defaultMode: 'deep',
  generating: false,
  activeRequestId: null,
  toolsInitialized: false,

  getActiveConversation: () => {
    const { conversations, activeConversationId } = get()
    return conversations.find(c => c.id === activeConversationId) ?? null
  },

  initializeTools: () => {
    if (get().toolsInitialized) return
    registerBuiltinTools()
    // 加载 Skill（内置 + 用户 + 项目级）
    skillRegistry.loadAll().catch(e => console.warn('[Agent] Skill 加载失败:', e))
    // 初始化 Token 引擎（异步，不阻塞）
    initTokenEngine().catch(e => console.warn('[Agent] Token 引擎初始化失败:', e))
    set({ toolsInitialized: true })
  },

  createConversation: (opts?: { roleplayCharacter?: string; title?: string }) => {
    // 确保 Tool 已初始化
    get().initializeTools()

    const llmStore = useLLMStore.getState()
    const project = useProjectStore.getState().currentProject
    const newConv: AgentConversation = {
      id: genId(),
      title: opts?.title ?? t('agent.newConversation'),
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      mode: get().defaultMode,
      modelId: llmStore.defaultModelId,
      roleplayCharacter: opts?.roleplayCharacter,
      projectPath: project?.path,
      projectName: project?.name,
    }
    set(state => ({
      conversations: [newConv, ...state.conversations],
      activeConversationId: newConv.id,
      showHistory: false,
    }))
    get().persistCurrent(newConv.id)
    return newConv
  },

  selectConversation: (id) => {
    set({ activeConversationId: id, showHistory: false })
  },

  deleteConversation: (id) => {
    set(state => {
      const filtered = state.conversations.filter(c => c.id !== id)
      // 如果删除的是当前会话，激活下一条或 null
      const nextId = state.activeConversationId === id
        ? (filtered[0]?.id ?? null)
        : state.activeConversationId
      return { conversations: filtered, activeConversationId: nextId }
    })
    // 同步删除归档文件（主进程幂等删除；fire-and-forget）
    ipc.invoke('fs:agent-archive-delete', id).catch(() => {
      console.warn('[Agent] 归档删除失败:', id)
    })
  },

  clearAll: () => {
    const ids = get().conversations.map(c => c.id)
    set({ conversations: [], activeConversationId: null })
    for (const id of ids) {
      ipc.invoke('fs:agent-archive-delete', id).catch(() => {
        console.warn('[Agent] 归档删除失败:', id)
      })
    }
  },

  toggleHistory: () => {
    set(state => ({ showHistory: !state.showHistory }))
  },

  setShowHistory: (show) => {
    set({ showHistory: show })
  },

  setMode: (mode) => {
    const conv = get().getActiveConversation()
    if (!conv) {
      set({ defaultMode: mode })
      return
    }
    set(state => ({
      defaultMode: mode,
      conversations: state.conversations.map(c =>
        c.id === conv.id ? { ...c, mode } : c
      ),
    }))
  },

  setModelId: (modelId) => {
    const conv = get().getActiveConversation()
    if (!conv) return
    set(state => ({
      conversations: state.conversations.map(c =>
        c.id === conv.id ? { ...c, modelId } : c
      ),
    }))
  },

  sendMessage: async (content) => {
    if (!content.trim() || get().generating) return

    // 确保 Tool 已初始化
    get().initializeTools()

    // ===== P0-4: / 命令拦截 =====
    const trimmedContent = content.trim()
    if (trimmedContent.startsWith('/')) {
      const { command, args } = parseSlashCommand(trimmedContent)
      if (command) {
        switch (command.name) {
          case 'clear': {
            const activeConv = get().getActiveConversation()
            if (activeConv) {
              // ⚠️ P0 修复：/clear 必须同时重置滚动摘要与压缩批次——否则旧主题摘要
              //    继续注入新对话的 system 尾部（污染新主题），压缩卡片也残留旧对话
              set(state => ({
                conversations: state.conversations.map(c =>
                  c.id === activeConv.id
                    ? { ...c, messages: [], rollingSummary: undefined, compressed: undefined }
                    : c
                ),
              }))
              // 清空同步落盘：否则重启后已清空的消息会从 archive 复活
              get().persistCurrent(activeConv.id)
            }
            return
          }
          case 'new':
            get().createConversation()
            return
          case 'help': {
            // 构造帮助信息作为系统消息
            const helpConv = get().getActiveConversation() ?? get().createConversation()
            const helpMsg: AgentMessage = {
              id: genId(), role: 'assistant', content: generateHelpText(), createdAt: Date.now(),
            }
            set(state => ({
              conversations: state.conversations.map(c =>
                c.id === helpConv.id ? { ...c, messages: [...c.messages, helpMsg] } : c
              ),
            }))
            return
          }
          case 'status': {
            // /status → 直接将 read_project_state 的结果展示
            // 不拦截，作为普通消息让 Agent 处理（它会调用 read_project_state）
            break
          }
          default:
            // Skill 命令：把 Skill 内容注入到用户消息中
            if (command.source === 'skill' && command.skill) {
              let skillContent = command.skill.content
              if (args) {
                skillContent = skillContent.replace(/\$\{args\}/g, args).replace(/\$1/g, args)
              }
              // 改写 content：用户意图 + Skill 指令拼接
              content = `${t('agent.skillUsed').replace('{name}', command.skill.metadata.displayName ?? command.name).replace('{args}', args || t('agent.noExtraArgs'))}\n\n${skillContent}`
            }
            break
        }
      }
    }

    // 确保有活跃会话（无则创建）
    let conv = get().getActiveConversation()
    if (!conv) {
      conv = get().createConversation()
    }
    const convId = conv.id

    // 构建用户消息
    const userMsg: AgentMessage = {
      id: genId(),
      role: 'user',
      content: content.trim(),
      createdAt: Date.now(),
    }

    // 构建占位助手消息（ReAct 循环中实时更新）
    const assistantMsg: AgentMessage = {
      id: genId(),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      streaming: true,
      toolCalls: [],
      artifacts: [],
    }

    // 更新会话标题（取第一条用户消息）
    const isFirstMsg = conv.messages.length === 0
    const newTitle = isFirstMsg ? generateTitle(content) : conv.title

    // 把用户消息 + 空助手消息写入会话
    set(state => ({
      generating: true,
      conversations: state.conversations.map(c =>
        c.id === convId
          ? {
              ...c,
              title: newTitle,
              messages: [...c.messages, userMsg, assistantMsg],
              updatedAt: Date.now(),
            }
          : c
      ),
    }))
    // 消息写入即时落盘（leading 写 + 尾写防抖）：否则 archive 只有创建时的空壳快照，
    // 长会话刷新后无法完整恢复
    get().persistCurrent(convId)

    // 辅助函数：更新助手消息
    const updateAssistantMsg = (updater: (msg: AgentMessage) => AgentMessage) => {
      set(state => ({
        conversations: state.conversations.map(c =>
          c.id === convId
            ? {
                ...c,
                messages: c.messages.map(m =>
                  m.id === assistantMsg.id ? updater(m) : m
                ),
              }
            : c
        ),
      }))
    }

    try {
      // 竞态防护：记录本次生成序号，旧请求（取消后）的 onDone/onError 晚到时不覆盖新请求状态
      const mySeq = ++generationSeq
      const llmStore = useLLMStore.getState()
      const currentConv = get().conversations.find(c => c.id === convId)!
      const modelId = currentConv.modelId ?? llmStore.defaultModelId ?? undefined

      if (!modelId) {
        updateAssistantMsg(m => ({
          ...m, content: `⚠️ ${t('agent.noModel')}`, streaming: false,
        }))
        set({ generating: false })
        return
      }

      // 构建系统提示词（包含项目上下文 + Tool 列表）
      let systemPrompt = buildAgentSystemPrompt(currentConv.mode)

      // ===== 角色试演注入：会话绑定角色卡时以角色身份回复（OOC 约束在 roleplay prompt 内） =====
      if (currentConv.roleplayCharacter) {
        const roleChar = useCharacterStore.getState().characters.find(c => c.name === currentConv.roleplayCharacter)
        if (roleChar) {
          systemPrompt += `\n\n${buildRoleplaySystemPrompt(roleChar)}`
        }
      }

      // ===== RAG 自动注入：向量搜索增强上下文 =====
      try {
        const ragResult = await retrieveContextForQuery(
          content.trim(),
          DEFAULT_RAG_CONFIG,
        )
        if (ragResult && ragResult.chunks.length > 0) {
          // ⚠️ M 级修复：标注检索片段的「非事实」语义——模型曾把检索结果当既定事实直接采信
          systemPrompt += `\n\n---\n## 知识库相关上下文（自动检索——以下片段为相关度排序的检索结果，可能与定稿有出入；涉及事实请以最新工具查询为准）\n\n${ragResult.formattedContext}`
          console.debug(`[Agent] ${getRAGSummary(ragResult)}`)
        }
      } catch {
        // RAG 失败不影响主流程
      }

      // ===== P1-5: @ 提及预取（Token 感知限制） =====
      const MENTION_MAX_TOKENS = 1200
      let enrichedUserMessage = content.trim()
      const mentions = parseMentions(enrichedUserMessage)
      if (mentions.length > 0) {
        // 同一目标被多次 @ 时只预取一次（如"对比 @架构 和 @架构"），避免重复注入 + 浪费预算；
        // 文件目标同用 read_file 工具，需按参数（路径）区分，不能只按 toolName 去重
        const prefetchCalls = mentionsToToolCalls(mentions)
          .filter((call, i, arr) => arr.findIndex(c =>
            c.toolName === call.toolName && JSON.stringify(c.args) === JSON.stringify(call.args)
          ) === i)
        const prefetchResults: string[] = []
        let prefetchTokens = 0
        for (const call of prefetchCalls) {
          if (prefetchTokens >= MENTION_MAX_TOKENS) break
          const tool = toolRegistry.get(call.toolName)
          if (tool) {
            try {
              const result = await tool.execute(call.args)
              if (result.success && result.content) {
                const availableBudget = MENTION_MAX_TOKENS - prefetchTokens
                const content = availableBudget > 0
                  ? truncateToTokenBudget(result.content, availableBudget)
                  : result.content
                const contentTokens = estimateTokens(content)
                // 文件预取用路径做标记（多文件时可区分来源），其余用工具名
                const label = call.toolName === 'read_file'
                  ? String((call.args as Record<string, unknown>).file_path ?? call.toolName)
                  : call.toolName
                prefetchResults.push(`[预加载上下文 @${label}]\n${content}`)
                prefetchTokens += contentTokens
              }
            } catch {
              // 预取失败不阻塞主流程
            }
          }
        }
        if (prefetchResults.length > 0) {
          // ⚠️ M 级修复：标注预取数据的时效性——预取后数据可能被修改（角色卡/架构编辑），
          //    模型曾基于过期数据作答
          enrichedUserMessage = `${enrichedUserMessage}\n\n---\n以下是系统预取的项目数据（约 ${prefetchTokens} tokens，可能已过期——涉及当前事实请以最新工具查询为准）：\n\n${prefetchResults.join('\n\n---\n\n')}`
        }
      }

      // ===== CCR 压缩检查（替换原 4000-token 硬丢弃）：超预算时先压缩最旧批 =====
      // 压缩后 messages 剩 rest（最新轮次），压缩批移入 compressed 保留原文（2-3 代）
      const HISTORY_MAX_TOKENS = 4000 // 常量随块上移（原 456-457 行块内 const）
      const preCompressMessages = currentConv.messages.filter(m => !m.streaming && m.role !== 'system')
      const totalHistoryTokens = preCompressMessages.reduce(
        (sum, m) => sum + estimateTokens(m.content), 0,
      )
      if (totalHistoryTokens > HISTORY_MAX_TOKENS) {
        try {
          const { batch, rest } = selectCompressionBatch(currentConv.messages, HISTORY_MAX_TOKENS)
          if (batch.length > 0) {
            const summary = await generateConversationSummary({
              oldSummary: currentConv.rollingSummary ?? '',
              batch,
              modelId,
            })
            const batchNum = (currentConv.compressed?.length ?? 0) + 1
            const newBatch: CompressedBatch = {
              batch: batchNum,
              original: batch,
              summary,
              compressedAt: Date.now(),
              originalTokens: batch.reduce((sum, m) => sum + estimateTokens(m.content), 0),
            }
            // 保留 2-3 代原文防摘要漂移：超过 3 代时丢弃最旧一代的 original（仅留摘要）
            const compressed = [...(currentConv.compressed ?? []), newBatch]
            if (compressed.length > 3) {
              compressed[0] = { ...compressed[0], original: [] }
            }
            set(state => ({
              conversations: state.conversations.map(c =>
                c.id === convId
                  ? { ...c, messages: rest, compressed, rollingSummary: summary, updatedAt: Date.now() }
                  : c
              ),
            }))
            get().persistCurrent(convId)
          }
        } catch {
          // 摘要失败降级：不压缩，走下方硬截断（历史行为，不阻断对话）
          console.warn('[Agent] CCR 摘要生成失败，降级硬截断')
        }
      }

      // 构造历史消息（Token 感知窗口：最多 4000 tokens；CCR 压缩后剩余消息通常已达标）
      const afterCompress = get().conversations.find(c => c.id === convId)!
      const candidateMessages = afterCompress.messages
        .filter(m => !m.streaming && m.role !== 'system')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
        .reverse() // 从最新到最旧
      const historyMessages: LLMMessage[] = []
      let historyTokens = 0
      for (const msg of candidateMessages) {
        const msgTokens = estimateTokens(msg.content)
        if (historyTokens + msgTokens > HISTORY_MAX_TOKENS) break
        historyMessages.unshift(msg) // 还原为正序
        historyTokens += msgTokens
      }

      // LLM 生成函数（流式调用：实时推送文本 + 底层可取消 + 真实 usage）
      // 返回 Promise<string> 完整文本供 ReAct 循环解析 tool_call
      const generateFn = async (
        messages: LLMMessage[],
        mid: string,
        onChunk?: (chunk: string) => void,
      ): Promise<string> => {
        const startTime = Date.now()
        let streamRequestId: string | null = null
        let usage: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number } | undefined

        try {
          const text = await new Promise<string>((resolve, reject) => {
            useLLMStore.getState().generateStream(
              messages.map(m => ({ role: m.role, content: m.content })),
              {
                onChunk: (chunk) => {
                  onChunk?.(chunk)
                },
                onDone: (fullText, u) => {
                  usage = u
                  resolve(fullText)
                },
                onError: (error) => reject(new Error(error)),
              },
              mid,
              { priority: 12 }, // Agent 任务优先于批量任务
            ).then((requestId) => {
              streamRequestId = requestId
              activeStreamRequestId = requestId
            }).catch((error) => reject(error))
          })

          // 记录 LLM 调用日志（流式 usage 真实统计 + 缓存命中费用真实化）
          const model = llmStore.models.find(m => m.id === mid)
          const duration = Date.now() - startTime
          try {
            const cost = usage && model
              ? calculateCost(model, usage.promptTokens, usage.completionTokens, (usage.cachedTokens ?? 0) > 0).totalCost
              : 0
            await (window as unknown as { velaAPI: { invoke: (ch: string, ...args: unknown[]) => Promise<unknown> } }).velaAPI.invoke('db:log-llm-call', {
              model_id: mid,
              model_name: model?.name ?? model?.modelName ?? '',
              purpose: 'agent',
              prompt_tokens: usage?.promptTokens ?? 0,
              completion_tokens: usage?.completionTokens ?? 0,
              total_tokens: usage?.totalTokens ?? 0,
              duration_ms: duration,
              success: 1,
              error_message: '',
              cost,
            })
          } catch { /* 日志失败不影响主流程 */ }

          return text
        } catch (error) {
          // 记录失败日志
          const model = llmStore.models.find(m => m.id === mid)
          try {
            await (window as unknown as { velaAPI: { invoke: (ch: string, ...args: unknown[]) => Promise<unknown> } }).velaAPI.invoke('db:log-llm-call', {
              model_id: mid,
              model_name: model?.name ?? model?.modelName ?? '',
              purpose: 'agent',
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0,
              duration_ms: Date.now() - startTime,
              success: 0,
              error_message: String(error),
            })
          } catch { /* 日志失败不影响主流程 */ }
          throw error
        } finally {
          if (activeStreamRequestId === streamRequestId) {
            activeStreamRequestId = null
          }
        }
      }

      // AbortController 用于取消（P1-7: 提升到模块级变量以便 cancelGeneration 访问）
      const abortController = new AbortController()
      activeAbortController = abortController
      set({ activeRequestId: assistantMsg.id })

      // 启动 ReAct 循环（使用预取增强后的用户消息）
      // 分块缓冲：减少 React re-render 次数
      // 纯时间驱动（间隔硬约束）：流式 chunk 大小不受控（快模型单片可 >200 字符），
      // 按大小立即 flush 会绕过时间间隔 → 高频 setState 阻塞主线程（同 workflow-store 教训）
      let chunkBuffer = ''
      let lastFlushTime = 0 // 0 = 首块立即 flush，首帧无延迟
      const FLUSH_INTERVAL_MS = 50

      const flushChunkBuffer = () => {
        if (!chunkBuffer) return
        updateAssistantMsg(m => ({
          ...m,
          content: m.content + chunkBuffer,
        }))
        chunkBuffer = ''
        lastFlushTime = Date.now()
      }

      await runAgentLoop(
        systemPrompt,
        historyMessages,
        enrichedUserMessage,
        modelId,
        generateFn,
        {
          onTextChunk: (chunk) => {
            // 清理所有形式的 tool_call/tool_result 标签（完整对 + 孤立片段）
            const cleaned = chunk
              .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
              .replace(/<\/?tool_call>/g, '')
              .replace(/<\/?tool_result[^>]*>/g, '')
              .trim()
            if (!cleaned) return
            chunkBuffer += cleaned
            // 仅时间驱动：两次 flush 之间强制 ≥50ms，大小不再立即触发
            if (Date.now() - lastFlushTime >= FLUSH_INTERVAL_MS) {
              flushChunkBuffer()
            }
          },
          onToolCallStart: (toolCall) => {
            // 需确认的工具会收到两次 start（waiting_confirm + running），已存在则更新而非重复追加
            updateAssistantMsg(m => {
              const existing = m.toolCalls ?? []
              const idx = existing.findIndex(tc => tc.id === toolCall.id)
              return {
                ...m,
                toolCalls: idx >= 0
                  ? existing.map(tc => tc.id === toolCall.id ? toolCall : tc)
                  : [...existing, toolCall],
              }
            })
          },
          onToolCallComplete: (toolCall) => {
            updateAssistantMsg(m => ({
              ...m,
              toolCalls: (m.toolCalls ?? []).map(tc =>
                tc.id === toolCall.id ? toolCall : tc
              ),
            }))
          },
          onToolCallConfirmRequired: (toolCall) => {
            // 更新 UI 显示确认状态
            updateAssistantMsg(m => ({
              ...m,
              toolCalls: (m.toolCalls ?? []).map(tc =>
                tc.id === toolCall.id ? { ...tc, status: 'waiting_confirm' as const } : tc
              ),
            }))

            // 返回 Promise，等待用户通过 resolveToolConfirmation 响应
            return new Promise<boolean>((resolve) => {
              pendingConfirmations.set(toolCall.id, { resolve })
            })
          },
          onDone: (fullText, toolCalls, artifacts) => {
            // 旧请求晚到（取消后已发新消息）：忽略，避免覆盖新请求的 generating 状态
            if (mySeq !== generationSeq) return
            // 刷新任何残留的缓冲区
            flushChunkBuffer()
            // 最终文本全量清洗，去除所有形式的 tool_call / tool_result 标签
            const cleanedText = fullText
              .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
              .replace(/<tool_result[\s\S]*?<\/tool_result>/g, '')
              .replace(/<\/?tool_call>/g, '')
              .replace(/<\/?tool_result[^>]*>/g, '')
              .replace(/\n{3,}/g, '\n\n')
              .trim()
            updateAssistantMsg(m => ({
              ...m,
              content: cleanedText,
              streaming: false,
              toolCalls,
              artifacts: artifacts.length > 0 ? artifacts : undefined,
            }))
            set(state => ({
              generating: false,
              activeRequestId: null,
              conversations: state.conversations.map(c =>
                c.id === convId ? { ...c, updatedAt: Date.now() } : c
              ),
            }))
            // 流式完成最终状态落盘（含完整助手回复/tool 产物）：刷新后可完整恢复
            get().persistCurrent(convId)
          },
          onError: (error) => {
            if (mySeq !== generationSeq) return
            updateAssistantMsg(m => ({
              ...m,
              content: t('agent.errorGenerated').replace('{error}', error),
              streaming: false,
            }))
            set({ generating: false, activeRequestId: null })
          },
        },
        abortController.signal,
      )
    } catch (error) {
      updateAssistantMsg(m => ({
        ...m,
        content: t('agent.errorException').replace('{error}', String(error)),
        streaming: false,
      }))
      set({ generating: false, activeRequestId: null })
    }
  },

  cancelGeneration: async () => {
    // 触发 AbortSignal，使 ReAct 循环中止（下一轮检查）
    if (activeAbortController) {
      activeAbortController.abort()
      activeAbortController = null
    }

    // 真实取消底层流式请求（旧实现传 assistantMsg.id 给 llm:cancel 无效，底层 API 会跑完）
    if (activeStreamRequestId) {
      await useLLMStore.getState().cancelGeneration(activeStreamRequestId)
      activeStreamRequestId = null
    }

    // 清理所有等待确认的 Promise，防止内存泄漏
    for (const [, pending] of pendingConfirmations) {
      pending.resolve(false) // 取消时默认拒绝
    }
    pendingConfirmations.clear()

    // 找到正在 streaming 的消息，关闭其状态
    set(state => ({
      generating: false,
      activeRequestId: null,
      conversations: state.conversations.map(c => ({
        ...c,
        messages: c.messages.map(m =>
          m.streaming ? { ...m, streaming: false, content: m.content + '\n\n_' + t('agent.stoppedGenerating') + '_' } : m
        ),
      })),
    }))
  },

  resolveToolConfirmation: (toolCallId, confirmed) => {
    const pending = pendingConfirmations.get(toolCallId)
    if (pending) {
      pending.resolve(confirmed)
      pendingConfirmations.delete(toolCallId)
    }
  },

  restoreArchives: async () => {
    const mySeq = ++archiveLoadSeq
    try {
      const list = (await ipc.invoke('fs:agent-archive-list')) as { id: string; title: string; updatedAt: number }[]
      const restored: AgentConversation[] = []
      for (const meta of list) {
        const raw = await ipc.invoke('fs:agent-archive-read', meta.id) as string | null
        if (!raw) continue
        const conv = parseArchive(raw)
        if (conv) restored.push(conv)
      }
      if (mySeq !== archiveLoadSeq) return // 旧请求晚到不覆盖
      set(state => {
        // 顺序二次调用（HMR 重执行/未来刷新入口）按 id 去重，避免整体重复
        const existingIds = new Set(state.conversations.map(c => c.id))
        const merged = [...restored.filter(c => !existingIds.has(c.id)), ...state.conversations]
        return { conversations: merged }
      })
    } catch {
      // 恢复失败静默（首次启动无归档目录属正常）
    }
  },

  persistCurrent: async (convId?: string) => {
    // 首写立即落盘（快照即时可见，恢复流程依赖首写落盘）；
    // 500ms 窗口内重复调用走尾写防抖，收尾写合并（fire-and-forget）
    // ⚠️ 必须按「变更会话 convId」而非「当前活跃会话」序列化：会话 A 生成中
    //    （ReAct 30-120s）用户切到 B，A 的 onDone 落盘若取活跃会话会把 A 的流式状态
    //    写到 B 名下，A 的 archive 停在 leading 写的空助手占位符（streaming:true），
    //    重启后 A 回复空白。所有调用点均已传 convId。
    const targetId = convId ?? get().activeConversationId
    if (!targetId) return
    const doWrite = (cid: string) => {
      const conv = get().conversations.find(c => c.id === cid)
      if (!conv) return
      ipc.invoke('fs:agent-archive-write', conv.id, serializeArchive(conv)).catch(() => {
        console.warn('[Agent] 会话归档写盘失败:', conv.id)
      })
    }
    if (persistTimer) {
      clearTimeout(persistTimer)
    }
    doWrite(targetId)
    persistTimer = setTimeout(() => {
      persistTimer = null
      doWrite(targetId)
    }, 500)
  },
}))
