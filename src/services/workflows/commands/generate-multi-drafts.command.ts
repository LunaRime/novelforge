/**
 * GenerateMultiDraftsCommand — 并行生成多个草稿版本 + AI 评分择优
 *
 * 同一章生成 2-3 个版本（不同 temperature / 不同 prompt 侧重），
 * AI 自动评出最佳版本返回。
 */

import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useLLMStore } from '../../../stores/llm-store'
import { getPromptTemplate } from '../../prompt-templates'
import { ChapterPromptBuilder } from '../../prompts/prompt-builder'
import { useUsageStore } from '../../../stores/usage-store'

export interface MultiDraftParams {
  chapterNumber: number
  chapterTitle: string
  /** 蓝图上下文 */
  blueprintContext: string
  /** 角色声音参考 */
  voiceContext: string
  /** 全局指导 */
  globalGuidance: string
  /** 版本数（2-3） */
  count?: number
}

export interface DraftCandidate {
  index: number
  content: string
  style: string
  temperature: number
  tokensUsed: number
  score?: number
  strengths?: string[]
  weaknesses?: string[]
}

export class GenerateMultiDraftsCommand extends BaseWorkflowCommand<DraftCandidate[]> {
  constructor(private params: MultiDraftParams) { super() }

  async execute({ callbacks }: CommandExecuteParams): Promise<DraftCandidate[]> {
    const count = Math.min(this.params.count || 2, 3)
    const template = getPromptTemplate('first_chapter_draft')
    if (!template) throw new Error('模板丢失')

    callbacks.log(`并行生成 ${count} 个草稿版本...`)

    // 定义不同的生成风格
    const styles = [
      { name: '标准版', temp: 0.7, focus: '平衡情节推进与角色刻画，保持稳定的叙事节奏。' },
      { name: '创意版', temp: 0.95, focus: '大胆使用修辞手法和意象，追求独特的文风和惊喜感。' },
      { name: '紧凑版', temp: 0.5, focus: '精简描写，快速推进情节，强化冲突和爽点密度。' },
    ].slice(0, count)

    const candidates: DraftCandidate[] = []

    // 并行生成
    const promises = styles.map(async (style, i) => {
      callbacks.log(`  📝 ${style.name} (t=${style.temp}) 生成中...`)

      const builder = new ChapterPromptBuilder(template)
        .withArchitecture(this.params.blueprintContext)
        .withChapterInfo(`第${this.params.chapterNumber}章 ${this.params.chapterTitle}`)
        .withGlobalGuidance(`${this.params.globalGuidance}\n\n【${style.name}侧重】${style.focus}`)
        .withUserGuidance(this.params.voiceContext)

      try {
        const content = await this.callLLM(
          builder.build(),
          builder.getSystemRole(),
          callbacks,
          { cacheScope: 'chapter_draft' },
        )

        candidates.push({
          index: i,
          content,
          style: style.name,
          temperature: style.temp,
          tokensUsed: Math.ceil(content.length * 0.75),
        })

        callbacks.log(`  ✅ ${style.name} 完成 (${content.length} 字)`)
      } catch (e) {
        callbacks.log(`  ❌ ${style.name} 失败: ${String(e)}`)
      }
    })

    await Promise.all(promises)

    // AI 评分择优
    if (candidates.length >= 2) {
      callbacks.log('正在 AI 评分择优...')
      await this.scoreCandidates(candidates, callbacks)
    }

    return candidates.sort((a, b) => (b.score || 0) - (a.score || 0))
  }

  private async scoreCandidates(
    candidates: DraftCandidate[],
    callbacks: CommandExecuteParams['callbacks'],
  ): Promise<void> {
    const llmStore = useLLMStore.getState()
    const modelId = llmStore.getModelForPurpose('review_chapter')
    if (!modelId) return

    for (const c of candidates) {
      try {
        const response = await llmStore.generate(
          [
            {
              role: 'system',
              content: '你是专业评审。请从 1-10 评分以下维度：情节推进、角色刻画、文笔质量、读者吸引力。输出JSON：{"scores":{"情节":8,"角色":7,"文笔":8,"吸引力":7},"overallScore":7.5,"strengths":[""],"weaknesses":[""]}',
            },
            { role: 'user', content: c.content.slice(0, 3000) },
          ],
          modelId,
          { responseFormat: { type: 'json_object' }, priority: 4 },
        )

        if (response.success) {
          try {
            const parsed = JSON.parse(response.content)
            c.score = parsed.overallScore || 0
            c.strengths = parsed.strengths || []
            c.weaknesses = parsed.weaknesses || []
            useUsageStore.getState().recordCall({
              model: llmStore.models.find(m => m.id === modelId)!,
              promptTokens: response.usage?.promptTokens || 0,
              completionTokens: response.usage?.completionTokens || 0,
              tier: 'standard',
            })
          } catch { c.score = 5 }
        }
        callbacks.log(`  ${c.style}: ${c.score}/10`)
      } catch { c.score = 5 }
    }
  }
}
