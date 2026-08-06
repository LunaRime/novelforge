import { t } from '../../../shared/locale'
import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { ReviewPromptBuilder } from '../../prompts/prompt-builder'
import { ipc } from '../../ipc-client'


export interface ReviewChapterParams {
  draftPath: string
  draftContent: string
  chapterNumber: number
  /** 审稿维度侧重点（可选） */
  reviewFocus?: string
}

export class ReviewChapterCommand extends BaseWorkflowCommand<string> {
  constructor(private params: ReviewChapterParams) {
    super()
  }

  async execute({ callbacks }: CommandExecuteParams): Promise<string> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(t('error.noProject'))

    const draft = this.params.draftContent
    if (!draft) throw new Error(t('error.noDraft'))

    callbacks.log('准备启动一致性审查引擎...')
    callbacks.log('  检索全书设定档案...')

    // 使用向量检索获取与待审章节相关的历史上下文（替代全局摘要）
    let contextSummary = '（无上下文参考）'
    try {
      // 从待审内容中提取前 200 字作为检索 query
      const queryText = draft.slice(0, 200)
      const results = await ipc.invoke('kb:search', queryText, 5)
      if (results.length > 0) {
        contextSummary = results
          .map((r: { fileName: string; score: number; text: string }, i: number) =>
            `[${i + 1}] (${r.fileName}, 相关度 ${(r.score * 100).toFixed(0)}%)\n${r.text}`)
          .join('\n\n')
      }
    } catch {
      contextSummary = '（知识库检索不可用）'
    }

    const characterState = await this.readCharacterStates()
    const worldBuilding = await this.readWorldBuilding()

    const template = getPromptTemplate('consistency_check')
    if (!template) throw new Error(t('error.templateNotFound').replace('{name}', '审稿'))

    const promptBuilder = new ReviewPromptBuilder(template)
      .withChapterContent(draft)
      .withCharacterStates(characterState)
      .withGlobalSummary(contextSummary)
      .withWorldBuilding(worldBuilding)
      .withReviewFocus(this.params.reviewFocus || '')

    callbacks.log('调用 AI 审查员对本章进行多维度扫描...')

    // 期望 JSON 格式返回
    const reviewResultRaw = await this.callLLMWithBuilder(
      promptBuilder,
      callbacks,
      { }
    )

    const { parseDraftMeta } = await import('../chapter-workflow')
    const baseDraft = await parseDraftMeta(this.params.draftPath)
    if (!baseDraft) throw new Error(t('error.noBaseDraft'))
    const baseVersion = baseDraft.version

    const revIndex = await ipc.invoke('db:review-next-index', baseDraft.id)

    // 解析审稿结果 — 三层回退策略：
    //   L1: Markdown 表格解析（优先，匹配 Prompt 要求）
    //   L2: JSON 解析（LLM 实际经常输出 JSON，即使 Prompt 说不要）
    //   L3: 原始文本兜底（保留完整输出供 ReviewReport 的旧版解析器处理）
    const { parseMarkdownTable, robustParseJSON } = await import('../workflow-utils')
    let parsedResult: { items?: Array<Record<string, string>>; summary?: string; rawResponse?: string } | undefined

