import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { t } from '../../../shared/locale'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { ChapterPromptBuilder } from '../../prompts/prompt-builder'
import { computeTextStats } from '../../text-stats'
import { ipc } from '../../ipc-client'
import {
  DIR_PROMPTS
} from '../../../shared/project-paths'
import type { ChapterInfo } from '../chapter-workflow'

export class GenerateDraftCommand extends BaseWorkflowCommand {

  constructor(private chapterInfo: ChapterInfo) {
    super()
  }

  async execute({ context, callbacks }: CommandExecuteParams): Promise<string> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(t('error.noProject'))

    callbacks.log(t('log.generateDraft.assembling'))

    const architecture = await this.readArchitecture(project.path)
    const projectPrompts = await this.readProjectPrompts(project.path)
    const mergedGuidance = [project.novelConfig.globalGuidance || '', projectPrompts].filter(Boolean).join('\n\n')

    const characterState = await this.readCharacterStates(project.path)
    let futureBlueprintsStr = t('inject.noFutureBlueprints')
    try {
      const { loadDirectoryBlueprints } = await import('../directory-workflow')
      const allBlueprints = await loadDirectoryBlueprints()
      const futureBlueprintsArr = allBlueprints.filter(
        b => b.chapterNumber > this.chapterInfo.chapterNumber && b.chapterNumber <= this.chapterInfo.chapterNumber + 5
      )
      if (futureBlueprintsArr.length > 0) {
        futureBlueprintsStr = futureBlueprintsArr.map(b => t('inject.futureBlueprintItem')
          .replace(/\{chapter\}/g, () => String(b.chapterNumber))
          .replace(/\{title\}/g, () => b.title)
          .replace(/\{events\}/g, () => b.keyEvents)).join('\n')
      }
    } catch (e) {
      console.warn('[generate-draft] 加载后续蓝图失败，将仅使用当前章节信息生成:', e)
    }

    const isFirstChapter = this.chapterInfo.chapterNumber === 1
    const templateKey = isFirstChapter ? 'first_chapter_draft' : 'next_chapter_draft'
    const template = getPromptTemplate(templateKey)
    if (!template) throw new Error(t('error.templateNotFound').replace('{name}', templateKey))

    // ==========================================
    // Prompt 构建——按「稳定前缀 → 可变后缀」排列
    // 以最大化 LLM 上下文缓存命中率
    // ==========================================
    const promptBuilder = new ChapterPromptBuilder(template)
      // ---- 缓存命中区（跨章稳定，前缀对齐）----
      .withArchitecture(architecture)
      .withGlobalGuidance(mergedGuidance)
      .withWritingStyle(project.novelConfig.writingStyle || '')
      .withNovelConfig(project.novelConfig)
      .withWordNumber(project.novelConfig.wordsPerChapter)

    // 流派特化注入
    const genreOverride = (await import('../../genre-overrides')).getGenreOverride(
      project.novelConfig.genre,
      project.novelConfig.subGenre,
    )
    if (genreOverride) {
      const genreGuide = (await import('../../genre-overrides')).formatGenreOverrideForPrompt(genreOverride)
      promptBuilder.withWritingStyle((project.novelConfig.writingStyle || '') + '\n\n' + genreGuide)
      callbacks.log(t('log.generateDraft.genreInjected').replace('{genre}', project.novelConfig.genre))
    }

