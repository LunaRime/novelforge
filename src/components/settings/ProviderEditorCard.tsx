import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { useLLMStore } from '../../stores/llm-store'
import { apiKeyFailure, credentialFailureKey } from '../../shared/credential-rules'
import { LLM_PROTOCOLS, type LLMProtocol } from '../../shared/llm-protocols'
import { BUILTIN_PRESETS } from '../../shared/provider-presets'
import { effectiveCatalogFor, isModelOfAccount } from '../../shared/provider-accounts'
import type { CredentialInfo, ProviderAccount } from '../../shared/ipc-channels'
import type { TextKey } from '../../shared/locale'
import { renderLog } from '../../services/render-logger'
import { Button } from '../ui/Button'
import { Disclosure } from '../ui/Disclosure'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select'
import { toast } from '../ui/Toast'
import { credentialFieldState } from './credential-field'
import { blockingReferences } from './model-references'
import {
  ModelCatalogEditor, catalogModelNames, catalogOverrides, catalogsEqual, initialCatalogDraft,
  type ModelDraft,
} from './ModelCatalogEditor'

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
  /**
   * 添加卡内的**内嵌形态**（模型管理 v3 §2.3）：不出卡头、不画卡片外观 ——
   * 标题、边框与底色由添加卡（模式标题 + 一张卡）提供，避免卡中卡的双层描边。
   */
  hideTitle?: boolean
  /** 添加卡的「自定义 API」模式：自定义设置**默认展开** —— 地址/协议是路由字段，不是次要项 */
  advancedOpen?: boolean
  /**
   * 写入 / 探测进行中上报（添加卡据此锁住两模式的分段切换）。
   * `saving || 候选面板打开`：后者是模态，理论上点不到背后的分段控件，锁是第二道防线。
   */
  onBusyChange?: (busy: boolean) => void
}

