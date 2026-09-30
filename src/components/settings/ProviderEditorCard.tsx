import { useEffect, useId, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { useLLMStore } from '../../stores/llm-store'
import { apiKeyFailure, credentialFailureKey } from '../../shared/credential-rules'
import { LLM_PROTOCOLS, type LLMProtocol } from '../../shared/llm-protocols'
import { BUILTIN_PRESETS } from '../../shared/provider-presets'
import type { CredentialInfo, ProviderAccount } from '../../shared/ipc-channels'
import type { TextKey } from '../../shared/locale'
import { renderLog } from '../../services/render-logger'
import { Button } from '../ui/Button'
import { Disclosure } from '../ui/Disclosure'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select'
import { toast } from '../ui/Toast'

export interface ProviderEditorCardProps {
  /** 编辑对象（打开时的快照；应用时以卡内草稿覆盖 saveProvider 的 account 参数） */
  account: ProviderAccount
  /** 打开这张卡时记下的 providers.json 版本号（v3 §5）——提交带上，别处改过则拒写 */
  revision: number
  /**
   * 该账户 ref 的 `credential:describe` 结果；`undefined` = 还没查到。
   * 驱动密钥框的 placeholder 三态与禁用（env 影子只读）。
   */
  keyInfo: CredentialInfo | undefined
  /** 关闭（取消 / 应用成功后）；`changed` = 是否写过盘（容器据此重拉 describe + 播报「已保存」） */
  onClose: (changed: boolean) => void
  /**
   * 脏草稿上报（**可选**，供容器做「切换行先确认」）。
   *
   * 为什么不把草稿提到容器：卡是唯一知道「哪些字段改过」的地方，草稿上提会让
   * 「应用失败保留草稿」的语义散成两处。容器只记一个布尔 —— 切换行前问它一次。
   */
  onDirtyChange?: (dirty: boolean) => void
}

/**
 * ProviderEditorCard —— 行内编辑卡（模型管理 v3 §2.2，2026-10-01）。
 *
 * 形态：行下展开、一次只开一张（单开由容器保证）；密钥**只写**、自定义设置折叠、[取消][应用]。
 *
 * 三条语义（都来自 spec，别在重构里丢掉）：
 * 1. **只写密钥**（§4.4）：框的初值**恒空** —— 已存的密钥读不回来（值在主进程凭据库里），
 *    空 = 不变更；用户当场输入的键走 `apiKeyDraft` 一次性参数，不进落盘对象。
 * 2. **应用顺序**（§4.7）：先落账户配置（带 revision 校验）→ 成功后才写凭据。
 *    凭据阶段失败时账户**已存**（主进程返回带 revision 的 false）→ 文案必须说清
 *    「配置已保存，密钥未写入」，且**保留草稿**（重试只补凭据这一步）。
 * 3. **失败非死路**：conflict / 失败都不关卡、不丢草稿 —— 关掉的话用户刚敲的密钥就没了。
 *
 * ⚠️ 保存成功的播报（aria-live「已保存 {name}」）**不在这里**：成功即关卡的语义下，
 * 卡挂载的 live region 会在播报前被卸载 —— 由容器（`ProviderRowList`）用重载后的行名播报。
 */
export function ProviderEditorCard({
  account, revision, keyInfo, onClose, onDirtyChange,
}: ProviderEditorCardProps) {
  const { t } = useTranslation()
  const saveProvider = useLLMStore((s) => s.saveProvider)
  const keyFieldId = useId()

  /** 密钥草稿：初值**恒空**（只写语义），提交时 trim 后作为一次性参数 */
  const [keyDraft, setKeyDraft] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [displayName, setDisplayName] = useState(account.displayName ?? '')
  const [baseUrl, setBaseUrl] = useState(account.baseUrl)
  const [protocol, setProtocol] = useState<LLMProtocol>(account.protocol)
  const [saving, setSaving] = useState(false)

  const failure = apiKeyFailure(keyDraft)
  const dirty =
    keyDraft.length > 0 ||
    displayName !== (account.displayName ?? '') ||
    baseUrl !== account.baseUrl ||
    protocol !== account.protocol

  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])

  /** placeholder 三态（v3 §4.5）——env 影子 > 已配置 > ollama 无密钥 > 待输入 */
  const envLocked = keyInfo !== undefined && !keyInfo.writable
  const placeholder = envLocked
    ? t('credential.placeholderEnv').replace('{name}', () => account.apiKeyRef ?? '')
    : keyInfo?.configured
      ? t('credential.placeholderConfigured')
      : account.provider === 'ollama'
        ? t('credential.placeholderOllama')
        : t('credential.placeholderEnter')

  const presetName = BUILTIN_PRESETS.find((p) => p.provider === account.provider)?.displayName ?? account.provider

  const handleApply = async () => {
    // 行内红字已是门控：非法值不提交（主进程还会再判一次 —— 渲染层可被绕过）
    if (failure || saving) return
    setSaving(true)
    const t0 = Date.now()
    try {
      const result = await saveProvider(
        // provider / id / modelNames 不在卡里改（身份 = 凭据词干来源，换家 = 删除重建）
        { ...account, displayName: displayName.trim() || undefined, baseUrl: baseUrl.trim(), protocol },
        undefined,
        revision,
        // 空草稿 = 不改已存密钥（§4.4）；有值 = 主进程按 trim 后的值写入凭据库
        keyDraft.trim() || undefined,
      )
      if (result.conflict) {
        // 一个字节都没写（主进程在写队列内校验）：只提示重载，草稿与卡都留着
        renderLog('error', 'Save:Settings', `provider save conflict: ${account.provider}`)
        toast.error(t('model.conflictReload'))
        return
      }
      if (!result.success) {
        // revision 带上 = **配置已写、凭据阶段失败**（§4.7）→ 文案必须与「什么都没存」区分开，
        // 否则用户会以为要重填整张表单（实际只需再点一次「应用」补密钥）
        const detail = failureText(result.error, t)
        toast.error(result.revision !== undefined
          ? t('credential.keyNotWritten').replace('{error}', () => detail)
          : t('save.failed').replace('{error}', () => detail))
        renderLog('error', 'Save:Settings', `provider save failed: ${account.provider} (${result.error ?? 'unknown'})`)
        return
      }
      renderLog('info', 'Save:Settings', `provider saved: ${account.provider} (${Date.now() - t0}ms)`)
      setKeyDraft('')
      onClose(true)
    } catch (e) {
      // IPC 本身 reject（超时/主进程异常）也要有反馈：否则只有「点了没反应」（同 deleteModel 的教训）
      renderLog('error', 'Save:Settings', `provider save failed: ${account.provider} (${String(e)})`)
      toast.error(t('save.failed').replace('{error}', () => String(e)))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      className="rounded-xl overflow-hidden mx-1 mb-1.5"
      style={{ border: '1px solid var(--color-accent)', backgroundColor: 'var(--color-panel)' }}
    >
      {/* 头：身份（provider 锁定 —— 换家 = 删除重建，凭据词干跟着家走） */}
      <div
        className="flex items-center gap-2 px-3 h-8"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <span className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>
          {displayName.trim() || presetName}
        </span>
        <span className="text-micro flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
          {account.provider}
        </span>
      </div>

      <div className="p-3 space-y-3">
        {/* API 密钥 —— 只写，永不回显 */}
        <div>
          <Label htmlFor={keyFieldId}>{t('credential.keyLabel')}</Label>
          <div className="relative">
            <Input
              id={keyFieldId}
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={keyDraft}
              disabled={envLocked}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder={placeholder}
              aria-label={t('credential.keyLabel')}
              className="pr-9"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              disabled={envLocked}
              title={showKey ? t('action.hideKey') : t('action.showKey')}
              aria-label={showKey ? t('action.hideKey') : t('action.showKey')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center rounded transition-colors text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ width: 20, height: 20 }}
            >
              {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
          {failure && (
            <p className="text-2xs mt-1" style={{ color: 'var(--color-error)' }} role="alert">
              {failureText(failure, t)}
            </p>
          )}
        </div>

        {/* 自定义设置（地址/协议多数场景默认就对；模型目录区由 T7 挂进这里） */}
        <Disclosure label={t('form.advanced')}>
          <div className="space-y-3">
            <div>
              <Label htmlFor={`${keyFieldId}-name`}>{t('form.displayName')}</Label>
              <Input
                id={`${keyFieldId}-name`}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={presetName}
              />
            </div>
            <div>
              <Label htmlFor={`${keyFieldId}-url`}>{t('form.apiAddress')}</Label>
              <Input
                id={`${keyFieldId}-url`}
                value={baseUrl}
                spellCheck={false}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com"
              />
            </div>
            <div>
              <Label>{t('form.protocol')}</Label>
              <Select value={protocol} onValueChange={(v) => setProtocol(v as LLMProtocol)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LLM_PROTOCOLS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{t(p.labelKey)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Disclosure>

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={saving} onClick={() => onClose(false)}>
            {t('action.cancel')}
          </Button>
          <Button size="sm" disabled={saving || failure !== undefined} onClick={() => void handleApply()}>
            {saving ? t('status.saving') : t('action.apply')}
          </Button>
        </div>
      </div>
    </section>
  )
}

/**
 * 拒因码 → 可读文案（`keyBlank` / `keyIllegalCharacters` / `envShadowed`）。
 *
 * 非拒因码（磁盘满/权限这类**技术错误串**）原样展示 —— 排障要看得见原文，
 * 硬套一句「未知错误」会让真机日志与界面都失去线索。
 */
function failureText(code: string | undefined, t: (key: TextKey) => string): string {
  if (!code) return t('status.unknown')
  const key = credentialFailureKey(code)
  return key ? t(key) : code
}
