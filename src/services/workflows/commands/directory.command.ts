import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { validateDirectoryWriteItems, type ChapterBlueprintScope, type DirectoryWriteRange } from '../../../core'
import { t } from '../../../shared/locale'
import { useProjectStore } from '../../../stores/project-store'
import { assertChapterBlueprintScope } from '../../chapters/chapter-blueprint-adapter'
import { getPromptTemplate } from '../../prompt-templates'
import { DirectoryPromptBuilder } from '../../prompts/prompt-builder'
import { DirectoryWorkflowParams, ChapterBlueprint, parseTextBlueprints, parseTextBlueprintsFromParsed } from '../directory-workflow'
import { stripThinkingTags, extractAndRepairJSON } from '../workflow-utils'

/**
 * 为 Prompt 注入清洗蓝图内容：
 * - 截断过长的 keyEvents（防止 prompt 膨胀）
 * - 转义 pipe 字符防止破坏 Markdown 表格上下文
 */
function sanitizeForPrompt(text: string, maxLen: number = 60): string {
  return text
    .replace(/\n/g, ' ')             // 换行 → 空格
    .replace(/\|/g, '/')             // pipe → slash（保护表格上下文）
    .slice(0, maxLen)                // 截断
    .trim()
}

export class GenerateDirectoryCommand extends BaseWorkflowCommand<ChapterBlueprint[]> {
  constructor(
    private readonly params: DirectoryWorkflowParams,
    private readonly source: ChapterBlueprintScope,
    private readonly range: DirectoryWriteRange,
  ) {
    super()
  }

