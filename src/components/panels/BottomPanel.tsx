import { memo, useState, useEffect, useLayoutEffect, useRef } from 'react'
import { getCurrentLocale } from '../../shared/locale'
import { useTranslation } from '../../hooks/useTranslation'
import {
  Clock, ShieldAlert,
  Play, X, ChevronDown, ChevronRight, Zap, ScrollText, Inbox,
} from 'lucide-react'
import { Button } from '../ui/Button'
import CountBadge from '../ui/CountBadge'
import { ProgressBar } from '../ui/ProgressBar'
import { StateDot, type StateDotState } from '../ui/StateDot'
import { useLayoutStore } from '../../stores/layout-store'
import { useWorkflowStore, type WorkflowStep, type WorkflowRun } from '../../stores/workflow-store'
import LogsView from './LogsView'
import InboxPanel from './automation/InboxPanel'
import { useAutomationStore } from '../../stores/automation-store'
import { useAgentStore } from '../../stores/agent-store'
import { useScopedWorkflowRuns, useTaskNavigation } from './agent/agent-panel-session'

/** 工作台底栏显示当前选中的页签。 */
export default function BottomPanel() {
  const { t } = useTranslation()
  const bottomTab = useLayoutStore(s => s.bottomTab)
  const toggleBottomPanel = useLayoutStore(s => s.toggleBottomPanel)
  const openBottomTab = useLayoutStore(s => s.openBottomTab)
  // ✅ 只订阅 activeRuns，不订阅 globalLogs 等高频字段
  const { activeRuns } = useScopedWorkflowRuns()
  // 收件箱未处理数（D 档徽章）：用长度而非数组本身订阅，避免每次 loadAll 都触发重渲染
  const pendingInboxCount = useAutomationStore(s => s.inbox.filter(i => i.status === 'pending').length)

  // 声明为 string：兼容旧版本持久化的 bottomTab='models'（已映射到活动视图）
  const activeTab: string = bottomTab || 'tasks'
  // 兼容旧持久化值：'activity'（写作统计已于 2026-09-22 搬去编辑区页面）与 'models' 一律回落到
  // 任务视图——否则老用户升级后会看到一个空白底栏
  const effectiveTab = (activeTab === 'activity' || activeTab === 'models') ? 'tasks' : activeTab
  // 任何活跃任务运行中
  const hasRunning = activeRuns.some(r => r.status === 'running')
  const hasWaiting = activeRuns.some(r => r.status === 'waiting')

  const views = [
    ['tasks', Zap, t('panel.tasks'), activeRuns.length],
    ['log', ScrollText, t('panel.log'), 0],
    ['inbox', Inbox, t('automation.inbox.tab'), pendingInboxCount],
  ] as const

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-panel)]">
      <div className="nf-workbench-view-header">
        <div className="nf-workbench-view-list" role="group" aria-label={t('panel.bottom')}>
          {views.map(([id, Icon, label, count]) => (
            <Button key={id} type="button" variant="ghost" className="nf-workbench-view"
              active={effectiveTab === id} aria-pressed={effectiveTab === id} title={label} aria-label={label}
              onClick={() => openBottomTab(id)}>
              <Icon size={14} aria-hidden="true" />
              <span className="truncate">{label}</span>
              {count > 0 && <CountBadge value={count} tone={id === 'tasks' && hasWaiting && !hasRunning ? 'warning' : 'accent'} />}
            </Button>
          ))}
        </div>
        <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0"
          title={t('tip.closePanel')} aria-label={t('tip.closePanel')} onClick={() => {
            toggleBottomPanel()
            document.querySelector<HTMLButtonElement>('[data-workbench-toggle="runtime"]')?.focus()
          }}>
          <X size={15} aria-hidden="true" />
        </Button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-hidden">
        {effectiveTab === 'tasks' && <TaskRunView />}
        {effectiveTab === 'log' && <LogsView />}
        {effectiveTab === 'inbox' && <InboxPanel />}
      </div>
    </div>
  )
}


// ===== ⚡ 任务视图（工作流进度主视图）— 支持多任务 =====

