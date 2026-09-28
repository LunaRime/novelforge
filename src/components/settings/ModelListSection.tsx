/**
 * ModelListSection — 模型列表 + 卡片 + 编辑表单（自 SettingsModal 拆出，2026-09-28）
 *
 * 拆出目的：① 给「行内编辑」重构一个可独立测试的边界；② SettingsModal 已 1460 行。
 * 行为与拆分前完全一致，后续改动（按钮规范化/行内编辑/拉取面板）均在本文件内进行。
 */
import { useEffect, useRef, useState } from 'react'
import { Check, Download, Eye, EyeOff, Plus, Save, Settings2, Trash2, Zap } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useLLMStore } from '../../stores/llm-store'
import type { ModelProfile } from '../../shared/ipc-channels'
import type { ModelPreset, ProviderPreset } from '../../shared/provider-presets'
import { BUILTIN_PRESETS } from '../../shared/provider-presets'
import { randomUUID } from '../../utils/id'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Badge } from '../ui/Badge'
import { Spinner } from '../ui/Spinner'
import { Disclosure } from '../ui/Disclosure'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../ui/Select'
import { PopoverSurface } from '../ui/PopoverSurface'
import { useOutsideClick } from '../../hooks/useOutsideClick'
import { useTranslation } from '../../hooks/useTranslation'
import { MAX_TOKENS_CAP } from '../../shared/llm-constants'
import { renderLog } from '../../services/render-logger'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'

/**
 * 从预设取「该模型的 token 规格」—— `maxTokens`（输出）与 `contextWindow`（窗口）**成对**返回。
 *
 * 成对的理由：切换预设模型 = 切换它的规格，两个数本就属于同一个模型，分开更新会留下
 * 「旧窗口 + 新输出上限」这种自相矛盾的组合。
 *
 * `contextWindow` 省略时取 `maxTokens`（预设里只在该模型真实窗口 ≠ 上限时才显式写它，
 * 避免 30+ 条重复数字漂移 —— 见 `provider-presets.ts` 的类型注释）。
 */
function tokenSpec(
  presetModel: ModelPreset | null | undefined,
  fallbackMaxTokens: number,
): Pick<ModelProfile, 'maxTokens' | 'contextWindow'> {
  const maxTokens = presetModel?.maxTokens ?? fallbackMaxTokens
  return { maxTokens, contextWindow: presetModel?.contextWindow ?? maxTokens }
}

