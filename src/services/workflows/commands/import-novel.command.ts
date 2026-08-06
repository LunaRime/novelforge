/**
 * 导入小说 — Command 集合
 *
 * 三个独立 Command 组成逆向推演全链路：
 * 1. ImportInitializeCommand — 写入正文 + 构建知识库
 * 2. InferGlobalSettingsCommand — 向量采样 + AI 推演全局配置/架构/角色
 * 3. InferBlueprintsPerChapterCommand — 按章逐一推演精准蓝图 + 蓝图入向量库 + 拼装轻量全局摘要
 */

import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { t } from '../../../shared/locale'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { ImportPromptBuilder } from '../../prompts/prompt-builder'
import { ipc } from '../../ipc-client'
import type { CharacterData } from '../../../../electron/repositories/character-repository'

/** 拆分后的章节数据（从 context.data 中传递） */
export interface ImportedChapter {
  number: number
  title: string
  content: string
  wordCount: number
}

// =================================================================
// 1. 初始化：写入正文 + 构建知识库
// =================================================================

export class ImportInitializeCommand extends BaseWorkflowCommand<void> {
  /** 本次导入的幂等会话 ID */
  private importSessionId: string

  constructor(private chapters: ImportedChapter[]) {
    super()
    this.importSessionId = crypto.randomUUID?.() ?? `import_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  }

  async execute({ context, callbacks }: CommandExecuteParams): Promise<void> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(t('error.noProject'))

    callbacks.log(t('log.import.starting').replace('{count}', String(this.chapters.length)))
    callbacks.log(t('log.import.sessionId').replace('{id}', this.importSessionId))
    callbacks.setProgress(5)

    // 获取已存在的章节号（幂等检测）
    const existingChapters = await ipc.invoke('db:draft-get-all-chapter-numbers') as number[]
    const existingSet = new Set(existingChapters)

    // 1. 批量创建草稿并标记为 finalized（幂等保护）
    let skippedCount = 0
    for (let i = 0; i < this.chapters.length; i++) {
      const ch = this.chapters[i]

      // 幂等检测：如果该章节已有定稿（source='write'），跳过
      if (existingSet.has(ch.number)) {
        const latestDraft = await ipc.invoke('db:draft-get-latest', ch.number) as { source?: string } | null
        if (latestDraft?.source === 'write') {
          skippedCount++
          if (skippedCount <= 3) {
            callbacks.log(t('log.import.skipped').replace('{chapter}', String(ch.number)))
          }
          continue
        }
      }

      // 直接调用 DB 写库（来源设为 write）
      await ipc.invoke('db:draft-create', {
        chapterNumber: ch.number,
        version: 1,
        content: ch.content,
        wordCount: ch.wordCount,
        source: 'write'
      })

      if (i % 10 === 0) {
        callbacks.setProgress(5 + Math.round((i / this.chapters.length) * 40))
        callbacks.log(t('log.import.imported')
          .replace('{chapter}', String(ch.number))
          .replace('{words}', String(ch.wordCount)))
      }
    }

    const importedCount = this.chapters.length - skippedCount
    callbacks.log(t('log.import.allDone').replace('{count}', String(importedCount))
      + (skippedCount > 0 ? t('log.import.skippedSuffix').replace('{count}', String(skippedCount)) : ''))
    callbacks.setProgress(45)

    // 2. 逐章导入知识库（向量化）
    callbacks.log(t('log.import.buildingKB'))
    let successCount = 0
    let failCount = 0
    for (let i = 0; i < this.chapters.length; i++) {
      const ch = this.chapters[i]
      try {
        const fileName = ch.title
          ? `第${ch.number}章 ${ch.title}.txt`
          : `chapter_${ch.number}.txt`
        const result = await ipc.invoke('kb:import-text', ch.content, fileName, project.path) as { success: boolean; error?: string }
        if (result.success) {
          successCount++
        } else {
          callbacks.log(t('log.import.kbImportFailed')
            .replace('{file}', fileName)
            .replace('{error}', () => result.error ?? ''))
          failCount++
        }
      } catch {
        failCount++
      }
      if (i % 10 === 0) {
        callbacks.setProgress(45 + Math.round((i / this.chapters.length) * 45))
      }
    }
    callbacks.log(t('log.import.kbDone')
      .replace('{ok}', String(successCount))
      .replace('{fail}', String(failCount)))
    callbacks.setProgress(90)

    // 将章节数据 + 导入会话 ID 存入 context 供后续步骤使用
    context.data.chapters = this.chapters
    context.data.totalChapters = this.chapters.length
    context.data.importSessionId = this.importSessionId

    // 刷新文件树
    useProjectStore.getState().refreshFileTree()
  }
}

// =================================================================
// 2. 向量采样 + AI 推演全局配置/架构/角色
// =================================================================

export class InferGlobalSettingsCommand extends BaseWorkflowCommand<void> {
  async execute({ context, callbacks }: CommandExecuteParams): Promise<void> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(t('error.noProject'))

    const chapters = context.data.chapters as ImportedChapter[]
    if (!chapters || chapters.length === 0) throw new Error(t('error.noChapters'))

    callbacks.log(t('log.import.searching'))
    callbacks.setProgress(5)

    // ===== 向量检索采样 =====
    // 注：query 为检索词，需与小说正文语言一致（知识库内容不随界面语言变化），仅 label 本地化
    const searchTopics = [
      { key: 'worldview', query: '世界观 力量体系 修炼等级 境界', label: t('inject.import.topicWorldview') },
      { key: 'protagonist', query: '主角 金手指 核心能力 天赋 系统', label: t('inject.import.topicProtagonist') },
      { key: 'conflict', query: '敌人 反派 阴谋 危机 矛盾 对手', label: t('inject.import.topicConflict') },
      { key: 'style', query: '视角 叙述 描写 风格 节奏', label: t('inject.import.topicStyle') },
    ]

    const sampledContent: Record<string, string> = {}
    for (const topic of searchTopics) {
      try {
        const results = await ipc.invoke('kb:search', topic.query, 5)
        if (results.length > 0) {
          sampledContent[topic.key] = results
            .map((r: { text: string; score: number; fileName: string }, i: number) =>
              t('inject.kbSnippetLine')
                .replace('{index}', String(i + 1))
                .replace('{file}', () => r.fileName)
                .replace('{score}', String((r.score * 100).toFixed(0)))
                .replace('{text}', () => r.text)
            ).join('\n\n')
        } else {
          sampledContent[topic.key] = t('inject.import.noSearchResults')
        }
        callbacks.log(t('log.import.topicFound')
          .replace('{topic}', topic.label)
          .replace('{count}', String(results.length)))
      } catch {
        sampledContent[topic.key] = t('inject.vectorSearchUnavailable')
        callbacks.log(t('log.import.topicFailed').replace('{topic}', topic.label))
      }
    }
    callbacks.setProgress(20)

    // ===== 构建 Prompt =====
    // 优先使用向量增强版 Prompt
    const template = getPromptTemplate('infer_novel_config_with_vectors')
      || getPromptTemplate('infer_novel_config')
    if (!template) throw new Error(t('error.templateNotFound').replace('{name}', t('inject.import.templateNameInferConfig')))

    const firstChapter = chapters[0]?.content?.slice(0, 3000) || t('inject.import.noFirstChapter')
    const latestChapter = chapters[chapters.length - 1]?.content?.slice(0, 3000) || t('inject.import.noLatestChapter')

    const prompt = new ImportPromptBuilder(template)
      .withSampledWorldview(sampledContent.worldview || '')
      .withSampledProtagonist(sampledContent.protagonist || '')
      .withSampledConflict(sampledContent.conflict || '')
      .withSampledStyle(sampledContent.style || '')
      .withFirstChapter(firstChapter)
      .withLatestChapter(latestChapter)
      .withTotalChapters(chapters.length)
      // 兼容旧版 Prompt 的 sample_content 变量
      .withSampleContent(t('inject.import.sampleContent')
        .replace('{first}', () => firstChapter)
        .replace('{latest}', () => latestChapter))
      .build()

    callbacks.log(t('log.import.inferringConfig'))
    callbacks.setProgress(25)

    const rawResult = await this.callLLM(
      prompt,
      template.systemRole || t('role.editorAnalyst'),
      callbacks,
      { responseFormat: { type: 'json_object' }, purpose: 'extract_json' }
    )

    callbacks.setProgress(70)
    callbacks.log(t('log.import.parsing'))

    // ===== 解析 JSON 结果 =====
    const inferResult = this.parseJSON<{
      novelConfig: Record<string, string>
      architectureFiles: Record<string, string>
      characterCards: Array<Record<string, unknown>>
    }>(rawResult)

    // ===== 写入小说配置 =====
    if (inferResult.novelConfig) {
      const novelConfig = {
        ...project.novelConfig,
        ...inferResult.novelConfig,
        totalChapters: chapters.length,
        wordsPerChapter: Math.round(chapters.reduce((s, c) => s + c.wordCount, 0) / chapters.length),
      }
      // 更新内存
      useProjectStore.getState().updateNovelConfig(novelConfig)
      // 持久化到 config 文件
      const updatedProject = useProjectStore.getState().currentProject
      if (updatedProject) {
        // 仅提取 ProjectData 字段，防止 structured clone 序列化异常
        const plainData = {
          id: updatedProject.id,
          name: updatedProject.name,
          path: updatedProject.path,
          novelConfig: { ...updatedProject.novelConfig },
          characterStates: updatedProject.characterStates,
          createdAt: updatedProject.createdAt,
          updatedAt: updatedProject.updatedAt,
        }
        await ipc.invoke('project:save', plainData.id, plainData)
      }
      callbacks.log(t('log.import.configUpdated'))

      // 生成配置摘要供后续步骤使用
      context.data.novelConfigSummary = t('import.summaryLine')
        .replace('{genre}', novelConfig.genre || t('common.unknownWord'))
        .replace('{subGenre}', novelConfig.subGenre || t('common.unknownWord'))
        .replace('{audience}', novelConfig.targetAudience || t('common.unknownWord'))
        .replace('{outline}', novelConfig.coreOutline || t('common.nonePlaceholder'))
        .replace('{world}', novelConfig.worldSetting || t('common.nonePlaceholder'))
        .replace('{goldenFinger}', novelConfig.goldenFinger || t('common.nonePlaceholder'))
        .replace('{protagonist}', novelConfig.protagonistProfile || t('common.nonePlaceholder'))
    }

    // ===== 写入架构信息（标题前缀与生成路径格式统一，消费方按 key 读取不受影响） =====
    if (inferResult.architectureFiles) {
      const title = (name: string, content: string) => content.startsWith(`# ${name}`) ? content : `# ${name}\n\n${content}\n`
      await ipc.invoke('db:project-core-update', {
        premise: title(t('arch.storyPremise'), inferResult.architectureFiles.premise),
        charactersArch: title(t('arch.characterMap'), inferResult.architectureFiles.characters),
        worldbuilding: title(t('arch.worldBuilding'), inferResult.architectureFiles.world),
        synopsis: title(t('arch.plotOutline'), inferResult.architectureFiles.synopsis),
      })
      callbacks.log(t('log.import.archSaved'))
    }

