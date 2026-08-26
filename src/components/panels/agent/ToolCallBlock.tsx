/**
 * ToolCallBlock — Tool 调用可视化区块
 *
 * 显示 Agent 调用的每个 Tool：
 * - 折叠的头部：Tool 名称 + 来源徽章 + 状态指示
 * - 展开的主体：参数 JSON + 执行结果
 *
 * 参考 Cursor/Antigravity 的 tool-use 可视化设计。
 */
import { useState } from 'react'
import {
  Wrench,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
} from 'lucide-react'
import type { ToolCallInfo } from '../../../services/agent/agent-engine'
import { useTranslation } from '../../../hooks/useTranslation'
import type { TextKey } from '../../../shared/locale'

interface Props {
  toolCall: ToolCallInfo
}

/** 状态图标映射 */
function StatusIcon({ status }: { status: ToolCallInfo['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 size={13} className="tool-call-status completed" />
    case 'failed':
      return <XCircle size={13} className="tool-call-status failed" />
    case 'running':
      return <Loader2 size={13} className="tool-call-status running tool-spinner" />
    case 'waiting_confirm':
      return <AlertTriangle size={13} className="tool-call-status waiting_confirm tool-pulse" />
    case 'pending':
    default:
      return <Loader2 size={13} className="tool-call-status running" style={{ opacity: 0.3 }} />
  }
}

/** 状态文字 */
function statusLabel(status: ToolCallInfo['status'], t: (key: TextKey) => string): string {
  switch (status) {
    case 'completed': return t('status.completed')
    case 'failed': return t('status.failed')
    case 'running': return t('status.running')
    case 'waiting_confirm': return t('status.confirming')
    case 'pending': return t('status.pending')
    default: return ''
  }
}

/**
 * 从工具参数提取文件/对象摘要（read_file/read_drafts 等）
 * - file_path / path → 📄 文件名（末尾段）
 * - chapter_number → 📖 章节（走 i18n chapter.label，禁止硬编码中文）
 * - 角色类工具 name 参数 → 👤 角色名
 */
function fileSummary(toolName: string, args: Record<string, unknown>, t: (key: TextKey) => string): string | null {
  const path = typeof args.file_path === 'string' ? args.file_path
    : typeof args.path === 'string' ? args.path
    : null
  if (path) {
    const base = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path
    return `📄 ${base}`
  }
  if (typeof args.chapter_number === 'number') {
    return `📖 ${t('chapter.label').replace('{n}', String(args.chapter_number))}`
  }
  if (typeof args.name === 'string' && ['read_characters', 'update_character_cards'].includes(toolName)) {
    return `👤 ${args.name}`
  }
  return null
}

export default function ToolCallBlock({ toolCall }: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const { toolName, arguments: args, status, result, error, source } = toolCall

  return (
    <div className="tool-call-block">
      {/* 折叠头部 */}
      <div className="tool-call-header" onClick={() => setExpanded(v => !v)}>
        <div className="tool-call-icon">
          <Wrench size={12} style={{ color: 'var(--color-text-muted)' }} />
        </div>

        <span className="tool-call-name">{toolName}</span>

        {/* 文件/章节摘要（📄/📖/👤） */}
        {(() => {
          const summary = fileSummary(toolName, args, t)
          return summary ? (
            <span className="tool-call-file-summary text-[0.65rem] opacity-60 ml-1 truncate max-w-[160px]"
              style={{ color: 'var(--color-text-muted)' }}>
              {summary}
            </span>
          ) : null
        })()}

        {/* 来源徽章 */}
        {source && (
          <span className={`tool-call-source-badge ${source}`}>
            {source === 'builtin' ? t('toolCall.builtin') : source === 'mcp' ? 'MCP' : 'Skill'}
          </span>
        )}

        {/* 状态 */}
        <div className="tool-call-status" style={{ marginLeft: 'auto' }}>
          <StatusIcon status={status} />
          <span>{statusLabel(status, t)}</span>
        </div>

        {/* 展开箭头 */}
        <ChevronRight
          size={12}
          className={`tool-call-arrow ${expanded ? 'expanded' : ''}`}
        />
      </div>

      {/* 展开区域 */}
      {expanded && (
        <div className="tool-call-body">
          {/* 参数 */}
          {Object.keys(args).length > 0 && (
            <div className="tool-call-params">
              {JSON.stringify(args, null, 2)}
            </div>
          )}

          {/* 结果 */}
          {result && (
            <div className="tool-call-result" style={{ position: 'relative' }}>
              {result}
              <button
                onClick={() => navigator.clipboard.writeText(result).catch(() => {})}
                className="absolute top-1 right-1 text-[0.65rem] px-1.5 py-0.5 rounded transition-opacity opacity-0 hover:opacity-100"
                style={{
                  backgroundColor: 'var(--color-hover)',
                  color: 'var(--color-text-secondary)',
                  border: '1px solid var(--color-border)',
                }}
                title={t('toolCall.copyResult')}
              >
                {t('action.copy')}
              </button>
            </div>
          )}

          {/* 错误 */}
          {error && (
            <div className="tool-call-result" style={{ color: '#ef4444' }}>
              ❌ {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