export function ModelListSection({
  purposes,
  purposeLabel,
}: {
  purposes: ModelProfile['purposes']
  purposeLabel: string
}) {
  const { t } = useTranslation()
  const models = useLLMStore(s => s.models)
  const defaultModelId = useLLMStore(s => s.defaultModelId)
  const defaultEmbeddingModelId = useLLMStore(s => s.defaultEmbeddingModelId)
  const loaded = useLLMStore(s => s.loaded)
  const loadModels = useLLMStore(s => s.loadModels)
  const saveModel = useLLMStore(s => s.saveModel)
  const deleteModel = useLLMStore(s => s.deleteModel)
  const setDefaultModel = useLLMStore(s => s.setDefaultModel)
  const setDefaultEmbeddingModel = useLLMStore(s => s.setDefaultEmbeddingModel)
  // 列表常驻，编辑器在对应位置原地展开（2026-09-28 替代旧的 editingModel「整列表替换」）；
  // baseline = 进入编辑时的 JSON 快照，用于「有实际改动才拦切换」的判定
  const [editing, setEditing] = useState<{ draft: ModelProfile; isNew: boolean; baseline: string } | null>(null)
  const [saving, setSaving] = useState(false)
  /** 正在删除的模型 id —— 删除可能较慢，必须给等待反馈并禁用按钮（否则用户连点） */
  const [deletingId, setDeletingId] = useState<string | null>(null)
  useEffect(() => {
    if (!loaded) loadModels()
  }, [loaded, loadModels])

  // 预设直接使用内置常量，无需 IPC 加载
  const presets = BUILTIN_PRESETS

  // 按用途过滤——遗留模型（无 purposes 字段的旧配置）按生成模型兜底显示，
  // 否则成孤儿无法编辑/删除/设默认（P3 修复）
  const filtered = models.filter((m) => {
    if (!m.purposes || m.purposes.length === 0) {
      return !purposes.includes('embedding')
    }
    return m.purposes.some((p) => purposes.includes(p as ModelProfile['purposes'][number]))
  })

  /**
   * 应用编辑态变更：无未保存改动时**同步**生效（点编辑立即展开，不等微任务）；
   * 有改动则先弹确认，确认后才应用——静默丢改动是 bug。
   */
  const withDirtyGuard = (apply: () => void) => {
    const dirty = editing !== null && JSON.stringify(editing.draft) !== editing.baseline
    if (!dirty) {
      apply()
      return
    }
    void confirm(t('model.discardEdit'), { danger: true, confirmText: t('action.discard') })
      .then((ok) => { if (ok) apply() })
  }

  /** 创建新模型：进入 isNew 编辑态（草稿卡在列表头部展开，不入 store，取消即消失） */
  const handleAdd = () => {
    withDirtyGuard(() => {
      const isEmbedding = purposes.includes('embedding')
      const openaiPreset = presets.find((p) => p.provider === 'openai') ?? presets[0]
      const draft: ModelProfile = {
        id: randomUUID(),
        name: '',
        provider: 'openai',
        protocol: (openaiPreset?.protocol ?? 'openai') as 'openai' | 'gemini',
        modelName: isEmbedding
          ? (openaiPreset?.embeddingModels[0] ?? 'text-embedding-3-small')
          : (openaiPreset?.models[0]?.name ?? 'gpt-4o'),
        apiKey: '',
        baseUrl: openaiPreset?.baseUrl ?? 'https://api.openai.com',
        temperature: 0.7,
        ...tokenSpec(openaiPreset?.models[0], 4096),
        purposes: [...purposes],
      }
      setEditing({ draft, isNew: true, baseline: JSON.stringify(draft) })
    })
  }

  /** 进入编辑：该卡在列表原位置展开（2026-09-28 行内编辑） */
  const startEdit = (m: ModelProfile) => {
    withDirtyGuard(() => setEditing({ draft: { ...m }, isNew: false, baseline: JSON.stringify(m) }))
  }

  const isEmbeddingSection = purposes.includes('embedding')

  /** 保存模型；若是该分类第一个则自动设为默认。
   *  ⚠️ 失败（saveModel 返回 false 或抛异常）时**保留草稿**——2026-09-28 整分支复核 I1：
   *  主进程对空 modelName/purposes 等返回 {success:false}（不抛），旧实现不检查返回值，
   *  会弹「保存成功」并收回表单，编辑静默丢失。失败必须可继续改。 */
  const handleSave = async () => {
    if (!editing) return
    const draft = editing.draft
    const t0 = Date.now()
    setSaving(true)
    try {
      const ok = await saveModel(draft)
      if (!ok) {
        renderLog('error', 'Save:Settings', t('log.render.modelSaveFailed')
          .replace('{id}', () => draft.id)
          .replace('{error}', () => t('status.unknown')))
        toast.error(t('save.failed').replace('{error}', () => t('status.unknown')))
        return // 保留草稿（失败不丢编辑）
      }
      // 新增模型后，如果该分类还没有默认则自动设为默认
      if (filtered.length === 0) {
        if (isEmbeddingSection) {
          setDefaultEmbeddingModel(draft.id)
        } else {
          setDefaultModel(draft.id)
        }
      }
      // 保存行为日志流：成功 info + toast 视觉反馈
      renderLog('info', 'Save:Settings', t('log.render.modelSaveSuccess')
        .replace('{id}', () => draft.id)
        .replace('{ms}', String(Date.now() - t0)))
      toast.success(t('save.success'))
      setEditing(null) // 仅成功才收回
    } catch (e) {
      renderLog('error', 'Save:Settings', t('log.render.modelSaveFailed')
        .replace('{id}', () => draft.id)
        .replace('{error}', () => String(e)))
      toast.error(t('save.failed').replace('{error}', String(e)))
      // 保留草稿
    } finally {
      setSaving(false)
    }
  }


  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
          {t('model.configured').replace('{n}', String(filtered.length)).replace('{label}', purposeLabel)}
        </span>
        <Button size="sm" onClick={() => void handleAdd()}>
          <Plus size={13} />
          {t('model.addLabel').replace('{label}', purposeLabel)}
        </Button>
      </div>

      {/* 空态：新增草稿卡存在时不显示（避免「空态 + 编辑卡」同屏） */}
      {filtered.length === 0 && !editing?.isNew ? (
        <div
          className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl"
          style={{ border: '1.5px dashed var(--color-border)' }}
        >
          <Zap size={36} style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('model.noLabelConfig').replace('{label}', purposeLabel)}
          </span>
          <Button size="sm" variant="outline" onClick={() => void handleAdd()}>
            <Plus size={13} />
            {t('model.addFirstLabel').replace('{label}', purposeLabel)}
          </Button>
        </div>
      ) : (
        /* 行内编辑（2026-09-28）：列表常驻；编辑中的卡在原位置展开为 ModelForm，
           新增草稿卡出现在列表头部 */
        <div className="space-y-2">
          {editing?.isNew && (
            <ModelForm
              model={editing.draft}
              onChange={(m) => setEditing((e) => (e ? { ...e, draft: m } : e))}
              onSave={handleSave}
              onCancel={() => setEditing(null)}
              saving={saving}
              purposeOptions={purposes}
              presets={presets}
            />
          )}
          {filtered.map((model) => (
            editing && !editing.isNew && editing.draft.id === model.id ? (
              <ModelForm
                key={model.id}
                model={editing.draft}
                onChange={(m) => setEditing((e) => (e ? { ...e, draft: m } : e))}
                onSave={handleSave}
                onCancel={() => setEditing(null)}
                saving={saving}
                purposeOptions={purposes}
                presets={presets}
              />
            ) : (
              <ModelCard
                key={model.id}
                model={model}
                isDefault={isEmbeddingSection
                  ? defaultEmbeddingModelId === model.id
                  : defaultModelId === model.id}
                onSetDefault={() => isEmbeddingSection
                  ? setDefaultEmbeddingModel(model.id)
                  : setDefaultModel(model.id)}
                onEdit={() => void startEdit(model)}
                onDelete={async () => {
                  // 删除模型配置此前无二次确认（且入口是 hover 才显形的按钮，键盘用户极易误触）
                  const ok = await confirm(
                    t('settings.confirmDeleteModel').replace('{name}', model.name),
                    { danger: true, confirmText: t('action.delete') },
                  )
                  if (!ok) return
                  setDeletingId(model.id)
                  try {
                    await deleteModel(model.id)
                  } finally {
                    setDeletingId(null)
                  }
                }}
                deleting={deletingId === model.id}
              />
            )
          ))}
        </div>
      )}
    </div>
  )
}

