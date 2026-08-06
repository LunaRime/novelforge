import { t } from '../../../shared/locale'
import { computeTextStats } from '../../text-stats'
import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { useLLMStore } from '../../../stores/llm-store'
import { getPromptTemplate } from '../../prompt-templates'
import { PostProcessPromptBuilder } from '../../prompts/prompt-builder'
import { ipc } from '../../ipc-client'

import {
  runPostProcessPipeline,
  getChapterFinalizeScope,
  stripThinkingTags,
  type PostProcessStep,
} from '../workflow-utils'
import type { ChapterInfo } from '../chapter-workflow'
import type { StepCallbacks } from '../../../stores/workflow-store'

// LLM 输出占位「无/无变化/None/No changes」等 → 视为无更新（中文模板输出中文，英文模板输出英文）
const NO_CHANGE_VALUES = ['无', '无变化', 'none', 'no change', 'no changes', 'n/a', 'na']

export interface FinalizeChapterParams {
  draftPath: string
  draftContent: string
  chapterNumber: number
  chapterInfo: ChapterInfo
}

// ===== 工具函数：流式调用大模型并返回完整文本 =====

/**
 * 使用 PromptBuilder 调用 LLM（不依赖 BaseWorkflowCommand 实例）
 * 独立函数，可被 PostProcessStep 的 executor 直接调用
 */
async function callLLMForPostProcess(
  builder: { build: () => string; getSystemRole: () => string },
  callbacks: { appendText: (text: string) => void },
  options?: { responseFormat?: { type: string } },
): Promise<string> {
  const llmStore = useLLMStore.getState()
  if (!llmStore.defaultModelId) throw new Error(t('error.noDefaultModel'))

  const modelId = llmStore.defaultModelId
  const model = llmStore.models.find(m => m.id === modelId)
  const startTime = Date.now()

  const logLLMCall = (success: boolean, errorMessage?: string) => {
    const duration = Date.now() - startTime
    ipc.invoke('db:log-llm-call', {
      model_id: modelId,
      model_name: model?.name ?? model?.modelName ?? '',
      purpose: 'post_process',
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      duration_ms: duration,
      success: success ? 1 : 0,
      error_message: errorMessage ?? '',
    }).catch(() => { })
  }

  return new Promise<string>((resolve, reject) => {
    let fullContent = ''
    llmStore.generateStream(
      [
        { role: 'system', content: builder.getSystemRole() },
        { role: 'user', content: builder.build() },
      ],
      {
        onChunk: (chunk) => { fullContent += chunk; callbacks.appendText(chunk) },
        onDone: (text, usage) => {
          if (usage) {
            ipc.invoke('db:log-llm-call', {
              model_id: modelId,
              model_name: model?.name ?? model?.modelName ?? '',
              purpose: 'post_process',
              prompt_tokens: usage.promptTokens,
              completion_tokens: usage.completionTokens,
              total_tokens: usage.totalTokens,
              duration_ms: Date.now() - startTime,
              success: 1,
            }).catch(() => { })
          } else {
            logLLMCall(true)
          }
          const raw = text || fullContent
          resolve(stripThinkingTags(raw))
        },
        onError: (err) => {
          logLLMCall(false, err || t('log.render.llmStreamFailed'))
          reject(new Error(err || t('log.render.llmStreamFailed')))
        },
      },
      undefined,
      options,
    )
  })
}


// ===== 后处理步骤构建器 =====

/**
 * 构建章节定稿后处理步骤列表
 *
 * 每个步骤都是独立的 PostProcessStep，由 runPostProcessPipeline
 * 统一调度执行、持久化状态、支持单步重试。
 * 导出供 createRepairFinalizeWorkflow 复用。
 *
 * @param project       当前项目信息
 * @param chapterNumber 章节号
 * @param chapterTitle  章节标题
 * @param draftContent  定稿正文内容
 */
