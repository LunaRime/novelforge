/**
 * MCPSettings — MCP 服务器设置（列表/连接/添加/删除）
 *
 * 配置文件：~/.vela/mcp_config.json（Claude Desktop 兼容格式）
 */
import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Plug, Unplug, Server } from 'lucide-react'
import { ipc } from '../../services/ipc-client'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
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

export default function MCPSettings() {
  const { t } = useTranslation()
  const [servers, setServers] = useState<MCPServerConfig[]>([])
  const [statuses, setStatuses] = useState<Record<string, string>>({})
  const [showAdd, setShowAdd] = useState(false)
  const [newId, setNewId] = useState('')
  const [newCommand, setNewCommand] = useState('')
  const [newArgs, setNewArgs] = useState('')

  const load = useCallback(async () => {
    try {
      const { configs } = await ipc.invoke('mcp:load-config')
      setServers(configs as MCPServerConfig[])
      const st = await ipc.invoke('mcp:get-servers-status')
      const map: Record<string, string> = {}
      for (const s of st as ServerStatus[]) map[s.id] = s.status
      setStatuses(map)
    } catch (e) {
      console.warn('[MCPSettings] 加载服务器失败:', e)
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
    }).catch(e => {
      console.warn('[MCPSettings] 加载服务器失败:', e)
    })
    return () => { cancelled = true }
  }, [])

  /** 连接服务器 */
  const handleConnect = useCallback(async (server: MCPServerConfig) => {
    const result = await ipc.invoke('mcp:connect', {
      id: server.id, name: server.name, command: server.command,
      args: server.args ?? [], env: server.env ?? {},
    })
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
      toast.success(t('mcp.added')) // 复用"已添加"文案语义（操作成功）
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
    if (st === 'connected') return { text: t('mcp.connect'), color: 'var(--color-success)' }
    if (st === 'connecting') return { text: t('status.loading'), color: 'var(--color-warning)' }
    if (st === 'error') return { text: t('status.error'), color: 'var(--color-error)' }
    return { text: t('mcp.disconnect'), color: 'var(--color-text-muted)' }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)] flex-shrink-0">
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          {t('settings.mcp')}
          <span className="ml-2 text-xs opacity-50" style={{ color: 'var(--color-text-muted)' }}>
            {servers.length}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setShowAdd(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer"
          style={{ color: '#fff', backgroundColor: 'var(--color-accent)' }}
        >
          <Plus size={12} />
          {t('mcp.addServer')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* 添加表单 */}
        {showAdd && (
          <div
            className="p-3.5 rounded-xl border space-y-2.5"
            style={{ borderColor: 'var(--color-accent)', backgroundColor: 'var(--color-panel)' }}
          >
            <input
              value={newId}
              onChange={e => setNewId(e.target.value)}
              placeholder={t('mcp.serverId')}
              className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none"
              style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
            />
            <input
              value={newCommand}
              onChange={e => setNewCommand(e.target.value)}
              placeholder={`${t('mcp.command')}（如 npx）`}
              className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none"
              style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
            />
            <input
              value={newArgs}
              onChange={e => setNewArgs(e.target.value)}
              placeholder={t('mcp.args')}
              className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none"
              style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
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

        {/* 服务器列表 */}
        {servers.length === 0 && !showAdd ? (
          <div className="text-center py-10 text-xs opacity-40" style={{ color: 'var(--color-text-muted)' }}>
            {t('mcp.empty')}
          </div>
        ) : (
          servers.map(server => {
            const st = statusLabel(server.id)
            const isConnected = statuses[server.id] === 'connected'
            return (
              <div
                key={server.id}
                className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl border"
                style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel)' }}
              >
                <Server size={14} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                      {server.name}
                    </p>
                    <span
                      className="flex items-center gap-1 text-[0.6rem] flex-shrink-0"
                      style={{ color: st.color }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: st.color }} />
                      {st.text}
                    </span>
                  </div>
                  <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-text-muted)' }}>
                    {server.command} {server.args?.join(' ') ?? ''}
                  </p>
                </div>
                {/* 连接/断开 */}
                <button
                  type="button"
                  onClick={() => isConnected ? handleDisconnect(server.id) : handleConnect(server)}
                  className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[0.65rem] transition-colors cursor-pointer"
                  style={{
                    color: isConnected ? 'var(--color-text-secondary)' : 'var(--color-accent)',
                    backgroundColor: isConnected ? 'var(--color-hover)' : 'rgba(var(--color-accent-rgb), 0.1)',
                  }}
                >
                  {isConnected ? <Unplug size={10} /> : <Plug size={10} />}
                  {isConnected ? t('mcp.disconnect') : t('mcp.connect')}
                </button>
                {/* 删除 */}
                <button
                  type="button"
                  onClick={() => handleRemove(server)}
                  className="flex-shrink-0 p-1.5 rounded-lg transition-colors cursor-pointer hover:bg-[var(--color-hover)]"
                  style={{ color: 'var(--color-text-muted)' }}
                  title={t('action.delete')}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
