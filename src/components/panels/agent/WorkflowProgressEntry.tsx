/**
 * WorkflowProgressEntry — 对话内工作流进度入口（线② 2b · dsh 照搬，过程组/run 节点）
 *
 * 有活跃工作流（activeRuns）时，在对话流底部显示单行折叠组：
 * 状态点 + 工作流图标 + 「工作流」标题 + 摘要「已完成 N 步 · 运行中 M」。
 * 展开显示各 run 的标题 + 状态点 + 步骤进度，点击跳转底部任务面板（详情仍在面板）。
 *
 * 对照 dsh `WorkflowRunPanel` 的 RunHeader + `process-groups` 的计数摘要。
 * 复用 2a 三原语（DisclosureRow / StateDot / TextShimmer）。用 NF 语义令牌。
 */
import { useEffect, useRef, useState } from 'react'
import { Workflow } from 'lucide-react'
import { DisclosureRow } from '../../ui/DisclosureRow'
import { StateDot, type StateDotState } from '../../ui/StateDot'
import { TextShimmer } from '../../ui/TextShimmer'
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
  const runningSteps = activeRuns.reduce((sum, r) => sum + r.steps.filter(s => s.status === 'running').length, 0)

  // 整体状态点：优先 running → warning → error
  const dotState: StateDotState = activeRuns.some(r => r.status === 'running')
    ? 'ongoing'
    : activeRuns.some(r => r.status === 'waiting' || r.status === 'paused')
      ? 'warning'
      : activeRuns.some(r => r.status === 'failed')
        ? 'error'
        : 'idle'

  const summary = t('workflow.progressSummary')
    .replace('{done}', String(doneSteps))
    .replace('{running}', String(runningSteps))

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
            <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, lineHeight: '24px', color: 'var(--color-text-muted)' }}>
              <TextShimmer active={running}>{summary}</TextShimmer>
            </span>
            {/* 行尾状态点 + 任务数 */}
            <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <StateDot state={dotState} />
              <span style={{ fontSize: 11, lineHeight: '24px', color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {activeRuns.length}
              </span>
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