function TaskRunView() {
  const { t } = useTranslation()
  const { activeRuns, history, scope } = useScopedWorkflowRuns()
  const approval = useAgentStore(s => s.pendingToolApproval)
  const liveApproval = approval?.isCurrent() ? approval : null
  const target = useTaskNavigation(state => state.workflow)
  const viewport = useRef<HTMLDivElement>(null)
  const waitingRuns = useWorkflowStore(s => s.waitingRuns)

  useLayoutEffect(() => {
    if (target?.scope !== scope || !viewport.current) return
    const row = [...viewport.current.querySelectorAll<HTMLButtonElement>('[data-workflow-run]')]
      .find(button => button.dataset.workflowRun === target.id)
    row?.focus()
    row?.scrollIntoView?.({ block: 'nearest' })
    useTaskNavigation.setState({ workflow: null })
  }, [scope, target])

  if (activeRuns.length === 0 && history.length === 0 && !liveApproval) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: 'var(--color-text-muted)' }}>
        <Zap size={36} style={{ opacity: 0.5 }} />
        <span className="text-xs">{t('empty.noTasks')}</span>
      </div>
    )
  }

  return (
    <div ref={viewport} className="h-full overflow-y-auto pb-4">
      {liveApproval && <button type="button"
        onClick={() => {
          if (!liveApproval.isCurrent() || useAgentStore.getState().pendingToolApproval !== liveApproval) return
          useTaskNavigation.setState({ approval: { scope, id: liveApproval.toolCall.id } })
          useAgentStore.getState().selectConversation(liveApproval.conversationId)
          useLayoutStore.getState().openRightPanel('agent')
        }}
        className="flex min-h-8 w-full items-center gap-2 px-3 text-left text-xs hover:bg-[var(--color-hover)]">
        <ShieldAlert size={14} className="shrink-0 text-[var(--color-warning)]" />
        <span>{t('agent.confirmAction')}</span>
        <span className="truncate text-[var(--color-text-muted)]">{liveApproval.toolCall.toolName}</span>
      </button>}
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
                />
              </div>
            )
          })}
        </div>
      )}

      {/* 历史记录（简表；2026-09-27 可供性修复：行 = 主按钮，点击就地展开步骤详情 ——
          此前行有 hover 变色却无点击处理器） */}
      {history.length > 0 && (
        <div className="flex-shrink-0">
          <div className="px-4 pt-3 pb-1 text-micro font-semibold" style={{ color: 'var(--color-text-muted)' }}>
            {t('panel.taskHistory')}
          </div>
          <div className="px-2 pb-2">
            {history.map((run) => (
              <HistoryRunItem key={run.id} run={run} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ===== 历史运行行（可展开步骤详情） =====

/**
 * 2026-09-27 可供性修复：历史行此前「hover 变色但无点击处理器」——
 * 现行为主按钮（键盘可达），点击就地展开该次运行的步骤详情（复用 WorkflowStepItem）。
 */
const HistoryRunItem = memo(function HistoryRunItem({ run }: { run: WorkflowRun }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  return (
    <div>
      <button
        type="button"
        data-workflow-run={run.id}
        aria-expanded={expanded}
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left cursor-pointer transition-colors hover:bg-[var(--color-hover)]"
      >
        <ChevronRight
          size={10}
          className={expanded ? 'rotate-90' : ''}
          style={{ transition: 'transform 0.15s', flexShrink: 0, color: 'var(--color-text-muted)' }}
        />
        {/* 状态点（线② 2b：StateDot 五态，替代 CheckCircle2/XCircle） */}
        <StateDot state={runDotState(run)} />
        {/* 标题 */}
        <span className="flex-1 text-xs truncate" style={{ color: 'var(--color-text-secondary)' }}>
          {run.title}
        </span>
        {run.cancellation === 'cancelled' && <span className="text-xs">{t('status.cancelled')}</span>}
        {/* 步骤计数 */}
        <span className="text-micro font-mono flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
          {run.steps.filter(s => s.status === 'completed').length}/{run.steps.length}
        </span>
        {/* 时间 */}
        <span className="text-micro flex-shrink-0 w-14 text-right" style={{ color: 'var(--color-text-muted)' }}>
          {new Date(run.createdAt).toLocaleTimeString(getCurrentLocale(), { hour: '2-digit', minute: '2-digit' })}
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-1">
          {run.steps.map((step, i) => (
            <WorkflowStepItem key={step.id} step={step} index={i} />
          ))}
        </div>
      )}
    </div>
  )
})

// ===== 当前任务进度面板（接收 run 参数，支持多实例） =====

const ActiveRunPanel = memo(function ActiveRunPanel({
  run,
  waitingForConfirm,
  waitingAfterStepIndex,
}: {
  run: WorkflowRun
  waitingForConfirm: boolean
  waitingAfterStepIndex: number
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(true)
  const header = useRef<HTMLButtonElement>(null)

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

  return (
    <div>
      {/* ── 状态条（始终可见）：主按钮 = 折叠/展开（原生 button，键盘可达）；
             取消按钮作兄弟、独立触发（2026-09-27：不再需要 stopPropagation） ── */}
      <div className="flex items-center gap-1 px-3 py-2 select-none">
        <button
          type="button"
          ref={header}
          data-workflow-run={run.id}
          aria-expanded={expanded}
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-2.5 flex-1 min-w-0 text-left cursor-pointer rounded hover:bg-[var(--color-hover)]"
        >
          {/* 状态点（线② 2b：StateDot 五态，替代 Spinner/Clock） */}
          <div className="flex-shrink-0">
            <StateDot state={runDotState(run)} />
          </div>

          {/* 标题 + 进度条 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5 mb-1">
              <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>
                {run.cancellation === 'requested' ? run.title : runningStep && isActive ? runningStep.name : run.title}
              </p>
              {run.cancellation === 'requested' && <span role="status" className="shrink-0 text-xs">{t('status.cancelling')}</span>}
              <span className="text-micro font-mono flex-shrink-0" style={{ color: 'var(--color-accent)' }}>
                {progress}%
              </span>
            </div>
            {/* 2px 进度条 */}
            <ProgressBar value={progress} />
          </div>

          {/* 右侧：步骤计数 + 折叠箭头 */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="text-micro font-mono" style={{ color: 'var(--color-text-muted)' }}>
              {completedCount}/{totalCount}
            </span>
            {expanded
              ? <ChevronDown size={11} style={{ color: 'var(--color-text-muted)' }} />
              : <ChevronRight size={11} style={{ color: 'var(--color-text-muted)' }} />
            }
          </div>
        </button>
        {/* 取消按钮（独立行为 → 兄弟节点；命中区 icon-btn = 22×22） */}
        {run.cancellation !== 'requested' && <button
          type="button"
          onClick={() => {
            header.current?.focus()
            useWorkflowStore.getState().cancelWorkflow(run.id)
          }}
          className="icon-btn size-[32px] shrink-0"
          title={t('tip.cancelTask')}
          aria-label={t('tip.cancelTask')}
        >
          <X size={11} />
        </button>}
      </div>

      {/* ── 步骤详情列表（展开时显示） ── */}
      {expanded && (
        <div className="pb-2">
          {/* 步骤列表——扁平连接器风格 */}
          <div className="px-4">
            {run.steps.map((step, i) => (
              <WorkflowStepItem key={step.id} step={step} index={i} />
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
              onClick={() => useWorkflowStore.getState().confirmContinue(run.id)}
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
            onClick={() => useWorkflowStore.getState().confirmContinue(run.id)}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium flex-shrink-0"
            style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text)' }}
          >
            <Play size={10} /> {t('nextStep.continue')}
          </button>
        </div>
      )}
    </div>
  )
})

// ===== 工作流步骤项（扁平连接器风格） =====

function WorkflowStepItem({
  step,
  index,
}: {
  step: WorkflowStep
  index: number
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const hasDetail = !!step.error || step.logs.length > 0

  /** 步骤标题行内容（有详情时整行 = 按钮；无详情 = 纯状态行，见下方渲染分支） */
  const rowContent = (
    <>
      {hasDetail && (
        expanded
          ? <ChevronDown size={10} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          : <ChevronRight size={10} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
      )}
      {/* 状态点（线② 2b：StateDot 五态，替代原竖线连接器 + 状态图标） */}
      <StepStatusIcon status={step.status} />
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
        <span className="text-micro font-mono flex-shrink-0" style={{ color: 'var(--color-accent)' }}>
          {step.progress}%
        </span>
      )}
      {/* 完成耗时（若有时间戳）或简单标记 */}
      {step.status === 'skipped' && (
        <span className="text-micro flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{t('status.aborted')}</span>
      )}
    </>
  )

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
    <div className="pb-0.5">
      {/* 步骤标题行（线② 2b：StateDot 已在 rowContent 行首，去掉原竖线连接器——
          dsh member 行 = 状态点 + 名字 + 状态，无竖线） */}
      {hasDetail ? (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="w-full flex items-center gap-1.5 py-1 text-left cursor-pointer rounded hover:bg-[var(--color-hover)]"
        >
          {rowContent}
        </button>
      ) : (
        <div className="flex items-center gap-1.5 py-1">
          {rowContent}
        </div>
      )}

      {/* 详情区（展开时显示：日志 + 错误） */}
      {expanded && hasDetail && (
        <div className="mb-1 pl-6">
          {step.error && (
            <div
              className="text-micro px-2 py-1 rounded mb-1"
              style={{ backgroundColor: 'rgba(var(--color-error-rgb),0.08)', color: 'var(--color-error)' }}
            >
              {step.error}
            </div>
          )}
          {step.logs.length > 0 && (
            <div className="max-h-16 overflow-y-auto space-y-0.5">
              {step.logs.slice(-6).map((log, i) => (
                <div key={i} className="text-micro font-mono leading-4" style={{ color: 'var(--color-text-muted)' }}>
                  {log}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 步骤状态图标（对齐竖线连接器）—— 线② 2b 改用 StateDot 五态（dsh 状态点统一语义） */
function StepStatusIcon({ status }: { status: WorkflowStep['status'] }) {
  return <StateDot state={stepDotState(status)} />
}

/** StepStatus → StateDot 五态 */
function stepDotState(status: WorkflowStep['status']): StateDotState {
  switch (status) {
    case 'completed': return 'done'
    case 'running': return 'ongoing'
    case 'failed': return 'error'
    case 'skipped': case 'pending':
    default: return 'idle'
  }
}

/** WorkflowStatus → StateDot 五态（run 级） */
function runDotState(run: WorkflowRun): StateDotState {
  if (run.cancellation) return run.cancellation === 'requested' ? 'warning' : 'idle'
  switch (run.status) {
    case 'running': return 'ongoing'
    case 'waiting': case 'paused': return 'warning'
    case 'failed': return 'error'
    case 'completed': return 'done'
    default: return 'idle'
  }
}

