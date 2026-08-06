import { t } from '../../../shared/locale'
/**
 * RefineParagraphsCommand — 段落级差异修改（非全文重写）
 *
 * 用户选中特定段落，指定改写方向（扩写/缩写/改风格/增强冲突/润色），
 * AI 只修改选中部分，其余内容保持不变。
 * 利用 diff-match-patch 生成差异供用户逐段接受/拒绝。
 */

import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { computeTextStats } from '../../text-stats'
import { ipc } from '../../ipc-client'

export interface RefineParagraphsParams {
  /** 完整原文 */
  fullContent: string
  /** 选中的段落起始位置（字符索引） */
  selectionStart: number
  /** 选中的段落结束位置（字符索引） */
  selectionEnd: number
  /** 改写指令 */
  instruction: string
  /** 改写类型 */
  refineType: 'expand' | 'shrink' | 'style' | 'conflict' | 'polish'
}

export interface RefineParagraphsResult {
  /** 修改后的完整文本 */
  modifiedContent: string
  /** 变更摘要 */
  summary: string
  /** 字数变化 */
  wordDelta: number
}

/** 改写类型 → 指令段落（i18n） */
function getRefineGuide(refineType: string): string {
  const guides: Record<string, string> = {
    expand: t('prompt.refine.guideExpand'),
    shrink: t('prompt.refine.guideShrink'),
    style: t('prompt.refine.guideStyle'),
    conflict: t('prompt.refine.guideConflict'),
    polish: t('prompt.refine.guidePolish'),
  }
  return guides[refineType] || guides.polish
}

export class RefineParagraphsCommand extends BaseWorkflowCommand<RefineParagraphsResult> {
  constructor(private params: RefineParagraphsParams) { super() }

  async execute({ callbacks }: CommandExecuteParams): Promise<RefineParagraphsResult> {
    const { fullContent, selectionStart, selectionEnd, instruction, refineType } = this.params

    // 提取选中段落及其上下文
    const selectedText = fullContent.slice(selectionStart, selectionEnd)
    if (!selectedText.trim()) throw new Error(t('error.emptySelection'))

    // 提取前后各 200 字作为上下文锚点
    const contextBefore = fullContent.slice(Math.max(0, selectionStart - 200), selectionStart)
    const contextAfter = fullContent.slice(selectionEnd, Math.min(fullContent.length, selectionEnd + 200))

    callbacks.log(t('log.refineParagraphs.selected')
      .replace('{type}', refineType)
      .replace('{words}', String(computeTextStats(selectedText).novelWordCount)))

    // 构建 prompt
    const guide = getRefineGuide(refineType)
    const systemPrompt = [
      t('prompt.refine.systemIntro'),
      '',
      t('prompt.refine.typeLabel').replace(/\{type\}/g, () => refineType),
      t('prompt.refine.guideLabel').replace(/\{guide\}/g, () => guide),
      instruction ? t('prompt.refine.requestLabel').replace(/\{instruction\}/g, () => instruction) : '',
      '',
      t('prompt.refine.importantRules'),
      t('prompt.refine.rule1'),
      t('prompt.refine.rule2'),
      t('prompt.refine.rule3'),
      t('prompt.refine.rule4'),
    ].filter(Boolean).join('\n')

    const userPrompt = [
      t('prompt.refine.userIntro'),
      '',
      `[CONTEXT_BEFORE]${contextBefore}`,
      `<<<SELECTED>>>`,
      selectedText,
      `>>>END<<<`,
      `[CONTEXT_AFTER]${contextAfter}`,
    ].join('\n')

    const result = await this.callLLM(userPrompt, systemPrompt, callbacks, { cacheScope: 'chapter_refine' })
    // 字数差用统一"有效字数"口径
    const wordDelta = computeTextStats(result).novelWordCount - computeTextStats(selectedText).novelWordCount

    // 解析输出，提取修改后的段落
    let modifiedText = result
    const startMatch = result.match(/\[START\]([\s\S]*?)\[END\]/)
    if (startMatch) {
      modifiedText = startMatch[1].trim()
    }

    // 拼接完整文本
    const modifiedContent =
      fullContent.slice(0, selectionStart) +
      modifiedText +
      fullContent.slice(selectionEnd)

    const action = refineType === 'expand' ? t('log.refineParagraphs.actionExpand')
      : refineType === 'shrink' ? t('log.refineParagraphs.actionShrink')
      : t('log.refineParagraphs.actionRewrite')
    const summary =
      t('log.refineParagraphs.done')
        .replace('{action}', action)
        .replace('{before}', String(computeTextStats(selectedText).novelWordCount))
        .replace('{after}', String(computeTextStats(modifiedText).novelWordCount))
        .replace('{delta}', `${wordDelta >= 0 ? '+' : ''}${wordDelta}`)

    // 创建修订记录
    try {
      const draftMeta = await this.findDraftMeta()
      if (draftMeta) {
        const revIndex = await ipc.invoke('db:revision-next-index', draftMeta.id)
        await ipc.invoke('db:revision-create', {
          baseDraftId: draftMeta.id,
          revisionIndex: revIndex,
          revisionType: 'refine' as const,
          userPrompt: `${refineType}: ${instruction}`,
          content: modifiedContent,
          wordCount: computeTextStats(modifiedContent).novelWordCount,
        })
        callbacks.log(summary)
      }
    } catch {
      // 修订创建失败不影响主流程
    }

    return { modifiedContent, summary, wordDelta }
  }

  private async findDraftMeta(): Promise<{ id: number } | null> {
    try {
      // 从当前编辑器 tab 获取 draft 信息
      const { useEditorStore } = await import('../../../stores/editor-store')
      const activeTab = useEditorStore.getState().tabs.find(t => t.type === 'chapter')
      if (activeTab?.filePath) {
        const { parseDraftMeta } = await import('../chapter-workflow')
        return parseDraftMeta(activeTab.filePath)
      }
    } catch { /* ignore */ }
    return null
  }
}
