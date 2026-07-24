import { DEFAULT_LOCALE } from '../../shared/locale'
/**
 * 后处理状态面板 — 通用可内嵌组件
 *
 * 展示后处理流水线各步骤的成功/失败状态，
 * 并提供单步重试和全部重试入口。
 *
 * 使用场景：
 * - 草稿箱章节卡片（定稿后处理状态）
 * - 故事架构页（角色卡提取状态）
 */

import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, CheckCircle2, XCircle, AlertTriangle, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '../ui/Button'
import { useProjectStore } from '../../stores/project-store'
import { readPostProcessStatus, type PostProcessStatus } from '../../services/workflows/workflow-utils'
import { cn } from '../../lib/utils'
import { globalEventBus } from '../../shared/event-bus'

interface PostProcessStatusPanelProps {
  /** 状态文件 scope 标识，如 'chapter_1_finalize' */
  scope: string
  /** 重试回调（传 stepKey 则单步重试，不传则全部重试） */
  onRetry?: (stepKey?: string) => void
  /** 是否默认展开（默认 false，折叠显示摘要） */
  defaultExpanded?: boolean
  /** 加载状态后的回调，通知父组件是否有失败项 */
  onStatusLoad?: (hasFailure: boolean) => void
  /** 额外 CSS 类名 */
  className?: string
}

export function PostProcessStatusPanel({
  scope,
  onRetry,
  defaultExpanded = false,
  onStatusLoad,
  className,
}: PostProcessStatusPanelProps) {
  const [status, setStatus] = useState<PostProcessStatus | null>(null)
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [loading, setLoading] = useState(true)
  const project = useProjectStore(s => s.currentProject)

  // 加载状态文件
  const loadStatus = useCallback(async () => {
    if (!project) return
    const s = await readPostProcessStatus(project.path, scope)
    setStatus(s)
    setLoading(false)
  }, [project, scope])

  // Initial load
  useEffect(() => {
    let mounted = true
    const init = async () => {
      if (!project) return
      setLoading(true)
      const s = await readPostProcessStatus(project.path, scope)
      if (mounted) {
        setStatus(s)
        setLoading(false)
      }
    }
    init()
    return () => { mounted = false }
  }, [project, scope])

  // 监听 EventBus 事件，自动刷新后处理状态
  useEffect(() => {
    const unsub1 = globalEventBus.on('FINALIZE_COMPLETE', () => { loadStatus() })
    const unsub2 = globalEventBus.on('WORKFLOW_COMPLETE', () => { loadStatus() })
    return () => { unsub1(); unsub2() }
  }, [loadStatus])

  // 状态变化时回调给父组件
  useEffect(() => {
    if (!status) return
    const isFailed = Object.values(status.steps).some(s => !s.ok)
    if (onStatusLoad) {
      onStatusLoad(isFailed)
    }
  }, [status, onStatusLoad])

  // 无状态文件 → 不渲染
  if (loading || !status) return null

  const steps = Object.entries(status.steps)
  const failedSteps = steps.filter(([, s]) => !s.ok)
  const successCount = steps.filter(([, s]) => s.ok).length
  const totalCount = steps.length
  const hasFailure = failedSteps.length > 0
  const hasCriticalFailure = failedSteps.some(([, s]) => s.critical)

  if (!hasFailure) {
    return (
      <div className={cn(
        'flex items-center gap-1.5 px-2 py-1 rounded text-[10px]',
        className,
      )} style={{ color: 'var(--color-success)', backgroundColor: 'rgba(var(--color-success-rgb), 0.08)' }}>
        <CheckCircle2 size={12} />
        <span>{status.sourceLabel} 完成（{successCount}/{totalCount}）</span>
      </div>
    )
  }

  // 有失败 → 显示带折叠的详情面板
  const warnColor = 'var(--color-warning)'
  const errorColor = 'var(--color-error)'
  const borderColor = hasCriticalFailure ? 'rgba(var(--color-error-rgb), 0.3)' : 'rgba(var(--color-warning-rgb), 0.3)'
  const bgColor = hasCriticalFailure ? 'rgba(var(--color-error-rgb), 0.08)' : 'rgba(var(--color-warning-rgb), 0.08)'

  return (
    <div className={cn('rounded-[var(--radius-md)] border overflow-hidden', className)}
      style={{ borderColor, backgroundColor: bgColor }}>
      {/* 折叠头部 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-left cursor-pointer hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] rounded-t-[var(--radius-md)]"
      >
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={13} style={{ color: hasCriticalFailure ? errorColor : warnColor }} />
          <span className="text-[11px] font-medium" style={{ color: 'var(--color-text)' }}>
            {status.sourceLabel} — {failedSteps.length} 个步骤失败
          </span>
          <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
            ({successCount}/{totalCount})
          </span>
        </div>
        <span style={{ color: 'var(--color-text-muted)' }}>
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </span>
      </button>

      {/* 展开详情 */}
      {expanded && (
        <div className="px-3 pb-2.5 space-y-1">
          {steps.map(([key, step]) => (
            <div
              key={key}
              className="flex items-center justify-between gap-2 py-1 text-[11px]"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {step.ok ? (
                  <CheckCircle2 size={12} className="shrink-0" style={{ color: 'var(--color-success)' }} />
                ) : (
                  <XCircle size={12} className="shrink-0" style={{ color: 'var(--color-error)' }} />
                )}
                <span className="truncate" style={{ color: step.ok ? 'var(--color-text-secondary)' : 'var(--color-text)' }}>
                  {step.label}
                </span>
                {step.critical && !step.ok && (
                  <span className="shrink-0 px-1 py-0.5 rounded text-[9px]" style={{ backgroundColor: 'rgba(var(--color-error-rgb), 0.15)', color: 'var(--color-error)' }}>
                    关键
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {step.ok ? (
                  <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                    {step.completedAt ? new Date(step.completedAt).toLocaleTimeString(DEFAULT_LOCALE, { hour: '2-digit', minute: '2-digit' }) : ''}
                  </span>
                ) : (
                  <>
                    <span className="text-[10px] max-w-[120px] truncate" title={step.error} style={{ color: 'var(--color-error)' }}>
                      {step.error || '失败'}
                    </span>
                    {onRetry && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onRetry(key) }}
                        className="p-0.5 rounded hover:bg-[var(--color-hover)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
                        title="重试此步骤"
                      >
                        <RefreshCw size={11} style={{ color: 'var(--color-accent)' }} />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}

          {/* 底部操作栏 */}
          <div className="flex items-center justify-between pt-1.5 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
              <Clock size={10} />
              <span>
                上次尝试 {new Date(status.updatedAt).toLocaleTimeString(DEFAULT_LOCALE, { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            {onRetry && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRetry()}
                className="gap-1"
              >
                <RefreshCw size={10} />
                重试失败步骤
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
