/**
 * VerificationPanel — 蓝图校检报告面板
 *
 * 显示缺口列表、严重程度，提供"补全"按钮。
 */

import React, { useState } from 'react'
import { AlertTriangle, CheckCircle, XCircle, Sparkles, RefreshCw } from 'lucide-react'
import type { VerificationReport, BlueprintGap } from '../../services/blueprint-verification-service'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'

interface VerificationPanelProps {
  report: VerificationReport | null
  loading: boolean
  onVerify: () => void
  onFillGap: (gap: BlueprintGap) => void
  onFillAll: () => void
  onClose: () => void
}

/** 严重程度配置 */
const SEVERITY_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  ok: { icon: <CheckCircle size={14} />, color: 'text-green-500', label: '完整' },
  warning: { icon: <AlertTriangle size={14} />, color: 'text-yellow-500', label: '有缺口' },
  critical: { icon: <XCircle size={14} />, color: 'text-red-500', label: '严重缺失' },
}

export const VerificationPanel: React.FC<VerificationPanelProps> = ({
  report,
  loading,
  onVerify,
  onFillGap,
  onFillAll,
  onClose,
}) => {
  const [fillingGaps, setFillingGaps] = useState<Set<number>>(new Set())
  const [fillingAll, setFillingAll] = useState(false)

  const handleFillGap = (gap: BlueprintGap) => {
    const key = gap.missingChapterNumbers[0]
    setFillingGaps((prev) => new Set(prev).add(key))
    onFillGap(gap)
    // 模拟完成（实际应在工作流回调中清除）
    setTimeout(() => {
      setFillingGaps((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }, 5000)
  }

  const handleFillAll = () => {
    setFillingAll(true)
    onFillAll()
  }

  const severityConf = report ? SEVERITY_CONFIG[report.severity] : null

  return (
    <div className="flex flex-col h-full border rounded-lg overflow-hidden bg-background">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-sidebar">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">蓝图校检</span>
          {severityConf && (
            <Badge variant="outline" className={`text-xs ${severityConf.color}`}>
              {severityConf.icon}
              <span className="ml-1">{severityConf.label}</span>
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onVerify}
            disabled={loading}
            title="重新校验"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} title="关闭">
            <XCircle size={13} />
          </Button>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-auto p-3">
        {loading && !report && (
          <div className="text-center text-muted-foreground text-sm py-8">
            <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
            正在校验...
          </div>
        )}

        {!report && !loading && (
          <div className="text-center text-muted-foreground text-sm py-8">
            点击校验按钮开始检查蓝图完整性
          </div>
        )}

        {report && (
          <>
            {/* 摘要 */}
            <div className="text-sm mb-3 p-2 bg-accent/5 rounded">
              {report.summary}
            </div>

            {/* 缺口列表 */}
            {report.gaps.length > 0 && (
              <div className="mb-3">
                <h4 className="text-xs font-medium text-muted-foreground mb-2">
                  缺口列表（{report.gaps.length} 处）
                </h4>
                <div className="space-y-2">
                  {report.gaps.map((gap, idx) => (
                    <div
                      key={idx}
                      className="border rounded p-2 text-xs bg-background"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-yellow-600">
                          缺失: 第 {gap.missingChapterNumbers[0]}
                          {gap.gapSize > 1 &&
                            `–${gap.missingChapterNumbers[gap.gapSize - 1]}`}
                          章
                          {gap.gapSize > 1 && ` (${gap.gapSize} 章)`}
                        </span>
                        <Button
                          variant="ai"
                          size="sm"
                          className="text-xs h-6 px-2"
                          onClick={() => handleFillGap(gap)}
                          disabled={fillingGaps.has(gap.missingChapterNumbers[0])}
                        >
                          <Sparkles size={10} />
                          {fillingGaps.has(gap.missingChapterNumbers[0])
                            ? '补全中...'
                            : '补全'}
                        </Button>
                      </div>
                      {gap.context && (
                        <div className="text-muted-foreground max-h-20 overflow-hidden text-ellipsis">
                          上下文: {gap.context.slice(0, 150)}
                          {gap.context.length > 150 && '...'}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 其他问题 */}
            {report.inconsistentRoles.length > 0 && (
              <div className="mb-3">
                <h4 className="text-xs font-medium text-muted-foreground mb-1">
                  角色定位不一致
                </h4>
                {report.inconsistentRoles.map((ir, idx) => (
                  <div key={idx} className="text-xs text-muted-foreground pl-2">
                    • 第{ir.chapter}章: {ir.role} → 建议 {ir.expectedRole}
                  </div>
                ))}
              </div>
            )}

            {report.missingTitles.length > 0 && (
              <div className="mb-3 text-xs text-muted-foreground">
                缺失标题: 第 {report.missingTitles.join(', ')} 章
              </div>
            )}

            {/* 全部补全按钮 */}
            {report.gaps.length > 0 && (
              <div className="mt-3 pt-3 border-t">
                <Button
                  variant="ai"
                  size="sm"
                  className="w-full"
                  onClick={handleFillAll}
                  disabled={fillingAll}
                >
                  <Sparkles size={12} />
                  {fillingAll ? '正在全部补全...' : `全部补全（${report.gaps.reduce((s, g) => s + g.gapSize, 0)} 章）`}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default VerificationPanel
