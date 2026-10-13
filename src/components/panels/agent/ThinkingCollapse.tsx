/**
 * ThinkingCollapse — 对话思考块折叠（线② · dsh 照搬，ReasoningRow 形态）
 *
 * 从「带边框折叠块」改为 dsh 的 24px 折叠行：
 * 「[🧠] 思考 · 首行摘要」（流式时摘要取最新完成段落首行，尾部渐隐）；
 * 展开为 compact markdown（次级排版）。
 *
 * 对照 dsh `ReasoningRow`（`ui-chat/src/client/chat/ReasoningRow.tsx` + `.module.css`）。
 * 单链路化（spec §2 注记）：本组件统一承载 agent-engine 的 `_思考过程_` 前缀拼装（含 #34
 * 工作流命令产出）与 MarkdownContent 的 `<think>` 标签两处思考渲染——同一形态，不再双链路。
 * 用 NF 语义令牌，遵循 color-token-standard / ui-interaction-standard。
 */
import { useMemo, useState } from 'react'
import { Brain } from 'lucide-react'
import { DisclosureRow } from '../../ui/DisclosureRow'
import { TextShimmer } from '../../ui/TextShimmer'
import { useTranslation } from '../../../hooks/useTranslation'

interface Props {
  /** 思考块原文（可能含 `_思考过程：_\n> ...` 前缀） */
  thinking: string
  /** 是否流式生成中（决定首行摘要策略 + 尾部渐隐） */
  streaming?: boolean
}

/** 剥离 `_xxx_\n> ...` 前缀，返回纯思考正文 */
function stripPrefix(text: string): string {
  const m = text.match(/^_[^_\n]+_\n>/)
  if (!m) return text
  const rest = text.slice(m[0].length)
  return rest.replace(/\n> /g, '\n').trimStart()
}

/** 首行（非流式） */
function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

/** 流式：最新完成段落的首行（dsh latestCompletedParagraphFirstLine） */
function latestCompletedParagraphFirstLine(text: string): string {
  // 按空行分段；流式时末段可能未完成，其首行不作摘要
  const paragraphs = text.split(/\r?\n(?:[\t ]*\r?\n)+/)
  // 末段视为「进行中」，排除；若只有一段则取该段首行
  const completed = paragraphs.length > 1 ? paragraphs.slice(0, -1) : paragraphs
  for (let i = completed.length - 1; i >= 0; i--) {
    const first = completed[i]!.split('\n')[0]?.trim() ?? ''
    if (first !== '') return first
  }
  return ''
}

export default function ThinkingCollapse({ thinking, streaming = false }: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const body = useMemo(() => stripPrefix(thinking), [thinking])
  const summaryText = streaming ? latestCompletedParagraphFirstLine(body) : firstLine(body)
  const summary = useMemo(() => summaryText.replaceAll('**', ''), [summaryText])

  const collapsedContent = summary ? (
    <>
      <span aria-hidden style={{ flex: 'none', width: 2, height: 2, margin: '0 8px', borderRadius: 1, background: 'var(--color-text-muted)' }} />
      <span
        style={{
          flex: '1 1 auto',
          minWidth: 0,
          overflow: 'hidden',
          fontSize: 13,
          lineHeight: '24px',
          whiteSpace: 'nowrap',
          ...(streaming ? { maskImage: 'linear-gradient(to right, black calc(100% - 48px), transparent)' } : {}),
        }}
      >
        <span style={{ display: 'block', overflow: 'hidden', textOverflow: streaming ? 'clip' : 'ellipsis' }}>
          <TextShimmer active={streaming}>{summary}</TextShimmer>
        </span>
      </span>
    </>
  ) : null

  return (
    <div data-variant="think" data-state={streaming ? 'running' : 'ok'} data-expanded={expanded || undefined}>
      <DisclosureRow
        icon={<Brain size={14} style={{ color: 'var(--color-text-muted)' }} />}
        title={t('agent.thinkingToggle')}
        running={streaming}
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => setExpanded(v => !v)}
        collapsedContent={collapsedContent}
      >
        {expanded && (
          <div
            style={{
              padding: '4px 0 4px 22px',
              minWidth: 0,
              fontSize: 13,
              lineHeight: 1.6,
              color: 'var(--color-text-secondary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {body}
          </div>
        )}
      </DisclosureRow>
    </div>
  )
}