    // ===== 写入角色卡 =====
    if (inferResult.characterCards && Array.isArray(inferResult.characterCards)) {
      let createdCount = 0
      const cardsToSave: CharacterData[] = []
      for (const card of inferResult.characterCards) {
        if (!card.name) continue
        const validRoles = ['protagonist', 'antagonist', 'supporting', 'minor']
        const role = validRoles.includes(card.role as string) ? card.role : 'supporting'
        cardsToSave.push({
          name: card.name as string,
          role: role as 'protagonist' | 'antagonist' | 'supporting' | 'minor',
          gender: (card.gender as string) || '',
          age: (card.age as string) || '',
          appearance: (card.appearance as string) || '',
          personality: (card.personality as string) || '',
          background: (card.background as string) || '',
          abilities: (card.abilities as string) || '',
          motivation: (card.motivation as string) || '',
          relationships: (card.relationships as string) || '',
          arc: (card.arc as string) || '',
          notes: (card.notes as string) || '',
          // tier 按 role 推导（P2 修复：此前恒 2）；tags/appearChapters/currentState 从 LLM 输出回填
          // （此前恒 ''/'[]'/缺失 → 对已有项目重跑导入会抹掉 v7 元数据与动态状态）
          tier: role === 'protagonist' || role === 'antagonist' ? 1 : (role === 'minor' ? 3 : 2),
          tags: (card.tags as string) || '',
          appearChapters: (card.appearChapters as string) || '[]',
          relations: '[]',
          ...(card.currentState && typeof card.currentState === 'object'
            ? (() => {
                const st = card.currentState as Record<string, unknown>
                return {
                  currentState: {
                    location: String(st.location ?? ''),
                    powerLevel: String(st.powerLevel ?? ''),
                    physicalState: String(st.physicalState ?? ''),
                    mentalState: String(st.mentalState ?? ''),
                    keyItems: String(st.keyItems ?? ''),
                    recentEvents: String(st.recentEvents ?? ''),
                    updatedAtChapter: Number(st.updatedAtChapter ?? 0) || 0,
                  },
                }
              })()
            : {}),
        })
        createdCount++
      }
      if (cardsToSave.length > 0) {
        await ipc.invoke('db:character-save-all', cardsToSave)
      }
      callbacks.log(t('log.import.cardsCreated').replace('{count}', String(createdCount)))
    }

