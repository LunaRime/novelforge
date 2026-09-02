import { t } from '../../../shared/locale'
import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { ChapterPromptBuilder } from '../../prompts/prompt-builder'
import { computeTextStats } from '../../text-stats'
import { ipc } from '../../ipc-client'
import { getActiveStyle, appendWritingStyle } from '../../agent/style-registry'

import type { ChapterInfo } from '../chapter-workflow'
import type { TextKey } from '../../../shared/locale'

export interface RefineDraftParams {
  draftPath: string
  draftContent: string
  chapterNumber: number
  chapterInfo: ChapterInfo
  mergedGuidance?: string
  userRefinePrompt?: string
  shortSummary?: string
}

export class RefineDraftCommand extends BaseWorkflowCommand<string> {
  constructor(private params: RefineDraftParams) {
    super()
  }

  async execute({ context, callbacks }: CommandExecuteParams): Promise<string> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(t('error.noProject'))

    const draft = this.params.draftContent
    if (!draft) throw new Error(t('error.noDraft'))

    callbacks.log(t('log.refineDraft.starting'))

    const template = getPromptTemplate('refine_chapter')
    if (!template) throw new Error(t('error.templateNotFound').replace('{name}', '修稿'))

    const mergedGuidance = this.params.mergedGuidance || project.novelConfig.globalGuidance || ''
    const userPromptBlock = this.params.userRefinePrompt?.trim()
      ? `★【用户额外修稿指导（绝对优先级）】★：\n${this.params.userRefinePrompt}`
      : ''

    // ⚠️ M 级修复：注入角色声音档案 + 角色状态——修稿模板引用「上方注入的角色声音档案」
    //    但此前从未注入（OOC 校验无基准，修稿者可能把符合人设的台词改歪）；
    //    withGlobalSummary/withShortSummary 此前恒空（无前文基准，修稿可能改写掉与前文咬合的细节）
    let voiceProfileText = ''
    try {
      const { loadCharacterVoiceProfiles, formatVoiceForPrompt } = await import('../../character-voice-analyzer')
      const profiles = await loadCharacterVoiceProfiles()
      voiceProfileText = formatVoiceForPrompt(profiles)
    } catch { /* 声音档案加载失败不阻断 */ }
    const characterStates = await this.readCharacterStates()
    const shortSummary = this.params.shortSummary?.trim() || t('inject.review.noContextReference')

    // ==========================================
    // 输出风格注入（C3，与 generate-draft 同款语义）：default.md 存在即追加到既有 config.writingStyle
    // 之后，无 default.md / 读盘失败 → 零变化（修稿首次把 writingStyle 引入 prompt——用户裁决接受新行为）
    // ==========================================
    const activeStyleBody = project.path
      ? ((await getActiveStyle(project.path))?.promptBody ?? '')
      : ''
    const writingStyleValue = appendWritingStyle(project.novelConfig.writingStyle || '', activeStyleBody)

    const promptBuilder = new ChapterPromptBuilder(template)
      .withDraftContent(draft)
      .withChapterInfo(this.params.chapterInfo)
      .withGlobalGuidance(mergedGuidance)
      .withWritingStyle(writingStyleValue)
      .withGlobalSummary(shortSummary)
      .withShortSummary(shortSummary)
      .withCharacterStates(characterStates)
      .withVoiceProfile(voiceProfileText)
      .withWordNumber(project.novelConfig.wordsPerChapter)
      .withUserRefinePrompt(userPromptBlock)

    const refined = await this.callLLMWithBuilder(promptBuilder, callbacks, { purpose: 'refine_chapter' })

    const cleanRefined = this.stripThinkingTags(refined)

    const { parseDraftMeta } = await import('../chapter-workflow')
    const baseDraft = await parseDraftMeta(this.params.draftPath)
    if (!baseDraft) throw new Error(t('error.noBaseDraft'))

    const revIndex = await ipc.invoke('db:revision-next-index', baseDraft.id)

    // 清理该草稿下已有的 pending 状态修稿，保证只保留最新的一条
    const pendingRevs = await ipc.invoke('db:revision-get-pending', baseDraft.id)
    for (const rev of pendingRevs) {
      await ipc.invoke('db:revision-mark-discarded', rev.id)
    }

    const createRes = await ipc.invoke('db:revision-create', {
      baseDraftId: baseDraft.id,
      revisionIndex: revIndex,
      revisionType: 'refine',
      content: cleanRefined,
      wordCount: computeTextStats(cleanRefined).novelWordCount,
    }) as { success: boolean; id: number }

    const { useEditorStore } = await import('../../../stores/editor-store')
    useEditorStore.getState().openFile({
      id: `diff-${this.params.draftPath}-${createRes.id}`,
      name: t('workflow.refineMerge').replace('{n}', String(this.params.chapterNumber)),
      type: 'diff',
      filePath: this.params.draftPath,
      originalContent: this.params.draftContent,
      content: cleanRefined,
      revisionPath: String(createRes.id),
      chapterNumber: this.params.chapterNumber,
      chapterDir: `vela://draft/ch${this.params.chapterNumber}`,
    })

    context.data.refined = cleanRefined
    context.data.refinedPath = this.params.draftPath
    callbacks.log(t('log.refineDraft.done')
      .replace('{chars}', String(cleanRefined.length))
      .replace('{revision}', String(revIndex)))
    return refined
  }

  /** 角色状态（修稿设定咬合基准）— 与 review-chapter 同实现 */
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
            t('inject.review.charStateTier1')
              .replace('{name}', () => card.name)
              .replace('{role}', () => this.roleLabel(card.role))
              .replace('{power}', () => String(cs.powerLevel || ''))
              .replace('{location}', () => String(cs.location || ''))
              .replace('{physical}', () => String(cs.physicalState || ''))
              .replace('{mental}', () => String(cs.mentalState || ''))
              .replace('{recent}', () => String(cs.recentEvents || ''))
          )
        } else if (tier === 2) {
          tier2.push(
            t('inject.review.charStateTier2')
              .replace('{name}', () => card.name)
              .replace('{role}', () => t('characterRole.supporting'))
              .replace('{location}', () => String(cs.location || ''))
              .replace('{recent}', () => String(cs.recentEvents || ''))
          )
        }
      }

      const parts: string[] = []
      if (tier1.length > 0) parts.push(tier1.join('\n'))
      if (tier2.length > 0) parts.push(tier2.join('\n'))
      return parts.length > 0 ? parts.join('\n') : t('common.noneYetPlaceholder')
    } catch { return t('common.readFailedPlaceholder') }
  }

  private roleLabel(role?: string): string {
    if (!role) return t('common.unknownWord')
    const known: Record<string, TextKey> = {
      protagonist: 'characterRole.protagonist',
      antagonist: 'characterRole.antagonist',
      supporting: 'characterRole.supporting',
      extra: 'characterRole.extra',
    }
    return known[role] ? t(known[role]) : role
  }
}
