/**
 * ModelListSection — 模型列表 + 卡片 + 编辑表单（自 SettingsModal 拆出，2026-09-28）
 *
 * 拆出目的：① 给「行内编辑」重构一个可独立测试的边界；② SettingsModal 已 1460 行。
 * 行为与拆分前完全一致，后续改动（按钮规范化/行内编辑/拉取面板）均在本文件内进行。
 */
import { useEffect, useState } from 'react'
import { Check, Eye, EyeOff, Plus, Save, Settings2, Trash2, Zap } from 'lucide-react'
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
  const [editingModel, setEditingModel] = useState<ModelProfile | null>(null)
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

  /** 创建新模型，使用预设中 openai 的默认属性 */
  const handleAdd = () => {
    const isEmbedding = purposes.includes('embedding')
    const openaiPreset = presets.find((p) => p.provider === 'openai') ?? presets[0]
    setEditingModel({
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
    })
  }

  const isEmbeddingSection = purposes.includes('embedding')

  /** 保存模型；若是该分类第一个则自动设为默认 */
  const handleSave = async () => {
    if (!editingModel) return
    const t0 = Date.now()
    setSaving(true)
    try {
      await saveModel(editingModel)
      // 新增模型后，如果该分类还没有默认则自动设为默认
      const countBefore = filtered.length
      if (countBefore === 0) {
        if (isEmbeddingSection) {
          setDefaultEmbeddingModel(editingModel.id)
        } else {
          setDefaultModel(editingModel.id)
        }
      }
      // 保存行为日志流：成功 info + toast 视觉反馈
      renderLog('info', 'Save:Settings', t('log.render.modelSaveSuccess')
        .replace('{id}', () => editingModel.id)
        .replace('{ms}', String(Date.now() - t0)))
      toast.success(t('save.success'))
    } catch (e) {
      renderLog('error', 'Save:Settings', t('log.render.modelSaveFailed')
        .replace('{id}', () => editingModel.id)
        .replace('{error}', () => String(e)))
      toast.error(t('save.failed').replace('{error}', String(e)))
    }
    setEditingModel(null)
    setSaving(false)
  }


  return (
    <div className="space-y-4">
      {/* 模型编辑表单 */}
      {editingModel && (
        <ModelForm
          model={editingModel}
          onChange={setEditingModel}
          onSave={handleSave}
          onCancel={() => setEditingModel(null)}
          saving={saving}
          purposeOptions={purposes}
          presets={presets}
        />
      )}

      {/* 模型列表 */}
      {!editingModel && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
              {t('model.configured').replace('{n}', String(filtered.length)).replace('{label}', purposeLabel)}
            </span>
            <Button size="sm" onClick={handleAdd}>
              <Plus size={13} />
              {t('model.addLabel').replace('{label}', purposeLabel)}
            </Button>
          </div>

          {filtered.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl"
              style={{ border: '1.5px dashed var(--color-border)' }}
            >
              <Zap size={36} style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {t('model.noLabelConfig').replace('{label}', purposeLabel)}
              </span>
              <Button size="sm" variant="outline" onClick={handleAdd}>
                <Plus size={13} />
                {t('model.addFirstLabel').replace('{label}', purposeLabel)}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((model) => (
                <ModelCard
                  key={model.id}
                  model={model}
                  isDefault={isEmbeddingSection
                    ? defaultEmbeddingModelId === model.id
                    : defaultModelId === model.id}
                  onSetDefault={() => isEmbeddingSection
                    ? setDefaultEmbeddingModel(model.id)
                    : setDefaultModel(model.id)}
                  onEdit={() => setEditingModel({ ...model })}
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
              ))}
            </div>
          )}
        </>
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
      {/* 图标 */}
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-lg"
        style={{ backgroundColor: 'var(--color-hover)' }}
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

      {/* 操作按钮（hover 显示） */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        {!isDefault && (
          <button
            onClick={onSetDefault}
            title={t('model.setDefault')}
            className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors hover:bg-[var(--color-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <Check size={14} />
          </button>
        )}
        <button
          onClick={onEdit}
          title={t('action.edit')}
          className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors hover:bg-[var(--color-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          <Settings2 size={14} />
        </button>
        <button
          onClick={onDelete}
          disabled={deleting}
          title={t('action.delete')}
          className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors hover:bg-[rgba(var(--color-error-rgb),0.1)] text-[var(--color-text-muted)] hover:text-[var(--color-error)] disabled:opacity-50 disabled:cursor-not-allowed"
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
