import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { t } from '../../../shared/locale'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { BasePromptBuilder } from '../../prompts/prompt-builder'
import { ipc } from '../../ipc-client'


/**
 * 文风分析命令
 * 从已写章节中采样正文，调用 AI 提炼作者文风特征，
 * 结果写入 NovelConfig.writingStyle 以锚定后续生成/修稿。
 */
export class AnalyzeWritingStyleCommand extends BaseWorkflowCommand<string> {
  async execute({ callbacks }: CommandExecuteParams): Promise<string> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(t('error.noProject'))

    callbacks.log(t('log.analyzeStyle.sampling'))

    // 采样策略：取最近 5 章的正文（从数据库查询）
    const sampleTexts: string[] = []
    try {
      const maxChap = await ipc.invoke('db:draft-get-max-finalized-chapter')
      if (maxChap <= 0) {
        callbacks.log(t('log.analyzeStyle.noChapters'))
        return ''
      }

      const startChap = Math.max(1, maxChap - 4)
      for (let c = maxChap; c >= startChap; c--) {
        const meta = await ipc.invoke('db:draft-get-finalized', c)
        if (meta) {
          const full = await ipc.invoke('db:draft-get-full', meta.id)
          if (full?.content?.trim()) {
            sampleTexts.push(full.content.trim().slice(0, 2000))
          }
        }
      }
      callbacks.log(t('log.analyzeStyle.sampled').replace('{count}', String(sampleTexts.length)))
    } catch {
      callbacks.log(t('log.analyzeStyle.fetchFailed'))
      return ''
    }

    if (sampleTexts.length === 0) {
      callbacks.log(t('log.analyzeStyle.sampleEmpty'))
      return ''
    }

    const template = getPromptTemplate('analyze_writing_style')
    if (!template) throw new Error(t('error.templateNotFound').replace('{name}', '文风分析'))

    const sampleText = sampleTexts.join('\n\n---\n\n')
    const prompt = new BasePromptBuilder(template)
      // 使用 protected variables 需要通过子类或反射，这里使用 build 前手动设置
      ; (prompt as unknown as { variables: { sample_text: string } }).variables = { sample_text: sampleText }
    const finalPrompt = prompt.build()

    callbacks.log(t('log.analyzeStyle.calling'))
    const result = await this.callLLM(
      finalPrompt,
      template.systemRole || t('role.literaryCritic'),
      callbacks,
    )

    const cleanResult = this.stripThinkingTags(result).trim()
    if (!cleanResult) {
      callbacks.log(t('log.analyzeStyle.emptyResult'))
      return ''
    }

    // 写入 NovelConfig
    const { updateNovelConfig, saveProject } = useProjectStore.getState()
    updateNovelConfig({ writingStyle: cleanResult })
    await saveProject()
    callbacks.log(t('log.analyzeStyle.saved'))

    return cleanResult
  }
}
