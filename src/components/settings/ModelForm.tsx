/* eslint-disable react-refresh/only-export-components -- 有意混合导出：tokenSpec 与 ModelForm
   强关联（切换预设即重算规格），拆文件只会把一处内聚逻辑劈两半；Button.tsx 同款先例。 */
/**
 * ModelForm — 「其他」卡（无归属手工条目）的行内编辑表单（模型管理 v3 §2.8）。
 *
 * 一体的供应商卡退役后，本表单只服务一种情形：`models.json` 里**不属于任何供应商账户**的
 * 历史条目（P3 兼容层，可见可编辑可删、不自动迁移）。它的 provider/地址是用户手填的，
 * 猜错了会静默改掉他的端点，所以这里保留完整的 provider / 地址 / 模型标识字段。
 *
 * 凭据**只写**（v3 §4.4）：框里恒空（已存的键读不回来），输入的值走一次性 `apiKeyDraft`；
 * placeholder 三态与行内编辑卡同口径（`credential-field.ts`，两处各写一套必然漂移）。
 */
import { useEffect, useRef, useState } from 'react'
import { Download, Eye, EyeOff, Save, Zap } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Disclosure } from '../ui/Disclosure'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../ui/Select'
import { PopoverSurface } from '../ui/PopoverSurface'
import { useOutsideClick } from '../../hooks/useOutsideClick'
import { useTranslation } from '../../hooks/useTranslation'
import { useLLMStore } from '../../stores/llm-store'
import type { CredentialInfo, ModelProfile } from '../../shared/ipc-channels'
import { LLM_PROTOCOLS, type LLMProtocol } from '../../shared/llm-protocols'
import type { ModelPreset, ProviderPreset } from '../../shared/provider-presets'
import { MAX_TOKENS_CAP } from '../../shared/llm-constants'
import { credentialFieldState } from './credential-field'

/**
 * 从预设取「该模型的 token 规格」—— `maxTokens`（输出）与 `contextWindow`（窗口）**成对**返回。
 *
 * 成对的理由：切换预设模型 = 切换它的规格，两个数本就属于同一个模型，分开更新会留下
 * 「旧窗口 + 新输出上限」这种自相矛盾的组合。
 *
 * `contextWindow` 省略时取 `maxTokens`（预设里只在该模型真实窗口 ≠ 上限时才显式写它，
 * 避免 30+ 条重复数字漂移 —— 见 `provider-presets.ts` 的类型注释）。
 */
export function tokenSpec(
  presetModel: ModelPreset | null | undefined,
  fallbackMaxTokens: number,
): Pick<ModelProfile, 'maxTokens' | 'contextWindow'> {
  const maxTokens = presetModel?.maxTokens ?? fallbackMaxTokens
  return { maxTokens, contextWindow: presetModel?.contextWindow ?? maxTokens }
}

/**
 * 「这个条目有可用的凭据来源」—— 测试连接与保存共用的 gating 判据。
 *
 * v3 T5 起两种来源（都**不是**条目上的值，类型上已经没有 `apiKey` 了）：
 * 凭据引用 `apiKeyRef`（值在凭据库里，由主进程解析）或**表单里刚输入的草稿**。
 * ⚠️ 两处判据必须同源，否则同一状态下测试能点、保存不能点，用户只会当成 bug。
 */
function hasUsableKey(model: ModelProfile, keyDraft: string): boolean {
  return Boolean(model.apiKeyRef || keyDraft.trim()) || model.provider === 'ollama'
}

