import { useEffect, useMemo, useRef, useState } from 'react'
import { GitFork, Trash2, Pin, Pencil, Archive, Plus, ChevronRight } from 'lucide-react'
import { useAgentStore } from '../../../stores/agent-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useLLMStore } from '../../../stores/llm-store'
import { useProjectStore } from '../../../stores/project-store'
import AgentMessage from './AgentMessage'
import AgentInputBox from './AgentInputBox'
import AgentMemoryView from './AgentMemoryView'
import CompressedBatchCard from './CompressedBatchCard'
import ContextBudgetBar from './ContextBudgetBar'
import { computeContextUsage } from '../../../services/agent/context-usage'
import { buildAgentSystemSegments, buildAgentSystemSegmentsAsync } from '../../../services/agent/context-builder'
import { ipc } from '../../../services/ipc-client'
import type { AgentMode } from '../../../stores/agent-store'
import { formatRelativeTime } from '../../../utils/time'
import { useTranslation } from '../../../hooks/useTranslation'
import { confirm } from '../../ui/Confirm'

/**
 * 对话区域主组件
 * - 空状态：居中显示欢迎词 + 输入框 + 最近会话（参考 agent1.html pt-[30vh] 设计）
 * - 有会话：消息列表 + 底部固定输入框
 */
export default function AgentConversation() {
  const { getActiveConversation, showHistory, memoryView } = useAgentStore()
  const activeConv = getActiveConversation()

  // 历史面板模式
  if (showHistory) {
    return <AgentHistoryPanel />
  }

  // 记忆查看器模式（AgentHeader「记忆」按钮 → AgentMemoryView）
  if (memoryView) {
    return <AgentMemoryView />
  }

  // 空状态（无活跃会话）
  if (!activeConv || activeConv.messages.length === 0) {
    return <EmptyState />
  }

  // 有消息的对话视图
  return <ActiveConversation />
}

// ===== 空状态视图 =====

function EmptyState() {
  const { conversations, selectConversation } = useAgentStore()
  const { t } = useTranslation()
  // 最近会话条数默认 3，可通过全局配置 recentConversationCount 覆盖（读取失败/非法值静默降级为 3）
  const [recentCount, setRecentCount] = useState(3)
  useEffect(() => {
    let cancelled = false
    ipc.invoke('config:get')
      .then(cfg => {
        if (!cancelled && typeof cfg?.recentConversationCount === 'number' && cfg.recentConversationCount > 0) {
          setRecentCount(cfg.recentConversationCount)
        }
      })
      .catch(() => { /* config:get 读取失败保持默认 3 */ })
    return () => { cancelled = true }
  }, [])
  // 取最近 recentCount 条历史会话（不包含当前空会话）
  const recentConvs = conversations
    .filter(c => c && c.messages.length > 0)
    .slice(0, recentCount)



  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 内容区（滚动）——输入框已移至面板下部固定，此处仅保留引导内容。
          2026-09-22 UI 重做：改成 flex-col + 顶部对齐（原 paddingTop max(8vh,32px) 把内容
          往下推、下方留一大片空白）+ 披露声明 mt-auto 压到底部，避免它夹在内容中间。 */}
      <div className="flex-1 overflow-y-auto flex flex-col">
      <div
        className="px-4 flex-1 flex flex-col"
        style={{ paddingTop: 16, paddingBottom: 16 }}
      >
        {/* 标题（紧凑：text-sm，与 IDE 工具面板风格一致） */}
        <div className="mb-1 pl-1 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
          NovelForge
        </div>
        {/* 副标题 */}
        <div className="mb-3 pl-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {(() => {
            const text = t('agent.subtitle')
            const parts: React.ReactNode[] = []
            let last = 0
            const re = /([/@])/g
            let m: RegExpExecArray | null
            while ((m = re.exec(text)) !== null) {
              if (m.index > last) parts.push(text.slice(last, m.index))
              parts.push(<code key={m.index} className="px-1 py-0.5 rounded text-micro" style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-accent)' }}>{m[1]}</code>)
              last = m.index + 1
            }
            if (last < text.length) parts.push(text.slice(last))
            return <>{parts}</>
          })()}
        </div>

        {/* 最近会话（如有） */}
        {recentConvs.length > 0 && (
          <div className="mt-4">
            <div className="flex flex-col gap-0">
              {recentConvs.map(conv => (
                <RecentConversationItem
                  key={conv.id}
                  title={conv.title}
                  updatedAt={conv.updatedAt}
                  onClick={() => selectConversation(conv.id)}
                  onDelete={async () => {
                    const ok = await confirm(
                      t('agent.confirmDeleteConversation').replace('{title}', conv.title),
                      { danger: true, confirmText: t('agent.deleteConversation') },
                    )
                    if (ok) useAgentStore.getState().deleteConversation(conv.id)
                  }}
                />
              ))}
            </div>
            {conversations.filter(c => c.messages.length > 0).length > recentCount && (
              <button
                onClick={() => useAgentStore.getState().setShowHistory(true)}
                className="mt-4 text-left text-xs transition-all hover:underline"
                style={{ color: 'var(--color-text-muted)' }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              >
                {t('action.loadMore')}
              </button>
            )}
          </div>
        )}

      </div>
      </div>

      {/* 输入框固定于面板下部。
          2026-09-22：去掉 borderTop —— 与对话视图同步，输入框上方不再有分隔线；
          披露声明也从内容区底部移到**这里**（紧贴输入框上方，用户指定） */}
      <div className="flex-shrink-0 px-3 pb-3 pt-2">
        <div className="mb-1 px-1 text-center text-2xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          {t('agent.disclaimer')}
        </div>
        <AgentInputBox />
      </div>
    </div>
  )
}

