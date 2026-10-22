import { useState } from 'react'
import type { CompressedBatch } from '../../../services/agent/archive-codec'
import type { AgentMessage } from '../../../stores/agent-store'
import { useAgentStore } from '../../../stores/agent-store'
import { shouldWarnFidelity } from '../../../services/agent/ccr-fidelity'
import { localeVariants, t } from '../../../shared/locale'
import { Button } from '../../ui/Button'

/**
 * 回执段的起始标记（B5：回执头插在摘要里，展示时拆出来独立成段）。
 * ⚠️ 必须与写入端同源（都取 `t('ccr.receiptsHeader')`），且匹配要按**全语变体**：
 * 摘要用**写入时** locale 生成，只按当前 locale 匹配会让「压缩后切语言」的回执拆段静默失效
 * （不崩、不报错，回执被当成摘要正文一起渲染）。
 */

/**
 * CCR 压缩事件卡片（B 档第二轮 T7）
 *
 * 三处与本轮之前不同：
 * - **真实降幅**：读后端实测的 `beforeTokens → afterTokens`（旧实现用"原文 − 摘要"估算，
 *   既非真实请求降幅、也不含注入截断）
 * - **原文按需读分卷**：原文已移出会话 JSON，展开时才从 `.originals.json` 取
 * - **回执独立成段**：副作用回执与摘要正文分开渲染，便于核对"这批做过什么"
 *
 * P1-3：摘要失效（`batch.invalidated` 或会话级 `summaryStale`——移除某批/rewind 后
 * 迭代链已断）时给出「重生成摘要」按钮：读分卷原文以**该批为唯一输入**重建并恢复注入。
 */
