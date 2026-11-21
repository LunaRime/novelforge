import { CreateIcon } from '../../ui/ActionIcons'
import { MoreHorizontal, Server, Sparkles, ChevronRight, History } from 'lucide-react'
import { useAgentStore } from '../../../stores/agent-store'
import { useMCPStore } from '../../../stores/mcp-store'
import { skillRegistry, type LoadedSkill } from '../../../services/agent/skill-registry'
import { useEffect, useRef, useState, useMemo } from 'react'
import { confirm } from '../../ui/Confirm'
import { Button } from '../../ui/Button'
import { MenuItem } from '../../ui/MenuItem'
import { useOutsideClick } from '../../../hooks/useOutsideClick'
import { useEscapeKey } from '../../../hooks/useEscapeKey'
import { useFloatingPosition } from '../../../hooks/useFloatingPosition'
import { PopoverSurface } from '../../ui/PopoverSurface'
import { useTranslation } from '../../../hooks/useTranslation'

/**
 * Agent 面板顶部工具栏
 */
export default function AgentHeader() {
  // 原子 selector：action 引用稳定，流式期间不随整 store 每 50ms 重渲染
  const createConversation = useAgentStore(s => s.createConversation)
  const toggleHistory = useAgentStore(s => s.toggleHistory)
  const title = useAgentStore(s => s.conversations.find(item => item.id === s.activeConversationId)?.title)
  const historyOpen = useAgentStore(s => s.showHistory)
  const { t } = useTranslation()
  const [showMore, setShowMore] = useState(false)
  const [subView, setSubView] = useState<'main' | 'mcp' | 'skills'>('main')
  const moreRef = useRef<HTMLDivElement>(null)
  const moreButton = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  // 更多菜单浮在整个窗口之上（锚点：⋯ 按钮容器；面板顶部 → 朝下展开）
  const moreMenuRef = useFloatingPosition<HTMLDivElement>(moreRef, showMore, { placement: 'below', align: 'end' })

  // 点击外部关闭更多菜单
  useOutsideClick(moreRef, () => { setShowMore(false); setSubView('main') }, showMore)
  useEscapeKey(() => { setShowMore(false); setSubView('main'); moreButton.current?.focus() }, showMore)
  useEffect(() => {
    if (showMore) menu.current?.querySelector('button')?.focus()
  }, [showMore, subView])

  // MCP 状态（原子 selector，流式期间不重渲染）
  const mcpServers = useMCPStore(s => s.servers)
  const mcpTools = useMCPStore(s => s.tools)
  const connectedCount = mcpServers.filter(s => s.status === 'connected').length

  // Skill 列表
  const skills = useMemo(() => skillRegistry.listAll(), [])

  // 当前会话为空（无消息）时禁止新建 —— 订阅派生布尔（原始值），流式期间值稳定不重渲染
  const isCurrentEmpty = useAgentStore(s => {
    const conv = s.conversations.find(c => c.id === s.activeConversationId)
    return !conv || conv.messages.every(m => m.role === 'system')
  })

  const conversationTitle = title || t('agent.newConversation')
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-editor-bg)] px-2 py-1">
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--color-text-secondary)]" title={conversationTitle}>
        {conversationTitle}
      </span>
      <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0"
        title={isCurrentEmpty ? t('tip.emptyAgent') : t('tip.newConversation')} aria-label={t('tip.newConversation')}
        disabled={isCurrentEmpty} onClick={() => createConversation()}>
        <CreateIcon size={16} />
      </Button>
      <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" active={historyOpen}
        title={t('tip.historyConversations')} aria-label={t('tip.historyConversations')} aria-pressed={historyOpen} onClick={toggleHistory}>
        <History size={15} aria-hidden="true" />
      </Button>
      <div className="relative shrink-0" ref={moreRef}>
        <Button ref={moreButton} type="button" variant="ghost" size="icon" className="size-8"
          title={t('tip.moreOptions')} aria-label={t('tip.moreOptions')} aria-expanded={showMore}
          active={showMore} onClick={() => { setShowMore(value => !value); setSubView('main') }}>
          <MoreHorizontal size={16} aria-hidden="true" />
        </Button>
        {/* 更多菜单下拉 */}
        {showMore && (
          <PopoverSurface
            ref={moreMenuRef}
            className="py-1"
            style={{ width: subView === 'main' ? 200 : 260, transition: 'width 0.15s ease' }}
          >
            <div ref={menu}>
              {/* ===== 主菜单视图 ===== */}
              {subView === 'main' && (
                <>
                  <MenuItem
                    label={t('agent.mcpServers')}
                    icon={<Server size={13} />}
                    shortcut={connectedCount > 0 ? t('agent.onlineCount').replace('{n}', String(connectedCount)) : ''}
                    onClick={() => setSubView('mcp')}
                  />
                  <MenuItem
                    label={t('agent.skillList')}
                    icon={<Sparkles size={13} />}
                    shortcut={skills.length > 0 ? t('agent.skillCount').replace('{n}', String(skills.length)) : ''}
                    onClick={() => setSubView('skills')}
                  />
                  <div style={{ height: 1, backgroundColor: 'var(--color-border)', margin: '4px 0' }} />
                  <MenuItem
                    label={t('agent.clearAll')}
                    danger
                    onClick={async () => {
                      setShowMore(false)
                      const ok = await confirm(t('agent.confirmClearMsg'), {
                        title: t('agent.confirmClearTitle'),
                        confirmText: t('dialog.confirmClear'),
                        danger: true,
                      })
                      if (ok) useAgentStore.getState().clearAll()
                    }}
                  />
                </>
              )}

              {/* ===== MCP 子视图 ===== */}
              {subView === 'mcp' && (
                <MCPSubView
                  servers={mcpServers}
                  toolCount={mcpTools.length}
                  onBack={() => setSubView('main')}
                />
              )}

              {/* ===== Skill 子视图 ===== */}
              {subView === 'skills' && (
                <SkillSubView
                  skills={skills}
                  onBack={() => setSubView('main')}
                />
              )}
            </div>
          </PopoverSurface>
        )}
      </div>
    </div>
  )
}