// ===== 活跃对话视图 =====

/**
 * 预算条记忆段数据源（F3）：与真实注入共用 buildAgentSystemSegmentsAsync——
 * 注入实际含 M1+M2（~1.1k tokens），此前预算条走同步 M1-only（~300）显示与实况不符。
 * 竞态/卸载安全：cancelled 标志丢弃过期响应；loaded 携带 key（会话/模式/项目），
 * 过期响应即使已 setState 也在渲染时按 key 丢弃——避免 effect 内同步 setState 级联渲染。
 */
function useAsyncSegments(activeConv: { id?: string; mode?: AgentMode } | null): { base: string; memoryM1: string; memoryM2: string } | null {
  const [loaded, setLoaded] = useState<{ key: string; segments: { base: string; memoryM1: string; memoryM2: string } } | null>(null)
  const projectPath = useProjectStore.getState().currentProject?.path ?? null
  const convId = activeConv?.id ?? ''
  const mode = activeConv?.mode ?? 'quick'
  const key = `${convId}|${mode}|${projectPath}`

  useEffect(() => {
    if (!convId) return
    let cancelled = false
    buildAgentSystemSegmentsAsync(mode)
      .then(segments => { if (!cancelled) setLoaded({ key, segments }) })
      .catch(() => { /* M2 读盘失败降级：保持同步兜底 */ })
    return () => { cancelled = true }
  }, [convId, mode, projectPath, key])

  return loaded && loaded.key === key ? loaded.segments : null
}

