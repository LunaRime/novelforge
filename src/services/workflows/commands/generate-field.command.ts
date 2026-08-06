import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { t } from '../../../shared/locale'
import { useProjectStore } from '../../../stores/project-store'
import type { NovelConfig } from '../../../shared/ipc-channels'

/**
 * 支持的单字段生成 Key
 * 每个 key 对应 NovelConfig 中的一个文本字段
 */
export type GeneratableField =
  | 'coreOutline'
  | 'worldSetting'
  | 'goldenFinger'
  | 'protagonistProfile'
  | 'globalGuidance'
  | 'writingStyle'

/** 字段标签映射（i18n） */
function getFieldLabel(fieldKey: GeneratableField): string {
  const labels: Record<GeneratableField, string> = {
    coreOutline: t('field.label.coreOutline'),
    worldSetting: t('field.label.worldSetting'),
    goldenFinger: t('field.label.goldenFinger'),
    protagonistProfile: t('field.label.protagonistProfile'),
    globalGuidance: t('field.label.globalGuidance'),
    writingStyle: t('field.label.writingStyle'),
  }
  return labels[fieldKey]
}

/**
 * 单字段 AI 生成命令
 * 根据已有的 NovelConfig 上下文，只生成指定字段的内容
 */
export class GenerateFieldCommand extends BaseWorkflowCommand<string> {
  constructor(private fieldKey: GeneratableField) {
    super()
  }

  async execute({ callbacks }: CommandExecuteParams): Promise<string> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(t('error.noProject'))

    const config = project.novelConfig
    const label = getFieldLabel(this.fieldKey)

    callbacks.log(t('log.generateField.generating').replace('{label}', label))

    // 构建上下文摘要（已填写的字段作为参考）
    const context = this.buildContext(config)
    // 构建针对性 prompt
    const prompt = this.buildPrompt(config, context)
    const systemPrompt = t('role.configDesigner')

    const result = await this.callLLM(prompt, systemPrompt, callbacks)
    const cleanResult = this.stripThinkingTags(result).trim()

    if (!cleanResult) {
      callbacks.log(t('log.generateField.emptyResult').replace('{label}', label))
      return ''
    }

    // 写入 NovelConfig
    const { updateNovelConfig, saveProject } = useProjectStore.getState()
    updateNovelConfig({ [this.fieldKey]: cleanResult })
    await saveProject()
    callbacks.log(t('log.generateField.saved').replace('{label}', label))

    return cleanResult
  }

  /** 构建已有配置的上下文摘要 */
  private buildContext(config: NovelConfig): string {
    const parts: string[] = []
    if (config.genre) parts.push(t('inject.ctxGenre').replace(/\{value\}/g, () => config.genre))
    if (config.subGenre) parts.push(t('inject.ctxSubGenre').replace(/\{value\}/g, () => config.subGenre))
    if (config.targetAudience) parts.push(t('inject.ctxAudience').replace(/\{value\}/g, () => config.targetAudience))
    if (config.totalChapters) parts.push(t('inject.ctxTotalChapters').replace(/\{value\}/g, () => String(config.totalChapters)))
    if (config.wordsPerChapter) parts.push(t('inject.ctxWordsPerChapter').replace(/\{value\}/g, () => String(config.wordsPerChapter)))
    if (config.coreOutline?.trim() && this.fieldKey !== 'coreOutline')
      parts.push(t('inject.ctxCoreOutline').replace(/\{value\}/g, () => config.coreOutline.slice(0, 500)))
    if (config.worldSetting?.trim() && this.fieldKey !== 'worldSetting')
      parts.push(t('inject.ctxWorldSetting').replace(/\{value\}/g, () => config.worldSetting.slice(0, 500)))
    if (config.goldenFinger?.trim() && this.fieldKey !== 'goldenFinger')
      parts.push(t('inject.ctxGoldenFinger').replace(/\{value\}/g, () => config.goldenFinger.slice(0, 500)))
    if (config.protagonistProfile?.trim() && this.fieldKey !== 'protagonistProfile')
      parts.push(t('inject.ctxProtagonist').replace(/\{value\}/g, () => config.protagonistProfile.slice(0, 500)))
    if (config.globalGuidance?.trim() && this.fieldKey !== 'globalGuidance')
      parts.push(t('inject.ctxGlobalGuidance').replace(/\{value\}/g, () => config.globalGuidance.slice(0, 500)))
    const referenceWorks = config.referenceWorks
    if (referenceWorks?.trim())
      parts.push(t('inject.ctxReferenceWorks').replace(/\{value\}/g, () => referenceWorks))
    const writingStyle = config.writingStyle
    if (writingStyle?.trim() && this.fieldKey !== 'writingStyle')
      parts.push(t('inject.ctxWritingStyle').replace(/\{value\}/g, () => writingStyle.slice(0, 300)))
    return parts.length > 0 ? parts.join('\n') : t('inject.ctxNoConfig')
  }

  /** 根据 fieldKey 构建针对性 prompt */
  private buildPrompt(config: NovelConfig, context: string): string {
    const fieldPrompts: Record<GeneratableField, string> = {
      coreOutline: t('prompt.field.coreOutline'),

      worldSetting: t('prompt.field.worldSetting'),

      goldenFinger: t('prompt.field.goldenFinger'),

      protagonistProfile: t('prompt.field.protagonistProfile'),

      globalGuidance: t('prompt.field.globalGuidance')
        .replace(/\{totalChapters\}/g, () => String(config.totalChapters || 100)),

      writingStyle: t('prompt.field.writingStyle')
        .replace(/\{genre\}/g, () => config.genre || t('inject.unspecified'))
        .replace(/\{audience\}/g, () => config.targetAudience || t('inject.unspecified')),
    }

    return t('prompt.field.header') + '\n' + context + '\n\n' +
      fieldPrompts[this.fieldKey] + '\n\n' +
      t('prompt.field.outputRequirements')
  }
}