    if (!isFirstChapter) {
      // 智能上下文剪枝：按相关性排序只注入 top-3 最相关章节
      const { pruneChapterContext } = await import('../../smart-context-pruner')
      const pruned = await pruneChapterContext(
        this.chapterInfo.chapterNumber,
        { title: this.chapterInfo.title, keyEvents: this.chapterInfo.keyEvents, characters: this.chapterInfo.characters },
      )
      const chapterTimeline = pruned.text
      callbacks.log(t('log.generateDraft.pruned')
        .replace('{tokens}', String(pruned.tokensUsed))
        .replace('{saved}', String(pruned.tokensSaved)))

      let previousEnding = ''
      try {
        const prevNum = this.chapterInfo.chapterNumber - 1
        const meta = await ipc.invoke('db:draft-get-finalized', prevNum)
        if (meta) {
          const full = await ipc.invoke('db:draft-get-full', meta.id)
          if (full?.content) previousEnding = full.content.slice(-1000)
        }
      } catch { /* 忽略 */ }

      let filteredContext = ''
      try {
        callbacks.log(t('log.generateDraft.searchingKB'))
        let searchQuery = `${this.chapterInfo.title} ${this.chapterInfo.keyEvents} ${this.chapterInfo.characters.join(' ')}`
        if (this.chapterInfo.knowledgeQueryHint?.trim()) {
          searchQuery += ` ${this.chapterInfo.knowledgeQueryHint.trim()}`
          callbacks.log(t('log.generateDraft.kbHint').replace('{keyword}', this.chapterInfo.knowledgeQueryHint.trim()))
        }
        // ⚠️ M 级修复：统一走 retrieveContextForQuery——章节范围过滤（±10 章防未来剧情泄露
        //    ——此前裸 kb:search 会命中已定稿的未来章节，与 future_blueprints 指令直接冲突）、
        //    0.6 相似度阈值（低相关片段不再诱导硬关联）、800 token 预算
        const { retrieveContextForQuery } = await import('../../agent/rag-context-provider')
        const rag = await retrieveContextForQuery(searchQuery, undefined, this.chapterInfo.chapterNumber)
        filteredContext = rag && rag.formattedContext
          ? rag.formattedContext
          : t('inject.kbNoContent')
      } catch {
        filteredContext = t('inject.kbUnavailable')
      }

      promptBuilder
        // ---- 缓存命中区续（要点时间线按序追加，前缀对齐）----
        .withGlobalSummary(chapterTimeline)
        .withCharacterStates(characterState)
        // ---- 缓存失效区（逐章变化）----
        .withPreviousEnding(previousEnding || t('inject.noPreviousEnding'))
        .withChapterInfo(this.chapterInfo)

      // 过渡引擎：构建前章场景卡片
      let transitionContext = ''
      try {
        const { buildTransitionContext, formatTransitionForPrompt } = await import('../../chapter-transition-engine')
        const ctx = await buildTransitionContext(this.chapterInfo.chapterNumber)
        transitionContext = formatTransitionForPrompt(ctx)
        if (transitionContext) callbacks.log(t('log.generateDraft.transitionBuilt'))
      } catch { /* 不影响主流程 */ }

      promptBuilder
        .withFutureBlueprints(futureBlueprintsStr)
        // ⚠️ H 级修复：此前 withUserGuidance 连续调用两次，后者覆盖前者——transitionContext
        //（前章场景卡：地点/时间/情绪/在场角色/未解决冲突/关键物品）被静默丢弃，
        // 衔接型幻觉（角色瞬移/冲突蒸发）的源头。合并为一次调用
        .withUserGuidance(
          [this.chapterInfo.userGuidance?.trim(), transitionContext.trim()]
            .filter(Boolean)
            .join('\n\n') || t('inject.noUserGuidance'),
        )
        .withFilteredContext(filteredContext)
        .withShortSummary('')
    }

    // ===== 防缺陷注入（伏笔 / 角色声音 / 设定多样性）=====
    let prompt = promptBuilder.build()
    const antiDefectSections: string[] = []

    // 1. 未回收伏笔（≤5 条，埋设于本章之前）——防止伏笔断裂/提前回收
    try {
      const { loadAllForeshadowing } = await import('../../foreshadowing-manager')
      const all = await loadAllForeshadowing()
      const pending = all
        .filter(f => !f.resolved && (f.setChapter ?? 0) < this.chapterInfo.chapterNumber)
        .sort((a, b) => (b.setChapter ?? 0) - (a.setChapter ?? 0))
        .slice(0, 5)
      if (pending.length > 0) {
        antiDefectSections.push(
          t('inject.unresolvedForeshadowing') + '\n' +
          pending.map((f, i) => t('inject.foreshadowItem')
            .replace(/\{index\}/g, () => String(i + 1))
            .replace(/\{chapter\}/g, () => String(f.setChapter))
            .replace(/\{content\}/g, () => String(f.content))
            .replace(/\{type\}/g, () => String(f.type))).join('\n'),
        )
      }
    } catch { /* 伏笔注入失败不阻断 */ }

    // 2. 角色声音档案（tier1 台词风格，防 OOC）
    try {
      const { loadCharacterVoiceProfiles, formatVoiceForPrompt } = await import('../../character-voice-analyzer')
      const profiles = await loadCharacterVoiceProfiles()
      const voicePrompt = formatVoiceForPrompt(profiles)
      if (voicePrompt) antiDefectSections.push(voicePrompt)
    } catch { /* 声音注入失败不阻断 */ }

