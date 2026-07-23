/**
 * MutualReviewReport — AI 互评报告 UI
 *
 * 显示多视角评审结果：雷达图式的分数对比、共识/分歧分析。
 */

import React from 'react'
import { ThumbsUp, AlertCircle, Lightbulb, Zap } from 'lucide-react'
import type { MutualReviewReport } from '../../services/workflows/commands/synthesize-scores.command'
import { Badge } from '../ui/Badge'
import { useTranslation } from '../../hooks/useTranslation'

interface MutualReviewReportProps {
  report: MutualReviewReport
  className?: string
}

/** 视角颜色映射 */
const PERSPECTIVE_COLORS: Record<string, string> = {
  '情节逻辑性': '#3b82f6',
  '角色一致性': '#8b5cf6',
  '文笔流畅度': '#10b981',
}

export const MutualReviewReportView: React.FC<MutualReviewReportProps> = ({
  report,
  className = '',
}) => {
  const { t } = useTranslation()
  return (
    <div className={`flex flex-col gap-4 text-sm ${className}`}>
      {/* 总评分 */}
      <div className="flex items-center gap-4 p-4 bg-accent/5 rounded-lg">
        <div className="flex flex-col items-center">
          <div className="text-3xl font-bold text-accent">
            {report.finalScore.toFixed(1)}
          </div>
          <div className="text-xs text-muted-foreground">{t('review.overallScore')}</div>
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium mb-2">
            {report.reviewerOutputs.length} 个 AI 视角综合评审
          </div>
          <div className="flex gap-2">
            {report.reviewerOutputs.map((ro, i) => (
              <Badge
                key={i}
                variant="outline"
                className="text-xs"
                style={{
                  borderColor: PERSPECTIVE_COLORS[ro.perspective] || '#6b7280',
                }}
              >
                {ro.perspective}: {ro.overallScore}/10
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {/* 各维度得分 */}
      <div className="border rounded p-3">
        <h4 className="text-xs font-medium text-muted-foreground mb-2">
          各维度评分
        </h4>
        <div className="space-y-2">
          {Object.entries(report.aggregatedScores).map(([criterion, score]) => (
            <div key={criterion} className="flex items-center gap-2">
              <span className="w-24 text-xs truncate">{criterion}</span>
              <div className="flex-1 h-2 bg-border rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${(score / 10) * 100}%` }}
                />
              </div>
              <span className="text-xs tabular-nums w-6 text-right">
                {score.toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 共识优点 */}
      {report.consensusStrengths.length > 0 && (
        <div className="border rounded p-3">
          <h4 className="text-xs font-medium text-green-600 mb-2 flex items-center gap-1">
            <ThumbsUp size={12} /> 共识优点
          </h4>
          <ul className="space-y-1">
            {report.consensusStrengths.map((s, i) => (
              <li key={i} className="text-xs text-muted-foreground flex gap-1">
                <span className="text-green-500">✓</span> {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 共识问题 */}
      {report.consensusWeaknesses.length > 0 && (
        <div className="border rounded p-3">
          <h4 className="text-xs font-medium text-yellow-600 mb-2 flex items-center gap-1">
            <AlertCircle size={12} /> 共识问题
          </h4>
          <ul className="space-y-1">
            {report.consensusWeaknesses.map((w, i) => (
              <li key={i} className="text-xs text-muted-foreground flex gap-1">
                <span className="text-yellow-500">!</span> {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 各视角详情 */}
      {report.reviewerOutputs.map((ro, i) => (
        <div key={i} className="border rounded p-3">
          <h4
            className="text-xs font-medium mb-2 flex items-center gap-1"
            style={{
              color: PERSPECTIVE_COLORS[ro.perspective] || '#6b7280',
            }}
          >
            <Zap size={12} /> {ro.perspective} — {ro.overallScore}/10
          </h4>
          {ro.strengths.length > 0 && (
            <div className="mb-1">
              <span className="text-xs text-green-600">{t('review.pros')}</span>
              <span className="text-xs text-muted-foreground">
                {ro.strengths.join('、')}
              </span>
            </div>
          )}
          {ro.weaknesses.length > 0 && (
            <div className="mb-1">
              <span className="text-xs text-yellow-600">{t('review.cons')}</span>
              <span className="text-xs text-muted-foreground">
                {ro.weaknesses.join('、')}
              </span>
            </div>
          )}
          {ro.suggestions.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {ro.suggestions.map((sug, j) => (
                <span
                  key={j}
                  className="text-xs bg-accent/10 text-accent px-1.5 py-0.5 rounded"
                >
                  <Lightbulb size={10} className="inline mr-0.5" />
                  {sug}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* 分歧标注 */}
      {report.divergenceNotes.length > 0 && (
        <div className="border rounded p-3 border-yellow-300">
          <h4 className="text-xs font-medium text-yellow-700 mb-2 flex items-center gap-1">
            <AlertCircle size={12} /> 评审分歧（需要作者判断）
          </h4>
          {report.divergenceNotes.map((note, i) => (
            <div
              key={i}
              className="text-xs text-yellow-700 whitespace-pre-line mb-1"
            >
              {note}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default MutualReviewReportView
