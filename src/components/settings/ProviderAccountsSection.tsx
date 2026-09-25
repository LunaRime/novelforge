/**
 * 供应商账户 —— 一份凭据挂多个模型（2026-09-25）
 *
 * 设计见 `docs/superpowers/specs/2026-09-25-provider-accounts-design.md`。
 * 用户的痛点原话：「添加一个模型供应商然后勾选旗下的模型然后就可以便携切换而不需要又添加」。
 *
 * **存储**：`providers.json` 是账户的唯一真相；`models.json` 里由账户**派生**的条目持有凭据副本。
 * 这么做是为了不动 `models.json` 的 10 个读点与 91 处凭据引用（详见 provider-accounts.ts 头注释）。
 */
import { useCallback, useState } from 'react'
import { Plus, Trash2, Download, KeyRound } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { useLLMStore } from '../../stores/llm-store'
import { useAgentStore } from '../../stores/agent-store'
import { useVectorConfigStore } from '../../stores/vector-config-store'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/Select'
import { EmptyState } from '../ui/EmptyState'
import { Disclosure } from '../ui/Disclosure'
import { confirm } from '../ui/Confirm'
import { toast } from '../ui/Toast'
import { renderLog } from '../../services/render-logger'
import { BUILTIN_PRESETS } from '../../shared/provider-presets'
import { deriveModelId, findModelReferences, type ModelReferenceSources } from '../../shared/provider-accounts'
import type { ProviderAccount } from '../../shared/ipc-channels'

/** 汇集引用检查需要的输入（各 store 直接读，避免层层传参） */
function collectReferenceSources(): ModelReferenceSources {
  const llm = useLLMStore.getState()
  const agent = useAgentStore.getState()
  const vector = useVectorConfigStore.getState()
  return {
    defaultModelId: llm.defaultModelId,
    defaultEmbeddingModelId: llm.defaultEmbeddingModelId,
    llmEmbeddingModelId: vector.llmEmbeddingSettings.modelId,
    modelRoutes: llm.modelRoutes,
    conversations: agent.conversations.map((c) => ({ id: c.id, title: c.title, modelId: c.modelId })),
  }
}

/**
 * 这些模型里，哪些还被别处引用？有则返回可读提示（一次列全），无则 null。
 *
 * ⚠️ 取消勾选 / 删账户会**真的删掉模型条目** —— 不查引用的话，默认模型、三层路由、
 * 会话会指向不存在的 id（界面上表现为空白或静默回退）。
 */
function blockingReferences(modelIds: string[]): string | null {
  const sources = collectReferenceSources()
  const hits = modelIds.flatMap((id) => findModelReferences(id, sources))
  if (hits.length === 0) return null
  return hits.map((h) => h.label).join('、')
}