export function buildFinalizePostProcessSteps(
  _project: { path: string },
  chapterNumber: number,
  chapterTitle: string,
  draftContent: string,
): PostProcessStep[] {
  const steps: PostProcessStep[] = []

  // ─── 步骤 1: 导入知识库（无依赖，可独立执行）─────────────────────
  steps.push({
    key: 'kb_import',
    label: t('workflow.importKB'),
    critical: true,
    dependsOn: [],
    executor: async (callbacks) => {
      const contentFileName = chapterTitle
        ? `第${chapterNumber}章 ${chapterTitle}.txt`
        : `chapter_${chapterNumber}.txt`
      const result = await ipc.invoke('kb:import-text', draftContent, contentFileName, _project.path) as { success: boolean; error?: string; chunkCount?: number }
      if (result.success) {
        callbacks.log(t('log.finalize.kbImported').replace('{count}', String(result.chunkCount)))
      } else {
        throw new Error(t('error.kbImportFailed').replace('{error}', String(result.error)))
      }
    },
  })

  // ─── 步骤 2: 本章剧情要点提取 ─────────────────────────────────────
  const notesTemplate = getPromptTemplate('generate_chapter_notes')
  if (notesTemplate) {
    steps.push({
      key: 'chapter_notes',
      label: t('workflow.chapterKeyPoints'),
      critical: true,
      dependsOn: ['kb_import'],
      executor: async (callbacks) => {
        const notesBuilder = new PostProcessPromptBuilder(notesTemplate)
          .withChapterContent(draftContent)
          .withChapterNumber(chapterNumber)
          .withChapterTitle(chapterTitle)

        const cleanNotes = await callLLMForPostProcess(notesBuilder, callbacks)

        // 写入蓝图 JSON 的 notes 字段
        await ipc.invoke('db:blueprint-update-notes', chapterNumber, cleanNotes)
        callbacks.log(t('log.finalize.notesDone'))
      },
    })
  }

  // ─── 步骤 3: 角色状态更新 ────────────────────────────────────────
  const cardTemplate = getPromptTemplate('update_character_cards')
  if (cardTemplate) {
    steps.push({
      key: 'character_cards',
      label: t('workflow.characterStateUpdate'),
      critical: false,
      dependsOn: ['kb_import'],  // 仅依赖 KB 导入完成，可与 chapter_notes 并行
      executor: async (callbacks) => {
        // 读取现有角色卡
        const allChars = (await ipc.invoke('db:character-get-all')) as unknown as Array<Record<string, unknown>>
        const simpleCards = allChars.map((c) => ({ name: c.name, role: c.role }))

        const cardBuilder = new PostProcessPromptBuilder(cardTemplate)
          .withChapterContent(draftContent.slice(0, 5000))
          .withChapterNumber(chapterNumber)
          .withExistingCardsJson(simpleCards)

        const cardsResult = await callLLMForPostProcess(cardBuilder, callbacks)

        // 解析 Markdown 表格格式的角色状态更新（比 JSON 更稳定）
        const { parseMarkdownTable, robustParseJSON } = await import('../workflow-utils')
        const updSections = cardsResult.split(/###\s*(UPDATES|NEW)/i)
        let updateRows: Array<Record<string, string>> = []
        let newRows: Array<Record<string, string>> = []

        for (let si = 0; si < updSections.length; si++) {
          const label = updSections[si]?.trim().toUpperCase()
          const content = updSections[si + 1] || ''
          if (label === 'UPDATES') {
            updateRows = parseMarkdownTable(content) || []
          } else if (label === 'NEW') {
            newRows = parseMarkdownTable(content) || []
          }
        }
        // 如果没有分段，尝试整体解析——按角色名是否已存在分类：
        //   历史事故：唯一一张 NEW 表被整体当 UPDATES → allChars.find 找不到 → continue
        //   静默跳过，新角色全部丢失。回退时按存在性分流，不存在的名字进 newRows。
        if (updateRows.length === 0 && newRows.length === 0) {
          const fallbackRows = parseMarkdownTable(cardsResult) || []
          const existingNames = new Set(allChars.map(c => c.name))
          updateRows = fallbackRows.filter(r => existingNames.has(r.name || ''))
          newRows = fallbackRows.filter(r => !existingNames.has(r.name || '') && (r.name || ''))
        }

        // L2: JSON 回退（字段映射与 Markdown 表格一致：currentState + tags/motivation + NEW 详情）
        if (updateRows.length === 0 && newRows.length === 0) {
          const jsonParsed = robustParseJSON(cardsResult, false)
          if (jsonParsed && typeof jsonParsed === 'object') {
            const obj = jsonParsed as Record<string, unknown>
            const jUpdates = (Array.isArray(obj.updates) ? obj.updates : []) as Array<Record<string, unknown>>
            const jNewChars = (Array.isArray(obj.newCharacters) ? obj.newCharacters : []) as Array<Record<string, unknown>>
            const jChars = (Array.isArray(obj.characters) ? obj.characters : []) as Array<Record<string, unknown>>
            const src = jUpdates.length > 0 ? jUpdates : jChars
            const mapState = (c: Record<string, unknown>) => {
              const st = (c.currentState as Record<string, unknown> | undefined) ?? {}
              return {
                name: String(c.name || ''),
                location: String(st.location || c.location || ''),
                powerLevel: String(st.powerLevel || c.powerLevel || ''),
                physicalState: String(st.physicalState || c.physicalState || ''),
                mentalState: String(st.mentalState || c.mentalState || ''),
                keyItems: String(st.keyItems || c.keyItems || ''),
                recentEvents: String(st.recentEvents || c.recentEvents || ''),
                tags: typeof c.tags === 'string' ? c.tags : (Array.isArray(c.tags) ? (c.tags as unknown[]).join('、') : ''),
                motivation: String(c.motivation || ''),
                appearance: String(c.appearance || ''),
                personality: String(c.personality || ''),
              }
            }
            if (src.length > 0) {
              updateRows = src.map(mapState)
            }
            if (jNewChars.length > 0) {
              newRows = jNewChars.map(mapState)
            }
            if (updateRows.length > 0 || newRows.length > 0) {
              callbacks.log(t('log.finalize.charStateJsonFallback'))
            }
          }
        }

        // L1 + L2 均失败：记录可诊断日志（步骤以成功完成，但 0 更新——用户/开发者有线索）
        if (updateRows.length === 0 && newRows.length === 0) {
          callbacks.log(t('log.finalize.charStateParseFailed'))
        }

        // LLM 输出归一化：tags → JSON 数组字符串（角色列表按 JSON.parse 消费）
        const normalizeTags = (value: string): string => {
          const tags = String(value ?? '')
            .split(/[，,、；;]+/)
            .map(s => s.trim())
            .filter(Boolean)
          return tags.length > 0 ? JSON.stringify(tags.slice(0, 8)) : ''
        }
        // LLM 占位"无/无变化/None/No changes" → null（不覆盖已有值）
        const cleanOptional = (value: string): string | null => {
          const s = String(value ?? '').trim()
          if (!s || NO_CHANGE_VALUES.includes(s.toLowerCase())) return null
          return s
        }
        const cleanText = (value: string): string => {
          const s = String(value ?? '').trim()
          return (!s || NO_CHANGE_VALUES.includes(s.toLowerCase())) ? '' : s
        }

        if (updateRows.length > 0) {
          for (const row of updateRows) {
            const name = row.name || ''
            if (!name) continue
            const dbChar = allChars.find((c) => c.name === name)
            if (dbChar) {
              const dbCharState = (dbChar.currentState as Record<string, unknown>) || {}
              const newState = {
                location: row.location || (dbCharState.location as string) || '',
                powerLevel: row.powerLevel || (dbCharState.powerLevel as string) || '',
                physicalState: row.physicalState || (dbCharState.physicalState as string) || '',
                mentalState: row.mentalState || (dbCharState.mentalState as string) || '',
                keyItems: row.keyItems || (dbCharState.keyItems as string) || '',
                // COALESCE 与其余字段一致：LLM 该行为空时保留旧值（此前会清空已有 recentEvents）
                recentEvents: row.recentEvents || (dbCharState.recentEvents as string) || '',
                updatedAtChapter: chapterNumber,
              }
              // 标签/核心动机：有更新才覆盖（COALESCE），LLM 输出"无"保留旧值
              await ipc.invoke('db:character-update-state', name, newState, {
                tags: normalizeTags(row.tags ?? '') || null,
                motivation: cleanOptional(row.motivation ?? ''),
              })
              callbacks.log(t('log.finalize.charStateUpdated').replace('{name}', name))
            }
          }
        }

        if (newRows.length > 0) {
          let newCharCount = 0
          for (const row of newRows) {
            const name = row.name || ''
            if (!name || allChars.some((c) => c.name === name)) continue
            newCharCount++
            await ipc.invoke('db:character-upsert', {
              name: name,
              role: row.role || 'supporting',
              gender: '', age: '',
              appearance: cleanText(row.appearance ?? ''),
              personality: cleanText(row.personality ?? ''),
              background: '', abilities: '',
              motivation: cleanOptional(row.motivation ?? '') ?? '',
              relationships: '', arc: '', notes: '',
              tier: 2,
              tags: normalizeTags(row.tags ?? ''),
              appearChapters: JSON.stringify([chapterNumber]), // 登记出场章节
              relations: '[]',
              currentState: {
                location: row.location || '',
                powerLevel: row.powerLevel || '',
                physicalState: row.physicalState || '',
                mentalState: row.mentalState || '',
                keyItems: row.keyItems || '',
                recentEvents: row.recentEvents || '',
                updatedAtChapter: chapterNumber,
              }
            })
          }
          if (newCharCount > 0) {
            callbacks.log(t('log.finalize.newChars').replace('{count}', String(newCharCount)))
          }
        }
      },
    })
  }

  // ─── 步骤 3.8: 关系自动检测 ────────────────────────────────────────
  steps.push({
    key: 'relation_detect',
    label: t('workflow.relationDetect'),
    critical: false,
    dependsOn: ['character_cards'],
    executor: async (callbacks: StepCallbacks) => {
      callbacks.log(t('log.finalize.detectingRelations'))
      try {
        const allChars = await ipc.invoke('db:character-get-all') as Array<{
          name: string; relations: string; appearChapters: string
        }>
        let detected = 0

        for (const char of allChars) {
          if (!char.name) continue
          let rels: Array<{ target: string; type: string; label: string; sinceChapter: number }> = []
          try { rels = JSON.parse(char.relations || '[]') } catch { rels = [] }

          // 更新出场章节
          let chaps: number[] = []
          try { chaps = JSON.parse(char.appearChapters || '[]') } catch { chaps = [] }
          if (!chaps.includes(chapterNumber)) {
            chaps.push(chapterNumber)
            chaps.sort((a: number, b: number) => a - b)
          }

          // 检测新关系：在正文中查找 "角色名：关系描述" 或 "与XXX的关系"
          for (const other of allChars) {
            if (other.name === char.name) continue
            const alreadyRelated = rels.some(r => r.target === other.name)
            if (alreadyRelated) continue

            // Simple heuristic: check if both names appear near each other in the text
            const idxA = draftContent.indexOf(char.name)
            const idxB = draftContent.indexOf(other.name)
            if (idxA >= 0 && idxB >= 0 && Math.abs(idxA - idxB) < 500) {
              // Both characters appear in the same vicinity → potential interaction
              rels.push({
                target: other.name,
                type: 'other',
                label: t('workflow.chapterInteraction').replace('{n}', String(chapterNumber)),
                sinceChapter: chapterNumber,
              })
              detected++
            }
          }

          if (detected > 0 || chaps.includes(chapterNumber)) {
            const c = char as Record<string, unknown>
            await ipc.invoke('db:character-upsert', {
              name: c.name as string,
              role: String(c.role || 'supporting'),
              gender: '', age: '', appearance: '', personality: '', background: '',
              abilities: '', motivation: '', relationships: String(c.relationships || ''),
              arc: '', notes: '',
              tier: Number(c.tier ?? 2),
              tags: String(c.tags || ''),
              appearChapters: JSON.stringify(chaps),
              relations: JSON.stringify(rels),
            })
          }
        }
        if (detected > 0) callbacks.log(t('log.finalize.relationsDetected').replace('{count}', String(detected)))
        else callbacks.log(t('log.finalize.noRelations'))
      } catch (e) {
        callbacks.log(t('log.finalize.relationDetectFailed').replace('{error}', () => String(e)))
      }
    },
  })

  // ─── 步骤 4: 文风自动学习（每5章触发一次）─────────────────────────
  if (chapterNumber % 5 === 0) {
    steps.push({
      key: 'style_analysis',
      label: t('workflow.styleLearning'),
      critical: false,
      dependsOn: ['kb_import'],
      executor: async (callbacks) => {
        callbacks.log(t('log.finalize.styleLearning'))
        const { AnalyzeWritingStyleCommand } = await import('./analyze-style.command')
        await new AnalyzeWritingStyleCommand().execute({
          step: { id: '', name: '', description: '', status: 'pending' as const, logs: [] },
          context: { data: {}, cancelled: false },
          callbacks,
        })
        callbacks.log(t('log.finalize.styleDone'))
      },
    })
  }

  // 步骤 3.2: 伏笔扫描
  const voiceIdx = steps.length - (chapterNumber % 5 === 0 ? 2 : 1)
  steps.splice(voiceIdx, 0, {
    key: 'foreshadowing_scan',
    label: t('workflow.foreshadowScan'),
    critical: false,
    dependsOn: ['kb_import'],
    executor: async (callbacks: StepCallbacks) => {
      try {
        const { scanNewForeshadowing, detectResolvedForeshadowing, loadAllForeshadowing, saveForeshadowing } = await import('../../foreshadowing-manager')
        const all = await loadAllForeshadowing()
        const news = scanNewForeshadowing(draftContent, chapterNumber)
        const done = detectResolvedForeshadowing(draftContent, all, chapterNumber)
        const merged = [...all.filter(i => !done.some(d => d.id === i.id)), ...news]
        await saveForeshadowing(merged)
        if (news.length) callbacks.log(t('log.finalize.foreshadow').replace('{added}', String(news.length)).replace('{resolved}', String(done.length)))
      } catch (e) { callbacks.log(t('log.finalize.foreshadowFailed').replace('{error}', () => String(e))) }
    },
  })

  // ─── 步骤 5: 正文质量审计（重复词/衔接/术语/蓝图完成度/违禁词/时间线）──
  // 全部非关键：审计发现问题不影响定稿，日志提示可触发修稿
  steps.push({
    key: 'content_audit',
    label: t('workflow.contentAudit'),
    critical: false,
    dependsOn: ['kb_import'],
    executor: async (callbacks: StepCallbacks) => {
      // ===== 审计上下文（跨章基线/细纲锚点/豁免词/白名单）——与终审自省共用收集 =====
      const { collectAuditContext, auditText } = await import('../../audit/audit-context')
      const ctx = await collectAuditContext(chapterNumber)
      const result = auditText(ctx, draftContent)

      if (result.passed) {
        callbacks.log(`✅ ${result.summary}`)
      } else {
        for (const issue of result.issues) {
          callbacks.log(`⚠️ [${issue.kind}] ${issue.message}`)
        }
        callbacks.log(t('log.finalize.auditSummary').replace('{summary}', result.summary))
      }
    },
  })

  // 步骤 3.5: 角色声音分析
  steps.splice(voiceIdx + 1, 0, {
    key: 'voice_analysis',
    label: t('workflow.voiceAnalysis'),
    critical: false,
    dependsOn: ['kb_import'],
    executor: async (callbacks: StepCallbacks) => {
      callbacks.log(t('log.finalize.analyzingVoice'))
      try {
        const { analyzeCharacterVoice, upsertVoiceProfile } = await import('../../character-voice-analyzer')
        const characters = await ipc.invoke('db:character-get-all') as Array<{ name: string; notes?: string }>
        let analyzed = 0
        for (const char of characters) {
          if (!char.name) continue
          try {
            // 获取角色的完整数据，防止覆写
            // 从已有字符数据构造完整字段，仅更新 notes，防止覆写其他字段
            const existing = char as Record<string, string | number | undefined>
            const profile = analyzeCharacterVoice(draftContent, char.name)
            if (profile.topWords.length > 0) {
              // upsert：剥离旧 VOICE 块 → 合并新旧档案 → 单块写回（防止 notes 膨胀 + 读端取到旧档案）
              const updatedNotes = upsertVoiceProfile((existing.notes as string) || '', profile)
              await ipc.invoke('db:character-upsert', {
                name: existing.name as string,
                role: (existing.role as string) || 'supporting',
                gender: (existing.gender as string) || '',
                age: (existing.age as string) || '',
                appearance: (existing.appearance as string) || '',
                personality: (existing.personality as string) || '',
                background: (existing.background as string) || '',
                abilities: (existing.abilities as string) || '',
                motivation: (existing.motivation as string) || '',
                relationships: (existing.relationships as string) || '',
                arc: (existing.arc as string) || '',
                notes: updatedNotes,
              } as never)
              analyzed++
            }
          } catch { /* skip */ }
        }
        callbacks.log(t('log.finalize.voiceDone').replace('{done}', String(analyzed)).replace('{total}', String(characters.length)))
      } catch (e) {
        callbacks.log(t('log.finalize.voiceFailed').replace('{error}', () => String(e)))
      }
    },
  })

  return steps
}

// ===== 定稿命令 =====

export class FinalizeChapterCommand extends BaseWorkflowCommand<void> {
  constructor(private params: FinalizeChapterParams) {
    super()
  }

  async execute({ callbacks }: CommandExecuteParams): Promise<void> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(t('error.noProject'))

    const refinedDraftText = this.params.draftContent
    if (!refinedDraftText) throw new Error(t('error.noFinalizedContent'))

    callbacks.log(t('log.finalize.start'))

    // 1. 获取对应草稿并将库内状态变更为 finalized（同时同步定稿期可能微调过的正文）
    const { parseDraftMeta } = await import('../chapter-workflow')
    const dbDraft = await parseDraftMeta(this.params.draftPath)
    if (!dbDraft) throw new Error(t('error.draftStateFlow'))

    // wordCount 用统一"有效字数"口径（汉字 + 英文单词）
    const novelWordCount = computeTextStats(refinedDraftText).novelWordCount
    await ipc.invoke('db:draft-update-content', dbDraft.id, refinedDraftText, novelWordCount)
    await ipc.invoke('db:draft-update-status', dbDraft.id, 'finalized', novelWordCount)

    // 【重要】：除了写入 DB，对于已定稿的章节需要实体化为物理文件放在根目录，供外部系统读取或备份
    const safeTitle = this.params.chapterInfo.title ? ` ${this.params.chapterInfo.title.replace(/[/\\]/g, '_')}` : ''
    const physicalPath = `${project.path}/${t('inject.chapterFileName')
      .replace('{chapter}', String(this.params.chapterNumber))
      .replace('{title}', () => safeTitle)}`
    try {
      const titleLine = this.params.chapterInfo.title
        ? t('inject.chapterTitleLineWithTitle')
          .replace('{chapter}', String(this.params.chapterNumber))
          .replace('{title}', () => this.params.chapterInfo.title)
        : t('inject.chapterTitleLineNoTitle').replace('{chapter}', String(this.params.chapterNumber))
      const contentToWrite = titleLine + refinedDraftText.replace(/^#+ .*\n*/, '')
      await ipc.invoke('fs:write-file', physicalPath, contentToWrite)
    } catch (e) {
      callbacks.log(t('log.finalize.fileWriteFailed').replace('{error}', () => String(e)))
    }

    callbacks.log(t('log.finalize.written')
      .replace('{chapter}', String(this.params.chapterNumber))
      .replace('{title}', safeTitle))

    // 3. 通过 PostProcessPipeline 执行后处理（状态持久化 + 支持重试）
    callbacks.log(t('log.finalize.startingPostProcess'))

    const scope = getChapterFinalizeScope(this.params.chapterNumber)
    const sourceLabel = t('inject.finalize.sourceLabel').replace('{chapter}', String(this.params.chapterNumber))
    const steps = buildFinalizePostProcessSteps(
      project,
      this.params.chapterNumber,
      this.params.chapterInfo.title,
      refinedDraftText,
    )

    await runPostProcessPipeline(project.path, scope, sourceLabel, steps, callbacks)

    callbacks.log(t('log.finalize.allDone').replace('{chapter}', String(this.params.chapterNumber)))
    useProjectStore.getState().refreshFileTree()

    // 通过 EventBus 通知 ProjectService 执行定稿后的统一刷新
    const { globalEventBus } = await import('../../../shared/event-bus')
    globalEventBus.emit('FINALIZE_COMPLETE', { chapterNumber: this.params.chapterNumber })
  }
}