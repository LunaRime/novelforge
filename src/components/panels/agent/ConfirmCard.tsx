/**
 * ConfirmCard — 操作确认卡片
 *
 * 当 Agent 调用需要确认的 Tool 时显示此卡片。
 * 用户可以批准或拒绝操作。
 */
import { ShieldAlert } from 'lucide-react'
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
  const { id, toolName, arguments: args } = toolCall

  // 生成操作描述
  const description = generateDescription(toolName, args, t)

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
        {Object.keys(args).length > 0 && (
          <div
            style={{
              marginTop: 6,
              padding: '4px 8px',
              borderRadius: 4,
              backgroundColor: 'var(--color-hover)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.68rem',
              color: 'var(--color-text-secondary)',
              whiteSpace: 'pre-wrap',
              maxHeight: 120,
              overflowY: 'auto',
            }}
          >
            {JSON.stringify(args, null, 2)}
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="confirm-card-actions">
        <button
          className="confirm-card-btn reject"
          onClick={() => resolveToolConfirmation(id, false)}
        >
          {t('action.reject')}
        </button>
        <button
          className="confirm-card-btn approve"
          onClick={() => resolveToolConfirmation(id, true)}
        >
          {t('action.approve')}
        </button>
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
    default:
      return t('agentConfirm.defaultAction').replace('{name}', toolName)
  }
}