/** 模型卡片 */
function ModelCard({
  model, isDefault, onSetDefault, onEdit, onDelete, deleting = false,
}: {
  model: ModelProfile
  isDefault: boolean
  onSetDefault: () => void
  onEdit: () => void
  onDelete: () => void
  /** 删除进行中：显示旋转图标并禁用（防连点） */
  deleting?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-3 rounded-xl group transition-colors',
        isDefault
          ? 'border border-[var(--color-accent)]'
          : 'border border-[var(--color-border)] hover:border-[var(--color-accent)]',
      )}
      style={{ backgroundColor: isDefault ? 'color-mix(in srgb, var(--color-accent) 5%, var(--color-panel))' : 'var(--color-panel)' }}
    >
      {/* 图标 — 固定 32×32（`w-9` 在本仓 html{font-size:14px} 下 = 31.5px，半像素修正） */}
      <div
        className="rounded-lg flex items-center justify-center flex-shrink-0 text-lg"
        style={{ width: 32, height: 32, backgroundColor: 'var(--color-hover)' }}
      >
        {providerEmoji(model.provider)}
      </div>

      {/* 信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
            {model.name || model.modelName}
          </span>
          {isDefault && (
            <Badge variant="solid" className="px-1.5 font-normal flex-shrink-0">
              {t('model.default')}
            </Badge>
          )}
        </div>
        <p className="text-xs truncate mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
          {model.provider} · {model.modelName} · {model.baseUrl}
        </p>
      </div>

      {/* 操作按钮 —— 常驻 32×32（2026-09-28 走查：此前是 hover 才显形，违反
          「操作按钮常驻」不变量；热区也低于 32×32 标准） */}
      <div className="flex items-center gap-1">
        {!isDefault && (
          <button
            type="button"
            onClick={onSetDefault}
            title={t('model.setDefault')}
            aria-label={t('model.setDefault')}
            className="flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            style={{ width: 32, height: 32 }}
          >
            <Check size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={onEdit}
          title={t('action.edit')}
          aria-label={t('action.edit')}
          className="flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          style={{ width: 32, height: 32 }}
        >
          <Settings2 size={14} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          title={t('action.delete')}
          aria-label={t('action.delete')}
          className="flex items-center justify-center rounded-lg transition-colors hover:bg-[rgba(var(--color-error-rgb),0.1)] text-[var(--color-text-muted)] hover:text-[var(--color-error)] disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ width: 32, height: 32 }}
        >
          {deleting ? <Spinner size={14}  /> : <Trash2 size={14} />}
        </button>
      </div>
    </div>
  )
}

