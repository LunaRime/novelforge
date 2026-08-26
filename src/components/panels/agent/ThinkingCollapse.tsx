/**
 * ThinkingCollapse — 对话思考块折叠组件（默认折叠）
 *
 * 接收 agent-engine 拼装的思考块原文（含 `_${t('agent.thinkingPrefix')}_\n> ...`
 * 前缀），默认折叠为「思考过程」头部，点击展开显示原文。
 * 与 AIOutputPanel ThinkingBlock 默认折叠语义一致。
 */
import { useState } from 'react'
import { ChevronRight, Brain } from 'lucide-react'
import { useTranslation } from '../../../hooks/useTranslation'

interface Props {
  /** 思考块原文（含 `_思考过程_\n> ...` 前缀） */
  thinking: string
}

export default function ThinkingCollapse({ thinking }: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)  // 默认折叠（与 AIOutputPanel ThinkingBlock 语义一致）
  return (
    <div className="mb-1.5 rounded-md border" style={{ borderColor: 'var(--color-border)' }}>
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1.5 px-2 py-1 text-xs w-full text-left transition-colors"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <Brain size={11} style={{ color: 'var(--color-accent)' }} />
        <span className="font-medium">{t('agent.thinkingPrefix')}</span>
        <span className="flex-1" />
        <ChevronRight size={11} className={expanded ? 'rotate-90' : ''} style={{ transition: 'transform 0.15s' }} />
      </button>
      {expanded && (
        <div className="px-3 pb-2 text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
          {thinking}
        </div>
      )}
    </div>
  )
}
