/**
 * VerifyBlueprintsCommand — 扫描蓝图缺口并生成校检报告
 *
 * 不调用 LLM，纯数据分析。
 */

import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { loadDirectoryBlueprints } from '../directory-workflow'
import { generateVerificationReport, type VerificationReport } from '../../blueprint-verification-service'

export class VerifyBlueprintsCommand extends BaseWorkflowCommand<VerificationReport> {
  async execute({ callbacks }: CommandExecuteParams): Promise<VerificationReport> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error('未打开项目')

    const totalChapters = project.novelConfig.totalChapters

    callbacks.log('正在扫描蓝图缺口...')
    const blueprints = await loadDirectoryBlueprints()
    callbacks.log(`已加载 ${blueprints.length} 章蓝图（共 ${totalChapters} 章）`)

    const report = await generateVerificationReport(totalChapters, blueprints)

    callbacks.log(`校检完成: ${report.summary}`)
    callbacks.setProgress(100)

    return report
  }
}