export default function CompressedBatchCard({ batch, summaryStale = false }: {
  batch: CompressedBatch
  /** 会话级摘要失效（rollingSummaryInvalidated；card 拿不到会话，由父传入） */
  summaryStale?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [originals, setOriginals] = useState<AgentMessage[] | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  /** P1-3：重生成失败的内联提示（失败文案由 store 返回，已 i18n） */
  const [regenerateError, setRegenerateError] = useState<string | null>(null)
  const loadBatchOriginal = useAgentStore(s => s.loadBatchOriginal)
  const removeCompaction = useAgentStore(s => s.removeCompaction)
  const regenerateBatchSummary = useAgentStore(s => s.regenerateBatchSummary)
  const generating = useAgentStore(s => s.generating)

  // 真实降幅（B2）；旧档案无实测值时回落到估算
  const hasRealDelta = batch.changeTokens !== undefined
  const before = batch.beforeTokens ?? batch.originalTokens
  const after = batch.afterTokens ?? Math.max(0, batch.originalTokens - (hasRealDelta ? batch.changeTokens! : 0))
  const savedTokens = before - after

  // 回执拆段展示（B5）：按**全语变体**定位（切语言后旧摘要仍能被正确拆分）；取最早命中者
  let receiptsIndex = -1
  let marker = ''
  for (const variant of localeVariants('ccr.receiptsHeader')) {
    const idx = batch.summary.indexOf(variant)
    if (idx >= 0 && (receiptsIndex < 0 || idx < receiptsIndex)) {
      receiptsIndex = idx
      marker = variant
    }
  }
  // 回执块边界：回执在**头部**，其后（空行之后）才是模型写的摘要正文。
  // ⚠️ 正文必须从回执块**之后**开始切——只跳过标题行会让回执行在正文里**再出现一次**
  // （回执块已单独渲染），用户看到重复内容（新增用例暴露的既有缺陷）。
  const receiptsBlockEnd = receiptsIndex >= 0 ? batch.summary.indexOf('\n\n', receiptsIndex) : -1
  const summaryText = receiptsIndex >= 0
    ? (receiptsBlockEnd > 0 ? batch.summary.slice(receiptsBlockEnd).trim() : '')
    : batch.summary
  const receiptsText = receiptsIndex >= 0
    ? batch.summary.slice(receiptsIndex, receiptsBlockEnd > 0 ? receiptsBlockEnd : batch.summary.length).trim()
    : ''

  // 旧档案（升级前产出）的原文是 inline 数组、且无 recoverable 字段 —— 必须仍可展开（评审 I3）
  const inlineOriginals = batch.original ?? []
  const hasInline = inlineOriginals.length > 0
  const recoverable = batch.recoverable !== false || hasInline

  const handleToggle = async () => {
    if (!expanded && originals === null) {
      if (hasInline) {
        setOriginals(inlineOriginals)        // 旧档案：直接用内联原文
      } else if (batch.recoverable !== false) {
        // 新档案：按需从分卷读（原文已不在会话 JSON 里）
        const loaded = await loadBatchOriginal(batch.batch)
        setOriginals(loaded ?? [])
      }
    }
    setExpanded(v => !v)
  }

  /** P1-3：重生成摘要（以该批分卷原文为唯一输入；busy 期间防双击）。
   *  失败原因由 store 以**已 i18n 的文案**返回 → 内联展示（此前只能去 LogsView 找）。 */
  const handleRegenerate = async () => {
    if (regenerating) return
    setRegenerating(true)
    setRegenerateError(null)
    try {
      const err = await regenerateBatchSummary(batch.batch)
      if (err) setRegenerateError(err)
    } finally {
      setRegenerating(false)
    }
  }

  // 摘要需要重生成：批次级失效（rewind 等）或会话级失效（移除某批后链断）
  const needsRegenerate = batch.invalidated === true || summaryStale

  return (
    <div
      className="mx-2 my-2 rounded-lg px-3 py-2 text-xs"
      style={{ backgroundColor: 'var(--color-hover)', border: '1px dashed var(--color-border)' }}
    >
      {/* 2026-09-27 可供性修复：通知文案（含 savedTokens / before → after 计数）此前落在
          无热区的 span 上——改为整段包进主按钮（点它 = 展开/收起，尾部保留「展开/收起」标签
          作可点暗示）；「移除该压缩」作兄弟节点。文字型按钮热区用 py-1 -my-1 撑到 21px。 */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleToggle()}
          className="flex-1 min-w-0 text-left cursor-pointer"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {t('ccr.compressedNotice').replace('{n}', String(batch.originalTokens))}
          {savedTokens > 0 && ` · ${t('ccr.savedTokens').replace('{n}', String(savedTokens))}`}
          {hasRealDelta && ` (${before} → ${after})`}
          {batch.invalidated && ` · ${t('ccr.batchInvalidated')}`}
          {/* P1-2：保真告警标注（只标注不拦截——历史仍按降幅判定正常替换） */}
          {batch.fidelity && shouldWarnFidelity(batch.fidelity) && (
            <span title={t('ccr.fidelityWarn')
              .replace('{retained}', String(batch.fidelity.retained))
              .replace('{extracted}', String(batch.fidelity.extracted))}
              style={{ color: 'var(--color-warning)' }}
            >
              {` · ⚠ ${t('ccr.fidelityBadge')
                .replace('{retained}', String(batch.fidelity.retained))
                .replace('{extracted}', String(batch.fidelity.extracted))}`}
            </span>
          )}
          <span className="ml-1" style={{ color: 'var(--color-accent)' }}>
            {expanded ? t('ccr.collapse') : t('ccr.expand')}
          </span>
        </button>
      </div>
      {recoverable && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void removeCompaction(batch.batch)}
          >
            {t('ccr.removeCompaction')}
          </Button>
          {needsRegenerate && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleRegenerate()}
              disabled={regenerating || generating}
              title={generating ? t('ccr.regenerateBusy') : undefined}
            >
              {regenerating ? t('ccr.regenerating') : t('ccr.regenerateSummary')}
            </Button>
          )}
        </div>
      )}

      {/* P1-3：重生成失败的内联提示（不静默；成功即清除） */}
      {regenerateError && (
        <div className="mt-1 text-micro" style={{ color: 'var(--color-warning)' }}>{regenerateError}</div>
      )}

      <div className="mt-1 whitespace-pre-wrap">{summaryText}</div>

      {/* B5：回执独立成段 */}
      {receiptsText && (
        <div className="mt-1">
          <div className="text-micro" style={{ color: 'var(--color-text-muted)' }}>{marker}</div>
          <div className="whitespace-pre-wrap" style={{ color: 'var(--color-text-secondary)' }}>{receiptsText}</div>
        </div>
      )}

      {expanded && (
        recoverable ? (
          <div
            className="mt-2 max-h-48 overflow-y-auto rounded px-2 py-1"
            style={{ backgroundColor: 'var(--color-active)' }}
          >
            {(originals ?? []).map(m => (
              <div key={m.id} className="mb-1">
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  {m.role === 'user' ? t('ccr.roleUser') : t('ccr.roleAssistant')}:{' '}
                </span>
                {m.content}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 text-micro" style={{ color: 'var(--color-text-muted)' }}>
            {t('ccr.originalUnavailable')}
          </div>
        )
      )}
    </div>
  )
}
