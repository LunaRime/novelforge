import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { t } from '../../../shared/locale'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { ArchitecturePromptBuilder } from '../../prompts/prompt-builder'
import { stripThinkingTags, stringifyField as stringifyFieldUtils } from '../workflow-utils'
import { ipc } from '../../ipc-client'

import type { NovelConfig } from '../../../shared/ipc-channels'

// --- 基础工具库 ---

function getNovelConfig(): { project: NonNullable<ReturnType<typeof useProjectStore.getState>['currentProject']>; config: NovelConfig } {
  const project = useProjectStore.getState().currentProject
  if (!project) throw new Error(t('error.noProject'))
  return { project, config: project.novelConfig }
}

// stripThinkingTags 统一走 workflow-utils 单一出口

async function writeArchToDb(key: 'premise' | 'charactersArch' | 'worldbuilding' | 'synopsis', content: string): Promise<void> {
  const cleanContent = stripThinkingTags(content)
  await ipc.invoke('db:project-core-update', { [key]: cleanContent })

  // 通知 UI 层实时刷新架构完成状态
  const { globalEventBus } = await import('../../../shared/event-bus')
  globalEventBus.emit('ARCH_FILE_UPDATED', { fileName: `${key}.md` })
}

// --- 独立命令类 ---

export class GenerateConfigCommand extends BaseWorkflowCommand<string> {
  constructor(private idea: string, private totalChapters: number, private wordsPerChapter: number, private onGenerated: (config: Partial<NovelConfig>) => void) {
    super()
  }

  async execute({ callbacks }: CommandExecuteParams): Promise<string> {
    callbacks.log(t('log.arch.dispatchConfigAI'))

    const template = getPromptTemplate('generate_global_config')
    if (!template) throw new Error(t('error.templateNotFound').replace('{name}', 'generate_global_config'))

    const promptBuilder = new ArchitecturePromptBuilder(template)
      .withUserIdea(this.idea)
      .withNumberOfChapters(this.totalChapters)
      .withWordNumber(this.wordsPerChapter)

    const resultRaw = await this.callLLMWithBuilder(
      promptBuilder,
      callbacks,
      { responseFormat: { type: 'json_object' }, thinking: true }
    )

    callbacks.log(t('log.arch.parseDone'))
    let parsed: Partial<NovelConfig>
    try {
      parsed = this.parseJSON<Partial<NovelConfig>>(resultRaw)
    } catch (e) {
      throw new Error(t('error.jsonParse').replace('{error}', String(e)))
    }

    // 防御：LLM 常常将长文本字段错误地生成为对象或数组（workflow-utils 单一出口，长文本数组用换行合并）
    const stringifyField = (val: unknown): string => stringifyFieldUtils(val, '\n')

    if (parsed.coreOutline !== undefined) parsed.coreOutline = stringifyField(parsed.coreOutline)
    if (parsed.worldSetting !== undefined) parsed.worldSetting = stringifyField(parsed.worldSetting)
    if (parsed.goldenFinger !== undefined) parsed.goldenFinger = stringifyField(parsed.goldenFinger)
    if (parsed.protagonistProfile !== undefined) parsed.protagonistProfile = stringifyField(parsed.protagonistProfile)
    if (parsed.globalGuidance !== undefined) parsed.globalGuidance = stringifyField(parsed.globalGuidance)
    if (parsed.referenceWorks !== undefined) parsed.referenceWorks = stringifyField(parsed.referenceWorks)
    if (parsed.writingStyle !== undefined) parsed.writingStyle = stringifyField(parsed.writingStyle)

    // 数字字段解析：非法值（如 "50章"）静默默认——打日志便于诊断（P3 修复）
    if (parsed.totalChapters !== undefined) {
      const n = parseInt(String(parsed.totalChapters))
      if (isNaN(n) || n <= 0) {
        callbacks.log(t('log.arch.numberParseFallback').replace('{field}', 'totalChapters').replace('{raw}', String(parsed.totalChapters)).replace('{fallback}', '100'))
        parsed.totalChapters = 100
      } else {
        parsed.totalChapters = n
      }
    }
    if (parsed.wordsPerChapter !== undefined) {
      const n = parseInt(String(parsed.wordsPerChapter))
      if (isNaN(n) || n <= 0) {
        callbacks.log(t('log.arch.numberParseFallback').replace('{field}', 'wordsPerChapter').replace('{raw}', String(parsed.wordsPerChapter)).replace('{fallback}', '3000'))
        parsed.wordsPerChapter = 3000
      } else {
        parsed.wordsPerChapter = n
      }
    }

    // 先更新前端 Store
    this.onGenerated(parsed)
    callbacks.log(t('log.arch.applying'))

    // 再持久化到数据库
    const saved = await useProjectStore.getState().saveProject()

    if (saved) {
      callbacks.log(t('log.arch.configSaved'))
    } else {
      callbacks.log(t('log.arch.configSaveFailed'))
    }
    callbacks.setProgress(100)
    return t('arch.configApplied')
  }
}