/** 模型编辑表单（「其他」卡专用） */
export function ModelForm({
  model, onChange, onSave, onCancel, saving, presets, keyInfo,
}: {
  model: ModelProfile
  onChange: (m: ModelProfile) => void
  /** 保存：`apiKeyDraft` = 本次输入的密钥（空 = 不变更已存值）——一次性参数，不进 model */
  onSave: (apiKeyDraft?: string) => void
  onCancel: () => void
  saving: boolean
  /** 服务商预设（来自 BUILTIN_PRESETS 常量） */
  presets: ProviderPreset[]
  /**
   * 该条目 `apiKeyRef` 的 describe 结果（`undefined` = 还没查到 / 该条目尚无 ref）。
   * 驱动密钥框的 placeholder 三态与 env 只读（与行内编辑卡同口径）。
   */
  keyInfo?: CredentialInfo
}) {
  const { t } = useTranslation()
  const [showKey, setShowKey] = useState(false)
  /**
   * 密钥草稿（v3 §4.4 只写语义）：初值**恒空**（已存的键读不回来，框里空 = 不变更）。
   */
  const [keyDraft, setKeyDraft] = useState('')
  // 标记"模型标识"是否使用自定义输入模式
  const [customModelName, setCustomModelName] = useState(false)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean, error?: string } | null>(null)
  const testConnection = useLLMStore(s => s.testConnection)

  // 「获取模型」面板（2026-09-28）：用**当前表单值**（含未保存的 key）探测端点，
  // 拉回候选点选填入——与供应商区同一 store action（listProviderModels）
  const [fetchPanelOpen, setFetchPanelOpen] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [fetchCandidates, setFetchCandidates] = useState<string[]>([])
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [fetchQuery, setFetchQuery] = useState('')
  const fetchPanelRef = useRef<HTMLDivElement | null>(null)
  useOutsideClick(fetchPanelRef, () => setFetchPanelOpen(false), fetchPanelOpen)
  // Esc 关闭面板：必须 capture + stopImmediatePropagation —— 设置弹窗自己也挂了 window 级
  // Esc（bubble 阶段，useEscapeKey），不阻断的话一次 Esc 会连设置弹窗一起关掉（丢未保存编辑）。
  // 2026-09-28 整分支复核 I2（通用 Esc 栈是更大的独立任务，此处局部修复本面板的冲突）。
  useEffect(() => {
    if (!fetchPanelOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      e.preventDefault()
      setFetchPanelOpen(false)
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [fetchPanelOpen])

  const doFetchModels = async () => {
    setFetching(true)
    setFetchError(null)
    const res = await useLLMStore.getState().listProviderModels({
      provider: model.provider, protocol: model.protocol,
      // 密钥二选一（v3 §4.7）：表单里刚敲的草稿优先，否则按 apiKeyRef 解析
      //（与 ProviderAccountsSection 同一处口径）
      apiKeyDraft: keyDraft.trim() || undefined,
      apiKeyRef: model.apiKeyRef,
      baseUrl: model.baseUrl,
    })
    setFetching(false)
    setFetchPanelOpen(true)
    if (!res.success) {
      setFetchError(res.error ?? t('status.unknown'))
      setFetchCandidates([])
      return
    }
    setFetchCandidates((res.models ?? []).map((m) => m.id)) // 候选带规格后取 id（面板当前只用名字；规格在 v2 批量采纳时消费）
    if ((res.models ?? []).length === 0) setFetchError(t('provider.fetchedEmpty'))
  }

  const isEmbedding = model.purposes?.includes('embedding')
  // 将预设数组转换为以 provider 为键的 Map 方便查找
  const presetMap = new Map(presets.map((p) => [p.provider, p]))
  const preset = presetMap.get(model.provider)
  // 生成模型列表为 ModelPreset[]，embedding 模型为 string列表转换过来的 ModelPreset
  const presetModels: import('../../shared/provider-presets').ModelPreset[] = isEmbedding
    ? (preset?.embeddingModels ?? []).map((name) => ({ name, maxTokens: 0 }))
    : (preset?.models ?? [])

  /** 更新单个字段 */
  const up = <K extends keyof ModelProfile>(key: K, val: ModelProfile[K]) =>
    onChange({ ...model, [key]: val })

  /**
   * 切换服务商：从持久化预设中自动填充 baseUrl / protocol
   * 并将模型名重置为该服务商的第一个预设模型
   */
  const handleProviderChange = (provider: ModelProfile['provider']) => {
    const oldPreset = presetMap.get(model.provider)
    const p = presetMap.get(provider)
    const firstModel = isEmbedding ? null : (p?.models[0] ?? null)
    const defaultModelName = isEmbedding
      ? (p?.embeddingModels[0] ?? '')
      : (firstModel?.name ?? '')
    setCustomModelName(false)
    onChange({
      ...model,
      provider,
      protocol: (p?.protocol ?? 'openai') as 'openai' | 'gemini',
      // 保护已填配置（误触 provider 不再清空，P3 修复）：
      // - baseUrl 是用户自定义值（≠ 旧 provider 默认）时保留
      // - modelName 处于自定义输入模式时保留
      baseUrl: (model.baseUrl && oldPreset && model.baseUrl !== oldPreset.baseUrl)
        ? model.baseUrl
        : (p?.baseUrl ?? ''),
      modelName: (customModelName && model.modelName)
        ? model.modelName
        : defaultModelName,
      ...tokenSpec(firstModel, model.maxTokens),
    })
  }

  /** 选择预设模型或切换到自定义输入 */
  const handleModelSelect = (val: string) => {
    if (val === '__custom__') {
      setCustomModelName(true)
      up('modelName', '')
    } else {
      setCustomModelName(false)
      // 找到对应的 ModelPreset，同时更新 modelName 和 maxTokens
      const matched = presetModels.find((m) => m.name === val)
      onChange({
        ...model,
        modelName: val,
        ...tokenSpec(matched, model.maxTokens),
      })
    }
  }


  // 当前模型名是否在预设列表里（决定下拉框显示）
  const isPresetValue = presetModels.some((m) => m.name === model.modelName)
  const selectValue = customModelName || (!isPresetValue && presetModels.length > 0)
    ? '__custom__'
    : model.modelName

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    // 草稿密钥优先（typed key wins）：刚敲的键要能当场验证，不必先保存一轮
    const result = await testConnection(model, keyDraft.trim() || undefined)
    setTestResult(result)
    setTesting(false)
    setTimeout(() => setTestResult(null), 3000)
  }

  /** 密钥框状态（只写 placeholder 三态 + env 影子只读）——与行内编辑卡同一条判据 */
  const { envLocked, placeholder } = credentialFieldState(keyInfo, model.provider, model.apiKeyRef, t)

  return (
    <div
      className="rounded-xl p-5 space-y-4"
      style={{ border: '1.5px solid var(--color-accent)', backgroundColor: 'var(--color-panel)' }}
    >
      <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
        {model.name ? t('model.editConfig').replace('{name}', model.name) : t('model.newConfig')}
      </h3>

      {/* 显示名称 */}
      <div>
        <Label>{t('form.displayName')}</Label>
        <Input
          value={model.name}
          onChange={(e) => up('name', e.target.value)}
          placeholder={t('model.namePlaceholder')}
        />
      </div>

      {/* 服务商 + 协议 */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t('form.provider')}</Label>
          <Select value={model.provider} onValueChange={(v) => handleProviderChange(v as ModelProfile['provider'])}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {/* 单源（presets = BUILTIN_PRESETS，含 pi-ai 移植的 9 家新供应商——2026-09-29 复核 I3：
                  旧硬编码 6 项让新家的值匹配不到 Item，Radix 渲染空白且选不回原值）；当前值兜底防"单向陷阱" */}
              {presets.map((p) => (
                <SelectItem key={p.provider} value={p.provider}>{p.displayName ?? p.provider}</SelectItem>
              ))}
              {!presets.some((p) => p.provider === model.provider) && (
                <SelectItem value={model.provider}>{model.provider}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t('form.protocol')}</Label>
          {/* 选项来自协议单源（src/shared/llm-protocols.ts）——加协议只需注册表加员，
              此处与 llm-factory 自动同步（"UI 可选集 ≡ 适配器可服务集"） */}
          <Select value={model.protocol} onValueChange={(v) => up('protocol', v as LLMProtocol)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LLM_PROTOCOLS.map((p) => (
                <SelectItem key={p.id} value={p.id}>{t(p.labelKey)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* API Key —— 刻意排在自定义设置**之前**：它是本表单唯一必填的凭据，
          而下面的模型标识/地址多能从预设带出，属可折叠的次要项 */}
      <div>
        <Label>{t('form.apiKey')}</Label>
        <div className="relative">
          <Input
            type={showKey ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            value={keyDraft}
            disabled={envLocked}
            onChange={(e) => setKeyDraft(e.target.value)}
            placeholder={placeholder}
            aria-label={t('form.apiKey')}
            className="pr-9"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            disabled={envLocked}
            title={showKey ? t('action.hideKey') : t('action.showKey')}
            aria-label={showKey ? t('action.hideKey') : t('action.showKey')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>

      {/* 自定义设置（默认收起）：地址默认值本来就是对的一般用户不必看见；
          模型标识同理（上面选了服务商就已带出默认模型） */}
      <Disclosure label={t('form.advanced')}>
        {/* 模型标识：有预设时显示下拉，否则纯输入 */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <Label className="mb-0">{t('form.modelId')}</Label>
            <div className="flex items-center gap-2">
              {presetModels.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (customModelName) {
                      // 切回预设列表
                      const first = presetModels[0]
                      setCustomModelName(false)
                      onChange({ ...model, modelName: first.name, ...tokenSpec(first, model.maxTokens) })
                    } else {
                      // 切换到自定义输入
                      setCustomModelName(true)
                      up('modelName', '')
                    }
                  }}
                  className="text-xs transition-colors"
                  style={{ color: 'var(--color-accent)' }}
                >
                  {customModelName ? t('form.selectFromList') : t('form.manualInput')}
                </button>
              )}
              {/* 获取模型（2026-09-28）：用当前表单值探测端点——与供应商区同一 action；
                  anchorName 供下方候选面板定位（CSS 锚点模式） */}
              <button
                type="button"
                onClick={() => void doFetchModels()}
                disabled={fetching || !model.baseUrl}
                aria-expanded={fetchPanelOpen}
                className="inline-flex items-center gap-1 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ color: 'var(--color-accent)', anchorName: '--model-fetch' } as React.CSSProperties}
              >
                <Download size={12} />
                {fetching ? t('provider.fetching') : t('provider.fetchModels')}
              </button>
            </div>
          </div>

          {/* 有预设模型 且 未切到手动输入 → 显示下拉 */}
          {presetModels.length > 0 && !customModelName ? (
            <Select value={selectValue} onValueChange={handleModelSelect}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {presetModels.map((m) => (
                  <SelectItem key={m.name} value={m.name}>{m.name}</SelectItem>
                ))}
                <SelectItem value="__custom__">{t('form.manualOption')}</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <div>
              <Input
                value={model.modelName}
                onChange={(e) => up('modelName', e.target.value)}
                placeholder={isEmbedding ? 'text-embedding-3-small' : 'gpt-4o'}
                autoFocus={customModelName}
              />
            </div>
          )}

          {/* 候选面板：拉取结果 + 搜索 + 点选填入（点选 = 切手动输入模式，
              预设下拉不含拉取结果，直接赋值会让 Select 处于「值不在选项里」的非法态） */}
          {fetchPanelOpen && (
            <PopoverSurface anchorName="--model-fetch" placement="below-end" className="p-1.5" style={{ width: 260 }}>
              <div ref={fetchPanelRef}>
                <Input
                  type="search"
                  className="h-6 text-micro mb-1"
                  value={fetchQuery}
                  onChange={(e) => setFetchQuery(e.target.value)}
                  placeholder={t('provider.searchPlaceholder')}
                  aria-label={t('provider.searchPlaceholder')}
                />
                {fetchError && (
                  <p className="text-2xs px-1 py-0.5" style={{ color: 'var(--color-error)' }}>{fetchError}</p>
                )}
                <div className="max-h-48 overflow-y-auto">
                  {fetchCandidates
                    .filter((n) => n.toLowerCase().includes(fetchQuery.trim().toLowerCase()))
                    .map((n) => (
                      <button
                        key={n}
                        type="button"
                        className="w-full text-left px-2 py-1 rounded text-xs hover:bg-[var(--color-hover)] cursor-pointer"
                        onClick={() => {
                          setCustomModelName(true)
                          up('modelName', n)
                          setFetchPanelOpen(false)
                        }}
                      >
                        {n}
                      </button>
                    ))}
                  {!fetchError && fetchCandidates.length === 0 && (
                    <p className="text-2xs px-1 py-0.5" style={{ color: 'var(--color-text-muted)' }}>
                      {t('provider.fetchNoMatches')}
                    </p>
                  )}
                </div>
              </div>
            </PopoverSurface>
          )}
        </div>

        {/* API 地址 */}
        <div className="mt-3">
          <Label>{t('form.apiAddress')}</Label>
          <Input
            value={model.baseUrl}
            onChange={(e) => up('baseUrl', e.target.value)}
            placeholder="https://api.openai.com"
          />
          {model.provider !== 'custom' && (
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
              {t('model.apiAutoFilled').replace('{provider}', model.provider)}
            </p>
          )}
        </div>
      </Disclosure>

      {/* 模型参数（仅生成模型）：**窗口与输出上限并排** —— 二者是同一个模型的两项规格，
          含义不同且不可互相推导（窗口 = 输入+输出总容量；输出上限 = 单次回复上限），
          故各带一行说明。2026-09-25 之前它们是同一个 maxTokens 字段。 */}
      {!isEmbedding && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('form.contextWindow')}</Label>
              <Input
                type="number" min={1} step={1024}
                value={model.contextWindow}
                onChange={(e) => up('contextWindow', (e.target.value === '' ? '' : parseInt(e.target.value)) as number)}
                onBlur={() => {
                  // 只兜下界：本字段仅本地消费（占用条分母 / 压缩预算），**不发往 API**，
                  // 故不像 maxTokens 那样需要上限（那个上限是为了防 API 400）
                  const v = Number(model.contextWindow);
                  if (isNaN(v) || v < 1) up('contextWindow', MAX_TOKENS_CAP)
                }}
              />
              <p className="text-2xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                {t('form.contextWindowHint')}
              </p>
            </div>
            <div>
              <Label>{t('form.maxTokens')}</Label>
              <Input
                type="number"
                value={model.maxTokens}
                onChange={(e) => up('maxTokens', (e.target.value === '' ? '' : parseInt(e.target.value)) as number)}
                onBlur={() => {
                  // 钳制到 [1, MAX_TOKENS_CAP]（全局模型输出上限，与主进程运行时钳制共享常量）——此前可保存 9999999（P2 修复）
                  const v = Number(model.maxTokens);
                  if (isNaN(v) || v < 1) up('maxTokens', 4096)
                  else if (v > MAX_TOKENS_CAP) up('maxTokens', MAX_TOKENS_CAP)
                }}
              />
              <p className="text-2xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                {t('form.maxTokensHint')}
              </p>
            </div>
          </div>

        </>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="outline"
          onClick={handleTest}
          disabled={testing || !model.baseUrl || !hasUsableKey(model, keyDraft)}
        >
          <Zap size={13} />
          {testing ? t('model.testing') : t('model.testBtn')}
        </Button>
        <Button
          className="flex-1"
          onClick={() => onSave(keyDraft.trim() || undefined)}
          disabled={saving || !model.name || !hasUsableKey(model, keyDraft)}
        >
          <Save size={13} />
          {saving ? t('model.saving') : t('model.saveBtn')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>{t('action.cancel')}</Button>
      </div>
      {testResult && (
        <div className={`text-xs p-2 rounded ${testResult.success ? 'bg-[rgba(var(--color-success-rgb),0.1)] text-[var(--color-success)] border border-[rgba(var(--color-success-rgb),0.2)]' : 'bg-[rgba(var(--color-error-rgb),0.1)] text-[var(--color-error)] border border-[rgba(var(--color-error-rgb),0.2)]'} break-all`}>
          {testResult.success ? `✅ ${t('model.testSuccess')}` : `❌ ${t('model.testFailed').replace('{error}', testResult.error ?? '')}`}
        </div>
      )}
    </div>
  )
}
