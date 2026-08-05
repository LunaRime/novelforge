/**
 * LogsView — 底部面板日志视图
 *
 * 展示工作流运行日志（内存 globalLogs，与主进程文件日志双写）。
 * 2026-08-05 升级：级别筛选 / 复制 / 日志文件查看器 / 打开日志目录。
 */
import { useState, useRef, useEffect, memo, useMemo } from 'react'
import { Trash2, ChevronsDown, Copy, Check, FileText, FolderOpen } from 'lucide-react'
import { useWorkflowStore } from '../../stores/workflow-store'
import { Button } from '../ui/Button'
import { t, type TextKey } from '../../shared/locale'
import { ipc } from '../../services/ipc-client'
import LogFileDialog from '../dialogs/LogFileDialog'

type LogFilter = 'all' | 'info' | 'warn' | 'error'

const FILTERS: Array<{ key: LogFilter; label: TextKey }> = [
  { key: 'all', label: 'log.filterAll' },
  { key: 'info', label: 'log.filterInfo' },
  { key: 'warn', label: 'log.filterWarn' },
  { key: 'error', label: 'log.filterError' },
]

export default memo(function LogsView() {
  const globalLogs = useWorkflowStore(s => s.globalLogs)
  const clearLogs = useWorkflowStore(s => s.clearLogs)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState<LogFilter>('all')
  const [fileDialogOpen, setFileDialogOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const visibleLogs = useMemo(
    () => filter === 'all' ? globalLogs : globalLogs.filter(l => l.level === filter),
    [globalLogs, filter],
  )

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [visibleLogs.length, autoScroll])

  const levelColor = (level: string) => {
    switch (level) {
      case 'error': return 'var(--color-error)'
      case 'warn':  return 'var(--color-warning)'
      default:      return 'var(--color-text-secondary)'
    }
  }

  const copyLogs = async () => {
    try {
      const text = visibleLogs.map(l => `${l.time} [${l.level.toUpperCase()}] ${l.message}`).join('\n')
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* 剪贴板不可用 */ }
  }

  const openLogDir = async () => {
    await ipc.invoke('log:open-dir')
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-1 px-2 py-1 flex-shrink-0">
        {/* 级别筛选 */}
        <div className="flex items-center gap-0.5">
          {FILTERS.map(f => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                filter === f.key
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]'
              }`}
            >
              {t(f.label)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="icon"
            onClick={copyLogs}
            disabled={!visibleLogs.length}
            title={copied ? t('log.copied') : t('log.copy')}
          >
            {copied ? <Check size={13} className="text-[var(--color-accent)]" /> : <Copy size={13} />}
          </Button>
          <Button
            variant="ghost" size="icon"
            onClick={() => setFileDialogOpen(true)}
            title={t('log.viewFiles')}
          >
            <FileText size={13} />
          </Button>
          <Button variant="ghost" size="icon" onClick={openLogDir} title={t('log.openDir')}>
            <FolderOpen size={13} />
          </Button>
          <Button
            variant="ghost" size="icon"
            onClick={() => setAutoScroll(!autoScroll)}
            title={autoScroll ? t('tip.autoScrollOn') : t('tip.autoScrollOff')}
            className={autoScroll ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}
          >
            <ChevronsDown size={13} />
          </Button>
          <Button variant="ghost" size="icon" onClick={clearLogs} title={t('tip.clearLog')}>
            <Trash2 size={13} />
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 pb-2 font-mono text-xs leading-5">
        {visibleLogs.length === 0 && (
          <div className="text-center py-8 opacity-30">{t('status.noLogs')}</div>
        )}
        {visibleLogs.map((log, i) => (
          <div key={i} className="flex gap-2">
            <span style={{ color: 'var(--color-text-muted)' }}>{log.time}</span>
            <span style={{ color: levelColor(log.level) }}>{log.message}</span>
          </div>
        ))}
      </div>

      <LogFileDialog open={fileDialogOpen} onOpenChange={setFileDialogOpen} />
    </div>
  )
})