export function ProviderAccountsSection() {
  const { t } = useTranslation()
  const providers = useLLMStore((s) => s.providers)
  const models = useLLMStore((s) => s.models)
  const [editing, setEditing] = useState<ProviderAccount | null>(null)

  const countModels = useCallback(
    (account: ProviderAccount) =>
      models.filter((m) => m.id.startsWith(`${account.id}::`)).length,
    [models],
  )

  const handleDelete = useCallback(
    async (account: ProviderAccount) => {
      const derived = models.filter((m) => m.id.startsWith(`${account.id}::`)).map((m) => m.id)
      // 引用检查放在**二次确认之前**：被引用时根本不该走到"确认删除"这一步
      const blocking = blockingReferences(derived)
      if (blocking) {
        toast.error(t('provider.referenced').replace('{list}', () => blocking))
        return
      }
      const ok = await confirm(
        t('provider.deleteConfirm')
          .replace('{name}', () => account.provider)
          .replace('{n}', String(derived.length)),
        { danger: true, confirmText: t('action.delete') },
      )
      if (ok) await useLLMStore.getState().deleteProvider(account.id)
    },
    [models, t],
  )

  if (editing) {
    return (
      <ProviderAccountForm
        account={editing}
        onCancel={() => setEditing(null)}
        onDone={() => setEditing(null)}
      />
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
            {t('provider.sectionTitle')}
          </span>
        </div>
        <Button size="sm" onClick={() => setEditing(newAccount())}>
          <Plus size={13} />
          {t('provider.add')}
        </Button>
      </div>
      <p className="text-2xs" style={{ color: 'var(--color-text-muted)' }}>
        {t('provider.sectionDesc')}
      </p>

      {providers.length === 0 ? (
        <div className="rounded-xl" style={{ border: '1.5px dashed var(--color-border)' }}>
          <EmptyState
            icon={<KeyRound size={36} style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />}
            message={t('provider.none')}
          />
        </div>
      ) : (
        <div className="space-y-2">
          {providers.map((account) => (
            <div
              key={account.id}
              className="flex items-center gap-3 rounded-lg px-3 py-2"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <KeyRound size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>
                  {account.provider}
                </div>
                <div className="text-2xs truncate" style={{ color: 'var(--color-text-muted)' }}>
                  {t('provider.selectedCount').replace('{n}', String(countModels(account)))}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditing(account)}>
                {t('action.edit')}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void handleDelete(account)}
                title={t('provider.delete')}
                aria-label={t('provider.delete')}
              >
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function newAccount(): ProviderAccount {
  const preset = BUILTIN_PRESETS[0]
  return {
    id: crypto.randomUUID(),
    provider: (preset?.provider ?? 'openai') as ProviderAccount['provider'],
    protocol: (preset?.protocol ?? 'openai') as ProviderAccount['protocol'],
    apiKey: '',
    baseUrl: preset?.baseUrl ?? '',
    modelNames: [],
  }
}

/**
 * 该供应商「可能有的模型」—— 预设清单（离线可用）+ 已勾选的。
 *
 * 有了预设清单，「获取可用模型」就不再是**前置条件**：服务不支持该端点时用户照样能勾选。
 */
function candidateModels(provider: string, selected: string[]): string[] {
  const preset = BUILTIN_PRESETS.find((p) => p.provider === provider)
  const names = [
    ...(preset?.models.map((m) => m.name) ?? []),
    ...(preset?.embeddingModels ?? []),
    ...selected,
  ]
  return [...new Set(names)]
}

function ProviderAccountForm({
  account,
  onCancel,
  onDone,
}: {
  account: ProviderAccount
  onCancel: () => void
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<ProviderAccount>(account)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(account.modelNames))
  const [fetched, setFetched] = useState<string[] | null>(null)
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [manual, setManual] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)

  const up = <K extends keyof ProviderAccount>(key: K, value: ProviderAccount[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  /**
   * 换服务商 → **协议与地址都要跟着换**（预设里写着该服务商走哪套协议、在哪个地址）。
   *
   * ⚠️ 早先只换 provider 不动 baseUrl 是个真 bug：选 Moonshot 却仍打
   * `https://api.openai.com` → 必然 401 → 「获取可用模型」永远失败，
   * 而当时的报错文案还说「该服务可能不支持模型列表」，把用户引向完全错误的方向。
   *
   * 保留用户自定义过的地址（≠ 旧预设地址时不覆盖）—— 与 ModelForm 的 P3 修复同一规则。
   */
  const handleProviderChange = (next: ProviderAccount['provider']) => {
    const prevPreset = BUILTIN_PRESETS.find((p) => p.provider === draft.provider)
    const nextPreset = BUILTIN_PRESETS.find((p) => p.provider === next)
    setDraft((d) => ({
      ...d,
      provider: next,
      protocol: (nextPreset?.protocol ?? 'openai') as ProviderAccount['protocol'],
      baseUrl:
        d.baseUrl && prevPreset && d.baseUrl !== prevPreset.baseUrl
          ? d.baseUrl
          : (nextPreset?.baseUrl ?? ''),
    }))
  }

  const candidates = [
    ...new Set([...(fetched ?? []), ...candidateModels(draft.provider, [...selected])]),
  ].sort()

  const handleFetch = async () => {
    setFetching(true)
    setFetchError(null)
    const res = await useLLMStore.getState().listProviderModels({
      provider: draft.provider,
      protocol: draft.protocol,
      apiKey: draft.apiKey,
      baseUrl: draft.baseUrl,
    })
    setFetching(false)
    if (!res.success) {
      setFetchError(res.error ?? t('status.unknown'))
      return
    }
    const list = res.models ?? []
    setFetched(list)
    // 空列表**不是错误**（有些服务就返回空），但要说清为什么看不到模型
    if (list.length === 0) setFetchError(t('provider.fetchedEmpty'))
  }

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleSave = async () => {
    // 取消勾选 = 删除模型条目 → 先查引用，被引用就不让存
    const removed = account.modelNames
      .filter((n) => !selected.has(n))
      .map((n) => deriveModelId(account.id, n))
    const blocking = blockingReferences(removed)
    if (blocking) {
      toast.error(t('provider.referenced').replace('{list}', () => blocking))
      return
    }
    setSaving(true)
    const t0 = Date.now()
    // 保存反馈按 save-feedback-standard：成功/失败都要有**日志 + toast**，
    // 与 LLMSection 的模型保存同一套 key 与 source 标签
    const ok = await useLLMStore.getState().saveProvider({ ...draft, modelNames: [...selected] })
    setSaving(false)
    if (ok) {
      renderLog('info', 'Save:Settings', `provider saved: ${draft.provider} (${Date.now() - t0}ms)`)
      toast.success(t('save.success'))
      onDone()
    } else {
      renderLog('error', 'Save:Settings', `provider save failed: ${draft.provider}`)
      toast.error(t('save.failed').replace('{error}', () => t('status.unknown')))
    }
  }

  return (
    <div
      className="rounded-xl p-5 space-y-4"
      style={{ border: '1.5px solid var(--color-accent)', backgroundColor: 'var(--color-panel)' }}
    >
      <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
        {account.modelNames.length > 0 ? t('provider.editTitle') : t('provider.newTitle')}
      </h3>

      {/* 服务商（协议与地址由预设带出） */}
      <div className={draft.provider === 'custom' ? 'grid grid-cols-2 gap-3' : ''}>
        <div>
          <Label>{t('form.provider')}</Label>
          <Select
            value={draft.provider}
            onValueChange={(v) => handleProviderChange(v as ProviderAccount['provider'])}
          >
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {/* 直接映射预设 —— `custom`（自定义）**已经在预设里**，
                  这里不要再补一条，否则会出现两个同值的「自定义」 */}
              {BUILTIN_PRESETS.map((p) => (
                <SelectItem key={p.provider} value={p.provider}>{p.displayName ?? p.provider}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* 协议只在「自定义」时才问：选定的服务商该走哪套协议是**既定事实**（预设里写着），
            让用户选是多余的 —— 而且选错就整条链路不通 */}
        {draft.provider === 'custom' && (
          <div>
            <Label>{t('form.protocol')}</Label>
            <Select
              value={draft.protocol}
              onValueChange={(v) => up('protocol', v as ProviderAccount['protocol'])}
            >
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI 兼容</SelectItem>
                <SelectItem value="gemini">Gemini 原生</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* API Key —— 唯一必填的凭据，放在最前 */}
      <div>
        <Label>{t('form.apiKey')}</Label>
        <div className="relative">
          <Input
            type={showKey ? 'text' : 'password'}
            value={draft.apiKey}
            onChange={(e) => up('apiKey', e.target.value)}
            placeholder={draft.provider === 'ollama' ? t('model.apiKeyPlaceholder') : 'sk-...'}
            className="pr-9"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            {showKey ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
      </div>

      {/* 自定义设置（地址默认值多数场景就对） */}
      <Disclosure label={t('form.advanced')}>
        <Label>{t('form.apiAddress')}</Label>
        <Input
          value={draft.baseUrl}
          onChange={(e) => up('baseUrl', e.target.value)}
          placeholder="https://api.openai.com"
        />
      </Disclosure>

      {/* 模型勾选 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="mb-0">
            {t('provider.selectedCount').replace('{n}', String(selected.size))}
          </Label>
          <Button variant="outline" size="sm" onClick={() => void handleFetch()} disabled={fetching}>
            <Download size={12} />
            {fetching ? t('provider.fetching') : t('provider.fetchModels')}
          </Button>
        </div>
        <p className="text-2xs" style={{ color: 'var(--color-text-muted)' }}>
          {t('provider.hintBeforeFetch')}
        </p>
        {fetchError && (
          <p className="text-2xs" style={{ color: 'var(--color-warning)' }}>{fetchError}</p>
        )}

        <div className="max-h-56 overflow-y-auto rounded-lg p-1 space-y-0.5"
             style={{ border: '1px solid var(--color-border)' }}>
          {candidates.map((name) => (
            <label
              key={name}
              className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs hover:bg-[var(--color-hover)]"
              style={{ color: 'var(--color-text)' }}
            >
              <input
                type="checkbox"
                className="w-3.5 h-3.5 accent-[var(--color-accent)] cursor-pointer flex-shrink-0"
                checked={selected.has(name)}
                onChange={() => toggle(name)}
              />
              <span className="truncate">{name}</span>
            </label>
          ))}
          {/* 手工补充：服务不提供列表时的出路 */}
          <div className="flex items-center gap-1.5 px-2 py-1">
            <Input
              className="h-6 text-micro"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !manual.trim()) return
                toggle(manual.trim())
                setManual('')
              }}
              placeholder={t('provider.manualAdd')}
            />
            <Button
              variant="outline" size="sm"
              disabled={!manual.trim()}
              onClick={() => { toggle(manual.trim()); setManual('') }}
            >
              <Plus size={12} />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="outline" onClick={onCancel}>{t('action.cancel')}</Button>
        <Button onClick={() => void handleSave()} disabled={saving}>
          {t('action.save')}
        </Button>
      </div>
    </div>
  )
}

/* 眼睛图标（与 ModelForm 同款，单独取用避免与 lucide 的其它导入混在一起） */
function EyeIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
}
function EyeOffIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 8 10 8a17.7 17.7 0 0 1-2.16 3.19M6.61 6.61A17.7 17.7 0 0 0 2 12s3.5 8 10 8a9.1 9.1 0 0 0 5.39-1.61" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><path d="M2 2l20 20" /></svg>
}