  async execute({ context, callbacks }: CommandExecuteParams): Promise<ChapterBlueprint[]> {
    const assertActive = () => {
      assertChapterBlueprintScope(this.source)
      if (context.cancelled) throw new Error(t('error.workflowCancelled'))
    }
    assertActive()
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(t('error.noProject'))

    const architecture = context.data.architecture as string
    const existingBlueprints = (context.data.existingBlueprints || []) as ChapterBlueprint[]

    const { first: startChapter, last: endChapter, totalChapters } = this.range
    const globalGuidance = project.novelConfig.globalGuidance || ''
    const genre = project.novelConfig.genre || ''

    callbacks.log(t('log.directory.generating').replace('{start}', String(startChapter)).replace('{end}', String(endChapter)))

    // 从当前默认模型获取 maxTokens，动态计算每批次章节数
    const llmStore = (await import('../../../stores/llm-store')).useLLMStore.getState()
    assertActive()
    const defaultModel = llmStore.models.find(m => m.id === llmStore.defaultModelId)
    const modelMaxTokens = defaultModel?.maxTokens || 4096
    const outputBudget = Math.floor(modelMaxTokens * 0.6)  // 预留 40% 给 prompt + 思考
    const tokensPerChapter = 200
    const autoBatchSize = Math.min(50, Math.max(5, Math.floor(outputBudget / tokensPerChapter)))
    // 用户选择分批时每批章数（不得超过模型输出预算自动值，防截断/防上下文溢出）；
    // single 模式 = 自动值（大模型通常 50 = 一次对话生成全部）
    const batchSize = this.params.generationMode === 'batch' && this.params.batchChapterCount
      ? Math.min(this.params.batchChapterCount, autoBatchSize)
      : autoBatchSize
    if (this.params.generationMode === 'batch') {
      callbacks.log(t('log.directory.batchMode').replace('{size}', String(batchSize)))
    }

    const newBlueprints = new Map<number, ChapterBlueprint>()
    // 使用游标追踪生成进度，支持 AI 超额返回时智能跳过后续批次
    let cursor = startChapter
    // 多级重试策略：本地修复 → 中批次(5章) → 单章
    let consecutiveParseFailures = 0
    const MAX_CONSECUTIVE_FAILURES = 5  // 增加容错次数（修复不算新 LLM 调用）
    // 动态批次大小
    let effectiveBatchSize = batchSize

    while (cursor <= endChapter) {
      assertActive()

      const batchEnd = Math.min(cursor + effectiveBatchSize - 1, endChapter)
      if (effectiveBatchSize < batchSize) {
        callbacks.log(t('log.directory.generatingRetry')
          .replace('{start}', String(cursor))
          .replace('{end}', String(batchEnd))
          .replace('{size}', String(effectiveBatchSize)))
      } else {
        callbacks.log(t('log.directory.generatingRange')
          .replace('{start}', String(cursor))
          .replace('{end}', String(batchEnd)))
      }

      let prompt: string
      if (cursor === 1 && this.params.mode === 'full' && this.params.generationMode !== 'batch' && consecutiveParseFailures === 0 && newBlueprints.size === 0) {
        const template = getPromptTemplate('chapter_blueprint')
        if (!template) throw new Error(t('error.templateMissing'))
        prompt = new DirectoryPromptBuilder(template)
          .withNovelArchitecture(architecture)
          .withNumberOfChapters(endChapter)
          .withGlobalGuidance(globalGuidance)
          .withGenre(genre)
          .withPacingGuidance((context.data.pacingGuidance as string) || '')
          .build()
      } else {
        const template = getPromptTemplate('chapter_blueprint_chunk')
        if (!template) throw new Error(t('error.templateMissing'))

        // 构建上下文章节列表（清洗 + 截断，防止 prompt 膨胀）
        const previous = new Map(existingBlueprints.map(chapter => [chapter.chapterNumber, chapter]))
        for (const [chapter, row] of newBlueprints) previous.set(chapter, row)
        const prevAll = [...previous.values()]
          .filter(chapter => chapter.chapterNumber < cursor)
          .sort((a, b) => a.chapterNumber - b.chapterNumber)
        // 最多取最近 20 章，防止超出上下文窗口
        const chapterList = prevAll.slice(-20).map(c =>
          t('inject.directory.chapterLine')
            .replace('{chapter}', String(c.chapterNumber))
            .replace('{title}', () => sanitizeForPrompt(c.title ?? '', 30))
            .replace('{events}', () => sanitizeForPrompt(c.keyEvents ?? '', 80))
        ).join('\n')
        const chapterListNote = prevAll.length > 20
          ? t('inject.directory.truncatedNote').replace('{count}', String(prevAll.length))
          : t('inject.directory.countNote').replace('{count}', String(prevAll.length))

        prompt = new DirectoryPromptBuilder(template)
          .withNovelArchitecture(architecture)
          .withChapterList((chapterList || t('inject.directory.firstBatch')) + '\n' + chapterListNote)
          .withNumberOfChapters(totalChapters)
          .withN(cursor)
          .withM(batchEnd)
          .withGlobalGuidance(globalGuidance)
          .withGenre(genre)
          .withPacingGuidance((context.data.pacingGuidance as string) || '')
          .build()
      }

      callbacks.setProgress(Math.round(((cursor - startChapter) / (endChapter - startChapter + 1)) * 90))

      // systemRole 由模板定义
      const systemRole = getPromptTemplate('chapter_blueprint')?.systemRole || t('role.blueprintArchitect')
      // staticContext：架构入 system 前缀（与 generate-draft 一致）——
      // ① 批次间 system 前缀完全稳定 → API 前缀缓存命中（长链路输入费用减半）
      // ② system 消息遵从度更高 → 50 章级长输出中后段不偏离架构（降幻觉）
      // 注意：必须传注入后的 prompt 字符串而非 builder（callLLMWithBuilder 内部重 build 会丢注入）
      const maxAcceptedChapter = this.params.generationMode === 'batch' ? batchEnd : endChapter
      assertActive()
      const resultText = await this.callLLM(prompt, systemRole, callbacks, { staticContext: architecture, purpose: 'blueprint_gen' }, context)
      assertActive()

      const collect = (parsed: ChapterBlueprint[]) => {
        const before = newBlueprints.size
        for (const row of parsed) {
          if (Number.isSafeInteger(row.chapterNumber) && row.chapterNumber >= cursor
            && row.chapterNumber <= maxAcceptedChapter && !newBlueprints.has(row.chapterNumber)) {
            newBlueprints.set(row.chapterNumber, row)
          }
        }
        return newBlueprints.size - before
      }

      let added = collect(parseTextBlueprints(resultText, cursor, maxAcceptedChapter))
      let repaired = false
      if (added === 0 && consecutiveParseFailures === 0) {
        callbacks.log(t('log.directory.localRepair'))
        const repairResult = extractAndRepairJSON(stripThinkingTags(resultText), false)
        if (repairResult.parsed) {
          added = collect(parseTextBlueprintsFromParsed(repairResult.parsed, cursor, maxAcceptedChapter))
        }
        repaired = added > 0
        callbacks.log(t(repaired ? 'log.directory.repairOk' : 'log.directory.repairFailed'))
      }

      if (added > 0) {
        const previousCursor = cursor
        consecutiveParseFailures = 0
        effectiveBatchSize = batchSize
        while (newBlueprints.has(cursor)) cursor++
        if (cursor > previousCursor) {
          callbacks.log(t(repaired ? 'log.directory.batchDoneRepaired' : 'log.directory.batchDone')
            .replace('{start}', String(previousCursor))
            .replace('{end}', String(cursor - 1))
            .replace('{count}', String(added)))
        }
        continue
      }

      consecutiveParseFailures++
      callbacks.log(t('log.directory.parseFailed')
        .replace('{start}', String(cursor))
        .replace('{end}', String(batchEnd))
        .replace('{failures}', String(consecutiveParseFailures))
        .replace('{maxFailures}', String(MAX_CONSECUTIVE_FAILURES)))

      if (consecutiveParseFailures >= MAX_CONSECUTIVE_FAILURES) {
        callbacks.log(t('log.directory.abort').replace('{count}', String(MAX_CONSECUTIVE_FAILURES)))
        throw new Error(t('error.blueprintParseRepeatedFailure').replace('{count}', String(MAX_CONSECUTIVE_FAILURES)))
      }
      if (consecutiveParseFailures === 1) {
        effectiveBatchSize = Math.min(5, effectiveBatchSize)
        callbacks.log(t('log.directory.shrinkBatch')
          .replace('{size}', String(effectiveBatchSize))
          .replace('{chapter}', String(cursor)))
      } else if (consecutiveParseFailures <= 3) {
        effectiveBatchSize = Math.max(1, Math.floor(effectiveBatchSize / 2))
        callbacks.log(t('log.directory.shrinkMore')
          .replace('{size}', String(effectiveBatchSize))
          .replace('{chapter}', String(cursor)))
      } else {
        effectiveBatchSize = 1
        callbacks.log(t('log.directory.singleRetry').replace('{chapter}', String(cursor)))
      }
    }

    assertActive()
    const blueprints = [...newBlueprints.values()].sort((a, b) => a.chapterNumber - b.chapterNumber)
    validateDirectoryWriteItems(this.range, blueprints)
    context.data.newBlueprints = blueprints
    callbacks.log(t('log.directory.done').replace('{count}', String(blueprints.length)))
    return blueprints
  }
}