/**
 * ProviderEditorCard —— 行内编辑卡（模型管理 v3 §2.2，2026-10-01）。
 *
 * 形态：行下展开、一次只开一张（单开由容器保证）；密钥**只写**、自定义设置折叠、[取消][应用]。
 * T9 起也承载添加卡的内嵌形态（`hideTitle`/`advancedOpen`）—— 同一张卡，两种外壳。
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
  account, revision, keyInfo, onClose, onDirtyChange, hideTitle = false, advancedOpen = false, onBusyChange,
}: ProviderEditorCardProps) {
  const { t } = useTranslation()
  const saveProvider = useLLMStore((s) => s.saveProvider)
  const models = useLLMStore((s) => s.models)
  const loadProviders = useLLMStore((s) => s.loadProviders)
  const loadModels = useLLMStore((s) => s.loadModels)
  const keyFieldId = useId()

  /** 密钥草稿：初值**恒空**（只写语义），提交时 trim 后作为一次性参数 */
  const [keyDraft, setKeyDraft] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [displayName, setDisplayName] = useState(account.displayName ?? '')
  const [baseUrl, setBaseUrl] = useState(account.baseUrl)
  const [protocol, setProtocol] = useState<LLMProtocol>(account.protocol)
  const [saving, setSaving] = useState(false)
  /** 候选 Modal（探测）是否开着 —— 上报给添加卡做模式切换锁（见 onBusyChange） */
  const [catalogBusy, setCatalogBusy] = useState(false)
  /** 上次提交撞了 revision 冲突 —— 卡内给一条「重新加载」的就地出口（见 handleReload） */
  const [conflict, setConflict] = useState(false)
  /** 上一次见到的 provider —— 用于识别「换家」（只有添加卡会换；编辑卡的 provider 锁定） */
  const providerRef = useRef(account.provider)

  /** 本账户的派生条目 —— 目录区的初值/placeholder/用途标签来源（按 id 前缀取，别拿全局表） */
  const accountModels = useMemo(
    () => models.filter((m) => isModelOfAccount(m.id, account.id)),
    [models, account.id],
  )
  /** 目录草稿（`undefined` = 继承内置目录，三态之一） */
  const [catalog, setCatalog] = useState<ModelDraft[] | undefined>(
    () => initialCatalogDraft(account.modelNames, accountModels),
  )
  /** 目录行级校验（id 空/重复、容量非法）—— 坏行拦的是**整张卡**的「应用」 */
  const [catalogValid, setCatalogValid] = useState(true)

  /**
   * 初值每渲染重算（纯函数、行数很小）：不缓存引用就能直接做「脏没脏」比较，
   * 也不必在 `models` 重载后手动同步 —— 卡片打开期间重载只影响 placeholder。
   */
  const initialCatalog = initialCatalogDraft(account.modelNames, accountModels)

  const failure = apiKeyFailure(keyDraft)
  const dirty =
    keyDraft.length > 0 ||
    displayName !== (account.displayName ?? '') ||
    baseUrl !== account.baseUrl ||
    protocol !== account.protocol ||
    !catalogsEqual(initialCatalog, catalog)

  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])

  /** 写入 / 探测中上报（添加卡据此锁模式切换） */
  useEffect(() => { onBusyChange?.(saving || catalogBusy) }, [saving, catalogBusy, onBusyChange])

  /**
   * 换家重播种（**只有添加卡会发生**：目录模式的 provider 下拉）。
   *
   * `provider` 是身份（凭据词干跟着家走，见 §3.1），它的预设决定 protocol/baseUrl ——
   * 换家后旧家的地址与协议不成立，必须跟着换（否则会把 OpenAI 的地址存进 DeepSeek 账户）。
   * 卡内别的草稿不动：密钥与家无关；目录的**继承源**变了，故已物化的清单回落继承态
   * （留着就是上一家的模型名，写进去只会是个坏账户）。
   *
   * 编辑卡不会触发：`account` 是打开时的快照，provider 锁定（换家 = 删除重建）。
   */
  useEffect(() => {
    if (account.provider === providerRef.current) return
    providerRef.current = account.provider
    setProtocol(account.protocol)
    setBaseUrl(account.baseUrl)
    setCatalog(undefined)
  }, [account.provider, account.protocol, account.baseUrl])

  /** placeholder 三态（v3 §4.5）——env 影子 > 已配置 > ollama 无密钥 > 待输入（与「其他」卡同口径） */
  const { envLocked, placeholder } = credentialFieldState(keyInfo, account.provider, account.apiKeyRef, t)

  /**
   * 显示名**仅自定义账户可编**（v3 §3.1）：预设家的名字由预设给（改了也没处显示）。
   * 组合 patch 时只在这条成立时才带上 displayName —— 否则会把存量账户上的显示名静默清掉。
   */
  const canEditDisplayName = account.provider === 'custom'

  const presetName = BUILTIN_PRESETS.find((p) => p.provider === account.provider)?.displayName ?? account.provider

  /**
   * 「获取可用模型」的凭据快照（v3 §4.7）—— 用**卡内的草稿值**（地址可能刚改、密钥可能刚敲），
   * 不是账户上的旧值。`undefined` = 入口禁用：地址空、或密钥草稿本身不合法（那种键拿去探测
   * 只会换回一个 401，不如先把红字改掉）。`saving` 期间由 `disabled` 一并锁住。
   */
  const fetchCredentials = baseUrl.trim() !== '' && failure === undefined
    ? {
      protocol,
      baseUrl: baseUrl.trim(),
      apiKeyRef: account.apiKeyRef,
      // 空草稿 = 不提供（主进程按 ref 解析）；有值即胜出（typed key wins）
      ...(keyDraft.trim() ? { apiKeyDraft: keyDraft.trim() } : {}),
    }
    : undefined

  /**
   * conflict 的就地出口：重读盘上真值（账户 + revision + 派生条目 + 凭据状态）。
   *
   * 草稿**原样留着** —— 这正是冲突后用户要的：另一窗口写完之后，他手上这份编辑仍然算数，
   * 只要版本号跟上，再点一次「应用」即可写入。不自动重载：那会把用户还没提交的修改
   * 与另一窗口的结果静默合并，冲突提示就失去意义了（T6 评审 Minor ④ 的收编）。
   */
  const handleReload = async () => {
    await Promise.all([loadProviders(), loadModels()])
    setConflict(false)
  }

  const handleApply = async () => {
    // 行内红字已是门控：非法值不提交（主进程还会再判一次 —— 渲染层可被绕过）
    if (failure || saving || !catalogValid) return

    /**
     * 引用检查（v2 有、v3 重建时丢掉的守卫，2026-10-01 终审 I1）：
     * 目录区**删行 / 恢复默认会真的删掉派生条目**（主进程 `syncAccountModels` 按下发清单重建），
     * 而默认模型、三层路由、会话、向量配置都按 id 引用它们 —— 不查就提交，删完是一串悬空 id：
     * 界面报「已保存」，状态栏/工作流那边报未配置，只能人工修。
     *
     * 被引用 → **整张卡不提交**（草稿保留，用户改掉引用再点一次即可），与删账户同一句文案。
     * 差集口径走 `effectiveCatalogFor`（与同步函数同源）：空数组/缺省 = 继承内置目录，
     * 用 `??` 直算会把「删光 = 恢复默认」误判成「删光全部条目」（对自带内置目录的家是假警报）。
     */
    const nextNames = catalogModelNames(catalog)
    const kept = effectiveCatalogFor({ provider: account.provider, modelNames: nextNames })
    const removed = accountModels.filter((m) => !kept.includes(m.modelName.trim())).map((m) => m.id)
    const blocking = removed.length > 0 ? blockingReferences(removed) : null
    if (blocking) {
      renderLog('warn', 'Save:Settings', `provider save blocked by references: ${account.provider} → ${blocking}`)
      toast.error(t('provider.referenced').replace('{list}', () => blocking))
      return
    }

    setConflict(false)
    setSaving(true)
    const t0 = Date.now()
    try {
      /** 目录清单：`undefined` = 继承（三态的原样表达）；空数组 = 空目录（主进程按继承语义重建） */
      const modelNames = catalogModelNames(catalog)
      const result = await saveProvider(
        // provider / id 不在卡里改（身份 = 凭据词干来源，换家 = 删除重建）；
        // modelNames 由目录区接管（清单 + 逐行差异在同一次提交里落盘，不留半成品）
        {
          ...account,
          ...(canEditDisplayName ? { displayName: displayName.trim() || undefined } : {}),
          baseUrl: baseUrl.trim(),
          protocol,
          modelNames,
        },
        undefined,
        revision,
        // 空草稿 = 不改已存密钥（§4.4）；有值 = 主进程按 trim 后的值写入凭据库
        keyDraft.trim() || undefined,
        // 只带改过的字段 —— 没碰过的容量/名字不该覆盖条目上的真值（§3.4 合并语义）
        catalogOverrides(catalog, accountModels),
      )
      if (result.conflict) {
        // 一个字节都没写（主进程在写队列内校验）：草稿与卡都留着，卡内给一条就地「重新加载」
        renderLog('error', 'Save:Settings', `provider save conflict: ${account.provider}`)
        setConflict(true)
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
      className={`rounded-xl overflow-hidden${hideTitle ? '' : ' mx-1 mb-1.5'}`}
      style={hideTitle ? undefined : { border: '1px solid var(--color-accent)', backgroundColor: 'var(--color-panel)' }}
    >
      {/* 头：身份（provider 锁定 —— 换家 = 删除重建，凭据词干跟着家走）。
          添加卡内嵌形态（hideTitle）不出卡头：标题由添加卡的模式承担，边框/底色也由它给。 */}
      {!hideTitle && (
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
      )}

      <div className={hideTitle ? 'space-y-3' : 'p-3 space-y-3'}>
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

        {/* 自定义设置（地址/协议多数场景默认就对；模型目录区由 T7 挂进这里）。
            advancedOpen：添加卡的「自定义 API」模式把它默认摊开 —— 那模式下这些都是路由字段 */}
        <Disclosure label={t('form.advanced')} defaultOpen={advancedOpen}>
          <div className="space-y-3">
            {/* 显示名仅自定义账户可编（预设家的名字由预设给；字段出现也只是个改不动的东西） */}
            {canEditDisplayName && (
              <div>
                <Label htmlFor={`${keyFieldId}-name`}>{t('form.displayName')}</Label>
                <Input
                  id={`${keyFieldId}-name`}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={presetName}
                />
              </div>
            )}
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

            {/* 模型目录（v3 §2.3）：三态 + 行内展开 + 「获取可用模型」（T8） */}
            <div style={{ borderTop: '1px solid var(--color-border)' }} className="pt-2">
              <ModelCatalogEditor
                provider={account.provider}
                existing={accountModels}
                value={catalog}
                onChange={setCatalog}
                onValidityChange={setCatalogValid}
                onBusyChange={setCatalogBusy}
                fetchCredentials={fetchCredentials}
                disabled={saving}
              />
            </div>
          </div>
        </Disclosure>

        {/* conflict 的就地出口：提示 + 一个真能点的动作（此前只有 toast 里一句「请重载」，
            而「重载」在界面上无路可走 —— 编辑卡会随设置段标签切走而卸载，草稿一起没） */}
        {conflict && (
          <div className="flex items-center gap-2" role="alert">
            <span className="text-2xs flex-1" style={{ color: 'var(--color-warning)' }}>
              {t('model.conflictReload')}
            </span>
            <Button variant="outline" size="sm" disabled={saving} onClick={() => void handleReload()}>
              {t('action.reload')}
            </Button>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={saving} onClick={() => onClose(false)}>
            {t('action.cancel')}
          </Button>
          <Button size="sm" disabled={saving || failure !== undefined || !catalogValid} onClick={() => void handleApply()}>
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
