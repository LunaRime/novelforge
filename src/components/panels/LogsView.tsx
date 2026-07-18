/**
 * LogsView — 底部面板日志视图
 *
 * 从 BottomPanel 中提取的独立子组件，展示工作流运行日志。
 * 支持自动滚动和清空日志。
 */
import { useState, useRef, useEffect, memo } from 'react'
import { Trash2, ChevronsDown } from 'lucide-react'
import { useWorkflowStore } from '../../stores/workflow-store'
import { Button } from '../ui/Button'
import { t } from '../../shared/locale'

export default memo(function LogsView() {
  const globalLogs = useWorkflowStore(s => s.globalLogs)
  const clearLogs = useWorkflowStore(s => s.clearLogs)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [globalLogs.length, autoScroll])

  const levelColor = (level: string) => {
    switch (level) {
      case 'error': return 'var(--color-error)'
      case 'warn':  return 'var(--color-warning)'
      default:      return 'var(--color-text-secondary)'
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-end gap-1 px-2 py-1 flex-shrink-0">
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

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 pb-2 font-mono text-xs leading-5">
        {globalLogs.length === 0 && (
          <div className="text-center py-8 opacity-30">{t('status.noLogs')}</div>
        )}
        {globalLogs.map((log, i) => (
          <div key={i} className="flex gap-2">
            <span style={{ color: 'var(--color-text-muted)' }}>{log.time}</span>
            <span style={{ color: levelColor(log.level) }}>{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
})
