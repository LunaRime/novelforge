/**
 * ConfirmCard — 操作确认卡片（线② · dsh 照搬，接管输入区形态）
 *
 * 当 Agent 调用需要确认的 Tool 时显示此卡片（渲染在输入区上方，不进聊天流）。
 * 用户可以批准或拒绝操作；支持快捷键 Enter=允许一次、Esc=拒绝（dsh ApprovalPanel 语义）。
 * 保留「始终允许」（D3 已拍板：NF 的 A 档固化提案不随 dsh 的 allowed-once 收窄）。
 */
import { useEffect } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Button } from '../../ui/Button'
import type { ToolCallInfo } from '../../../services/agent/agent-engine'
import { useAgentStore } from '../../../stores/agent-store'
import { useTranslation } from '../../../hooks/useTranslation'
import type { TextKey } from '../../../shared/locale'

interface Props {
  toolCall: ToolCallInfo
}

export default function ConfirmCard({ toolCall }: Props) {
  const { t } = useTranslation()
  const { resolveToolConfirmation } = useAgentStore()
  const { id, toolName, arguments: args, approval } = toolCall

  // 生成操作描述
  const description = generateDescription(toolName, args, t)

  // A 档：可固化提案 → 「始终允许」按钮（用户照着规则描述判断"记住什么"）
  const rememberPattern = approval?.action === 'prompt' ? approval.remember?.displayPattern : undefined
  const showRiskHint = approval?.risk === 'high' || approval?.risk === 'critical'

  // 快捷键（dsh ApprovalPanel 语义）：Enter = 允许一次、Esc = 拒绝。
  // 防 IME / 防误触：focus 在输入框时不拦截（输入框自己处理 Enter/Esc）；
  // focus 在按钮时 Enter 由按钮自己处理（避免双触发），Esc 仍拒绝。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return
      const el = e.target instanceof Element ? e.target : null
      if (el?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === 'Enter') {
        if (el?.closest('button, a[href], [role="button"]')) return
        e.preventDefault()
        resolveToolConfirmation(id, true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        resolveToolConfirmation(id, false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [id, resolveToolConfirmation])

  return (
    <div className="confirm-card">
      {/* 头部 */}
      <div className="confirm-card-header">
        <ShieldAlert size={14} />
        <span>{t('agent.confirmAction')}</span>
      </div>

      {/* 内容 */}
      <div className="confirm-card-body">
        <div>{description}</div>
        {rememberPattern && (
          <div style={{ marginTop: 4, fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)' }}>
            {t('agentConfirm.rememberHint').replace('{pattern}', rememberPattern)}
          </div>
        )}
        {showRiskHint && (
          <div style={{ marginTop: 4, fontSize: 'var(--text-2xs)', color: 'var(--color-warning)' }}>
            {t('agentConfirm.riskHigh')}
          </div>
        )}
        {Object.keys(args).length > 0 && (
          <div
            style={{
              marginTop: 6,
              padding: '4px 8px',
              borderRadius: 4,
              backgroundColor: 'var(--color-hover)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-2xs)',
              color: 'var(--color-text-secondary)',
              whiteSpace: 'pre-wrap',
              maxHeight: 120,
              overflowY: 'auto',
            }}
          >
            {JSON.stringify(args, null, 2)}
          </div>
        )}
        {/* 快捷键提示（dsh ApprovalPanel：Enter=允许一次、Esc=拒绝） */}
        <div style={{ marginTop: 4, fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)', opacity: 0.7 }}>
          {t('agentConfirm.keyboardHint')}
        </div>
      </div>

      {/* 操作按钮：走 ui/Button —— 原 .confirm-card-btn 系列自带一套配色与 hover，
          其中 .approve:hover 与常态同色（零反馈死规则），且没有焦点环与按下反馈 */}
      <div className="confirm-card-actions">
        <Button variant="outline" size="sm" onClick={() => resolveToolConfirmation(id, false)}>
          {t('action.reject')}
        </Button>
        {rememberPattern && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => resolveToolConfirmation(id, true, true)}
            title={t('agentConfirm.rememberHint').replace('{pattern}', rememberPattern)}
          >
            {t('agentConfirm.alwaysAllow')}
          </Button>
        )}
        <Button variant="success" size="sm" onClick={() => resolveToolConfirmation(id, true)}>
          {t('action.approve')}
        </Button>
      </div>
    </div>
  )
}

/** 根据 Tool 名称生成人类可读的操作描述 */
function generateDescription(
  toolName: string,
  args: Record<string, unknown>,
  t: (key: TextKey) => string,
): string {
  switch (toolName) {
    case 'write_file':
      return t('agentConfirm.writeFile').replace('{path}', String(args.file_path ?? t('agentConfirm.unknownPath')))
    case 'open_editor':
      return t('agentConfirm.openEditor').replace('{path}', String(args.file_path ?? t('agentConfirm.unknownFile')))
    case 'start_workflow': {
      const chapterSuffix = args.chapter_number
        ? t('agentConfirm.chapterSuffix').replace('{n}', String(args.chapter_number))
        : ''
      return t('agentConfirm.startWorkflow')
        .replace('{name}', String(args.workflow ?? t('agentConfirm.unknownWorkflow')))
        .replace('{chapter}', chapterSuffix)
    }
    case 'update_config':
      return t('agentConfirm.updateConfig').replace('{field}', String(args.field ?? t('agentConfirm.unknownField')))
    case 'edit_file':
      return t('agentConfirm.editFile').replace('{path}', String(args.file_path ?? t('agentConfirm.unknownPath')))
    case 'index_content': {
      const name = args.file_name ?? args.chapter_number ?? t('agentConfirm.unknownFile')
      return t('agentConfirm.indexContent').replace('{name}', String(name))
    }
    case 'call_external_api':
      return t('agentConfirm.callExternalApi')
        .replace('{method}', String(args.method ?? 'GET'))
        .replace('{path}', String(args.path ?? t('agentConfirm.unknownPath')))
    default:
      return t('agentConfirm.defaultAction').replace('{name}', toolName)
  }
}