function ActiveConversation() {
  const { getActiveConversation, generating } = useAgentStore()
  const { t } = useTranslation()
  const activeConv = getActiveConversation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [currentInput, setCurrentInput] = useState('')
  const asyncSegments = useAsyncSegments(activeConv)

  // 输入框内容追踪（AgentInputBox 内部状态，通过冒泡 input 事件捕获——预算条 current 段用，P0 近似）
  useEffect(() => {
    const onInput = (e: Event) => {
      const el = e.target as HTMLElement | null
      if (el && el.tagName === 'TEXTAREA' && rootRef.current?.contains(el)) {
        setCurrentInput((el as HTMLTextAreaElement).value)
      }
    }
    document.addEventListener('input', onInput)
    return () => document.removeEventListener('input', onInput)
  }, [])

  // 消息变化时自动滚动到底部
  useEffect(() => {
    if (isAtBottom && scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [activeConv?.messages, generating, isAtBottom])

  // 监听滚动位置判断是否在底部
  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setIsAtBottom(distanceFromBottom < 60)
  }

  /** 跳转到底部 */
  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }

  /** 分支：从指定消息 fork 新会话（B1 数据层：复制起点含历史，自动激活） */
  const handleFork = (messageId: string) => {
    useAgentStore.getState().forkFromMessage(messageId)
    // 自动滚动到新会话底部
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }))
  }

  /** 回退：确认后截断到指定消息（可恢复） */
  const handleRewind = async (messageId: string) => {
    const ok = await confirm(t('agent.confirmRewind'), {
      title: t('agent.confirmRewindTitle'),
      confirmText: t('dialog.confirmRewind'),
      danger: true,
    })
    if (ok) useAgentStore.getState().rewindToMessage(messageId)
  }

  if (!activeConv) return null

  // 可见消息列表（过滤 system——显示层与 store 层独立：store 按物理序截断，展示按可见序）
  const visibleMessages = activeConv.messages.filter(m => m.role !== 'system')
  /** 末条可见消息 id（F6/D1）：rewind 到末条无内容可截断（store 静默 no-op）——按钮禁用 + 解释性 tooltip */
  const lastVisibleId = visibleMessages.length > 0 ? visibleMessages[visibleMessages.length - 1].id : null

  // 上下文占用分段（P0 近似：history 用当前 messages 估算，非实际发送副本）
  // F3：与注入共用 async 数据源（M1+M2 真实值）；async 未就绪时同步 M1-only 兜底，避免闪烁
  const syncSegments = buildAgentSystemSegments(activeConv.mode)
  const usageSegments = asyncSegments ?? { base: syncSegments.base, memoryM1: syncSegments.memory, memoryM2: '' }
  const currentProjectName = useProjectStore.getState().currentProject?.name ?? null
  const modelId = activeConv.modelId ?? useLLMStore.getState().defaultModelId
  const modelMax = useLLMStore.getState().models.find(m => m.id === modelId)?.maxTokens ?? 131072
  const contextUsage = computeContextUsage({
    base: usageSegments.base,
    memory: [usageSegments.memoryM2, usageSegments.memoryM1].filter(Boolean).join('\n\n---\n\n'),
    historyMessages: activeConv.messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role, content: m.content })),
    currentContent: currentInput,
    modelMax,
  })

  return (
    <div ref={rootRef} className="flex flex-col h-full relative">
      {/* 消息列表滚动区 */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        <div className="flex flex-col">
          {/* 恢复提示：会话基于快照项目，与当前打开项目不一致（P0 仅提示，不静默切换） */}
          {activeConv.projectName && currentProjectName && activeConv.projectName !== currentProjectName && (
            <div className="mx-2 my-2 rounded-lg px-3 py-1.5 text-xs" style={{ backgroundColor: 'var(--color-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
              {t('ccr.restoreProjectHint').replace('{name}', activeConv.projectName).replace('{current}', currentProjectName)}
            </div>
          )}
          {/* CCR 压缩事件卡片：已折叠批次（按 batch 序，早的在前） */}
          {(activeConv.compressed ?? [])
            .slice()
            .sort((a, b) => a.batch - b.batch)
            .filter(b => b.summary)
            .map(b => (
              <CompressedBatchCard key={b.batch} batch={b} />
            ))}
          {visibleMessages.map(msg => (
            <AgentMessage
              key={msg.id}
              message={msg}
              onFork={handleFork}
              onRewind={handleRewind}
              // 末条：不可回退（F6 store 已 no-op）——禁用 + 解释性 tooltip 消除无声失败
              rewindDisabled={msg.id === lastVisibleId}
            />
          ))}
        </div>
        {/* 底部空间 */}
        <div className="h-4" />
      </div>

      {/* 跳到底部浮动按钮 */}
      {!isAtBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute z-10 flex items-center justify-center w-7 h-7 rounded-full shadow-md transition-all"
          style={{
            right: 16,
            bottom: 100,
            backgroundColor: 'var(--color-sidebar)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-secondary)',
          }}
          title={t('tip.scrollBottom')}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--color-accent)'
            e.currentTarget.style.color = 'var(--color-accent)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--color-border)'
            e.currentTarget.style.color = 'var(--color-text-secondary)'
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M19 12l-7 7-7-7" />
          </svg>
        </button>
      )}

      {/* 底部：输入区 + 下方信息行
          2026-09-22：上下文圆环与「工作流输出」移到输入框**下方**，
          并去掉输入框上方那条分隔线（borderTop）—— 底栏与对话区改由留白分隔 */}
      <div className="flex-shrink-0 px-3 pb-2 pt-2">
        <AgentInputBox />
        <div className="mt-1.5 flex items-center justify-between gap-2 px-0.5">
          <ContextBudgetBar usage={contextUsage} />
          <AgentToolbar />
        </div>
      </div>
    </div>
  )
}

