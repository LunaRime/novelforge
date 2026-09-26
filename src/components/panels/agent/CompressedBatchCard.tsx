import { useState } from 'react'
import type { CompressedBatch } from '../../../services/agent/archive-codec'
import type { AgentMessage } from '../../../stores/agent-store'
import { useAgentStore } from '../../../stores/agent-store'
import { t } from '../../../shared/locale'

/** 回执段的起始标记（B5：回执附在摘要尾部，展示时拆出来独立成段） */
const RECEIPTS_MARKER = '本段已执行的操作（回执）：'

/**
 * CCR 压缩事件卡片（B 档第二轮 T7）
 *
 * 三处与本轮之前不同：
 * - **真实降幅**：读后端实测的 `beforeTokens → afterTokens`（旧实现用"原文 − 摘要"估算，
 *   既非真实请求降幅、也不含注入截断）
 * - **原文按需读分卷**：原文已移出会话 JSON，展开时才从 `.originals.json` 取
 * - **回执独立成段**：副作用回执与摘要正文分开渲染，便于核对"这批做过什么"
 */
export default function CompressedBatchCard({ batch }: { batch: CompressedBatch }) {
  const [expanded, setExpanded] = useState(false)
  const [originals, setOriginals] = useState<AgentMessage[] | null>(null)
  const loadBatchOriginal = useAgentStore(s => s.loadBatchOriginal)
  const removeCompaction = useAgentStore(s => s.removeCompaction)

  // 真实降幅（B2）；旧档案无实测值时回落到估算
  const hasRealDelta = batch.changeTokens !== undefined
  const before = batch.beforeTokens ?? batch.originalTokens
  const after = batch.afterTokens ?? Math.max(0, batch.originalTokens - (hasRealDelta ? batch.changeTokens! : 0))
  const savedTokens = before - after

  // 回执拆段展示（B5）
  const receiptsIndex = batch.summary.indexOf(RECEIPTS_MARKER)
  const summaryText = receiptsIndex >= 0 ? batch.summary.slice(0, receiptsIndex).trim() : batch.summary
  const receiptsText = receiptsIndex >= 0 ? batch.summary.slice(receiptsIndex + RECEIPTS_MARKER.length).trim() : ''

  const recoverable = batch.recoverable !== false

  const handleToggle = async () => {
    // 首次展开时按需读分卷（原文已不在会话 JSON 里）
    if (!expanded && originals === null && recoverable) {
      const loaded = await loadBatchOriginal(batch.batch)
      setOriginals(loaded ?? [])
    }
    setExpanded(v => !v)
  }

  return (
    <div
      className="mx-2 my-2 rounded-lg px-3 py-2 text-xs"
      style={{ backgroundColor: 'var(--color-hover)', border: '1px dashed var(--color-border)' }}
    >
      <div className="flex items-center justify-between">
        <span style={{ color: 'var(--color-text-secondary)' }}>
          {t('ccr.compressedNotice').replace('{n}', String(batch.originalTokens))}
          {savedTokens > 0 && ` · ${t('ccr.savedTokens').replace('{n}', String(savedTokens))}`}
          {hasRealDelta && ` (${before} → ${after})`}
          {batch.invalidated && ` · ${t('ccr.batchInvalidated')}`}
        </span>
        <div className="flex items-center gap-2">
          {recoverable && (
            <button
              onClick={() => void removeCompaction(batch.batch)}
              style={{ color: 'var(--color-accent)' }}
              className="hover:underline"
            >
              {t('ccr.removeCompaction')}
            </button>
          )}
          <button onClick={() => void handleToggle()} style={{ color: 'var(--color-accent)' }} className="hover:underline">
            {expanded ? t('ccr.collapse') : t('ccr.expand')}
          </button>
        </div>
      </div>

      <div className="mt-1 whitespace-pre-wrap">{summaryText}</div>

      {/* B5：回执独立成段 */}
      {receiptsText && (
        <div className="mt-1">
          <div className="text-micro" style={{ color: 'var(--color-text-muted)' }}>{RECEIPTS_MARKER}</div>
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
