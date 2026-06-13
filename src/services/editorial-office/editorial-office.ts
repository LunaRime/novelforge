/**
 * Vela 编辑部协作引擎 — 模拟真实出版社编辑部的多人协作流程
 *
 * 流程：
 * 1. 并行启动所有非主编角色评审（情节审查/文案/连续性/风格）
 * 2. 每个角色使用 ModelRouter 自动选择最优模型
 * 3. 所有评审结果提交主编进行综合裁决
 * 4. 输出含共识/分歧/优先级的结构化评审报告
 */

import { useLLMStore } from '../../stores/llm-store'
import {
  type EditorRole,
  EDITOR_ROLES,
  REVIEWER_ROLES,
} from './editor-roles'
import type { CallPurpose } from '../llm/model-router'

// ===== 类型定义 =====

export interface RoleReviewResult {
  role: EditorRole
  displayName: string
  icon: string
  scores: Record<string, number>
  overallScore: number
  strengths: string[]
  weaknesses: string[]
  suggestions: string[]
  rawResponse: string
  tokensUsed: number
  /** 角色特有的额外分析字段 */
  extra?: Record<string, unknown>
}

export interface ChiefSynthesis {
  finalScore: number
  verdict: 'approved' | 'approved_with_minor_changes' | 'needs_major_revision' | 'rejected'
  prioritySuggestions: Array<{
    priority: number
    issue: string
    suggestion: string
  }>
  consensusSummary: string
  divergenceRulings: Array<{
    topic: string
    positions: string
    ruling: string
    reason: string
  }>
}

export interface EditorialReviewResult {
  draftId?: number
  chapterNumber: number
  roleResults: RoleReviewResult[]
  synthesis: ChiefSynthesis | null
  /** 聚合各维度加权平均分 */
  aggregatedScores: Record<string, number>
  /** 加权综合最终分 */
  finalScore: number
  /** 所有建议（去重并按优先级排序） */
  mergedSuggestions: string[]
  generatedAt: string
  /** 总 token 消耗 */
  totalTokensUsed: number
  /** 估算费用（USD） */
  estimatedCost: number
}

export interface EditorialReviewConfig {
  enabledRoles: EditorRole[]
  includeChiefSynthesis: boolean
}

// ===== 默认配置 =====

export const DEFAULT_EDITORIAL_CONFIG: EditorialReviewConfig = {
  enabledRoles: [...REVIEWER_ROLES],
  includeChiefSynthesis: true,
}

// ===== 编辑部引擎 =====

export class EditorialOffice {
  private config: EditorialReviewConfig

  constructor(config: Partial<EditorialReviewConfig> = {}) {
    this.config = {
      ...DEFAULT_EDITORIAL_CONFIG,
      ...config,
    }
  }