// ===== Agent 底部工具栏（小说创作场景） =====

/**
 * 重构后的工具栏：贴合小说创作场景
 * 左侧：快速引用按钮（架构、角色、蓝图）
 * 右侧：打开 AI 输出面板按钮
 */
function AgentToolbar() {
  const openRightPanel = useLayoutStore(s => s.openRightPanel)
  const { t } = useTranslation()

  return (
    <div className="flex items-center justify-end">

      {/* 右侧：打开 AI 输出面板 */}
      <button
        onClick={() => openRightPanel('ai-output')}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all select-none"
        style={{
          color: 'var(--color-text-muted)',
          border: '1px solid var(--color-border)',
        }}
        title={t('tip.switchAIOutput')}
        onMouseEnter={e => {
          e.currentTarget.style.backgroundColor = 'var(--color-hover)'
          e.currentTarget.style.color = 'var(--color-text)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = 'var(--color-text-muted)'
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
        {t('agent.aiWorkflow')}
      </button>
    </div>
  )
}

// ===== 历史面板 =====

function AgentHistoryPanel() {
  const {
    conversations, activeConversationId, selectConversation, deleteConversation, setShowHistory,
    renameConversation, archiveConversation, pinConversation, duplicateConversation,
    createConversation, renameWorkspace, deleteWorkspace,
  } = useAgentStore()
  const { t } = useTranslation()
  // 归档默认隐藏（2026-09-22）
  const [showArchived, setShowArchived] = useState(false)
  // 工作区：折叠态（默认全展开）与重命名态（2026-09-22）
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [renamingWs, setRenamingWs] = useState<string | null>(null)
  const [wsDraft, setWsDraft] = useState('')

  // title 查找表：fork 子会话标注父会话标题（父会话已被删除时 get 返回 undefined → 不标注，静默降级）
  const titleById = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of conversations) m.set(c.id, c.title)
    return m
  }, [conversations])

  /** 按**小说项目**分组（每个项目 = 一个工作区）：置顶优先、组内按更新时间倒序；
   *  组间按「该组最近一条的更新时间」倒序 —— 活跃工作区浮到最上面。 */
  const groups = useMemo(() => {
    const byProject = new Map<string, { name: string; items: typeof conversations }>()
    for (const c of conversations) {
      if (c.archived && !showArchived) continue
      const key = c.projectPath || '__none__'
      if (!byProject.has(key)) byProject.set(key, { name: c.projectName || t('agent.noWorkspace'), items: [] })
      byProject.get(key)!.items.push(c)
    }
    const arr = [...byProject.entries()].map(([key, g]) => ({ key, ...g }))
    for (const g of arr) {
      g.items.sort((a, b) => (Number(b.pinned ?? false) - Number(a.pinned ?? false)) || b.updatedAt - a.updatedAt)
    }
    return arr.sort((a, b) => (b.items[0]?.updatedAt ?? 0) - (a.items[0]?.updatedAt ?? 0))
  }, [conversations, showArchived, t])

  const archivedCount = conversations.filter(c => c.archived).length

  return (
    <div className="flex flex-col h-full">
      {/* 面板标题 */}
      <div
        className="flex items-center justify-between px-3 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {t('agent.allConversations')}
        </span>
        <div className="flex items-center gap-1">
          {/* 归档开关（有归档项时才出现，2026-09-22） */}
          {archivedCount > 0 && (
            <button
              onClick={() => setShowArchived(v => !v)}
              className="text-xs px-2 py-0.5 rounded transition-colors"
              style={{ color: showArchived ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              {t('agent.showArchived')} ({archivedCount})
            </button>
          )}
          <button
            onClick={() => setShowHistory(false)}
            className="text-xs px-2 py-0.5 rounded transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            {t('action.close')}
          </button>
        </div>
      </div>

      {/* 会话列表：按**工作区**（小说项目）分组 */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {groups.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('agent.noConversations')}
          </div>
        ) : (
          groups.map(g => (
            <div key={g.key} className="mb-2">
              {renamingWs === g.key ? (
                /* 工作区重命名（内联输入；只改显示名，不动磁盘上的实际项目） */
                <div className="flex items-center px-2 py-1 rounded" style={{ backgroundColor: 'var(--color-hover)' }}>
                  <input
                    autoFocus
                    value={wsDraft}
                    onChange={e => setWsDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { renameWorkspace(g.key, wsDraft); setRenamingWs(null) }
                      if (e.key === 'Escape') setRenamingWs(null)
                    }}
                    onBlur={() => { renameWorkspace(g.key, wsDraft); setRenamingWs(null) }}
                    className="flex-1 min-w-0 text-micro bg-transparent outline-none"
                    style={{ color: 'var(--color-text)' }}
                  />
                </div>
              ) : (
                <div className="group/ws flex items-center gap-0.5 px-2 py-1">
                  {/* 折叠箭头 + 工作区名 + 会话数（点整行切换折叠） */}
                  <button
                    onClick={() => setCollapsed(c => ({ ...c, [g.key]: !c[g.key] }))}
                    className="flex items-center gap-1 flex-1 min-w-0 cursor-pointer text-micro font-medium"
                    style={{ color: 'var(--color-text-muted)' }}
                    title={g.name}
                  >
                    <ChevronRight
                      size={10}
                      className={collapsed[g.key] ? '' : 'rotate-90'}
                      style={{ transition: 'transform 0.15s', flexShrink: 0 }}
                    />
                    <span className="truncate">{g.name}</span>
                    <span className="flex-shrink-0 opacity-60">({g.items.length})</span>
                  </button>
                  {/* 工作区操作：新建对话 / 重命名 / 删除（hover 显示） */}
                  <div
                    className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover/ws:opacity-100 group-focus-within/ws:opacity-100 transition-opacity duration-150"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    <button
                      className={ACT_BTN}
                      title={t('agent.newChatInWorkspace')}
                      onClick={() => createConversation({
                        // 空串 = 不关联项目（未关联项目组）；传 undefined 会回落到「当前项目」而非留空
                        projectPath: g.key === '__none__' ? '' : g.key,
                        projectName: g.name,
                      })}
                    >
                      <Plus size={12} />
                    </button>
                    <button
                      className={ACT_BTN}
                      title={t('agent.renameWorkspace')}
                      onClick={() => { setWsDraft(g.name); setRenamingWs(g.key) }}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      className={ACT_BTN}
                      title={t('agent.deleteWorkspace')}
                      onClick={async () => {
                        const ok = await confirm(
                          t('agent.deleteWorkspaceConfirm')
                            .replace('{name}', g.name)
                            .replace('{count}', String(g.items.length)),
                          { danger: true, confirmText: t('agent.deleteWorkspace') },
                        )
                        if (ok) deleteWorkspace(g.key)
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              )}
              {!collapsed[g.key] && g.items.map(conv => (
                <RecentConversationItem
                  key={conv.id}
                  title={conv.title}
                  updatedAt={conv.updatedAt}
                  parentTitle={conv.parentId ? titleById.get(conv.parentId) : undefined}
                  isActive={conv.id === activeConversationId}
                  pinned={conv.pinned}
                  archived={conv.archived}
                  onClick={() => selectConversation(conv.id)}
                  onDelete={async () => {
                    const ok = await confirm(
                      t('agent.confirmDeleteConversation').replace('{title}', conv.title),
                      { danger: true, confirmText: t('agent.deleteConversation') },
                    )
                    if (ok) deleteConversation(conv.id)
                  }}
                  onRename={title => renameConversation(conv.id, title)}
                  onTogglePin={() => pinConversation(conv.id, !conv.pinned)}
                  onToggleArchive={() => archiveConversation(conv.id, !conv.archived)}
                  onDuplicate={() => duplicateConversation(conv.id)}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ===== 最近会话列表项 =====

/** 会话项 hover 工具条里的小图标按钮统一样式 */
// 命中区 16×16 → 20×20（鼠标可点但偏小），并补 focus-visible 焦点环（键盘可达性）
const ACT_BTN = 'flex items-center justify-center w-5 h-5 rounded cursor-pointer hover:opacity-70 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]'

function RecentConversationItem({
  title,
  updatedAt,
  isActive,
  parentTitle,
  pinned,
  archived,
  onClick,
  onDelete,
  onRename,
  onTogglePin,
  onToggleArchive,
  onDuplicate,
}: {
  title: string
  updatedAt: number
  isActive?: boolean
  /** 父会话标题（有值 = fork 子会话——缩进 + 分支图标 + 标注） */
  parentTitle?: string
  pinned?: boolean
  archived?: boolean
  onClick: () => void
  onDelete: () => void
  /** 以下四项可选：空状态里的「最近会话」列表不提供这些管理操作 */
  onRename?: (title: string) => void
  onTogglePin?: () => void
  onToggleArchive?: () => void
  onDuplicate?: () => void
}) {
  const { t } = useTranslation()
  // 内联重命名（2026-09-22）：外层原来是 <button>，里面塞 input 是非法的，
  // 因此改为 role="button" 的 div（键盘 Enter 仍可选中）
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)

  if (editing) {
    return (
      <div className={`w-full flex items-center rounded px-2 py-1 box-border${parentTitle ? ' pl-5' : ''}`} style={{ backgroundColor: 'var(--color-hover)' }}>
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { onRename?.(draft); setEditing(false) }
            if (e.key === 'Escape') { setDraft(title); setEditing(false) }
          }}
          onBlur={() => { onRename?.(draft); setEditing(false) }}
          className="flex-1 min-w-0 text-xs bg-transparent outline-none"
          style={{ color: 'var(--color-text)' }}
        />
      </div>
    )
  }

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onClick() }}
      className={`group w-full flex flex-row items-center justify-between overflow-hidden rounded py-1.5 text-left px-2 box-border transition-colors${parentTitle ? ' pl-5' : ''}`}
      style={{ backgroundColor: isActive ? 'var(--color-hover)' : 'transparent' }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'var(--color-hover)' }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent' }}
    >
      {/* 标题 */}
      <div className="flex items-center gap-x-1 overflow-hidden flex-1 min-w-0">
        {pinned && <Pin size={10} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />}
        <div
          className="truncate text-xs"
          style={{ color: 'var(--color-text)', opacity: isActive ? 1 : 0.65 }}
        >
          {title}
        </div>
        {/* fork 子会话标注：分支图标 + 「来自『父标题』」（固定 pl-5 缩进，无布局跳动） */}
        {parentTitle && (
          <div className="flex items-center gap-1 min-w-0">
            <GitFork size={10} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
            <span className="text-micro truncate" style={{ color: 'var(--color-text-muted)' }}>
              {t('agent.forkedFrom').replace('{title}', parentTitle)}
            </span>
          </div>
        )}
      </div>

      {/* 右侧：固定宽度容器，时间与操作组绝对定位重叠，hover 时 opacity 过渡（零布局跳动） */}
      <div className="flex-shrink-0 ml-1 relative" style={{ width: 88, height: 16 }}>
        <span
          className="absolute right-0 top-0 text-micro whitespace-nowrap opacity-60 transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {formatRelativeTime(updatedAt)}
        </span>
        {/* 操作组（2026-09-22）：置顶 / 重命名 / 分叉 / 归档 / 删除 */}
        <div
          className="absolute right-0 top-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {/* 以下四项管理操作仅在调用方提供回调时渲染（空状态的「最近会话」列表不提供） */}
          {onTogglePin && (
            <button
              className={ACT_BTN}
              title={pinned ? t('agent.unpinConversation') : t('agent.pinConversation')}
              onClick={e => { e.stopPropagation(); onTogglePin?.() }}
            >
              <Pin size={12} />
            </button>
          )}
          {onRename && (
            <button
              className={ACT_BTN}
              title={t('agent.renameConversation')}
              onClick={e => { e.stopPropagation(); setDraft(title); setEditing(true) }}
            >
              <Pencil size={12} />
            </button>
          )}
          {onDuplicate && (
            <button
              className={ACT_BTN}
              title={t('agent.duplicateConversation')}
              onClick={e => { e.stopPropagation(); onDuplicate?.() }}
            >
              <GitFork size={12} />
            </button>
          )}
          {onToggleArchive && (
            <button
              className={ACT_BTN}
              title={archived ? t('agent.unarchiveConversation') : t('agent.archiveConversation')}
              onClick={e => { e.stopPropagation(); onToggleArchive?.() }}
            >
              <Archive size={12} />
            </button>
          )}
          <button
            className={ACT_BTN}
            title={t('agent.deleteConversation')}
            onClick={e => { e.stopPropagation(); onDelete() }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}


