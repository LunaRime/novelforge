/**
 * ProgressLabel — Agent 进度标签（约束③「计划步骤有序、有状态」）
 *
 * 从 `RunningStatus` 拆出的叶子组件。拆出有据：把进度分支内联进 `RunningStatus.tsx`
 * （原 54 行）会占 17 行 = **31.5%**，违反本档硬约束「单文件改动 ≤30%」；
 * 拆成叶子后宿主只剩 import + prop + 一个分支。
 *
 * 自持计时器（而非复用宿主的）：宿主只需传 `startTime`，无需改动其 `formatDuration`
 * 签名（硬约束之二禁止改公开接口签名）。
 *
 * ⚠️ **不得据此画百分比进度条**：`totalSteps` 是 ReAct 轮次预算（`MAX_TOOL_ROUNDS = 8`），
 * 不是模型自拟待办清单——进度条会误导用户以为剩余工作量可精确预测。
 */
import { useEffect, useState } from 'react'
import { TextShimmer } from '../../ui/TextShimmer'
import { useTranslation } from '../../../hooks/useTranslation'
import type { TextKey } from '../../../shared/locale'
import type { AgentProgress } from '../../../services/agent/progress-tracker'

/** 格式化用时：<60s → 「x.xs」；≥60s → 「Xm Ys」（与 RunningStatus 同口径） */
function formatDuration(ms: number, t: (key: TextKey) => string): string {
  const s = ms / 1000
  if (s < 60) return t('duration.seconds').replace('{s}', (Math.round(s * 10) / 10).toString())
  const whole = Math.round(s)
  return t('duration.minutes')
    .replace('{m}', String(Math.floor(whole / 60)))
    .replace('{s}', String(whole % 60))
}

interface Props {
  progress: AgentProgress
  /** turn 开始时间戳（assistant 占位消息 createdAt） */
  startTime: number
  running: boolean
}

export default function ProgressLabel({ progress, startTime, running }: Props) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])

  const elapsed = formatDuration(Math.max(1000, now - startTime), t)
  const stepSuffix = progress.totalSteps
    ? ` · ${progress.completedSteps}/${progress.totalSteps}`
    : ''
  return (
    <TextShimmer active={running}>
      {progress.description}{stepSuffix} · {elapsed}
    </TextShimmer>
  )
}
