/**
 * ToolCallBlock — Tool 调用单行（线② · dsh 照搬）
 *
 * 从「折叠块（chevron + wrench + 名字 + 摘要 + 状态图标）」改为 dsh 的
 * 24px 单行：「[icon] 标题 · 摘要」（2px 点分隔、摘要单行省略）；状态靠
 * 颜色 + shimmer（错误红 / 中断琥珀）。展开为 IN/OUT 双栏卡（参数 JSON + 结果）。
 *
 * 复用线② 三原语：DisclosureRow（24px 流程行）+ StateDot（状态点）+ TextShimmer（流式扫光）。
 * 状态五态映射（spec §2.9）：completed→done / failed→error / running·pending→ongoing /
 * waiting_confirm→warning。
 *
 * 对照 dsh `ToolRow`（`ui-tool/src/client/tool/components/ToolRow.tsx`）。
 * 用 NF 语义令牌，遵循 color-token-standard / card-affordance-standard / ui-interaction-standard。
 */
import { useMemo, useState } from 'react'
import { Wrench, FileText, Search, Terminal, GitCompare } from 'lucide-react'
import { DisclosureRow } from '../../ui/DisclosureRow'
import { TextShimmer } from '../../ui/TextShimmer'
import type { ToolCallInfo } from '../../../services/agent/agent-engine'
import { useTranslation } from '../../../hooks/useTranslation'
import type { TextKey } from '../../../shared/locale'

interface Props {
  toolCall: ToolCallInfo
}

/** 工具图标（按 toolName 分族，dsh 的 PROCESS_ICONS 思路） */
function ToolIcon({ toolName }: { toolName: string }) {
  if (toolName === 'read_file' || toolName === 'read_characters' || toolName === 'read_drafts') {
    return <FileText size={14} style={{ color: 'var(--color-text-muted)' }} />
  }
  if (toolName === 'search_content' || toolName === 'search') {
    return <Search size={14} style={{ color: 'var(--color-text-muted)' }} />
  }
  if (toolName.includes('terminal') || toolName === 'run_command' || toolName === 'execute') {
    return <Terminal size={14} style={{ color: 'var(--color-text-muted)' }} />
  }
  if (toolName === 'diff' || toolName === 'edit_file') {
    return <GitCompare size={14} style={{ color: 'var(--color-text-muted)' }} />
  }
  return <Wrench size={14} style={{ color: 'var(--color-text-muted)' }} />
}

/**
 * 从工具参数提取摘要（read_file → 文件名；chapter_number → 章节；角色名等）。
 * 单行省略展示，末尾段截断。
 */
function fileSummary(toolName: string, args: Record<string, unknown>, t: (key: TextKey) => string): string {
  const path = typeof args.file_path === 'string' ? args.file_path
    : typeof args.path === 'string' ? args.path
    : null
  if (path) {
    return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path
  }
  if (typeof args.chapter_number === 'number') {
    return t('chapter.label').replace('{n}', String(args.chapter_number))
  }
  if (toolName === 'read_characters' && typeof args.character_name === 'string') {
    return args.character_name
  }
  return ''
}

export default function ToolCallBlock({ toolCall }: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const { toolName, arguments: args, status, result, error } = toolCall

  const summary = useMemo(() => fileSummary(toolName, args, t), [toolName, args, t])
  const running = status === 'running' || status === 'pending'
  // 错误态：摘要 = 失败首行（红）。waiting_confirm 在 AgentMessage 层已单独走 ConfirmCard，不会到这里。
  const failed = status === 'failed'
  const summaryText = failed ? (error ?? t('status.failed')) : summary

  // 展开体：IN/OUT 双栏卡（参数 JSON + 结果）。可展开 = 有参数或有结果/错误。
  const hasBody = Object.keys(args).length > 0 || !!result || !!error
  const body = expanded && hasBody ? (
    <div style={{ margin: '4px 0 4px 22px', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          border: '0.5px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--color-hover)',
          display: 'flex',
          flexDirection: 'column',
          fontSize: 'var(--text-micro)',
        }}
      >
        {/* IN：参数 */}
        {Object.keys(args).length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 14, alignItems: 'baseline', padding: '8px 12px', maxHeight: 150, overflowY: 'auto' }}>
            <span style={{ color: 'var(--color-text-muted)', alignSelf: 'start' }}>{t('toolCall.input')}</span>
            <span style={{ minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
              {JSON.stringify(args, null, 2)}
            </span>
          </div>
        )}
        {/* OUT：结果 / 错误 */}
        {(result || error) && (
          <>
            {Object.keys(args).length > 0 && <span style={{ height: '0.5px', background: 'var(--color-border)' }} />}
            <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 14, alignItems: 'baseline', padding: '8px 12px', maxHeight: 150, overflowY: 'auto' }}>
              <span style={{ color: 'var(--color-text-muted)', alignSelf: 'start' }}>{t('toolCall.output')}</span>
              <span style={{ minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: error ? 'var(--color-error)' : 'var(--color-text-secondary)' }}>
                {error ? `❌ ${error}` : result}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  ) : null

  return (
    <div data-tool={toolName} data-state={status}>
      <DisclosureRow
        icon={<ToolIcon toolName={toolName} />}
        title={toolName}
        running={running}
        open={expanded}
        expandable={hasBody}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => setExpanded(v => !v)}
        collapsedContent={
          summaryText ? (
            <>
              {/* 2px 点分隔 */}
              <span aria-hidden style={{ flex: 'none', width: 2, height: 2, margin: '0 8px', borderRadius: 1, background: 'var(--color-text-muted)' }} />
              <span
                style={{
                  flex: '1 1 auto',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 13,
                  lineHeight: '24px',
                  color: failed ? 'var(--color-error)' : 'var(--color-text-muted)',
                }}
              >
                <TextShimmer active={running}>{summaryText}</TextShimmer>
              </span>
            </>
          ) : null
        }
      >
        {body}
      </DisclosureRow>
    </div>
  )
}
