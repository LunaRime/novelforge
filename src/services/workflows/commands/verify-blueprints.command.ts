/**
 * VerifyBlueprintsCommand — 扫描蓝图缺口并生成校检报告
 *
 * 不调用 LLM，纯数据分析。
 */

import { t } from '../../../shared/locale'
import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { loadDirectoryBlueprints } from '../directory-workflow'
import { generateVerificationReport, type VerificationReport } from '../../blueprint-verification-service'

export class VerifyBlueprintsCommand extends BaseWorkflowCommand<VerificationReport> {
  async execute({ callbacks }: CommandExecuteParams): Promise<VerificationReport> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(t('error.noProject'))

    const totalChapters = project.novelConfig.totalChapters

    callbacks.log(t('log.verifyBlueprints.scanning'))
    const blueprints = await loadDirectoryBlueprints()
    callbacks.log(t('log.verifyBlueprints.loaded')
      .replace('{loaded}', String(blueprints.length))
      .replace('{total}', String(totalChapters)))

    const report = await generateVerificationReport(totalChapters, blueprints)

    callbacks.log(t('log.verifyBlueprints.done').replace('{summary}', report.summary))
    callbacks.setProgress(100)

    return report
  }
}
