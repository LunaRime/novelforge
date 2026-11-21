/**
 * LogsView — 底部面板日志视图
 *
 * 展示工作流运行日志（内存 globalLogs，与主进程文件日志双写）。
 * 2026-08-05 升级：级别筛选 / 复制 / 日志文件查看器 / 打开日志目录。
 */
import { useState, useRef, useEffect, memo, useMemo, useId } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Trash2, ListEnd, ListStart, Copy, Check, FileText, FolderOpen, ListFilter, Info, TriangleAlert, CircleAlert } from 'lucide-react'
import { SortDirectionIcon } from '../ui/ActionIcons'
import { useWorkflowStore } from '../../stores/workflow-store'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { useTranslation } from '../../hooks/useTranslation'
import { ipc } from '../../services/ipc-client'
import LogFileDialog from '../dialogs/LogFileDialog'
import './log-filters.css'

type LogFilter = 'all' | 'info' | 'warn' | 'error'

const FILTERS = [
  { key: 'all', label: 'log.filterAll', icon: ListFilter },
  { key: 'info', label: 'log.filterInfo', icon: Info },
  { key: 'warn', label: 'log.filterWarn', icon: TriangleAlert },
  { key: 'error', label: 'log.filterError', icon: CircleAlert },
] as const

export default memo(function LogsView() {
  const { t } = useTranslation()
  const filterGroup = useId()
  const globalLogs = useWorkflowStore(s => s.globalLogs)
  const clearLogs = useWorkflowStore(s => s.clearLogs)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState<LogFilter>('all')
  const [fileDialogOpen, setFileDialogOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  /** 正序时新日志在底部，倒序时新日志在顶部。 */
  const [sortAsc, setSortAsc] = useState(true)

  const visibleLogs = useMemo(() => {
    const filtered = filter === 'all' ? globalLogs : globalLogs.filter(l => l.level === filter)
    // 按完整时间戳显式排序（追加顺序在多工作流并发/跨天场景下不可靠；
    // 12 小时制 locale 下 time 字符串比较也会错乱——用数字 ts 排序）
    return [...filtered].sort((a, b) => (sortAsc ? a.ts - b.ts : b.ts - a.ts))
  }, [globalLogs, filter, sortAsc])

  const counts = useMemo(() => {
    const totals = { all: globalLogs.length, info: 0, warn: 0, error: 0 }
    for (const log of globalLogs) {
      if (log.level === 'info' || log.level === 'warn' || log.level === 'error') totals[log.level]++
    }
    return totals
  }, [globalLogs])

  // 日志虚拟化：上限 500 条 + 流式期间每 100ms 追加，只渲染可视区 + overscan；
  // 行高可变（长消息换行），measureElement 动态测量真实高度
  const virtualizer = useVirtualizer({
    count: visibleLogs.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 10,
  })

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = sortAsc ? scrollRef.current.scrollHeight : 0
    }
  }, [visibleLogs, autoScroll, sortAsc])

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
      <div className="nf-log-toolbar">
        {/* 原生单选组支持 Tab 进入、方向键切换和鼠标选择。 */}
        <fieldset className="nf-log-filters">
          <legend className="sr-only">{t('log.filterLevel')}</legend>
          {FILTERS.map(({ key, label, icon: Icon }) => (
            <label className="nf-log-filter" key={key} data-level={key}>
              <input className="sr-only" type="radio" name={filterGroup} checked={filter === key} onChange={() => setFilter(key)} />
              <Icon size={14} aria-hidden="true" />
              <span>{t(label)}</span>
              <span className="nf-log-filter-count">{counts[key].toLocaleString()}</span>
            </label>
          ))}
        </fieldset>

        <div className="nf-log-actions">
          <Button
            variant="ghost" size="icon"
            onClick={copyLogs}
            disabled={!visibleLogs.length}
            title={copied ? t('log.copied') : t('log.copy')}
            aria-label={copied ? t('log.copied') : t('log.copy')}
          >
            {copied ? <Check size={13} className="text-[var(--color-accent)]" /> : <Copy size={13} />}
          </Button>
          <Button
            variant="ghost" size="icon"
            onClick={() => setFileDialogOpen(true)}
            title={t('log.viewFiles')}
            aria-label={t('log.viewFiles')}
          >
            <FileText size={13} />
          </Button>
          <Button variant="ghost" size="icon" onClick={openLogDir} title={t('log.openDir')} aria-label={t('log.openDir')}>
            <FolderOpen size={13} />
          </Button>
          <Button
            variant="ghost" size="icon"
            onClick={() => setSortAsc(!sortAsc)}
            title={sortAsc ? t('log.sortAsc') : t('log.sortDesc')}
            aria-label={sortAsc ? t('log.sortAsc') : t('log.sortDesc')}
            className={sortAsc ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-accent)]'}
          >
            <SortDirectionIcon direction={sortAsc ? 'asc' : 'desc'} />
          </Button>
          <Button
            variant="ghost" size="icon" active={autoScroll}
            onClick={() => setAutoScroll(!autoScroll)}
            title={autoScroll ? t('tip.autoScrollOn') : t('tip.autoScrollOff')}
            aria-label={autoScroll ? t('tip.autoScrollOn') : t('tip.autoScrollOff')}
            aria-pressed={autoScroll}
            className={autoScroll ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}
          >
            {sortAsc ? <ListEnd size={16} aria-hidden="true" /> : <ListStart size={16} aria-hidden="true" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={clearLogs} title={t('tip.clearLog')} aria-label={t('tip.clearLog')}>
            <Trash2 size={13} />
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 pb-2 font-mono text-xs leading-5">
        {visibleLogs.length === 0 ? (
          <EmptyState message={t('status.noLogs')} size="xs" className="text-center" />
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const log = visibleLogs[virtualRow.index]
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className="flex gap-2"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <span style={{ color: 'var(--color-text-muted)' }}>{log.time}</span>
                  <span style={{ color: levelColor(log.level) }}>{log.message}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <LogFileDialog open={fileDialogOpen} onOpenChange={setFileDialogOpen} />
    </div>
  )
})
