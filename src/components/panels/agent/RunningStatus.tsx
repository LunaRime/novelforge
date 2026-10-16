/**
 * RunningStatus — turn 运行计时行（线② · dsh 照搬，RunningStatus 形态）
 *
 * 流内实时「生成中，用时 x」→ turn 收尾「已完成，用时 x」。
 * 对照 dsh `RunningStatus`（`ui-chat/src/client/chat/RunningStatus.tsx`）。
 * NF 落地：assistant 占位消息的 createdAt = turn 开始时间；streaming 时实时计时，
 * 结束后定格。用 NF 语义令牌，遵循 color-token-standard。
 *
 * 有进度时改由 `ProgressLabel` 渲染（阶段 + 轮次）；计时仍在此算。
 */
import { useEffect, useState } from 'react'
import { TextShimmer } from '../../ui/TextShimmer'
import { useTranslation } from '../../../hooks/useTranslation'
import type { TextKey } from '../../../shared/locale'
import type { AgentProgress } from '../../../services/agent/progress-tracker'
import ProgressLabel from './ProgressLabel'

interface Props {
  /** turn 开始时间戳（assistant 占位消息 createdAt） */
  startTime: number
  /** 是否仍在生成（流式） */
  running: boolean
  /** 引擎实时进度（可选）；不传时保持原计时行行为 */
  progress?: AgentProgress | null
}

/** 格式化用时：<60s → 「x.xs」；≥60s → 「Xm Ys」 */
function formatDuration(ms: number, t: (key: TextKey) => string): string {
  const s = ms / 1000
  if (s < 60) return t('duration.seconds').replace('{s}', (Math.round(s * 10) / 10).toString())
  const whole = Math.round(s)
  return t('duration.minutes')
    .replace('{m}', String(Math.floor(whole / 60)))
    .replace('{s}', String(whole % 60))
}

export default function RunningStatus({ startTime, running, progress }: Props) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])

  const elapsed = Math.max(1000, now - startTime)
  const label = running
    ? t('agent.generatingFor').replace('{duration}', formatDuration(elapsed, t))
    : t('agent.completedFor').replace('{duration}', formatDuration(elapsed, t))

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 2, color: 'var(--color-text-muted)' }}>
      <span aria-hidden style={{ width: 2, height: 2, borderRadius: 1, background: 'var(--color-text-muted)' }} />
      <span style={{ fontSize: 11, lineHeight: '16px' }}>
        {progress && running
          ? <ProgressLabel progress={progress} startTime={startTime} running={running} />
          : <TextShimmer active={running}>{label}</TextShimmer>}
      </span>
    </div>
  )
}
