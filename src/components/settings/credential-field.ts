/**
 * 密钥框的显示状态（模型管理 v3 §4.5）—— 行内编辑卡与「其他」卡**同口径**的唯一来源。
 *
 * 只写语义下，框里永不回显已存的密钥；用户能看到的只有 placeholder 的三态与是否可编辑：
 * 环境变量影子（只读）> 已配置 > 待输入（Ollama 等原生服务：留空 = 不使用密钥）。
 * 两处各写一套的话，改文案时必然漏一处 —— 于是下沉成这个纯函数（翻译函数由调用方注入）。
 */
import type { CredentialInfo } from '../../shared/ipc-channels'
import type { TextKey } from '../../shared/locale'

export interface CredentialFieldState {
  /** env 影子（值由环境变量提供、不归设置页管）→ 密钥框只读 */
  envLocked: boolean
  /** 只写语义下的 placeholder（三态 + Ollama 特例） */
  placeholder: string
}

export function credentialFieldState(
  info: CredentialInfo | undefined,
  provider: string,
  refName: string | undefined,
  t: (key: TextKey) => string,
): CredentialFieldState {
  const envLocked = info !== undefined && !info.writable
  const placeholder = envLocked
    ? t('credential.placeholderEnv').replace('{name}', () => refName ?? '')
    : info?.configured
      ? t('credential.placeholderConfigured')
      : provider === 'ollama'
        ? t('credential.placeholderOllama')
        : t('credential.placeholderEnter')
  return { envLocked, placeholder }
}