  /**
   * 执行一轮完整的编辑评审。
   */
  async review(
    chapterContent: string,
    params: {
      chapterNumber: number
      characterStates?: string
      worldBuilding?: string
      architectureContext?: string
    },
    onProgress?: (role: string, status: string) => void,
  ): Promise<EditorialReviewResult> {
    const llmStore = useLLMStore.getState()
    let totalTokensUsed = 0

    // ==== 第一步：并行启动所有评审角色 ====
    const roleResults: RoleReviewResult[] = []

    const reviewPromises = this.config.enabledRoles.map(async (role) => {
      const roleConfig = EDITOR_ROLES[role]
      if (!roleConfig) return null

      onProgress?.(roleConfig.displayName, '评审中...')

      try {
        const modelId = llmStore.getModelForPurpose(this.getPurposeForRole(role))
        if (!modelId) {
          onProgress?.(roleConfig.displayName, '❌ 无可用模型')
          return null
        }

        // 构建角色专用的提示词
        const contextInfo = [
          params.characterStates ? `角色状态：\n${params.characterStates}` : '',
          params.worldBuilding ? `世界观设定：\n${params.worldBuilding}` : '',
          params.architectureContext ? `故事架构：\n${params.architectureContext}` : '',
        ].filter(Boolean).join('\n\n')

        const userPrompt = [
          `请评审第${params.chapterNumber}章草稿：`,
          '',
          '=== 草稿内容 ===',
          chapterContent.slice(0, 8000), // 截断过长的草稿内容
          '',
          contextInfo ? `=== 上下文信息 ===\n${contextInfo}` : '',
        ].filter(Boolean).join('\n')

        // 调用 LLM
        const response = await llmStore.generate(
          [
            { role: 'system', content: roleConfig.systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          modelId,
          {
            responseFormat: { type: 'json_object' },
            priority: 5,
          },
        )

        if (!response.success) {
          onProgress?.(roleConfig.displayName, `❌ ${response.error}`)
          return null
        }

        totalTokensUsed += response.usage?.totalTokens || 0

        // 解析结果
        let parsed: Record<string, unknown> = {}
        try {
          parsed = JSON.parse(response.content)
        } catch {
          parsed = { overallScore: 0, strengths: [], weaknesses: [], suggestions: [] }
        }

        const result: RoleReviewResult = {
          role: roleConfig.role,
          displayName: roleConfig.displayName,
          icon: roleConfig.icon,
          scores: (parsed.scores as Record<string, number>) || {},
          overallScore: (parsed.overallScore as number) || 0,
          strengths: (parsed.strengths as string[]) || [],
          weaknesses: (parsed.weaknesses as string[]) || [],
          suggestions: (parsed.suggestions as string[]) || [],
          rawResponse: response.content,
          tokensUsed: response.usage?.totalTokens || 0,
        }

        // 保留角色特有的额外字段
        const extraKeys = [
          'plotHoleAnalysis',
          'highlightedSentences',
          'continuityIssues',
          'styleNotes',
        ]
        const extra: Record<string, unknown> = {}
        for (const key of extraKeys) {
          if (parsed[key]) extra[key] = parsed[key]
        }
        if (Object.keys(extra).length > 0) result.extra = extra

        onProgress?.(
          roleConfig.displayName,
          `✅ ${result.overallScore}/10`,
        )

        return result
      } catch (error) {
        onProgress?.(roleConfig.displayName, `❌ ${String(error)}`)
        return null
      }
    })

    const results = await Promise.all(reviewPromises)
    for (const r of results) {
      if (r) roleResults.push(r)
    }

    // ==== 第二步：综合评分 ====
    let synthesis: ChiefSynthesis | null = null

    if (this.config.includeChiefSynthesis && roleResults.length >= 2) {
      onProgress?.('主编', '综合裁决中...')

      const chiefConfig = EDITOR_ROLES.chief_editor
      const modelId = llmStore.getModelForPurpose('mutual_eval')
      if (modelId) {
        try {
          const reviewsText = roleResults
            .map(
              (r) =>
                `### ${r.icon} ${r.displayName} (${r.overallScore}/10)\n` +
                `优点: ${r.strengths.join('；')}\n` +
                `问题: ${r.weaknesses.join('；')}\n` +
                `建议: ${r.suggestions.join('；')}\n`,
            )
            .join('\n\n')

          const chiefPrompt = [
            `以下是 ${roleResults.length} 个编辑对第${params.chapterNumber}章的评审意见，请做出综合裁决：`,
            '',
            reviewsText,
          ].join('\n')

          const response = await llmStore.generate(
            [
              { role: 'system', content: chiefConfig.systemPrompt },
              { role: 'user', content: chiefPrompt },
            ],
            modelId,
            {
              responseFormat: { type: 'json_object' },
              priority: 4,
            },
          )

          if (response.success) {
            try {
              synthesis = JSON.parse(response.content) as ChiefSynthesis
            } catch {
              synthesis = {
                finalScore: 0,
                verdict: 'needs_major_revision',
                prioritySuggestions: [],
                consensusSummary: '主编综合失败',
                divergenceRulings: [],
              }
            }
            totalTokensUsed += response.usage?.totalTokens || 0
          }
        } catch {
          // 主编失败不影响其他评审
        }
      }

      onProgress?.('主编', synthesis ? '✅ 裁决完成' : '⚠️ 裁决失败')
    }

    // ==== 第三步：聚合数据 ====
    const aggregatedScores = this.computeAggregatedScores(roleResults)
    const finalScore = synthesis?.finalScore ||
      roleResults.reduce((sum, r) => sum + r.overallScore * (EDITOR_ROLES[r.role]?.weight || 0.2), 0)

    // 合并所有建议（去重并按优先级排序）
    const allSuggestions = new Set<string>()
    // 优先取主编建议
    if (synthesis?.prioritySuggestions) {
      for (const s of synthesis.prioritySuggestions) {
        allSuggestions.add(`[P${s.priority}] ${s.suggestion}`)
      }
    }
    // 补充各角色建议
    for (const r of roleResults) {
      for (const s of r.suggestions) {
        if (allSuggestions.size < 20) allSuggestions.add(`[${r.displayName}] ${s}`)
      }
    }

    // 费用估算
    const estimatedCost = totalTokensUsed > 0
      ? llmStore.modelRouter?.estimateCost('mutual_eval', totalTokensUsed * 0.7, totalTokensUsed * 0.3)?.totalCost || 0
      : 0

    return {
      chapterNumber: params.chapterNumber,
      roleResults,
      synthesis,
      aggregatedScores,
      finalScore: Math.round(finalScore * 10) / 10,
      mergedSuggestions: [...allSuggestions],
      generatedAt: new Date().toISOString(),
      totalTokensUsed,
      estimatedCost,
    }
  }

  /** 加权平均各维度分数 */
  private computeAggregatedScores(
    results: RoleReviewResult[],
  ): Record<string, number> {
    const aggregated: Record<string, number> = {}

    for (const result of results) {
      const config = EDITOR_ROLES[result.role]
      if (!config) continue

      for (const [dim, score] of Object.entries(result.scores)) {
        if (typeof score === 'number') {
          aggregated[dim] = (aggregated[dim] || 0) + score * config.weight
        }
      }
    }

    return aggregated
  }

  /** 角色 → LLM purpose 映射 */
  private getPurposeForRole(role: EditorRole): CallPurpose {
    switch (role) {
      case 'chief_editor':
        return 'mutual_eval'
      case 'plot_reviewer':
      case 'continuity_checker':
        return 'review_chapter'
      case 'copy_editor':
        return 'style_analysis'
      case 'style_editor':
        return 'style_analysis'
      default:
        return 'review_chapter'
    }
  }
}