export class GenerateCoreSeedCommand extends BaseWorkflowCommand<string> {
  async execute({ context, callbacks }: CommandExecuteParams): Promise<string> {
    const { config } = getNovelConfig()
    callbacks.log(t('log.arch.generatingPremise'))

    const template = getPromptTemplate('premise')
    if (!template) throw new Error(t('error.templateNotFound').replace('{name}', 'premise'))

    const promptBuilder = new ArchitecturePromptBuilder(template)
      .withGenre(config.genre)
      .withSubGenre(config.subGenre || config.genre)
      .withTopic(config.coreOutline || t('status.notConfigured'))
      .withTargetAudience(config.targetAudience)
      .withNumberOfChapters(config.totalChapters)
      .withWordNumber(config.wordsPerChapter)
      .withCoreSetting(config.worldSetting || t('status.notConfigured'))
      .withGoldenFinger(config.goldenFinger || t('status.notConfigured'))
      .withProtagonistProfile(config.protagonistProfile || t('status.notConfigured'))
      .withGlobalGuidance(config.globalGuidance || t('status.notConfigured'))
      .withStepGuidance(((context.data.stepGuidance as Record<string, string>) || {}).premise || '')
      .withReferenceWorks(config.referenceWorks || '')

    const result = await this.callLLMWithBuilder(promptBuilder, callbacks, undefined, context)
    if (!result.trim()) throw new Error(t('error.premiseEmpty'))
    if (context.cancelled) throw new Error(t('error.workflowCancelled'))

    const content = `# ${t('arch.storyPremise')}\n\n${result}\n`
    await writeArchToDb('premise', content)

    callbacks.log(t('log.arch.premiseDone'))
    return result
  }
}

export class GenerateCharactersCommand extends BaseWorkflowCommand<string> {
  async execute({ context, callbacks }: CommandExecuteParams): Promise<string> {
    const { project, config } = getNovelConfig()

    const core = await ipc.invoke('db:project-core-get')
    const premise_result = core?.premise || ''

    if (!premise_result || premise_result.includes('待生成') || premise_result.length < 50) {
      throw new Error(t('error.premiseIncomplete'))
    }

    callbacks.log(t('log.arch.generatingCharacters'))
    const template = getPromptTemplate('character_dynamics')
    if (!template) throw new Error(t('error.templateNotFound').replace('{name}', 'character_dynamics'))

    const promptBuilder = new ArchitecturePromptBuilder(template)
      .withCoreSeed(premise_result)
      .withGenre(config.genre)
      .withProtagonistProfile(config.protagonistProfile || t('status.notConfigured'))
      .withGoldenFinger(config.goldenFinger || t('status.notConfigured'))
      .withWorldBuilding(config.worldSetting || t('status.notConfigured'))
      .withNumberOfChapters(config.totalChapters)
      .withGlobalGuidance(config.globalGuidance || t('status.notConfigured'))
      .withStepGuidance(((context.data.stepGuidance as Record<string, string>) || {}).characters || '')
      .withReferenceWorks(config.referenceWorks || '')

    const result = await this.callLLMWithBuilder(promptBuilder, callbacks, undefined, context)
    if (!result.trim()) throw new Error(t('error.charactersFailed'))
    if (context.cancelled) throw new Error(t('error.workflowCancelled'))

    await writeArchToDb('charactersArch', `# ${t('arch.characterMap')}\n\n${result}\n`)

    callbacks.log(t('log.arch.extractingCards'))
    const { runArchCharacterExtract } = await import('../architecture-workflow')
    runArchCharacterExtract(project.path, result, config.genre)

    callbacks.log(t('log.arch.charactersDone'))
    return result
  }
}