    callbacks.setProgress(90)
    this.notifyRefresh(['fileTree', 'characterCards'])
  }
}


// =================================================================
// 3. 按章逐一推演精准蓝图（限流并发）
// =================================================================

export class InferBlueprintsPerChapterCommand extends BaseWorkflowCommand<void> {
  /** 最大并发数，防止触发模型提供商 Rate Limit */
  private static readonly CONCURRENCY_LIMIT = 3

  async execute({ context, callbacks }: CommandExecuteParams): Promise<void> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(t('error.noProject'))

    const chapters = context.data.chapters as ImportedChapter[]
    const configSummary = (context.data.novelConfigSummary as string) || t('inject.import.configSummaryUnavailable')
    if (!chapters || chapters.length === 0) throw new Error(t('error.noChapters'))

    const template = getPromptTemplate('infer_single_chapter_blueprint')
    if (!template) throw new Error(t('error.templateNotFound').replace('{name}', t('inject.import.templateNameInferBlueprint')))

    callbacks.log(t('log.import.inferringBlueprints')
      .replace('{count}', String(chapters.length))
      .replace('{limit}', String(InferBlueprintsPerChapterCommand.CONCURRENCY_LIMIT)))
    callbacks.setProgress(5)

    let completedCount = 0
    let failedCount = 0

