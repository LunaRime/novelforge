import { create } from 'zustand'
import { t } from '../shared/locale'
import { useLLMStore } from './llm-store'
import { buildAgentSystemPromptAsync } from '../services/agent/context-builder'
import { runAgentLoop, type ToolCallInfo, type LLMMessage } from '../services/agent/agent-engine'
import { clearReadState } from '../services/agent/tools/read-file.tool'
import { registerBuiltinTools } from '../services/agent/tools'
import { detectWritingIntent, type WritingIntent } from '../services/agent/writing-intent'
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

/** fork/rewind 分支：rewind 归档（可恢复） */
export interface RewoundBranch {
  messageId: string
  messages: AgentMessage[]
  rewoundAt: number
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
  /** fork 自哪个会话（无此字段为根会话） */
  parentId?: string
  /** fork 起点消息 id（该消息及之前的历史已复制进新会话） */
  forkMessageId?: string
  /** rewind 归档：被截断消息，可 restoreRewound 恢复 */
  rewound?: RewoundBranch[]
}

// ===== Store 状态接口 =====

interface AgentState {
  /** 所有会话列表（最新的排在前面） */
  conversations: AgentConversation[]
  /** 当前活跃会话 ID */
  activeConversationId: string | null
  /** 是否显示历史面板 */
  showHistory: boolean
  /** 是否显示记忆查看器（AgentHeader 记忆按钮 → AgentMemoryView，P3 Task 3） */
  memoryView: boolean
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
  /** 切换记忆查看器（与历史面板互斥） */
  toggleMemoryView: () => void
  /** 设置记忆查看器可见性 */
  setMemoryView: (show: boolean) => void
  /** 设置当前会话模式 */
  setMode: (mode: AgentMode) => void
  /** 设置当前会话使用的模型 */
  setModelId: (modelId: string | null) => void
  /** 发送消息（触发 Agent ReAct 循环） */
  sendMessage: (content: string) => Promise<void>
  /** 意图预路由处理（内部）：强命中直接触发工作流并注入汇报消息；弱命中注入澄清；
   *  character 分支返回 { status: 'none', enhancedContent }（不 append 消息，由主流程在 userMsg
   *  构建时替换 content——P0-4）；未命中返回 { status: 'none' } */
  handleWritingIntent: (intent: WritingIntent, rawContent: string) => Promise<{ status: 'handled' | 'none'; enhancedContent?: string }>
  /** 取消当前生成 */
  cancelGeneration: () => Promise<void>
  /** 响应 Tool 确认（用于 ConfirmCard） */
  resolveToolConfirmation: (toolCallId: string, confirmed: boolean) => void
  /** 启动恢复：扫描 ~/.vela/agent-archive 重建会话列表（loadSeq 防竞态） */
  restoreArchives: () => Promise<void>
  /** 从指定消息 fork 新会话：复制到起点（含）的历史（过滤 system），新会话立即可用（自动激活）；
   *  返回新会话 id；无活跃会话或 messageId 无效返回 null */
  forkFromMessage: (messageId: string) => string | null
  /** 回退到指定消息（截断到起点含，被截断消息入 rewound 归档可恢复）；
   *  返回是否成功；无活跃会话或 messageId 无效返回 false */
  rewindToMessage: (messageId: string) => boolean
  /** 恢复第 entryIndex 个 rewind 归档：归档消息 append 回 messages（rewind 可逆）；
   *  返回是否成功；无归档或索引无效返回 false */
  restoreRewound: (entryIndex: number) => boolean
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
  memoryView: false,
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
      memoryView: false,
    }))
    // 新建会话后清空读去重状态：新会话的重复读应重新全量注入（上下文不同）
    clearReadState()
    get().persistCurrent(newConv.id)
    return newConv
  },

  selectConversation: (id) => {
    set({ activeConversationId: id, showHistory: false, memoryView: false })
    // 切换会话后清空读去重状态：新会话的重复读应重新全量注入（上下文不同）
    clearReadState()
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
    // 清空读去重状态：删除活跃会话时 activeConversationId 会切换到既有会话——
    // 新活跃会话从未读过该文件，却会命中上一会话的 file_unchanged 桩（零内容）。
    // 与 createConversation/selectConversation 挂钩一致（后者即使选择同一会话也清空）
    clearReadState()
    // 同步删除归档文件（主进程幂等删除；fire-and-forget）
    ipc.invoke('fs:agent-archive-delete', id).catch(() => {
      console.warn('[Agent] 归档删除失败:', id)
    })
  },

  clearAll: () => {
    const ids = get().conversations.map(c => c.id)
    set({ conversations: [], activeConversationId: null })
    // 清空所有会话后同步清空读去重状态（防会话间模块级状态残留）
    clearReadState()
    for (const id of ids) {
      ipc.invoke('fs:agent-archive-delete', id).catch(() => {
        console.warn('[Agent] 归档删除失败:', id)
      })
    }
  },

  toggleHistory: () => {
    set(state => ({ showHistory: !state.showHistory, memoryView: false }))
  },

  setShowHistory: (show) => {
    set({ showHistory: show, memoryView: false })
  },

  toggleMemoryView: () => {
    set(state => ({ memoryView: !state.memoryView, showHistory: false }))
  },

  setMemoryView: (show) => {
    set({ memoryView: show, showHistory: false })
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

    // ===== 意图预路由（阶段 A）：/命令与@未命中后，本地意图识别 → 确定性触发 or 澄清 or 兜底 =====
    // 守卫：/ 前缀输入（/status 穿透分支、未知/自定义 skill 命令改写分支——皆未 return 到达此处）
    // 全量保持改动前落 ReAct 的行为不变——预路由只对非 slash 输入有增量价值（查询→写工作流零切换）
    const intent = !trimmedContent.startsWith('/') ? detectWritingIntent(trimmedContent) : { kind: 'none' as const }
    let enhancedContent: string | undefined
    try {
      if (intent.kind !== 'none') {
        const res = await get().handleWritingIntent(intent, trimmedContent)
        if (res.status === 'handled') return
        enhancedContent = res.enhancedContent
        // P0-4：增强后文本同步替换 content——后续 userMsg/标题/RAG/@ 预取/enrichedUserMessage
        // 全部基于增强后文本执行（与 skill 注入改写 content 的既有手法一致）
        if (enhancedContent !== undefined) content = enhancedContent
      }
    } catch (error) {
      // 评审修复（I2）：预路由无兜底——handleWritingIntent 对非 WorkflowStartError 一律 rethrow（真实可达源：
      // workflow-starter.ts 的 startWorkflow 在 starter try 之外直抛），此前 sendMessage 直接 reject：
      // 无错误消息、无用户消息、generating 未置位。兜底：注入 `发生异常` 文案（与下方 ReAct try/catch
      // 的既有形态一致）并 return——不让 sendMessage reject，会话保持可继续对话
      const errorMsg: AgentMessage = {
        id: genId(), role: 'assistant',
        content: t('agent.errorException').replace('{error}', String(error)),
        createdAt: Date.now(),
      }
      set(state => ({
        conversations: state.conversations.map(c =>
          c.id === conv.id ? { ...c, messages: [...c.messages, errorMsg], updatedAt: Date.now() } : c
        ),
      }))
      get().persistCurrent(convId)
      return
    }
    // 未命中继续走原有 ReAct 链路——userMsg 构建处 content 取 enhancedContent ?? content.trim()

    // 构建用户消息（意图预路由 character 命中时 content 为增强后的完整请求——P0-4）
    const userMsg: AgentMessage = {
      id: genId(),
      role: 'user',
      content: enhancedContent ?? content.trim(),
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

      // 构建系统提示词（包含项目上下文 + Tool 列表；M2 作品记忆异步读盘注入，失败降级仅 M1）
      let systemPrompt = await buildAgentSystemPromptAsync(currentConv.mode)

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
              cached_tokens: usage?.cachedTokens ?? 0,
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
              cached_tokens: 0,
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

  handleWritingIntent: async (intent, rawContent) => {
    const conv = get().getActiveConversation()
    if (!conv) return { status: 'none' }
    // 评审修复（M5）：t 已在模块顶部静态导入——动态 import 冗余（handleWritingIntent 不受影响）
    const { startChapterWorkflow, startBlueprintWorkflow, startArchitectureWorkflow, WorkflowStartError } = await import('../services/workflows/workflow-starter')

    // ⚠️ P0-4 修订：**不在此 append 用户消息**——用户消息由 sendMessage 主流程统一构建/append（唯一入口）；
    //    原实现「这里 append 原文 + character 分支 append 增强 + 主流程再 append 原文」= 用户原文 2 次 + 增强 1 次，三重复
    const appendMsg = (msg: AgentMessage) => {
      set(state => ({
        conversations: state.conversations.map(c =>
          c.id === conv.id ? { ...c, messages: [...c.messages, msg], updatedAt: Date.now() } : c
        ),
      }))
      get().persistCurrent(conv.id)
    }

    const makeStartedMsg = (displayName: string, chapterTag: string): AgentMessage => ({
      id: genId(), role: 'assistant',
      content: t('agent.intentStarted').replace('{name}', displayName).replace('{chapter}', chapterTag),
      createdAt: Date.now(),
      artifacts: [{ type: 'workflow_started', name: `${displayName} ${chapterTag}`.trim() }],
    })

    try {
      switch (intent.kind) {
        case 'chapter_creation': {
          const chapter = intent.chapter
          if (chapter === null) {  // 「写」无章号
            appendMsg({ id: genId(), role: 'assistant', content: t('agent.intentClarifyChapter'), createdAt: Date.now() })
            return { status: 'handled' }
          }
          if (typeof chapter === 'object') {
            // 批量：逐章触发（v1 串行）
            for (let n = chapter.from; n <= chapter.to; n++) {
              const r = await startChapterWorkflow('generate_draft', n)
              appendMsg(makeStartedMsg(r.displayName, r.chapterTag))
            }
          } else {
            const r = await startChapterWorkflow('generate_draft', chapter)
            appendMsg(makeStartedMsg(r.displayName, r.chapterTag))
          }
          return { status: 'handled' }
        }
        case 'refine': {
          const chap = intent.chapter
          if (chap === null) {  // 无定位 → 澄清
            appendMsg({ id: genId(), role: 'assistant', content: t('agent.intentClarifyRefine'), createdAt: Date.now() })
            return { status: 'handled' }
          }
          const r = await startChapterWorkflow('refine', chap)
          appendMsg(makeStartedMsg(r.displayName, r.chapterTag))
          return { status: 'handled' }
        }
        case 'architecture': {
          const r = intent.target === 'blueprint'
            ? await startBlueprintWorkflow()
            : await startArchitectureWorkflow()
          appendMsg({
            id: genId(), role: 'assistant',
            content: t('agent.intentStartedNoChapter').replace('{name}', r.displayName),
            createdAt: Date.now(),
            artifacts: [{ type: 'workflow_started', name: r.displayName }],
          })
          return { status: 'handled' }
        }
        case 'character': {
          // v1：角色无现成工作流 → 参数提取 + 增强内容返回主流程（P0-4：不 append 任何消息，
          // 主流程在 userMsg 构建时替换 content——用户历史中为增强后的完整请求，原文仅出现 1 次）
          const op = intent.action === 'create' ? t('agent.intentCharCreate') : t('agent.intentCharUpdate')
          return { status: 'none', enhancedContent: `${op}：${intent.name}\n\n${rawContent}` }
        }
        case 'ambiguous':
          // 评审修复（M2）：按 hint 映射澄清文案——hint='chapter'（「帮我写」等缺章号写稿祈使）用
          // intentClarifyChapter（此前该键不可达，用户收到通用模糊句）；character 与其他 hint 用通用澄清
          appendMsg({
            id: genId(), role: 'assistant',
            content: intent.hint === 'character'
              ? t('agent.intentClarifyGeneric')
              : intent.hint === 'chapter'
                ? t('agent.intentClarifyChapter')
                : t('agent.intentClarifyGeneric'),
            createdAt: Date.now(),
          })
          return { status: 'handled' }
        case 'none':
          return { status: 'none' }
      }
    } catch (e) {
      if (e instanceof WorkflowStartError) {
        // P0-3：ERR_NO_BLUEPRINT 用 e.message（buildDraftWorkflow 内已带 wfBlueprintDataMissing 文案，归因精准）；
        // ERR_GUARD 用意图层文案
        const msg = e.code === 'ERR_GUARD' ? t('agent.intentGuardFail') : e.message
        appendMsg({ id: genId(), role: 'assistant', content: msg, createdAt: Date.now() })
        return { status: 'handled' }
      }
      throw e
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

  forkFromMessage: (messageId) => {
    const conv = get().getActiveConversation()
    if (!conv) return null
    const idx = conv.messages.findIndex(m => m.id === messageId)
    if (idx < 0) return null
    // 复制到起点（含）——system 消息 + in-flight streaming 占位符显式过滤（评审注意点已核验：
    //   生成链路独立构建 system——buildAgentSystemPromptAsync agent-store:517 每次生成重建 +
    //   historyMessages 过滤 role!=='system'（:633），过滤不影响 fork 后新会话生成；
    //   此处过滤只为保持会话数据干净；streaming 占位符不复制——fork 后其流式更新仍指向原会话 id）
    const forkMsgs = conv.messages
      .slice(0, idx + 1)
      .filter(m => m.role !== 'system' && !m.streaming)
      .map(m => ({ ...m }))
    const newConv: AgentConversation = {
      ...conv,
      id: genId(),
      title: `${conv.title}${t('agent.forkSuffix')}`,
      messages: forkMsgs,
      parentId: conv.id,
      forkMessageId: messageId,
      // rewound 不复制（新会话无归档）
      rewound: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    set(s => ({
      // 与 createConversation 一致的 prepend（列表合同「最新的排在前面」）；history 面板按
      // updatedAt 排序故视觉不受影响，但 deleteConversation 的 filtered[0] 回退激活依赖该序
      conversations: [newConv, ...s.conversations],
      activeConversationId: newConv.id,
    }))
    get().persistCurrent(newConv.id)
    return newConv.id
  },

  rewindToMessage: (messageId) => {
    // 生成期间不可回退：截断占位符进归档而 LLM 仍继续烧 token（onDone 写回旧 conv——回复丢失无信号）。
    // 守卫放 store 层最稳（发送方唯一入口），UI 禁用留后续
    if (get().generating) return false
    const conv = get().getActiveConversation()
    if (!conv) return false
    const idx = conv.messages.findIndex(m => m.id === messageId)
    if (idx < 0) return false
    const truncated = conv.messages.slice(idx + 1)
    // 回退到最后一条消息：无截断内容，空 entry 无意义（不 append）
    if (truncated.length === 0) return false
    const entry: RewoundBranch = { messageId, messages: truncated, rewoundAt: Date.now() }
    set(s => ({
      conversations: s.conversations.map(c =>
        c.id === conv.id
          ? { ...c, messages: c.messages.slice(0, idx + 1), rewound: [...(c.rewound ?? []), entry] }
          : c
      ),
    }))
    get().persistCurrent(conv.id)
    return true
  },

  restoreRewound: (entryIndex) => {
    const conv = get().getActiveConversation()
    if (!conv || !conv.rewound || entryIndex < 0 || entryIndex >= conv.rewound.length) return false
    const entry = conv.rewound[entryIndex]
    set(s => ({
      conversations: s.conversations.map(c =>
        c.id === conv.id
          ? { ...c, messages: [...c.messages, ...entry.messages], rewound: c.rewound?.filter((_, i) => i !== entryIndex) }
          : c
      ),
    }))
    get().persistCurrent(conv.id)
    return true
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