// ===== MCP 子视图 =====

function MCPSubView({
  servers,
  toolCount,
  onBack,
}: {
  servers: { id: string; name: string; status: string; toolCount: number; error?: string }[]
  toolCount: number
  onBack: () => void
}) {
  const { t } = useTranslation()
  const connectedCount = servers.filter(s => s.status === 'connected').length

  return (
    <>
      {/* 返回按钮 */}
      <button
        onClick={onBack}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors"
        style={{ color: 'var(--color-text-secondary)' }}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        <ChevronRight size={12} style={{ transform: 'rotate(180deg)' }} />
        <span className="font-medium">{t('agent.mcpServers')}</span>
        <span className="ml-auto text-micro opacity-50">
          {t('agent.onlineRatio').replace('{n}', String(connectedCount)).replace('{total}', String(servers.length))}
        </span>
      </button>

      <div style={{ height: 1, backgroundColor: 'var(--color-border)', margin: '2px 0' }} />

      {/* 服务器列表 */}
      {servers.length === 0 ? (
        <div className="px-3 py-3 text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
          <div className="mb-1">{t('agent.noMcp')}</div>
          <div className="text-micro opacity-60">
            {t('agent.mcpConfigHint')}
          </div>
        </div>
      ) : (
        <div className="py-1 max-h-[200px] overflow-y-auto">
          {servers.map(server => (
            <div
              key={server.id}
              className="flex items-center gap-2 px-3 py-1.5 text-xs"
            >
              {/* 状态灯 */}
              <span
                className="flex-shrink-0 w-1.5 h-1.5 rounded-full"
                style={{
                  backgroundColor:
                    server.status === 'connected' ? 'var(--color-success)'
                    : server.status === 'connecting' ? 'var(--color-warning)'
                    : server.status === 'error' ? 'var(--color-error)'
                    : 'var(--color-text-muted)',
                }}
              />
              <span
                className="flex-1 truncate font-medium"
                style={{ color: 'var(--color-text)' }}
              >
                {server.name}
              </span>
              {server.status === 'connected' && server.toolCount > 0 && (
                <span className="text-micro opacity-50 flex-shrink-0">
                  {server.toolCount} tools
                </span>
              )}
              {server.status === 'error' && (
                <span className="text-micro text-[var(--color-error)] truncate max-w-[80px]" title={server.error}>
                  {t('agent.serverError')}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 底部统计 */}
      {toolCount > 0 && (
        <>
          <div style={{ height: 1, backgroundColor: 'var(--color-border)', margin: '2px 0' }} />
          <div className="px-3 py-1.5 text-micro" style={{ color: 'var(--color-text-muted)' }}>
            {t('agent.mcpTools').replace('{n}', String(toolCount))}
          </div>
        </>
      )}
    </>
  )
}

// ===== Skill 子视图 =====

function SkillSubView({
  skills,
  onBack,
}: {
  skills: LoadedSkill[]
  onBack: () => void
}) {
  const { t } = useTranslation()
  /** 来源徽章颜色 */
  const sourceBadge = (source: string) => {
    switch (source) {
      case 'builtin': return { bg: 'rgba(var(--color-info-rgb),0.12)', color: 'var(--color-info)', label: t('agent.toolBuiltin') }
      case 'user': return { bg: 'rgba(var(--color-accent-rgb),0.12)', color: 'var(--color-accent)', label: t('agent.sourceUser') }
      case 'project': return { bg: 'rgba(var(--color-success-rgb),0.12)', color: 'var(--color-success)', label: t('agent.sourceProject') }
      default: return { bg: 'var(--color-hover)', color: 'var(--color-text-muted)', label: source }
    }
  }

  return (
    <>
      {/* 返回按钮 */}
      <button
        onClick={onBack}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors"
        style={{ color: 'var(--color-text-secondary)' }}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        <ChevronRight size={12} style={{ transform: 'rotate(180deg)' }} />
        <span className="font-medium">{t('agent.skillList')}</span>
        <span className="ml-auto text-micro opacity-50">
          {skills.length} {t('unit.skills')}
        </span>
      </button>

      <div style={{ height: 1, backgroundColor: 'var(--color-border)', margin: '2px 0' }} />

      {/* Skill 列表 */}
      {skills.length === 0 ? (
        <div className="px-3 py-3 text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
          <div className="mb-1">{t('agent.noSkills')}</div>
          <div className="text-micro opacity-60">
            {t('agent.skillHint')}
          </div>
        </div>
      ) : (
        <div className="py-1 max-h-[240px] overflow-y-auto">
          {skills.map(skill => {
            const badge = sourceBadge(skill.source)
            return (
              <div
                key={skill.metadata.name}
                className="flex items-start gap-2 px-3 py-1.5 text-xs"
              >
                <Sparkles size={12} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-accent)' }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium truncate" style={{ color: 'var(--color-text)' }}>
                      {skill.metadata.displayName ?? skill.metadata.name}
                    </span>
                    <span
                      className="text-2xs px-1 py-0 rounded flex-shrink-0"
                      style={{ backgroundColor: badge.bg, color: badge.color }}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <div
                    className="text-micro truncate mt-0.5"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {skill.metadata.description}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 底部提示 */}
      <div style={{ height: 1, backgroundColor: 'var(--color-border)', margin: '2px 0' }} />
      <div className="px-3 py-1.5 text-micro" style={{ color: 'var(--color-text-muted)' }}>
        {(() => {
          const hint = t('agent.slashHint')
          const idx = hint.indexOf('/')
          if (idx < 0) return hint
          return <>{hint.slice(0, idx)}<code className="px-0.5 rounded" style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-accent)' }}>/</code>{hint.slice(idx + 1)}</>
        })()}
      </div>
    </>
  )
}
