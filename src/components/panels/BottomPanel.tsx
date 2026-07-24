import { useState, useEffect } from 'react'
import { DEFAULT_LOCALE } from '../../shared/locale'
import { useTranslation } from '../../hooks/useTranslation'
import {
  Loader2, CheckCircle2, XCircle, Clock,
  Play, X, ChevronDown, ChevronRight, Zap,
} from 'lucide-react'
import { useLayoutStore } from '../../stores/layout-store'
import { useWorkflowStore, type WorkflowStep, type WorkflowRun } from '../../stores/workflow-store'
import LogsView from './LogsView'
import ModelsView from './ModelsView'
import { t } from '../../shared/locale'

/** 底部面板 Tab 名称映射（通过 i18n 字典统一管理） */
const TAB_LABELS: Record<string, string> = {
  tasks:  t('panel.tasks'),
  log:    t('panel.log'),
  models: t('panel.models'),
}

/** 下方工具窗口 */
export default function BottomPanel() {
  const bottomPanelOpen = useLayoutStore(s => s.bottomPanelOpen)
  const bottomTab = useLayoutStore(s => s.bottomTab)
  const toggleBottomPanel = useLayoutStore(s => s.toggleBottomPanel)
  // ✅ 只订阅 activeRuns，不订阅 globalLogs 等高频字段
  const activeRuns = useWorkflowStore(s => s.activeRuns)

  // A) 懒卸载：面板关闭时保持挂载，仅视觉隐藏，避免切换时的短暂状态错乱
  const [visible, setVisible] = useState(bottomPanelOpen)
  useEffect(() => {
    if (bottomPanelOpen) {
      /* intentionally deferred to avoid cascading render */
      setTimeout(() => setVisible(true), 0)
    } else {
      // 等待动画完成后再卸载
      const t = setTimeout(() => setVisible(false), 300)
      return () => clearTimeout(t)
    }
  }, [bottomPanelOpen])

  if (!visible) return null

  const activeTab = bottomTab || 'tasks'
  const label = TAB_LABELS[activeTab] ?? activeTab
  // 任何活跃任务运行中
  const hasRunning = activeRuns.some(r => r.status === 'running')
  const hasWaiting = activeRuns.some(r => r.status === 'waiting')

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden"
      style={{
        backgroundColor: 'var(--color-panel)',
        borderTop: '1px solid var(--color-border)',
        // A) 懒卸载过渡：关闭时先动画淡出再完全隐藏
        opacity: bottomPanelOpen ? 1 : 0,
        transition: 'opacity 0.25s ease',
        pointerEvents: bottomPanelOpen ? 'auto' : 'none',
      }}
    >
      {/* 面板标题头 */}
      <div
        className="no-select flex items-center justify-between flex-shrink-0 px-3"
        style={{ height: 'var(--height-panel-header)', borderBottom: '1px solid var(--color-border)' }}
      >
        {/* 左侧：面板名称 + 可选状态点 */}
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {label}
          </span>
          {/* 运行中指示 */}
          {activeTab === 'tasks' && hasRunning && (
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--color-accent)' }} />
          )}
          {activeTab === 'tasks' && hasWaiting && !hasRunning && (
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--color-warning)' }} />
          )}
          {/* 活跃任务数徽章 */}
          {activeTab === 'tasks' && activeRuns.length > 0 && (
            <span
              className="text-[0.68rem] font-mono px-1 rounded"
              style={{ backgroundColor: 'rgba(var(--color-accent-rgb), 0.12)', color: 'var(--color-accent)' }}
            >
              {activeRuns.length}
            </span>
          )}
        </div>

        {/* 右侧：关闭按钮 */}
        <button onClick={toggleBottomPanel} title={t('tip.closePanel')} className="icon-btn" style={{ width: 18, height: 18 }}>
          <X size={12} strokeWidth={1.5} />
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'tasks'  && <TaskRunView />}
        {activeTab === 'log'    && <LogsView />}
        {activeTab === 'models' && <ModelsView />}
      </div>
    </div>
  )
}


