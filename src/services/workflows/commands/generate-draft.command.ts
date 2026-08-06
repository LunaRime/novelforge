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
    let futureBlueprintsStr = '（无后续蓝图）'
    try {
      const { loadDirectoryBlueprints } = await import('../directory-workflow')
      const allBlueprints = await loadDirectoryBlueprints()
      const futureBlueprintsArr = allBlueprints.filter(
        b => b.chapterNumber > this.chapterInfo.chapterNumber && b.chapterNumber <= this.chapterInfo.chapterNumber + 5
      )
      if (futureBlueprintsArr.length > 0) {
        futureBlueprintsStr = futureBlueprintsArr.map(b => `第${b.chapterNumber}章 ${b.title}：${b.keyEvents}`).join('\n')
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
        const results = await ipc.invoke('kb:search', searchQuery, 5)
        filteredContext = results.length > 0
          ? results.map((r: { fileName: string; score: number; text: string }, i: number) => `[${i + 1}] (${r.fileName}, 相关度 ${(r.score * 100).toFixed(0)}%)\n${r.text}`).join('\n\n')
          : '（知识库中无相关内容）'
      } catch {
        filteredContext = '（知识库检索不可用）'
      }

      promptBuilder
        // ---- 缓存命中区续（要点时间线按序追加，前缀对齐）----
        .withGlobalSummary(chapterTimeline)
        .withCharacterStates(characterState)
        // ---- 缓存失效区（逐章变化）----
        .withPreviousEnding(previousEnding || '（无前文）')
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
        .withUserGuidance((this.chapterInfo.userGuidance || '') + '\n\n' + transitionContext)
        .withFilteredContext(filteredContext)
        .withShortSummary('')
        .withUserGuidance(this.chapterInfo.userGuidance?.trim() || '（无微操指导）')
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
          `【未回收伏笔（本章可自然回应 1-2 条，严禁提前全部回收）】\n` +
          pending.map((f, i) => `${i + 1}. [第${f.setChapter}章] ${f.content} (${f.type})`).join('\n'),
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
      if (cold) antiDefectSections.push(`【创意多样性参考（可选，非强制）】\n${cold}`)
    } catch { /* 采样失败不阻断 */ }

    // 4. 偏好记忆注入（用户历史替换对——"偏好 X 而非 Y"，优先使用用户表达）
    try {
      const { getTopPreferences } = await import('../../preferences')
      const prefs = await getTopPreferences(5)
      if (prefs.length > 0) {
        antiDefectSections.push(
          `【用户偏好（来自历史修改记录，优先遵循）】\n` +
          prefs.map(p => `- 用户偏好使用「${p.userText}」而非「${p.aiText}」（记录 ${p.count} 次）`).join('\n') +
          `\n请在表达相同含义时优先使用用户偏好的措辞，避免使用用户不喜欢的「${prefs.map(p => p.aiText).join('」「')}」。`,
        )
      }
    } catch { /* 偏好注入失败不阻断 */ }

    if (antiDefectSections.length > 0) {
      prompt += '\n\n---\n\n' + antiDefectSections.join('\n\n---\n\n')
    }

    // Token 预算管控：中文约 1.5 字符/token，预留 4K 给输出
    const estimatedTokens = Math.ceil(prompt.length / 1.5)
    const TOKEN_BUDGET = 28000
    if (estimatedTokens > TOKEN_BUDGET) {
      callbacks.log(t('log.generateDraft.tokenOverBudget')
        .replace('{estimated}', String(estimatedTokens))
        .replace('{budget}', String(TOKEN_BUDGET)))
    }

    callbacks.log(t('log.generateDraft.calling'))

    // staticContext：架构入 system 前缀（同项目连续调用缓存命中 + 模型遵从度更高）
    // 注意：必须传注入后的 prompt 字符串而非 builder —— callLLMWithBuilder 会重新 build() 丢失防缺陷注入
    const draftText = await this.callLLM(prompt, promptBuilder.getSystemRole(), callbacks, { staticContext: architecture })
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
        name: `第${this.chapterInfo.chapterNumber}章 ${this.chapterInfo.title} v${nextVersion}`,
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
          parts.push(`## 项目专属指导（${f.name.replace(/\.md$/, '')}）\n${result.content.trim()}`)
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
          if (tier === 1) tier1.push(`${card.name}（${card.role || '未知'}）| 状态未更新`)
          continue
        }

        if (tier === 1) {
          // 核心角色：完整档案
          tier1.push(
            `${card.name}（${card.role || '未知'}）| ` +
            `境界：${cs.powerLevel || '未知'} | ` +
            `位置：${cs.location || '未知'} | ` +
            `身体：${cs.physicalState || '正常'} | ` +
            `心理：${cs.mentalState || '正常'} | ` +
            `道具：${cs.keyItems || '无'} | ` +
            `最近：第${cs.updatedAtChapter || 0}章 ${cs.recentEvents || ''}`
          )
        } else if (tier === 2) {
          // 配角：精简摘要
          tier2.push(
            `${card.name}（配角）→ 第${cs.updatedAtChapter || 0}章 | ` +
            `${cs.location || '未知位置'} | ${cs.recentEvents || ''}`
          )
        }
        // tier 3 龙套：不注入，除非蓝图 characters[] 引用
      }

      const parts: string[] = []
      if (tier1.length > 0) parts.push(`【核心角色 — 完整档案】\n${tier1.join('\n')}`)
      if (tier2.length > 0) parts.push(`【重要配角 — 精简状态】\n${tier2.join('\n')}`)
      return parts.length > 0 ? parts.join('\n\n') : '（暂无角色状态档案）'
    } catch { return '（角色状态档案读取失败）' }
  }

}