    // 限流并发执行器
    const runWithConcurrency = async (tasks: (() => Promise<void>)[], limit: number) => {
      const executing = new Set<Promise<void>>()
      for (const task of tasks) {
        const p = task().then(() => { executing.delete(p) })
        executing.add(p)
        if (executing.size >= limit) {
          await Promise.race(executing)
        }
      }
      await Promise.all(executing)
    }

    const tasks = chapters.map((ch) => async () => {
      try {
        const prompt = new ImportPromptBuilder(template)
          .withChapterContent(ch.content.slice(0, 6000)) // 限制单章 Prompt 长度
          .withChapterNumber(ch.number)
          .withChapterTitle(ch.title)
          .withNovelConfigSummary(configSummary)
          .build()

        const rawResult = await this.callLLM(
          prompt,
          template.systemRole || t('role.novelAnalyst'),
          callbacks,
          { responseFormat: { type: 'json_object' } }
        )

        const blueprint = this.parseJSON<Record<string, unknown>>(rawResult)

        // 确保必要字段
        const finalBlueprint = {
          chapterNumber: ch.number,
          title: (blueprint.title as string) || ch.title,
          role: (blueprint.role as string) || '发展',
          purpose: (blueprint.purpose as string) || '',
          keyEvents: (blueprint.keyEvents as string) || '',
          // 角色列表：数组直用；字符串按分隔符拆（与 directory 路径消费一致——此前字符串
          // 角色列表被静默置空丢失，同一 LLM 输出两种消费行为，P3 修复）
          characters: Array.isArray(blueprint.characters)
            ? blueprint.characters as string[]
            : (typeof blueprint.characters === 'string' && blueprint.characters.trim()
                ? blueprint.characters.split(/[,，、;；]+/).map(s => s.trim()).filter(Boolean)
                : []),
          suspenseHook: (blueprint.suspenseHook as string) || '',
          userGuidance: '',
          notes: '',
          notesUpdatedAt: '',
          sortOrder: ch.number,
          priority: 0,
        }

        await ipc.invoke('db:blueprint-upsert', finalBlueprint)

        completedCount++
        callbacks.log(t('log.import.blueprintDone').replace('{chapter}', String(ch.number)))
      } catch (err) {
        failedCount++
        callbacks.log(t('log.import.blueprintFailed')
          .replace('{chapter}', String(ch.number))
          .replace('{error}', () => err instanceof Error ? err.message : String(err)))
      }

      // 更新进度
      const total = chapters.length
      const done = completedCount + failedCount
      callbacks.setProgress(5 + Math.round((done / total) * 90))
    })

    await runWithConcurrency(tasks, InferBlueprintsPerChapterCommand.CONCURRENCY_LIMIT)

    callbacks.log(t('log.import.blueprintDoneTitle'))
    callbacks.log(t('log.import.blueprintResult')
      .replace('{ok}', String(completedCount))
      .replace('{fail}', String(failedCount)))
    callbacks.setProgress(85)

    callbacks.setProgress(100)
    this.notifyRefresh(['fileTree', 'blueprints'])
  }
}