// ===== ⚡ 任务视图（工作流进度主视图）— 支持多任务 =====

function TaskRunView() {
  const { t } = useTranslation()
  const activeRuns = useWorkflowStore(s => s.activeRuns)
  const history = useWorkflowStore(s => s.history)
  const waitingRuns = useWorkflowStore(s => s.waitingRuns)
  const cancelWorkflow = useWorkflowStore(s => s.cancelWorkflow)
  const confirmContinue = useWorkflowStore(s => s.confirmContinue)

  console.log('[BottomPanel] TaskRunView render: activeRuns=', activeRuns.map(r => r.id.slice(0,8) + ':' + r.status + ':' + r.steps.map(s=>s.status).join('/')))

  if (activeRuns.length === 0 && history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: 'var(--color-text-muted)' }}>
        <Zap size={24} style={{ opacity: 0.5 }} />
        <span className="text-xs">{t('empty.noTasks')}</span>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto pb-4">
      {/* 活跃任务列表（支持多个并行） */}
      {activeRuns.length > 0 && (
        <div className="flex-shrink-0" style={{ borderBottom: history.length > 0 ? '1px solid var(--color-border)' : undefined }}>
          {activeRuns.map((run, idx) => {
            const runWaiting = waitingRuns[run.id]
            return (
              <div key={run.id} style={{ borderBottom: idx < activeRuns.length - 1 ? '1px solid var(--color-border)' : undefined }}>
                <ActiveRunPanel
                  run={run}
                  waitingForConfirm={runWaiting?.waitingForConfirm ?? false}
                  waitingAfterStepIndex={runWaiting?.waitingAfterStepIndex ?? -1}
                  onConfirm={() => confirmContinue(run.id)}
                  onCancel={() => cancelWorkflow(run.id)}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* 历史记录（简表） */}
      {history.length > 0 && (
        <div className="flex-shrink-0">
          <div className="px-4 pt-3 pb-1 text-[0.68rem] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
            {t('panel.taskHistory')}
          </div>
          <div className="px-2 pb-2">
            {history.map((run) => (
              <div
                key={run.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded transition-colors hover:bg-[var(--color-hover)]"
              >
                {/* 状态图标 */}
                {run.status === 'completed'
                  ? <CheckCircle2 size={12} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                  : <XCircle size={12} style={{ color: 'var(--color-error)', flexShrink: 0 }} />
                }
                {/* 标题 */}
                <span className="flex-1 text-xs truncate" style={{ color: 'var(--color-text-secondary)' }}>
                  {run.title}
                </span>
                {/* 步骤计数 */}
                <span className="text-[0.68rem] font-mono flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                  {run.steps.filter(s => s.status === 'completed').length}/{run.steps.length}
                </span>
                {/* 时间 */}
                <span className="text-[0.68rem] flex-shrink-0 w-14 text-right" style={{ color: 'var(--color-text-muted)' }}>
                  {new Date(run.createdAt).toLocaleTimeString(DEFAULT_LOCALE, { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ===== 当前任务进度面板（接收 run 参数，支持多实例） =====

function ActiveRunPanel({
  run,
  waitingForConfirm,
  waitingAfterStepIndex,
  onConfirm,
  onCancel,
}: {
  run: WorkflowRun
  waitingForConfirm: boolean
  waitingAfterStepIndex: number
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(true)

  // 需要确认时自动展开
  useEffect(() => {
    let mounted = true
    if (waitingForConfirm) {
      Promise.resolve().then(() => {
        if (mounted) setExpanded(true)
      })
    }
    return () => { mounted = false }
  }, [waitingForConfirm])

  const runningStep = run.steps.find(s => s.status === 'running')
  const completedCount = run.steps.filter(s => s.status === 'completed').length
  const totalCount = run.steps.length
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  const nextStepName = run.steps[waitingAfterStepIndex + 1]?.name
  const isActive = run.status === 'running' || run.status === 'waiting'

  console.log('[BottomPanel] ActiveRunPanel render: run.status=', run.status, 'steps=', run.steps.map(s => s.status).join(','))

  return (
    <div>
      {/* ── 状态条（始终可见，点击折叠/展开） ── */}
      <div
        className="flex items-center gap-2.5 px-3 py-2 cursor-pointer select-none"
        onClick={() => setExpanded(v => !v)}
      >
        {/* 状态图标 */}
        <div className="flex-shrink-0">
          {run.status === 'running' && (
            <Loader2 size={13} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
          )}
          {run.status === 'waiting' && (
            <Clock size={13} style={{ color: 'var(--color-warning)' }} />
          )}
        </div>

        {/* 标题 + 进度条 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5 mb-1">
            <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>
              {runningStep && isActive ? runningStep.name : run.title}
            </p>
            <span className="text-[0.68rem] font-mono flex-shrink-0" style={{ color: 'var(--color-accent)' }}>
              {progress}%
            </span>
          </div>
          {/* 2px 进度条 */}
          <div className="h-[2px] rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-border)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progress}%`, backgroundColor: 'var(--color-accent)' }}
            />
          </div>
        </div>

        {/* 右侧：步骤计数 + 折叠箭头 + 取消 */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-[0.68rem] font-mono" style={{ color: 'var(--color-text-muted)' }}>
            {completedCount}/{totalCount}
          </span>
          {expanded
            ? <ChevronDown size={11} style={{ color: 'var(--color-text-muted)' }} />
            : <ChevronRight size={11} style={{ color: 'var(--color-text-muted)' }} />
          }
          {/* 取消按钮——阻止冒泡到折叠点击 */}
          <button
            onClick={(e) => { e.stopPropagation(); onCancel() }}
            className="icon-btn"
            style={{ width: 18, height: 18 }}
            title={t('tip.cancelTask')}
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {/* ── 步骤详情列表（展开时显示） ── */}
      {expanded && (
        <div className="pb-2">
          {/* 步骤列表——扁平连接器风格 */}
          <div className="px-4">
            {run.steps.map((step, i) => (
              <WorkflowStepItem key={step.id} step={step} index={i} isLast={i === run.steps.length - 1} />
            ))}
          </div>

          {/* ── 等待确认操作区 ── */}
          {waitingForConfirm && nextStepName && (
            <div
              className="mx-4 mt-2 px-3 py-2 rounded flex items-center gap-2"
              style={{
                backgroundColor: 'rgba(var(--color-accent-rgb), 0.07)',
                border: '1px solid rgba(var(--color-accent-rgb), 0.25)',
              }}
            >
              <Clock size={11} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
              <span className="text-xs flex-1 truncate" style={{ color: 'var(--color-text-secondary)' }}>
                {t('panel.nextStep').replace('{name}', nextStepName)}
              </span>
              <button
                onClick={onConfirm}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium flex-shrink-0"
                style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text)' }}
              >
                <Play size={10} /> {t('nextStep.continue')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── 折叠时若等待确认：状态条下方显示简洁提示 ── */}
      {waitingForConfirm && !expanded && nextStepName && (
        <div
          className="mx-3 mb-2 px-2.5 py-1.5 rounded flex items-center gap-2"
          style={{
            backgroundColor: 'rgba(var(--color-accent-rgb), 0.07)',
            border: '1px solid rgba(var(--color-accent-rgb), 0.25)',
          }}
        >
          <Clock size={11} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
          <span className="text-xs flex-1 truncate" style={{ color: 'var(--color-text-secondary)' }}>
            {t('panel.nextStep').replace('{name}', nextStepName)}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onConfirm() }}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium flex-shrink-0"
            style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text)' }}
          >
            <Play size={10} /> {t('nextStep.continue')}
          </button>
        </div>
      )}
    </div>
  )
}

// ===== 工作流步骤项（扁平连接器风格） =====

function WorkflowStepItem({
  step,
  index,
  isLast,
}: {
  step: WorkflowStep
  index: number
  isLast: boolean
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const hasDetail = !!step.error || step.logs.length > 0

  // 运行中自动展开
  useEffect(() => {
    let mounted = true
    if (step.status === 'running') {
      Promise.resolve().then(() => {
        if (mounted) setExpanded(true)
      })
    }
    return () => { mounted = false }
  }, [step.status])

  return (
    <div className="relative flex gap-2.5">
      {/* ── 左侧：图标 + 竖线连接器 ── */}
      <div className="flex flex-col items-center flex-shrink-0" style={{ paddingTop: 8 }}>
        {/* 状态图标 */}
        <div className="flex-shrink-0">
          <StepStatusIcon status={step.status} />
        </div>
        {/* 竖线（非最后一步时显示） */}
        {!isLast && (
          <div
            className="w-px flex-1 mt-1"
            style={{
              minHeight: 12,
              backgroundColor: step.status === 'completed'
                ? 'var(--color-success)'
                : 'var(--color-border)',
              opacity: step.status === 'completed' ? 0.4 : 0.6,
            }}
          />
        )}
      </div>

      {/* ── 右侧：内容 ── */}
      <div
        className="flex-1 min-w-0 pb-2"
        style={{ minHeight: isLast ? undefined : 28 }}
      >
        {/* 步骤标题行 */}
        <div
          className={`flex items-center gap-1 py-1 ${hasDetail ? 'cursor-pointer' : ''}`}
          onClick={hasDetail ? () => setExpanded(v => !v) : undefined}
        >
          {hasDetail && (
            expanded
              ? <ChevronDown size={10} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
              : <ChevronRight size={10} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          )}
          <span
            className="text-xs flex-1 truncate"
            style={{
              color: step.status === 'running'
                ? 'var(--color-text)'
                : step.status === 'pending'
                  ? 'var(--color-text-muted)'
                  : 'var(--color-text-secondary)',
              fontWeight: step.status === 'running' ? 500 : 400,
            }}
          >
            {index + 1}. {step.name}
          </span>
          {/* 进度百分比 */}
          {step.progress !== undefined && step.status === 'running' && (
            <span className="text-[0.68rem] font-mono flex-shrink-0" style={{ color: 'var(--color-accent)' }}>
              {step.progress}%
            </span>
          )}
          {/* 完成耗时（若有时间戳）或简单标记 */}
          {step.status === 'skipped' && (
            <span className="text-[0.68rem] flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{t('status.aborted')}</span>
          )}
        </div>

        {/* 详情区（展开时显示：日志 + 错误） */}
        {expanded && hasDetail && (
          <div className="mb-1">
            {step.error && (
              <div
                className="text-[0.7rem] px-2 py-1 rounded mb-1"
                style={{ backgroundColor: 'rgba(192,57,74,0.08)', color: 'var(--color-error)' }}
              >
                {step.error}
              </div>
            )}
            {step.logs.length > 0 && (
              <div className="max-h-16 overflow-y-auto space-y-0.5">
                {step.logs.slice(-6).map((log, i) => (
                  <div key={i} className="text-[0.68rem] font-mono leading-4" style={{ color: 'var(--color-text-muted)' }}>
                    {log}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** 步骤状态图标（对齐竖线连接器） */
function StepStatusIcon({ status }: { status: WorkflowStep['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 size={13} style={{ color: 'var(--color-success)' }} />
    case 'running':
      return <Loader2 size={13} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
    case 'failed':
      return <XCircle size={13} style={{ color: 'var(--color-error)' }} />
    case 'skipped':
      return (
        <div
          className="w-3 h-3 rounded-full flex items-center justify-center"
          style={{ border: '1.5px dashed var(--color-text-muted)' }}
        />
      )
    default:
      // pending
      return (
        <div
          className="w-3 h-3 rounded-full"
          style={{ border: '1.5px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}
        />
      )
  }
}


// ModelsView 已提取到 ./ModelsView.tsx
