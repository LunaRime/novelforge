import { useTranslation } from '../../hooks/useTranslation'
import type { CredentialInfo } from '../../shared/ipc-channels'

export interface CredentialDotProps {
  /** `credential:describe` 的单项结果；`undefined` = 尚未查到（无灯） */
  info: CredentialInfo | undefined
  /** 凭据引用名（= 环境变量名）—— `source === 'env'` 时进 tooltip，让用户知道该去改哪里 */
  refName?: string
}

/**
 * CredentialDot —— 行上的**三态凭据灯**（模型管理 v3 §4.5）。
 *
 * | 状态 | 判据 | 呈现 |
 * |---|---|---|
 * | 绿 | `configured` | 「密钥已配置」（`source === 'env'` 时点明来源，见下） |
 * | 红 | `!configured`（ref 已分配但 env/store 皆无） | 「未配置密钥」 |
 * | 无灯 | `info === undefined`（describe 未完成/失败） | 不渲染 |
 *
 * 「无灯」不是错误态：凭据是**增强信息**，describe 失败只降级灯，不阻塞行、不弹提示
 * （设置段其余功能照常）。所以这里刻意不给灰灯 —— 灰灯会被读成「未配置」，
 * 而「没查到」与「确实没有」在这个位置的含义完全不同（一个要重试，一个要去填）。
 *
 * `source === 'env'`（环境变量影子）时灯仍是绿的，但 tooltip/aria-label 换成
 * 「由环境变量 X 提供（只读）」—— **值的来源要显式可见**：这类账户在应用里改密钥会被
 * 主进程拒绝（`envShadowed`），不说明来源的话用户只会看到「改了没反应」。
 */
export function CredentialDot({ info, refName }: CredentialDotProps) {
  const { t } = useTranslation()
  if (!info) return null

  const fromEnv = info.source === 'env'
  const label = info.configured
    ? fromEnv
      ? t('credential.dotEnv').replace('{name}', () => refName ?? '')
      : t('credential.dotConfigured')
    : t('credential.dotMissing')

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="inline-block rounded-full flex-shrink-0"
      style={{
        width: 8,
        height: 8,
        backgroundColor: info.configured ? 'var(--color-success)' : 'var(--color-error)',
      }}
    />
  )
}
