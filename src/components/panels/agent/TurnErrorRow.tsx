/**
 * TurnErrorRow — Turn 级错误行（线② · dsh 照搬）
 *
 * 助手回复失败时的专用错误行：状态点（error）+ 人类化文案 + code（可选）。
 * 对照 dsh `TurnErrorItem`（`ui-chat/src/client/chat/MessageItem.tsx`）：
 * 状态点 + 标题/正文两行 + 尾部 code 标签。
 * 用 NF 语义令牌（--color-error），遵循 color-token-standard。
 */
import { StateDot } from '../../ui/StateDot'
import { useTranslation } from '../../../hooks/useTranslation'

interface Props {
  message: string
  code?: string
}

export default function TurnErrorRow({ message, code }: Props) {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '4px 0' }}
    >
      <span style={{ paddingTop: 3, flexShrink: 0 }}>
        <StateDot state="error" />
      </span>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--color-error)' }}>
          {t('agent.turnError')}
        </span>
        <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {message}
        </span>
      </div>
      {code && (
        <code
          style={{
            flexShrink: 0,
            marginLeft: 'auto',
            padding: '1px 6px',
            borderRadius: 4,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--color-text-muted)',
            backgroundColor: 'var(--color-hover)',
          }}
        >
          {code}
        </code>
      )}
    </div>
  )
}
