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
import { ipc } from '../../ipc-client'
import { computeTextStats } from '../../text-stats'

/** 终审 Agent systemRole：只审不改，输出可执行的修改建议 */
const REVIEWER_SYSTEM = '你是一位资深网文编辑，擅长根据审计报告给出精准、可执行的修改建议。你只负责指出问题和给出方案，不负责改写正文。'

/** 重写 Agent systemRole：落实建议的写手 */
const REWRITER_SYSTEM = '你是一位顶尖网文写手，擅长根据编辑的修改建议重写正文，保持原文风格、节奏与剧情不变。'

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
      callbacks.log('⚠️ 终审自省：初稿内容不可读，跳过')
      return
    }

    let current = full.content
    let rewrote = false
    let rounds = 0

    for (let round = 1; round <= 2; round++) {
      rounds = round
      const audit = auditText(ctx, current)
      if (audit.passed) {
        callbacks.log(`✅ 终审自省第 ${round} 轮：审计通过，无需修改`)
        break
      }
      callbacks.log(`🔍 终审自省第 ${round} 轮：发现 ${audit.issues.length} 处问题（${audit.summary}）`)

      // ===== 1. 终审 Agent：审计报告 → 修改建议清单 =====
      const issueText = audit.issues
        .map((iss, i) => `${i + 1}. [${iss.kind}] ${iss.message}`)
        .join('\n')
      const reviewerPrompt =
        `【初稿审计报告】\n${issueText}\n\n` +
        `【初稿（前 3000 字）】\n${current.slice(0, 3000)}\n\n` +
        `【任务】针对审计报告中的每个问题，给出修改建议清单（编号 1.2.3.）：
每条格式：问题简述 → 具体修改方案 → 一句示例。
只针对审计报告中的问题，不要泛泛而谈，不要重写正文。`
      const suggestions = await this.callLLM(reviewerPrompt, REVIEWER_SYSTEM, callbacks)
      if (!suggestions.trim()) {
        callbacks.log('⚠️ 终审 Agent 未给出建议，本轮跳过')
        break
      }
      callbacks.log(`📋 终审 Agent 建议：\n${suggestions.slice(0, 500)}${suggestions.length > 500 ? '…' : ''}`)

      // ===== 2. 主 AI 根据清单重写 =====
      const rewritePrompt =
        `【修改建议清单】\n${suggestions}\n\n` +
        `【初稿全文】\n${current}\n\n` +
        `【任务】根据修改建议清单重写正文：落实每一条建议；保持原文风格、叙事节奏、剧情走向不变；不要新增与建议无关的大幅改动。`
      const rewritten = await this.callLLM(rewritePrompt, REWRITER_SYSTEM, callbacks)

      // 防御：重写稿异常（过短 = 截断/拒答）→ 放弃本轮，保留当前稿
      if (rewritten.trim().length < current.trim().length * 0.5) {
        callbacks.log('⚠️ 重写稿异常（长度不足初稿 50%），放弃本轮重写')
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
      callbacks.log(`📝 终审自省完成：重写稿已保存为新版本 v${nextVersion}（初稿保留，可对比）`)
      const { globalEventBus } = await import('../../../shared/event-bus')
      globalEventBus.emit('REFRESH_RESOURCE', { resources: ['drafts'] })
    } else {
      callbacks.log(`✅ 终审自省完成（${rounds} 轮）：未生成重写稿——审计通过或重写被拒，初稿保持`)
    }
  }
}