    // 3. 冷门设定采样（创意多样性，可选非强制）
    try {
      const { sampleColdSettings } = await import('../../agent/tools/setting-sampler.tool')
      const cold = await sampleColdSettings(2)
      if (cold) antiDefectSections.push(t('inject.creativityDiversity') + '\n' + cold)
    } catch { /* 采样失败不阻断 */ }

    // 4. 偏好记忆注入（用户历史替换对——"偏好 X 而非 Y"，优先使用用户表达）
    try {
      const { getTopPreferences } = await import('../../preferences')
      const prefs = await getTopPreferences(5)
      if (prefs.length > 0) {
        antiDefectSections.push(
          t('inject.userPreferencesTitle') + '\n' +
          prefs.map(p => t('inject.userPreferenceItem')
            .replace(/\{userText\}/g, () => String(p.userText))
            .replace(/\{aiText\}/g, () => String(p.aiText))
            .replace(/\{count\}/g, () => String(p.count))).join('\n') +
          t('inject.userPreferenceFooter')
            .replace(/\{aiTexts\}/g, () => prefs.map(p => String(p.aiText)).join('」「')),
        )
      }
    } catch { /* 偏好注入失败不阻断 */ }

    // ⚠️ M 级修复：超限降级——provider 静默截断会恰好截掉 prompt 尾部的角色状态/伏笔清单
    //    （幻觉高发段）。按优先级从尾部裁剪低关键段（设定采样/偏好在后，伏笔/声音档案在前），
    //    始终保留至少一段防缺陷注入
    const assemblePrompt = () => promptBuilder.build()
      + (antiDefectSections.length > 0 ? '\n\n---\n\n' + antiDefectSections.join('\n\n---\n\n') : '')
    prompt = assemblePrompt()

    // Token 预算管控：中文约 1.5 字符/token，预留 4K 给输出
    const TOKEN_BUDGET = 28000
    const estimate = (p: string) => Math.ceil(p.length / 1.5)
    let removedSections = 0
    while (estimate(prompt) > TOKEN_BUDGET && antiDefectSections.length > 1) {
      antiDefectSections.pop()
      removedSections++
      prompt = assemblePrompt()
    }
    if (removedSections > 0 || estimate(prompt) > TOKEN_BUDGET) {
      callbacks.log(t('log.generateDraft.tokenOverBudget')
        .replace('{estimated}', String(estimate(prompt)))
        .replace('{budget}', String(TOKEN_BUDGET))
        .replace('{removed}', String(removedSections)))
    }

    callbacks.log(t('log.generateDraft.calling'))

    // staticContext：架构入 system 前缀（同项目连续调用缓存命中 + 模型遵从度更高）
    // 注意：必须传注入后的 prompt 字符串而非 builder —— callLLMWithBuilder 会重新 build() 丢失防缺陷注入
    const draftText = await this.callLLM(prompt, promptBuilder.getSystemRole(), callbacks, { staticContext: architecture, purpose: 'draft_chapter' })
    const cleanDraftText = this.stripThinkingTags(draftText)

    // 落于数据库（wordCount 用统一"有效字数"口径：汉字 + 英文单词，非 length）
    const novelWordCount = computeTextStats(cleanDraftText).novelWordCount
    const nextVersion: number = await ipc.invoke('db:draft-next-version', this.chapterInfo.chapterNumber)
    const createResult = await ipc.invoke('db:draft-create', {
      chapterNumber: this.chapterInfo.chapterNumber,
      version: nextVersion,
      source: 'write',
      content: cleanDraftText,
      wordCount: novelWordCount,
    })

    const pseudoPath = createResult.id ? `vela://draft/${createResult.id}` : `vela://draft/ch${this.chapterInfo.chapterNumber}/v${nextVersion}`

    context.data.draft = cleanDraftText
    context.data.draftContent = cleanDraftText
    context.data.draftPath = pseudoPath
    context.data.chapterNumber = this.chapterInfo.chapterNumber
    context.data.chapterInfo = this.chapterInfo
    context.data.mergedGuidance = mergedGuidance
    context.data.shortSummary = ''

    useProjectStore.getState().refreshFileTree()
    try {
      const { useDraftStore } = await import('../../../stores/draft-store')
      await useDraftStore.getState().loadAllDrafts()
    } catch { /* 忽略 */ }

