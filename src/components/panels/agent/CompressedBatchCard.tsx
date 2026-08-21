import { useState } from 'react'
import type { CompressedBatch } from '../../../services/agent/archive-codec'
import { t } from '../../../shared/locale'

/** CCR 压缩事件卡片：摘要 + 展开恢复原文（设计 §4.4） */
export default function CompressedBatchCard({ batch }: { batch: CompressedBatch }) {
  const [expanded, setExpanded] = useState(false)
  const savedTokens = batch.originalTokens

  return (
    <div
      className="mx-2 my-2 rounded-lg px-3 py-2 text-xs"
      style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px dashed var(--color-border)' }}
    >
      <div className="flex items-center justify-between">
        <span style={{ color: 'var(--color-text-secondary)' }}>
          {t('ccr.compressedNotice').replace('{n}', String(batch.original.length))}
          {savedTokens > 0 && ` · ${t('ccr.savedTokens').replace('{n}', String(savedTokens))}`}
        </span>
        <button
          onClick={() => setExpanded(e => !e)}
          style={{ color: 'var(--color-accent)' }}
          className="hover:underline"
        >
          {expanded ? t('ccr.collapse') : t('ccr.expand')}
        </button>
      </div>
      <div className="mt-1 whitespace-pre-wrap">{batch.summary}</div>
      {expanded && batch.original.length > 0 && (
        <div
          className="mt-2 max-h-48 overflow-y-auto rounded px-2 py-1"
          style={{ backgroundColor: 'var(--color-bg-hover)' }}
        >
          {batch.original.map(m => (
            <div key={m.id} className="mb-1">
              <span style={{ color: 'var(--color-text-secondary)' }}>{m.role === 'user' ? t('ccr.roleUser') : t('ccr.roleAssistant')}: </span>
              {m.content}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
