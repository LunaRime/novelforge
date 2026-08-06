import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { t } from '../../../shared/locale'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { DirectoryPromptBuilder } from '../../prompts/prompt-builder'
import { DirectoryWorkflowParams, ChapterBlueprint, parseTextBlueprints, parseTextBlueprintsFromParsed, saveAllBlueprints } from '../directory-workflow'
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
  constructor(private params: DirectoryWorkflowParams) {
    super()
  }

  async execute({ context, callbacks }: CommandExecuteParams): Promise<ChapterBlueprint[]> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(t('error.noProject'))

    const architecture = context.data.architecture as string
    const existingBlueprints = (context.data.existingBlueprints || []) as ChapterBlueprint[]

    const totalChapters = project.novelConfig.totalChapters
    const globalGuidance = project.novelConfig.globalGuidance || ''
    const genre = project.novelConfig.genre || ''

    let startChapter = 1
    let endChapter = totalChapters

    if (this.params.mode === 'append') {
      startChapter = this.params.startChapter || (existingBlueprints.length + 1)
      if (this.params.count && this.params.count > 0) {
        endChapter = startChapter + this.params.count - 1
      }
    } else if (this.params.count && this.params.count > 0) {
      endChapter = Math.min(this.params.count, totalChapters)
    }

    callbacks.log(t('log.directory.generating').replace('{start}', String(startChapter)).replace('{end}', String(endChapter)))

    // 从当前默认模型获取 maxTokens，动态计算每批次章节数
    const llmStore = (await import('../../../stores/llm-store')).useLLMStore.getState()
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

    const newBlueprints: ChapterBlueprint[] = []
    // 使用游标追踪生成进度，支持 AI 超额返回时智能跳过后续批次
    let cursor = startChapter
    // 多级重试策略：本地修复 → 中批次(5章) → 单章
    let consecutiveParseFailures = 0
    const MAX_CONSECUTIVE_FAILURES = 5  // 增加容错次数（修复不算新 LLM 调用）
    // 动态批次大小
    let effectiveBatchSize = batchSize

    while (cursor <= endChapter) {
      if (context.cancelled) { callbacks.log(t('log.directory.cancelled')); break }

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
      if (cursor === 1 && this.params.mode === 'full') {
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
        const prevAll = [...existingBlueprints, ...newBlueprints]
        // 最多取最近 20 章，防止超出上下文窗口
        const chapterList = prevAll.slice(-20).map(c =>
          t('inject.directory.chapterLine')
            .replace('{chapter}', String(c.chapterNumber))
            .replace('{title}', () => sanitizeForPrompt(c.title, 30))
            .replace('{events}', () => sanitizeForPrompt(c.keyEvents, 80))
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
      const resultText = await this.callLLM(prompt, systemRole, callbacks, { staticContext: architecture })

      // 接受 AI 返回的从 cursor 到 endChapter 范围内的所有有效章节
      // AI 可能一次性返回超出本批次（batchEnd）的章节，全部保留（single 模式：省调用）
      // batch 模式：严格按批 —— 程序接受范围与模板输出纪律（≤ {{m}}）双保险，杜绝越界输出
      const parsed = parseTextBlueprints(resultText, cursor,
        this.params.generationMode === 'batch' ? batchEnd : endChapter)
      newBlueprints.push(...parsed)

      // 批次入库
      if (parsed.length > 0) {
        await saveAllBlueprints(parsed)
        useProjectStore.getState().refreshFileTree()
      }

      // 计算本次实际生成到的最大章节号，推进游标到已生成的最后一章之后
      if (parsed.length > 0) {
        consecutiveParseFailures = 0
        effectiveBatchSize = batchSize  // 恢复完整批次大小
        const actualMaxChapter = Math.max(...parsed.map(p => p.chapterNumber))
        const actualMinChapter = Math.min(...parsed.map(p => p.chapterNumber))

        // 缺口检测：如果游标章节在结果中缺失，下一轮重试会填补
        if (actualMinChapter > cursor) {
          callbacks.log(t('log.directory.gapDetected')
            .replace('{chapter}', String(cursor))
            .replace('{min}', String(actualMinChapter))
            .replace('{max}', String(actualMaxChapter)))
        } else {
          // 中间缺口检测：批次返回 1、3、4（缺 2）时，头部不缺但中间缺——
          // 历史事故：cursor 直接推到 max+1，缺失章节永久跳过。推进前检查连续性，
          // 有缺口则游标回退到第一个缺失章号
          const missingInRange: number[] = []
          for (let n = cursor; n < actualMaxChapter; n++) {
            if (!parsed.some(p => p.chapterNumber === n)) missingInRange.push(n)
          }
          if (missingInRange.length > 0) {
            cursor = missingInRange[0]
            callbacks.log(t('log.directory.middleGap')
              .replace('{chapter}', String(missingInRange[0]))
              .replace('{max}', String(actualMaxChapter))
              .replace('{count}', String(missingInRange.length)))
          } else {
            callbacks.log(t('log.directory.batchDone')
              .replace('{start}', String(cursor))
              .replace('{end}', String(actualMaxChapter))
              .replace('{count}', String(parsed.length)))
            cursor = actualMaxChapter + 1
          }
        }
      } else {
        consecutiveParseFailures++
        callbacks.log(t('log.directory.parseFailed')
          .replace('{start}', String(cursor))
          .replace('{end}', String(batchEnd))
          .replace('{failures}', String(consecutiveParseFailures))
          .replace('{maxFailures}', String(MAX_CONSECUTIVE_FAILURES)))

        // 三级降级策略：本地修复（不消耗 Token）→ 缩小批次 → 单章兜底
        // parseTextBlueprints 内部会自动尝试 Markdown 表格 → JSON fallback 两条路径
        if (consecutiveParseFailures === 1) {
          // 第 1 次失败：尝试更深层的本地 JSON 修复
          callbacks.log(t('log.directory.localRepair'))
          const repairResult = extractAndRepairJSON(stripThinkingTags(resultText), false)
          if (repairResult.parsed) {
            callbacks.log(t('log.directory.repairOk'))
            // batch 模式 repair 同样限批（此前误用 endChapter——AI 超额返回的越界章节
            // 在 repair 后被接受入库，破坏「严格按批」双保险）
            const repairedBlueprints = parseTextBlueprintsFromParsed(repairResult.parsed, cursor,
              this.params.generationMode === 'batch' ? batchEnd : endChapter)
            if (repairedBlueprints.length > 0) {
              newBlueprints.push(...repairedBlueprints)
              await saveAllBlueprints(repairedBlueprints)
              useProjectStore.getState().refreshFileTree()
              consecutiveParseFailures = 0
              effectiveBatchSize = batchSize
              const actualMaxChapter = Math.max(...repairedBlueprints.map(p => p.chapterNumber))
              callbacks.log(t('log.directory.batchDoneRepaired')
                .replace('{start}', String(cursor))
                .replace('{end}', String(actualMaxChapter))
                .replace('{count}', String(repairedBlueprints.length)))
              cursor = actualMaxChapter + 1
              continue
            }
          }
          callbacks.log(t('log.directory.repairFailed'))
          // 降级到 5 章小批次重试
          effectiveBatchSize = Math.min(5, effectiveBatchSize)
          callbacks.log(t('log.directory.shrinkBatch')
            .replace('{size}', String(effectiveBatchSize))
            .replace('{chapter}', String(cursor)))
        } else if (consecutiveParseFailures === 2 || consecutiveParseFailures === 3) {
          // 第 2-3 次失败：进一步缩小批次
          effectiveBatchSize = Math.max(1, Math.floor(effectiveBatchSize / 2))
          callbacks.log(t('log.directory.shrinkMore')
            .replace('{size}', String(effectiveBatchSize))
            .replace('{chapter}', String(cursor)))
        } else {
          // 第 4-5 次失败：单章模式
          effectiveBatchSize = 1
          callbacks.log(t('log.directory.singleRetry').replace('{chapter}', String(cursor)))
        }

        if (consecutiveParseFailures >= MAX_CONSECUTIVE_FAILURES) {
          callbacks.log(t('log.directory.abort').replace('{count}', String(MAX_CONSECUTIVE_FAILURES)))
          throw new Error(t('error.blueprintParseRepeatedFailure').replace('{count}', String(MAX_CONSECUTIVE_FAILURES)))
        }
        // cursor 保持不变，确保不跳过任何章节
      }
    }

    context.data.newBlueprints = newBlueprints
    context.data.existingBlueprints = existingBlueprints

    callbacks.log(t('log.directory.done').replace('{count}', String(newBlueprints.length)))
    return newBlueprints
  }
}