    // L1: Markdown 表格
    const tableRows = parseMarkdownTable(reviewResultRaw)
    if (tableRows && tableRows.length > 0) {
      parsedResult = {
        items: tableRows.map(r => ({
          category: r.category || '',
          severity: r.severity || 'pass',
          quote: r.quote || '',
          description: r.description || '',
        })),
        summary: `审稿完成，共 ${tableRows.length} 项检查`,
      }
      callbacks.log(`✅ 审稿结果解析成功 (Markdown 表格): ${tableRows.length} 条记录`)
    } else {
      // L2: JSON 回退 — 很多 LLM 习惯性输出 JSON 而非 Markdown 表格
      const jsonParsed = robustParseJSON(reviewResultRaw, false)
      if (jsonParsed && typeof jsonParsed === 'object') {
        const obj = jsonParsed as Record<string, unknown>
        // 兼容多种 JSON 结构：{ items: [...] } / { findings: [...] } / 直接是数组
        const items = Array.isArray(obj.items) ? obj.items
          : Array.isArray(obj.findings) ? obj.findings
          : Array.isArray(obj.issues) ? obj.issues
          : Array.isArray(jsonParsed) ? jsonParsed
          : null

        if (items && items.length > 0) {
          parsedResult = {
            items: (items as Array<Record<string, unknown>>).map(item => ({
              category: String(item.category || item.dimension || item.type || '综合检查'),
              severity: String(item.severity || item.level || 'pass'),
              quote: String(item.quote || item.excerpt || ''),
              description: String(item.description || item.detail || item.issue || ''),
            })),
            summary: String(obj.summary || obj.conclusion || `JSON 解析成功，共 ${items.length} 项检查`),
          }
          callbacks.log(`✅ 审稿结果解析成功 (JSON 回退): ${items.length} 条记录`)
        } else if (obj.summary || obj.conclusion) {
          // 纯文本类型的 JSON 响应（包含 summary 但无结构化 items）
          parsedResult = {
            items: [{ category: '综合检查', severity: 'warning', description: String(obj.summary || obj.conclusion) }],
            summary: String(obj.summary || obj.conclusion),
          }
          callbacks.log(`⚠️ JSON 解析为纯文本摘要，无结构化条目`)
        }
      }

      // L3: 全部解析策略失败 — 直接传递原始文本给 ReviewReport 的旧版解析器
      if (!parsedResult!) {
        callbacks.log('⚠️ 审稿结果无法结构化解析，保留原始输出供旧版解析器处理')
        // 不包装成 JSON — 直接存原始文本，ReviewReport.parseLegacyReport() 会处理
        parsedResult = {
          summary: '',
          items: [],
          rawResponse: reviewResultRaw,
        }
      }
    }

    // DB 持久化: 始终保存完整结构化数据 + 原始响应（如有）
    const dbContent: Record<string, unknown> = {
      items: parsedResult.items,
      summary: parsedResult.summary,
    }
    if (parsedResult.rawResponse) {
      dbContent.rawResponse = parsedResult.rawResponse
    }
    await ipc.invoke('db:review-create', {
      baseDraftId: baseDraft.id,
      reviewIndex: revIndex,
      content: JSON.stringify(dbContent, null, 2),
    })

    // Tab 内容: L1/L2 传 JSON 字符串供 ReviewReport 结构化渲染
    //           L3 传原始文本供 ReviewReport.parseLegacyReport() 旧版解析器处理
    const reportContent = parsedResult.rawResponse
      ? parsedResult.rawResponse
      : JSON.stringify(parsedResult, null, 2)

    const { useEditorStore } = await import('../../../stores/editor-store')
    const pseudoReviewPath = `vela://draft/ch${this.params.chapterNumber}/v${baseVersion}/review${revIndex}`
    useEditorStore.getState().openFile({
      id: `review-${this.params.draftPath}-${revIndex}`,
      name: t('workflow.reviewReport').replace('{n}', String(this.params.chapterNumber)),
      type: 'review-report',
      content: reportContent,
      filePath: this.params.draftPath,
      reportPath: pseudoReviewPath,
      reviewReport: reportContent,
      chapterNumber: this.params.chapterNumber,
    })

    callbacks.log(`✅ 审查完成，已生成审稿报告 r${revIndex}`)
    return reviewResultRaw
  }

  /** 分级角色状态注入 — 核心角色完整档案，配角精简 */
  private async readCharacterStates(): Promise<string> {
    try {
      const allChars = await ipc.invoke('db:character-get-all') as Array<{
        name: string; role: string; tier?: number; currentState?: Record<string, unknown>
      }>
      const tier1: string[] = []
      const tier2: string[] = []

      for (const card of allChars) {
        if (!card.name) continue
        const tier = card.tier ?? (card.role === 'protagonist' || card.role === 'antagonist' ? 1 : 2)
        const cs = card.currentState

        if (!cs) continue

        if (tier === 1) {
          tier1.push(
            `${card.name}（${card.role || '未知'}）: ` +
            `${cs.powerLevel || ''}, ${cs.location || ''}, ${cs.physicalState || ''}, ${cs.mentalState || ''}, ` +
            `最近：${cs.recentEvents || ''}`
          )
        } else if (tier === 2) {
          tier2.push(`${card.name}（配角）: ${cs.location || ''}, ${cs.recentEvents || ''}`)
        }
      }

      const parts: string[] = []
      if (tier1.length > 0) parts.push(tier1.join('\n'))
      if (tier2.length > 0) parts.push(tier2.join('\n'))
      return parts.length > 0 ? parts.join('\n') : t('common.noneYetPlaceholder')
    } catch { return t('common.readFailedPlaceholder') }
  }

  private async readWorldBuilding(): Promise<string> {
    const core = await ipc.invoke('db:project-core-get')
    return core?.worldbuilding || t('common.noneYetPlaceholder')
  }
}
