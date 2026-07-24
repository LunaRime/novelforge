/**
 * ProgressBar — Agent 任务进度条组件
 *
 * 显示 Agent 的当前执行阶段、步骤进度和耗时。
 */

import React from 'react'
import type { AgentProgress } from '../../../services/agent/progress-tracker'

interface ProgressBarProps {
  progress: AgentProgress
  className?: string
}

/** 阶段颜色映射 */
const PHASE_COLORS: Record<string, string> = {
  thinking: 'var(--color-accent)',     // 紫色
  tool_execution: 'var(--color-info)', // 蓝色
  generating: 'var(--color-success)',   // 绿色
  done: 'var(--color-text-muted)',         // 灰色
}

/** 阶段标签 */
const PHASE_LABELS: Record<string, string> = {
  thinking: '思考中',
  tool_execution: '执行工具',
  generating: '生成回复',
  done: '完成',
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ progress, className = '' }) => {
  const color = PHASE_COLORS[progress.phase] || '#6b7280'
  const label = PHASE_LABELS[progress.phase] || progress.phase

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {/* 状态栏 */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        <span>{label}</span>
        {progress.description && progress.phase !== 'done' && (
          <span className="truncate max-w-[200px]">— {progress.description}</span>
        )}
        {progress.elapsedMs > 0 && (
          <span className="ml-auto tabular-nums">
            {(progress.elapsedMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      {/* 进度条 */}
      {progress.totalSteps > 0 && progress.phase !== 'done' && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 bg-border rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${Math.min(progress.percentage, 100)}%`,
                backgroundColor: color,
              }}
            />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {progress.completedSteps}/{progress.totalSteps}
          </span>
        </div>
      )}

      {/* 工具信息 */}
      {progress.currentTool && (
        <div className="text-xs text-muted-foreground/70 pl-4">
          🔧 {progress.currentTool}
          {progress.totalTools > 1 &&
            ` (${progress.toolIndex}/${progress.totalTools})`}
        </div>
      )}

      {/* Token 统计 */}
      {progress.tokensUsed > 0 && (
        <div className="text-xs text-muted-foreground/50 pl-4">
          Tokens: {progress.tokensUsed.toLocaleString()}
        </div>
      )}
    </div>
  )
}

export default ProgressBar
