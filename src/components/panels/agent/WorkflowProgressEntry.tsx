/**
 * WorkflowProgressEntry — 对话内工作流进度入口（线② 2b · dsh 照搬，过程组/run 节点）
 *
 * 有活跃工作流（activeRuns）时，在对话流底部显示单行折叠组：
 * 状态点 + 工作流图标 + 「工作流」标题 + 指标 chip（「步骤 已完成/总数」+「运行中 N」）。
 * 展开显示各 run 的标题 + 状态点 + 步骤进度，点击跳转底部任务面板（详情仍在面板）。
 *
 * 2026-10 §2.4：行尾摘要由 `·` 串（「已完成 N 步 · 运行中 M」）改成 MetricChip 语言，
 * 并与行尾那个裸任务数（重复表达同一个 `activeRuns.length`）合并 —— 数字只出现一次。
 *
 * 对照 dsh `WorkflowRunPanel` 的 RunHeader + `process-groups` 的计数摘要。
 * 复用 2a 原语（DisclosureRow / StateDot）+ 指标原语（MetricChip）。用 NF 语义令牌。
 */
import { useEffect, useRef, useState } from 'react'
import { Activity, ListChecks, Workflow } from 'lucide-react'
import { DisclosureRow } from '../../ui/DisclosureRow'
import { MetricChip, MetricRow } from '../../ui/MetricChip'
import { StateDot, type StateDotState } from '../../ui/StateDot'
import { useWorkflowStore, type WorkflowRun } from '../../../stores/workflow-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useTranslation } from '../../../hooks/useTranslation'
import type { TextKey } from '../../../shared/locale'

/** WorkflowStatus → StateDot 五态 */
function runDotState(run: WorkflowRun): StateDotState {
  switch (run.status) {
    case 'running': return 'ongoing'
    case 'waiting': case 'paused': return 'warning'
    case 'failed': return 'error'
    case 'completed': return 'done'
    default: return 'idle'
  }
}

/** run 状态文字（i18n） */
function runStatusLabel(run: WorkflowRun, t: (key: TextKey) => string): string {
  switch (run.status) {
    case 'running': return t('status.running')
    case 'waiting': return t('status.confirming')
    case 'paused': return t('status.pending')
    case 'failed': return t('status.failed')
    case 'completed': return t('status.completed')
    default: return ''
  }
}

export default function WorkflowProgressEntry() {
  const { t } = useTranslation()
  const activeRuns = useWorkflowStore(s => s.activeRuns)
  const openBottomTab = useLayoutStore(s => s.openBottomTab)
  const [expanded, setExpanded] = useState(false)
  const userToggled = useRef(false)

  // running/waiting 时自动展开（不覆盖用户手动收起）；转 clean 后组件随 activeRuns 清空而消失
  const running = activeRuns.some(r => r.status === 'running' || r.status === 'waiting')
  useEffect(() => {
    if (running && !userToggled.current) setExpanded(true)
  }, [running])

  if (activeRuns.length === 0) return null

  // 步骤状态计数（dsh phaseStatusSummary 思路：member=step）
  const doneSteps = activeRuns.reduce((sum, r) => sum + r.steps.filter(s => s.status === 'completed').length, 0)
  const totalSteps = activeRuns.reduce((sum, r) => sum + r.steps.length, 0)

  // 整体状态点：优先 running → warning → error
  const dotState: StateDotState = activeRuns.some(r => r.status === 'running')
    ? 'ongoing'
    : activeRuns.some(r => r.status === 'waiting' || r.status === 'paused')
      ? 'warning'
      : activeRuns.some(r => r.status === 'failed')
        ? 'error'
        : 'idle'

  return (
    <div data-workflow-progress data-state={running ? 'running' : 'idle'}>
      <DisclosureRow
        icon={<Workflow size={14} style={{ color: 'var(--color-text-muted)' }} />}
        title={t('workflow.progressTitle')}
        running={running}
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => { userToggled.current = true; setExpanded(v => !v) }}
        collapsedContent={
          <>
            <span aria-hidden style={{ flex: 'none', width: 2, height: 2, margin: '0 8px', borderRadius: 1, background: 'var(--color-text-muted)' }} />
            {/* 指标 chip：步骤（已完成/总数）+ 运行中任务数。运行中数量同时承担了原来行尾
                那个裸数字（两者本是同一个 activeRuns.length），数字不再出现两次。
                整体状态仍由行尾 StateDot 表达（chip 只讲计数，不抢状态语义）。 */}
            <MetricRow className="min-w-0 flex-1">
              <MetricChip
                icon={<ListChecks size={12} />}
                label={t('metric.workflowSteps')}
                value={`${doneSteps}/${totalSteps}`}
                title={t('metric.workflowStepsHint')}
              />
              <MetricChip
                icon={<Activity size={12} />}
                label={t('metric.runningTasks')}
                value={activeRuns.length}
                title={t('metric.runningTasksHint')}
              />
            </MetricRow>
            <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center' }}>
              <StateDot state={dotState} />
            </span>
          </>
        }
      >
        {expanded && (
          <div style={{ paddingLeft: 22, display: 'flex', flexDirection: 'column' }}>
            {activeRuns.map(run => {
              const done = run.steps.filter(s => s.status === 'completed').length
              return (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => openBottomTab('tasks')}
                  className="flex items-center gap-1.5 text-left rounded cursor-pointer hover:bg-[var(--color-hover)]"
                  style={{ padding: '2px 4px', height: 24, color: 'var(--color-text-secondary)' }}
                  title={t('panel.tasks')}
                >
                  <StateDot state={runDotState(run)} />
                  <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                    {run.title}
                  </span>
                  <span style={{ flex: 'none', fontSize: 11, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {done}/{run.steps.length}
                  </span>
                  <span style={{ flex: 'none', fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {runStatusLabel(run, t)}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </DisclosureRow>
    </div>
  )
}
