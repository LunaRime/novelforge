import { useState } from 'react'
import type { CompressedBatch } from '../../../services/agent/archive-codec'
import type { AgentMessage } from '../../../stores/agent-store'
import { useAgentStore } from '../../../stores/agent-store'
import { t } from '../../../shared/locale'

/**
 * 回执段的起始标记（B5：回执头插在摘要里，展示时拆出来独立成段）。
 * ⚠️ 必须与写入端同源（都取 `t('ccr.receiptsHeader')`）—— 硬编码中文字面量做解析锚点
 * 会让 en-US/ru-RU 下拆段静默失效（评审 I7）。
 */
const receiptsMarker = (): string => t('ccr.receiptsHeader')

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

  // 回执拆段展示（B5）：标记与写入端同源（i18n），跨语言不失效
  const marker = receiptsMarker()
  const receiptsIndex = batch.summary.indexOf(marker)
  const summaryText = receiptsIndex >= 0
    ? batch.summary.slice(receiptsIndex + marker.length).trim()   // 回执在头部，摘要其后
    : batch.summary
  const receiptsText = receiptsIndex >= 0
    ? batch.summary.slice(receiptsIndex, batch.summary.indexOf('\n\n', receiptsIndex) > 0
      ? batch.summary.indexOf('\n\n', receiptsIndex)
      : batch.summary.length).trim()
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