/** 模型编辑表单 */
function ModelForm({
  model, onChange, onSave, onCancel, saving, presets,
}: {
  model: ModelProfile
  onChange: (m: ModelProfile) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  purposeOptions: ModelProfile['purposes']
  /** 服务商预设（来自 BUILTIN_PRESETS 常量） */
  presets: ProviderPreset[]
}) {
  const { t } = useTranslation()
  const [showKey, setShowKey] = useState(false)
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
      provider: model.provider, protocol: model.protocol, apiKey: model.apiKey, baseUrl: model.baseUrl,
    })
    setFetching(false)
    setFetchPanelOpen(true)
    if (!res.success) {
      setFetchError(res.error ?? t('status.unknown'))
      setFetchCandidates([])
      return
    }
    setFetchCandidates(res.models ?? [])
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
    const result = await testConnection(model)
    setTestResult(result)
    setTesting(false)
    setTimeout(() => setTestResult(null), 3000)
  }

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
              <SelectItem value="openai">OpenAI</SelectItem>
              <SelectItem value="deepseek">DeepSeek</SelectItem>
              <SelectItem value="gemini">Google Gemini</SelectItem>
              <SelectItem value="ollama">{t('settings.providerOllama')}</SelectItem>
              <SelectItem value="bigmodel">{t('settings.providerBigModel')}</SelectItem>
              <SelectItem value="custom">{t('settings.providerCustom')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t('form.protocol')}</Label>
          <Select value={model.protocol} onValueChange={(v) => up('protocol', v as 'openai' | 'gemini')}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI</SelectItem>
              <SelectItem value="gemini">Gemini</SelectItem>
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
            value={model.apiKey}
            onChange={(e) => up('apiKey', e.target.value)}
            placeholder={model.provider === 'ollama' ? t('model.apiKeyPlaceholder') : 'sk-...'}
            className="pr-9"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('form.temperature')}</Label>
              <Input
                type="number" min={0} max={2} step={0.1}
                value={model.temperature}
                onChange={(e) => up('temperature', (e.target.value === '' ? '' : parseFloat(e.target.value)) as number)}
                onBlur={() => {
                  // 钳制到 [0, 2]——此前可保存 -5 等非法值，运行时 API 400（P2 修复）
                  const v = Number(model.temperature);
                  if (isNaN(v)) up('temperature', 0.7)
                  else if (v < 0) up('temperature', 0)
                  else if (v > 2) up('temperature', 2)
                }}
              />
            </div>
          </div>
        </>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="outline"
          onClick={handleTest}
          disabled={testing || !model.baseUrl || (!model.apiKey && model.provider !== 'ollama')}
        >
          <Zap size={13} />
          {testing ? t('model.testing') : t('model.testBtn')}
        </Button>
        <Button
          className="flex-1"
          onClick={onSave}
          disabled={saving || !model.name || (!model.apiKey && model.provider !== 'ollama')}
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

// ==================== 工具函数（随 ModelCard 自 SettingsModal 迁入） ====================

function providerEmoji(provider: string) {
  const map: Record<string, string> = {
    openai: '🤖', deepseek: '🐬', gemini: '✨', ollama: '🦙', bigmodel: '🧠', custom: '⚙️',
  }
  return map[provider] ?? '🔧'
}
