import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { t } from '../../../shared/locale'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { ArchitecturePromptBuilder } from '../../prompts/prompt-builder'
import { ipc } from '../../ipc-client'

import type { NovelConfig } from '../../../shared/ipc-channels'

// --- 基础工具库 ---

function getNovelConfig(): { project: NonNullable<ReturnType<typeof useProjectStore.getState>['currentProject']>; config: NovelConfig } {
  const project = useProjectStore.getState().currentProject
  if (!project) throw new Error(t('error.noProject'))
  return { project, config: project.novelConfig }
}

function stripThinkingTags(text: string): string {
  return text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim()
}

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

    // 防御：LLM 常常将长文本字段错误地生成为对象或数组
    const stringifyField = (val: unknown) => {
      if (!val) return ''
      if (typeof val === 'string') return val
      if (Array.isArray(val)) return val.join('\n')
      if (typeof val === 'object') return JSON.stringify(val, null, 2)
      return String(val)
    }

    if (parsed.coreOutline !== undefined) parsed.coreOutline = stringifyField(parsed.coreOutline)
    if (parsed.worldSetting !== undefined) parsed.worldSetting = stringifyField(parsed.worldSetting)
    if (parsed.goldenFinger !== undefined) parsed.goldenFinger = stringifyField(parsed.goldenFinger)
    if (parsed.protagonistProfile !== undefined) parsed.protagonistProfile = stringifyField(parsed.protagonistProfile)
    if (parsed.globalGuidance !== undefined) parsed.globalGuidance = stringifyField(parsed.globalGuidance)
    if (parsed.referenceWorks !== undefined) parsed.referenceWorks = stringifyField(parsed.referenceWorks)
    if (parsed.writingStyle !== undefined) parsed.writingStyle = stringifyField(parsed.writingStyle)

    if (parsed.totalChapters !== undefined) parsed.totalChapters = parseInt(String(parsed.totalChapters)) || 100
    if (parsed.wordsPerChapter !== undefined) parsed.wordsPerChapter = parseInt(String(parsed.wordsPerChapter)) || 3000

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