    try {
      const { useEditorStore } = await import('../../../stores/editor-store')
      useEditorStore.getState().openFile({
        id: pseudoPath,
        name: t('draft.versionName')
          .replace(/\{chapter\}/g, () => String(this.chapterInfo.chapterNumber))
          .replace(/\{title\}/g, () => this.chapterInfo.title)
          .replace(/\{version\}/g, () => String(nextVersion)),
        type: 'chapter',
        filePath: pseudoPath,
        content: cleanDraftText,
      })
    } catch { /* 忽略 */ }

    callbacks.log(t('log.generateDraft.saved')
      .replace('{version}', String(nextVersion))
      .replace('{words}', String(novelWordCount)))
    return draftText
  }

  // --- 抽取自原文件的辅助方法 ---
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async readArchitecture(_projectPath: string): Promise<string> {
    const core = await ipc.invoke('db:project-core-get')
    const parts: string[] = []
    if (core?.premise) parts.push(core.premise.trim())
    if (core?.charactersArch) parts.push(core.charactersArch.trim())
    if (core?.worldbuilding) parts.push(core.worldbuilding.trim())
    if (core?.synopsis) parts.push(core.synopsis.trim())
    return parts.join('\n\n---\n\n')
  }

  private async readProjectPrompts(projectPath: string): Promise<string> {
    try {
      const files = await ipc.invoke('fs:list-dir', `${projectPath}/${DIR_PROMPTS}`)
      const mdFiles = files.filter((f: { isDir: boolean; name: string }) => !f.isDir && f.name.endsWith('.md'))
      if (mdFiles.length === 0) return ''
      const parts: string[] = []
      for (const f of mdFiles) {
        const result = await ipc.invoke('fs:read-file', f.path)
        if (result.success && result.content.trim()) {
          parts.push(t('inject.projectGuidanceTitle')
            .replace(/\{name\}/g, () => f.name.replace(/\.md$/, '')) + '\n' + result.content.trim())
        }
      }
      return parts.join('\n\n')
    } catch { return '' }
  }

  /** 分级角色状态注入 — 核心角色完整档案，配角精简，龙套省略 */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async readCharacterStates(_projectPath: string): Promise<string> {
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

        if (!cs || !cs.updatedAtChapter) {
          // 无状态数据 — 仅核心角色记录空档
          if (tier === 1) tier1.push(t('inject.charStateEmpty')
            .replace(/\{name\}/g, () => card.name)
            .replace(/\{role\}/g, () => card.role || t('common.unknownWord')))
          continue
        }

        if (tier === 1) {
          // 核心角色：完整档案
          tier1.push(
            t('inject.charStateCore')
              .replace(/\{name\}/g, () => card.name)
              .replace(/\{role\}/g, () => card.role || t('common.unknownWord'))
              .replace(/\{power\}/g, () => String(cs.powerLevel || t('common.unknownWord')))
              .replace(/\{location\}/g, () => String(cs.location || t('common.unknownWord')))
              .replace(/\{physical\}/g, () => String(cs.physicalState || t('inject.stateNormal')))
              .replace(/\{mental\}/g, () => String(cs.mentalState || t('inject.stateNormal')))
              .replace(/\{items\}/g, () => String(cs.keyItems || t('inject.stateNone')))
              .replace(/\{chapter\}/g, () => String(cs.updatedAtChapter || 0))
              .replace(/\{events\}/g, () => String(cs.recentEvents || ''))
          )
        } else if (tier === 2) {
          // 配角：精简摘要
          tier2.push(
            t('inject.charStateSupporting')
              .replace(/\{name\}/g, () => card.name)
              .replace(/\{chapter\}/g, () => String(cs.updatedAtChapter || 0))
              .replace(/\{location\}/g, () => String(cs.location || t('inject.stateUnknownLocation')))
              .replace(/\{events\}/g, () => String(cs.recentEvents || ''))
          )
        }
        // tier 3 龙套：不注入，除非蓝图 characters[] 引用
      }

      const parts: string[] = []
      if (tier1.length > 0) parts.push(t('inject.characterStateTitleCore') + '\n' + tier1.join('\n'))
      if (tier2.length > 0) parts.push(t('inject.characterStateTitleSupporting') + '\n' + tier2.join('\n'))
      return parts.length > 0 ? parts.join('\n\n') : t('inject.characterStateNone')
    } catch { return t('inject.characterStateReadFailed') }
  }

}
