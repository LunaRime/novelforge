/**
 * SelfReviewCommand — 迭代式自省（终审 Agent）
 *
 * 流程（最多 2 轮）：
 *   初稿 → 审计报告（六类审计，复用定稿审计上下文）→ 终审 Agent 给 1.2.3. 修改建议清单
 *   → 主 AI 根据清单重写 → 再次审计 → 循环。
 *
 * 安全设计：重写稿保存为**新版本草稿**（source='rewrite'），不覆盖初稿——
 * 可追溯、可与初稿对比；重写稿过短（< 初稿 50%）判定异常放弃本轮。
 */
import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { t } from '../../../shared/locale'
import { ipc } from '../../ipc-client'
import { computeTextStats } from '../../text-stats'

/** 终审 Agent systemRole：只审不改，输出可执行的修改建议 */
const getReviewerSystem = (): string => t('prompt.selfReview.reviewerSystem')

/** 重写 Agent systemRole：落实建议的写手 */
const getRewriterSystem = (): string => t('prompt.selfReview.rewriterSystem')

export class SelfReviewCommand extends BaseWorkflowCommand<void> {
  constructor(private params: {
    chapterNumber: number
    chapterTitle: string
    /** 初稿草稿 id（写稿步骤产出） */
    draftId: number
  }) {
    super()
  }

  async execute({ callbacks }: CommandExecuteParams): Promise<void> {
    const { collectAuditContext, auditText } = await import('../../audit/audit-context')
    const ctx = await collectAuditContext(this.params.chapterNumber)

    // 读初稿（写稿步骤最新版本）
    const full = await ipc.invoke('db:draft-get-full', this.params.draftId) as { content?: string } | null
    if (!full?.content || !full.content.trim()) {
      callbacks.log(t('log.selfReview.unreadable'))
      return
    }

    let current = full.content
    let rewrote = false
    let rounds = 0

    for (let round = 1; round <= 2; round++) {
      rounds = round
      const audit = auditText(ctx, current)
      if (audit.passed) {
        callbacks.log(t('log.selfReview.passed').replace('{round}', String(round)))
        break
      }
      callbacks.log(t('log.selfReview.issuesFound')
        .replace('{round}', String(round))
        .replace('{count}', String(audit.issues.length))
        .replace('{summary}', audit.summary))

      // ===== 1. 终审 Agent：审计报告 → 修改建议清单 =====
      const issueText = audit.issues
        .map((iss, i) => `${i + 1}. [${iss.kind}] ${iss.message}`)
        .join('\n')
      const reviewerPrompt =
        t('prompt.selfReview.reviewerTitle') + '\n' + issueText + '\n\n' +
        t('prompt.selfReview.draftPreviewTitle') + '\n' + current.slice(0, 3000) + '\n\n' +
        t('prompt.selfReview.reviewerTask')
      const suggestions = await this.callLLM(reviewerPrompt, getReviewerSystem(), callbacks)
      if (!suggestions.trim()) {
        callbacks.log(t('log.selfReview.noSuggestions'))
        break
      }
      callbacks.log(t('log.selfReview.suggestions')
        .replace('{suggestions}', suggestions.slice(0, 500) + (suggestions.length > 500 ? '…' : '')))

      // ===== 2. 主 AI 根据清单重写 =====
      const rewritePrompt =
        t('prompt.selfReview.suggestionTitle') + '\n' + suggestions + '\n\n' +
        t('prompt.selfReview.fullDraftTitle') + '\n' + current + '\n\n' +
        t('prompt.selfReview.rewriteTask')
      const rewritten = await this.callLLM(rewritePrompt, getRewriterSystem(), callbacks)

      // 防御：重写稿异常（过短 = 截断/拒答）→ 放弃本轮，保留当前稿
      if (rewritten.trim().length < current.trim().length * 0.5) {
        callbacks.log(t('log.selfReview.rewriteTooShort'))
        break
      }
      current = rewritten
      rewrote = true
    }

    // ===== 3. 落库：重写稿另存新版本（不覆盖初稿） =====
    if (rewrote) {
      const latest = await ipc.invoke('db:draft-get-latest', this.params.chapterNumber) as { version?: number } | null
      const nextVersion = (latest?.version ?? 1) + 1
      await ipc.invoke('db:draft-create', {
        chapterNumber: this.params.chapterNumber,
        version: nextVersion,
        content: current,
        wordCount: computeTextStats(current).novelWordCount,
        source: 'rewrite',
      })
      callbacks.log(t('log.selfReview.rewriteSaved').replace('{version}', String(nextVersion)))
      const { globalEventBus } = await import('../../../shared/event-bus')
      globalEventBus.emit('REFRESH_RESOURCE', { resources: ['drafts'] })
    } else {
      callbacks.log(t('log.selfReview.done').replace('{rounds}', String(rounds)))
    }
  }
}
