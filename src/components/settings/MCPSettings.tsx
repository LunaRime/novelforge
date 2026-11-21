/**
 * MCPSettings — MCP 服务器设置（列表/连接/添加/删除）
 *
 * 配置文件：~/.novelforge/mcp_config.json（Claude Desktop 兼容格式）
 */
import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Plug, Unplug, Server } from 'lucide-react'
import { ipc } from '../../services/ipc-client'
import { useSettingsDirty } from './settings-dirty'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import { EmptyState } from '../ui/EmptyState'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { useTranslation } from '../../hooks/useTranslation'

interface MCPServerConfig {
  id: string
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

interface ServerStatus {
  id: string
  status: string // connected | connecting | disconnected | error
  toolCount?: number
  error?: string
}

/** 推荐 MCP server（零代码生态——官方生态常用 server，点击一键填充添加表单；产品名为技术标识不翻译） */
const RECOMMENDED_MCPS: Array<{ id: string; name: string; command: string; args: string }> = [
  { id: 'filesystem', name: 'Filesystem', command: 'npx', args: '-y @modelcontextprotocol/server-filesystem ~' },
  { id: 'memory', name: 'Memory', command: 'npx', args: '-y @modelcontextprotocol/server-memory' },
  { id: 'sequential-thinking', name: 'Sequential Thinking', command: 'npx', args: '-y @modelcontextprotocol/server-sequential-thinking' },
  { id: 'github', name: 'GitHub', command: 'npx', args: '-y @modelcontextprotocol/server-github' },
]

export default function MCPSettings() {
  const { t } = useTranslation()
  const [servers, setServers] = useState<MCPServerConfig[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  const [statuses, setStatuses] = useState<Record<string, string>>({})
  const [showAdd, setShowAdd] = useState(false)
  const [newId, setNewId] = useState('')
  const [newCommand, setNewCommand] = useState('')

  // 添加表单有内容即算未保存：关闭设置页前确认，避免白填一场
  useSettingsDirty(showAdd && (newId.trim() !== '' || newCommand.trim() !== ''))
  const [newArgs, setNewArgs] = useState('')

  const load = useCallback(async () => {
    try {
      const { configs } = await ipc.invoke('mcp:load-config')
      setServers(configs as MCPServerConfig[])
      const st = await ipc.invoke('mcp:get-servers-status')
      const map: Record<string, string> = {}
      for (const s of st as ServerStatus[]) map[s.id] = s.status
      setStatuses(map)
      setLoadFailed(false)
    } catch (e) {
      // 2026-09-25 修：此前只 console.warn → servers 停在 []，渲染出「无服务器」**空态**，
      // 把加载失败伪装成"你没有配过服务器"（用户既不重试也不知道出了问题）
      console.warn('[MCPSettings] 加载服务器失败:', e)
      setLoadFailed(true)
    }
  }, [])

  // 初始加载（连接/断开/添加/删除后手动调用 load 刷新）
  useEffect(() => {
    let cancelled = false
    Promise.all([
      ipc.invoke('mcp:load-config'),
      ipc.invoke('mcp:get-servers-status'),
    ]).then(([cfg, st]) => {
      if (cancelled) return
      setServers((cfg as { configs: MCPServerConfig[] }).configs)
      const map: Record<string, string> = {}
      for (const s of st as ServerStatus[]) map[s.id] = s.status
      setStatuses(map)
      setLoadFailed(false)
    }).catch(e => {
      console.warn('[MCPSettings] 加载服务器失败:', e)
      if (!cancelled) setLoadFailed(true)
    })
    return () => { cancelled = true }
  }, [])

  /** 连接服务器 */
  const handleConnect = useCallback(async (server: MCPServerConfig) => {
    // L4 S10：只传 id —— command/args/env 由主进程从配置文件解析（原先传整份配置，
    // 等于让渲染层决定要 spawn 什么命令）
    const result = await ipc.invoke('mcp:connect', server.id)
    if (!result.success) toast.error(result.error ?? t('status.unknown'))
    load()
  }, [t, load])

  /** 断开服务器 */
  const handleDisconnect = useCallback(async (id: string) => {
    await ipc.invoke('mcp:disconnect', id)
    load()
  }, [load])

  /** 删除服务器 */
  const handleRemove = useCallback(async (server: MCPServerConfig) => {
    const ok = await confirm(
      t('mcp.deleteConfirm').replace('{name}', server.name),
      { title: t('settings.mcp'), danger: true },
    )
    if (!ok) return
    const result = await ipc.invoke('mcp:remove-server', server.id)
    if (result.success) {
      toast.success(t('mcp.removed'))
      load()
    } else {
      toast.error(result.error ?? t('status.unknown'))
    }
  }, [t, load])

  /** 添加服务器（写入配置文件） */
  const handleAdd = useCallback(async () => {
    const id = newId.trim()
    const command = newCommand.trim()
    if (!id || !command) return
    const args = newArgs.trim() ? newArgs.trim().split(/\s+/) : undefined
    const result = await ipc.invoke('mcp:add-server', { id, command, args })
    if (result.success) {
      toast.success(t('mcp.added'))
      setShowAdd(false)
      setNewId('')
      setNewCommand('')
      setNewArgs('')
      load()
    } else {
      toast.error(result.error ?? t('status.unknown'))
    }
  }, [newId, newCommand, newArgs, t, load])

  const statusLabel = (id: string): { text: string; color: string } => {
    const st = statuses[id]
    if (st === 'connected') return { text: t('mcp.statusConnected'), color: 'var(--color-success)' }
    if (st === 'connecting') return { text: t('status.loading'), color: 'var(--color-warning)' }
    if (st === 'error') return { text: t('status.error'), color: 'var(--color-error)' }
    return { text: t('mcp.statusDisconnected'), color: 'var(--color-text-muted)' }
  }

  return (
    <section className="nf-settings-panel space-y-3">
      <header className="nf-settings-resource-bar">
        <span className="rounded-md bg-[var(--color-editor-bg)] px-2 py-1 text-xs tabular-nums text-[var(--color-text-secondary)]" aria-label={t('settings.mcp')}>
          {servers.length}
        </span>
        <Button type="button" className="min-h-8" aria-expanded={showAdd} onClick={() => setShowAdd(v => !v)}>
          <Plus size={14} aria-hidden="true" />
          {t('mcp.addServer')}
        </Button>
      </header>

      <div className="space-y-3">
        {/* 选中推荐项只预填表单，添加与连接仍由各自的操作触发。 */}
        <div
          className="p-3 rounded-xl border"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-editor-bg)' }}
        >
          <div className="text-micro font-semibold mb-2" style={{ color: 'var(--color-text-muted)' }}>
            {t('mcp.recommended')}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {RECOMMENDED_MCPS.map((rec) => (
              <button
                key={rec.id}
                type="button"
                className="px-2 py-1 rounded-lg text-micro transition-colors cursor-pointer hover:opacity-80"
                style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text)' }}
                title={rec.id}
                onClick={() => {
                  setNewId(rec.id)
                  setNewCommand(rec.command)
                  setNewArgs(rec.args)
                  setShowAdd(true)
                }}
              >
                {rec.name}
              </button>
            ))}
          </div>
          <div className="text-2xs mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
            {t('mcp.recommendedHint')}
          </div>
        </div>

        {/* 添加表单
            三个字段的描边/正文色/焦点环/禁用态走 ui/Input；底色刻意用 --color-hover 而非
            --color-panel —— 它们嵌在本就 panel 底色的卡片里，同色会糊在一起 */}
        {showAdd && (
          <div
            className="p-3.5 rounded-xl border space-y-2.5"
            style={{ borderColor: 'var(--color-accent)', backgroundColor: 'var(--color-panel)' }}
          >
            <Input
              value={newId}
              onChange={e => setNewId(e.target.value)}
              placeholder={t('mcp.serverId')}
              className="px-2.5 py-1.5 rounded-lg"
              style={{ backgroundColor: 'var(--color-hover)' }}
            />
            <Input
              value={newCommand}
              onChange={e => setNewCommand(e.target.value)}
              placeholder={t('mcp.commandPlaceholder')}
              className="px-2.5 py-1.5 rounded-lg"
              style={{ backgroundColor: 'var(--color-hover)' }}
            />
            <Input
              value={newArgs}
              onChange={e => setNewArgs(e.target.value)}
              placeholder={t('mcp.args')}
              className="px-2.5 py-1.5 rounded-lg"
              style={{ backgroundColor: 'var(--color-hover)' }}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleAdd}
                disabled={!newId.trim() || !newCommand.trim()}
                className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer disabled:opacity-40"
                style={{ color: '#fff', backgroundColor: 'var(--color-accent)' }}
              >
                {t('mcp.addServer')}
              </button>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="px-3 py-1.5 rounded-lg text-xs transition-colors cursor-pointer"
                style={{ color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-hover)' }}
              >
                {t('action.close')}
              </button>
            </div>
          </div>
        )}

        {/* 服务器列表：加载失败与「确实没配过」必须分开，否则失败被读成空 */}
        {loadFailed ? (
          <div className="text-center py-10 text-xs space-y-2">
            <div style={{ color: 'var(--color-error)' }}>{t('common.loadFailed')}</div>
            <button
              type="button"
              className="px-3 py-1 rounded-lg text-xs transition-colors cursor-pointer"
              style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
              onClick={() => void load()}
            >
              {t('action.retry')}
            </button>
          </div>
        ) : servers.length === 0 && !showAdd ? (
          <EmptyState
            message={t('mcp.empty')}
            size="xs"
            className="text-center text-[var(--color-text-muted)]"
          />
        ) : (
          servers.map(server => {
            const st = statusLabel(server.id)
            const isConnected = statuses[server.id] === 'connected'
            return (
              <div
                key={server.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-editor-bg)] px-3 py-2"
              >
                <Server size={14} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                      {server.name}
                    </p>
                    <span
                      className="flex items-center gap-1 text-2xs flex-shrink-0"
                      style={{ color: st.color }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: st.color }} />
                      {st.text}
                    </span>
                  </div>
                  <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-text-muted)' }} title={[server.command, ...(server.args ?? [])].join(' ')}>
                    {server.command} {server.args?.join(' ') ?? ''}
                  </p>
                </div>
                {/* 连接/断开 */}
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-8 shrink-0"
                  onClick={() => isConnected ? handleDisconnect(server.id) : handleConnect(server)}
                >
                  {isConnected ? <Unplug size={10} /> : <Plug size={10} />}
                  {isConnected ? t('mcp.disconnect') : t('mcp.connect')}
                </Button>
                {/* 删除 */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemove(server)}
                  className="size-[32px] shrink-0"
                  title={t('action.delete')}
                  aria-label={`${t('action.delete')} ${server.name}`}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </Button>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