export class GenerateWorldBuildingCommand extends BaseWorkflowCommand<string> {
  async execute({ context, callbacks }: CommandExecuteParams): Promise<string> {
    const { config } = getNovelConfig()

    const core = await ipc.invoke('db:project-core-get')
    const premise_result = core?.premise || ''

    if (!premise_result || premise_result.includes('待生成') || premise_result.length < 50) {
      throw new Error(t('error.premiseIncomplete'))
    }

    callbacks.log(t('log.arch.generatingWorld'))
    const template = getPromptTemplate('world_building')
    if (!template) throw new Error(t('error.templateMissing'))

    const promptBuilder = new ArchitecturePromptBuilder(template)
      .withCoreSeed(premise_result)
      .withGenre(config.genre)
      .withCoreSetting(config.worldSetting || t('status.notConfigured'))
      .withGoldenFinger(config.goldenFinger || t('status.notConfigured'))
      .withProtagonistProfile(config.protagonistProfile || t('status.notConfigured'))
      .withGlobalGuidance(config.globalGuidance || t('status.notConfigured'))
      .withStepGuidance(((context.data.stepGuidance as Record<string, string>) || {}).worldbuilding || '')

    const result = await this.callLLMWithBuilder(promptBuilder, callbacks, undefined, context)
    if (context.cancelled) throw new Error(t('error.workflowCancelled'))

    await writeArchToDb('worldbuilding', `# ${t('arch.worldBuilding')}\n\n${result}\n`)

    callbacks.log(t('log.arch.worldDone'))
    return result
  }
}

export class GeneratePlotArchitectureCommand extends BaseWorkflowCommand<string> {
  async execute({ context, callbacks }: CommandExecuteParams): Promise<string> {
    const { config } = getNovelConfig()

    const core = await ipc.invoke('db:project-core-get')
    const premise = core?.premise || ''
    const char_dyn = core?.charactersArch || ''
    const world_b = core?.worldbuilding || ''

    if (!premise || premise.includes('待生成')) throw new Error(t('error.notGenerated').replace('{name}', t('arch.storyPremise')))
    if (!char_dyn || char_dyn.includes('待生成')) throw new Error(t('error.notGenerated').replace('{name}', t('arch.characterMap')))
    if (!world_b || world_b.includes('待生成')) throw new Error(t('error.notGenerated').replace('{name}', t('arch.worldBuilding')))

    callbacks.log(t('log.arch.generatingSynopsis'))
    const template = getPromptTemplate('synopsis')
    if (!template) throw new Error(t('error.templateMissing'))

    const { getPlotStructureGuide, getNarrativePOVLabel } = await import('../architecture-workflow')
    const guide = getPlotStructureGuide(config.plotStructure || 'three_act', config.totalChapters)
    const pov = getNarrativePOVLabel(config.narrativePOV || 'third_limited')

    const promptBuilder = new ArchitecturePromptBuilder(template)
      .withCoreSeed(premise)
      .withCharacterDynamics(char_dyn)
      .withWorldBuilding(world_b)
      .withGenre(config.genre)
      .withNumberOfChapters(config.totalChapters)
      .withWordNumber(config.wordsPerChapter)
      .withPlotStructureGuide(guide)
      .withNarrativePov(pov)
      .withGlobalGuidance(config.globalGuidance || t('status.notConfigured'))
      .withStepGuidance(((context.data.stepGuidance as Record<string, string>) || {}).synopsis || '')

    const result = await this.callLLMWithBuilder(promptBuilder, callbacks, undefined, context)
    if (context.cancelled) throw new Error(t('error.workflowCancelled'))

    await writeArchToDb('synopsis', `# ${t('arch.plotOutline')}\n\n${result}\n`)

    callbacks.log(t('log.arch.synopsisDone'))
    return result
  }
}
