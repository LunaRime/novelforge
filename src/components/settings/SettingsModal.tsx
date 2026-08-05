import { useState, useEffect } from 'react'
import {
  X, Plus, Trash2, Check, Save, Globe, Cpu, Database,
  Type, Settings2, Zap, Eye, EyeOff, MessageSquare,
  File, ExternalLink, RefreshCw, Loader2, Download, LogOut,
  BookMarked, Plug,
} from 'lucide-react'
import PromptSettings from './PromptSettings'
import SkillsSettings from './SkillsSettings'
import MCPSettings from './MCPSettings'
import { useLLMStore } from '../../stores/llm-store'
import { useThemeStore, FONT_OPTIONS, type FontId } from '../../stores/theme-store'
import type { ModelProfile } from '../../shared/ipc-channels'
import type { ProviderPreset } from '../../shared/provider-presets'
import { BUILTIN_PRESETS } from '../../shared/provider-presets'
import { randomUUID } from '../../utils/id'
import { Button } from '../ui/Button'
import MarkdownContent from '../ui/MarkdownContent'
import { switchLocale, useTranslation } from '../../hooks/useTranslation'
import { SUPPORTED_LOCALES, LOCALE_LABELS, type SupportedLocale } from '../../shared/locale'
import type { TextKey } from '../../shared/locale'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../ui/Select'
import { cn } from '../../lib/utils'
import { ipc } from '../../services/ipc-client'
import { renderLog } from '../../services/render-logger'
import { toast } from '../ui/Toast'
import { Switch } from '../ui/Switch'
import VectorConfigSection from './VectorConfigSection'
import DeveloperModeSection from './DeveloperModeSection'
import { useUpdateStore } from '../../stores/update-store'

// ==================== 分类定义 ====================

type SettingsSection = 'llm' | 'embedding' | 'proxy' | 'editor' | 'prompts' | 'skills' | 'mcp' | 'file' | 'dev' | 'about'

interface SectionItem {
  id: SettingsSection
  label: string
  icon: React.ReactNode
  description: string
}

function getSections(t: (key: TextKey) => string): SectionItem[] {
  return [
    { id: 'llm', label: t('settings.aiModel'), icon: <Cpu size={16} />, description: t('settings.aiModelDesc') },
    { id: 'embedding', label: t('settings.vectorModel'), icon: <Database size={16} />, description: t('settings.vectorModelDesc') },
    { id: 'proxy', label: t('settings.proxy'), icon: <Globe size={16} />, description: t('settings.proxyDesc') },
    { id: 'editor', label: t('settings.editor'), icon: <Type size={16} />, description: t('settings.editorDesc') },
    { id: 'prompts', label: t('settings.promptTemplates'), icon: <MessageSquare size={16} />, description: t('settings.promptTemplatesDesc') },
    { id: 'skills', label: t('settings.skills'), icon: <BookMarked size={16} />, description: t('settings.skillsDesc') },
    { id: 'mcp', label: t('settings.mcp'), icon: <Plug size={16} />, description: t('settings.mcpDesc') },
    { id: 'file', label: t('settings.file'), icon: <File size={16} />, description: t('settings.fileDesc') },
    { id: 'dev', label: t('settings.developer'), icon: <Plug size={16} />, description: t('settings.developerDesc') },
    { id: 'about', label: t('settings.about'), icon: <span style={{ color: 'var(--color-accent)', fontSize: 14 }}>?</span>, description: t('settings.aboutDesc') },
  ]
}

// ==================== 主组件 ====================

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

/** 全屏设置弹窗 */
export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t } = useTranslation()
  const [section, setSection] = useState<SettingsSection>('llm')
  const sections = getSections(t)

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative flex w-[880px] h-[600px] rounded-2xl overflow-hidden shadow-2xl"
        style={{
          backgroundColor: 'var(--color-editor-bg)',
          border: '1px solid var(--color-border)',
        }}
      >
        {/* 左侧导航 */}
        <aside
          className="flex flex-col w-52 flex-shrink-0 py-5 gap-1"
          style={{
            backgroundColor: 'var(--color-sidebar)',
            borderRight: '1px solid var(--color-border)',
          }}
        >
          {/* 标题 */}
          <div className="flex items-center gap-2 px-4 mb-4">
            <Settings2 size={16} style={{ color: 'var(--color-accent)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
              {t('settings.title')}
            </span>
          </div>

          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                'flex items-center gap-2.5 mx-2 px-3 py-2.5 rounded-lg text-left text-sm transition-colors',
                section === s.id
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]',
              )}
            >
              {s.icon}
              {s.label}
            </button>
          ))}
        </aside>

        {/* 右侧内容区 */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* 区域标题栏 */}
          <div
            className="flex items-center justify-between px-6 py-4 flex-shrink-0"
            style={{ borderBottom: '1px solid var(--color-border)' }}
          >
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
                {sections.find((s) => s.id === section)?.label}
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                {sections.find((s) => s.id === section)?.description}
              </p>
            </div>
            <button
              onClick={onClose}
              className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors hover:bg-[var(--color-hover)]"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <X size={16} />
            </button>
          </div>

          {/* 区域内容 */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {section === 'llm' && <LLMSection purposes={['generation', 'refinement', 'summary']} purposeLabel={t('model.purposeGen')} />}
            {section === 'embedding' && <VectorConfigSection />}
            {section === 'proxy' && <ProxySection />}
            {section === 'editor' && <EditorSection />}
            {section === 'prompts' && <PromptSettings />}
            {section === 'skills' && <SkillsSettings />}
            {section === 'mcp' && <MCPSettings />}
            {section === 'file' && <FileSection />}
            {section === 'dev' && <DeveloperModeSection />}
            {section === 'about' && <AboutSection />}
          </div>
        </main>
      </div>
    </div>
  )
}

// ==================== LLM & Embedding 通用区 ====================

function LLMSection({
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
  useEffect(() => {
    if (!loaded) loadModels()
  }, [loaded, loadModels])

  // 预设直接使用内置常量，无需 IPC 加载
  const presets = BUILTIN_PRESETS

  // 按用途过滤
  const filtered = models.filter((m) =>
    m.purposes?.some((p) => purposes.includes(p as ModelProfile['purposes'][number]))
  )

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
      maxTokens: openaiPreset?.models[0]?.maxTokens ?? 4096,
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
      renderLog('info', 'Save:Settings', `模型保存成功 ${editingModel.id}（${Date.now() - t0}ms）`)
      toast.success(t('save.success'))
    } catch (e) {
      renderLog('error', 'Save:Settings', `模型保存失败 ${editingModel.id}: ${String(e)}`)
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
              <Zap size={28} style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
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
                  onDelete={() => deleteModel(model.id)}
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
  model, isDefault, onSetDefault, onEdit, onDelete,
}: {
  model: ModelProfile
  isDefault: boolean
  onSetDefault: () => void
  onEdit: () => void
  onDelete: () => void
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
            <span className="text-[0.7rem] px-1.5 py-0.5 rounded-full bg-[var(--color-accent)] text-white flex-shrink-0">
              {t('model.default')}
            </span>
          )}
        </div>
        <p className="text-xs truncate mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
          {model.provider} · {model.modelName} · {model.baseUrl}
        </p>
      </div>

      {/* 操作按钮（hover 显示） */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
          title={t('action.delete')}
          className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors hover:bg-red-500/10 text-[var(--color-text-muted)] hover:text-red-400"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

// ==================== 模型编辑表单 ====================


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
      baseUrl: p?.baseUrl ?? '',
      modelName: defaultModelName,
      maxTokens: firstModel?.maxTokens ?? 4096,
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
        maxTokens: matched?.maxTokens ?? model.maxTokens,
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
                  onChange({ ...model, modelName: first.name, maxTokens: first.maxTokens ?? model.maxTokens })
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
      <div>
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

      {/* API Key */}
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

      {/* 温度 / Token（仅生成模型） */}
      {!isEmbedding && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t('form.temperature')}</Label>
            <Input
              type="number" min={0} max={2} step={0.1}
              value={model.temperature}
              onChange={(e) => up('temperature', (e.target.value === '' ? '' : parseFloat(e.target.value)) as number)}
              onBlur={() => {
                const v = Number(model.temperature);
                if (isNaN(v)) up('temperature', 0.7)
              }}
            />
          </div>
          <div>
            <Label>{t('form.maxTokens')}</Label>
            <Input
              type="number"
              value={model.maxTokens}
              onChange={(e) => up('maxTokens', (e.target.value === '' ? '' : parseInt(e.target.value)) as number)}
              onBlur={() => {
                const v = Number(model.maxTokens);
                if (!v || v < 1) up('maxTokens', 4096)
              }}
            />
          </div>
        </div>
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
        <div className={`text-xs p-2 rounded ${testResult.success ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'} break-all`}>
          {testResult.success ? `✅ ${t('model.testSuccess')}` : `❌ ${t('model.testFailed').replace('{error}', testResult.error ?? '')}`}
        </div>
      )}
    </div>
  )
}


// ==================== 代理设置 ====================

function ProxySection() {
  const { t } = useTranslation()
  const [proxy, setProxy] = useState<{
    enabled: boolean; type: 'http' | 'socks5'; host: string; port: number
  }>({ enabled: false, type: 'http', host: '', port: 7890 })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    ipc.invoke('config:get').then((cfg) => {
      if (cfg?.proxy) {
        setProxy({
          enabled: cfg.proxy.enabled ?? false, // 明确默认关闭
          type: cfg.proxy.type ?? 'http',
          host: cfg.proxy.host ?? '',
          port: cfg.proxy.port ?? 7890,
        })
      }
    }).catch(() => { })
  }, [])

  const handleSave = async () => {
    const t0 = Date.now()
    setSaving(true)
    try {
      await ipc.invoke('config:set', { proxy })
      // 保存行为日志流：成功 info（视觉反馈已有 setSaved 局部文本）
      renderLog('info', 'Save:Settings', `代理配置保存成功（${Date.now() - t0}ms）`)
    } catch (e) {
      renderLog('error', 'Save:Settings', `代理配置保存失败: ${String(e)}`)
      toast.error(t('save.failed').replace('{error}', String(e)))
    }
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="max-w-[480px] space-y-5">
      {/* 启用开关 */}
      <div
        className="flex items-center justify-between p-4 rounded-xl"
        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}
      >
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{t('proxy.enable')}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {t('proxy.enableDesc')}
          </p>
        </div>
        <Switch
          checked={proxy.enabled}
          onCheckedChange={(checked) => setProxy({ ...proxy, enabled: checked })}
          aria-label={t('proxy.enable')}
        />
      </div>

      {/* 代理详情 */}
      {proxy.enabled && (
        <div
          className="space-y-3 p-4 rounded-xl"
          style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}
        >
          <div>
            <Label>{t('form.proxyType')}</Label>
            <Select value={proxy.type} onValueChange={(v) => setProxy({ ...proxy, type: v as 'http' | 'socks5' })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="http">HTTP</SelectItem>
                <SelectItem value="socks5">SOCKS5</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div>
              <Label>{t('form.hostAddress')}</Label>
              <Input
                value={proxy.host}
                onChange={(e) => setProxy({ ...proxy, host: e.target.value })}
                placeholder="127.0.0.1"
              />
            </div>
            <div>
              <Label>{t('form.port')}</Label>
              <Input
                type="number"
                value={proxy.port}
                onChange={(e) => setProxy({ ...proxy, port: (e.target.value === '' ? '' : parseInt(e.target.value)) as number })}
                onBlur={() => {
                  const v = Number(proxy.port);
                  if (!v) setProxy({ ...proxy, port: 7890 })
                }}
              />
            </div>
          </div>
        </div>
      )}

      <Button onClick={handleSave} disabled={saving}>
        {saved ? <Check size={13} /> : <Save size={13} />}
        {saved ? t('form.saved') : saving ? t('status.saving') : t('form.saveProxyConfig')}
      </Button>
    </div>
  )
}

// ==================== 编辑器设置 ====================

/** 字体下拉菜单（界面字体 + 写作字体共用，现代化 Radix Select） */
function FontSelect({
  value,
  onChange,
}: {
  value: FontId
  onChange: (id: FontId) => void
}) {
  const { t } = useTranslation()
  const current = FONT_OPTIONS.find((o) => o.id === value) ?? FONT_OPTIONS[0]
  // 字体名优先走 i18n（labelKey 有则翻译，否则用内置中文 fallback）
  const currentLabel = current.labelKey ? t(current.labelKey as TextKey) : current.label

  return (
    <Select value={value} onValueChange={(v) => onChange(v as FontId)}>
      <SelectTrigger className="w-full">
        {/* 当前字体预览 */}
        <span className="flex-1 truncate text-left" style={{ fontFamily: current.family }}>
          {currentLabel}
        </span>
        <span className="text-xs flex-shrink-0 opacity-60">{current.preview}</span>
      </SelectTrigger>
      <SelectContent className="w-[var(--radix-select-trigger-width)]">
        {FONT_OPTIONS.map((opt) => (
          <SelectItem key={opt.id} value={opt.id} className="py-2">
            <div className="flex items-center gap-3 w-full">
              {/* 字体名 + 描述 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium" style={{ fontFamily: opt.family }}>
                    {opt.labelKey ? t(opt.labelKey as TextKey) : opt.label}
                  </span>
                  <span className="text-[0.65rem] opacity-60">{opt.labelEn}</span>
                </div>
                <p className="text-[0.65rem] truncate opacity-60">
                  {opt.descKey ? t(opt.descKey as TextKey) : opt.desc}
                </p>
              </div>
              {/* 预览文字 */}
              <span
                className="text-sm flex-shrink-0"
                style={{ fontFamily: opt.family, color: 'var(--color-text-secondary)' }}
              >
                {opt.preview}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function EditorSection() {
  const { writingFont, setWritingFont, uiFont, setUiFont } = useThemeStore()
  const { t, locale } = useTranslation()

  return (
    <div className="max-w-md space-y-5">
      {/* 界面语言 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{t('settings.language')}</p>
            <p className="text-[0.68rem] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('settings.languageDesc')}
            </p>
          </div>
        </div>
        <Select value={locale} onValueChange={(v) => switchLocale(v as SupportedLocale)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t('settings.language')} />
          </SelectTrigger>
          <SelectContent>
            {SUPPORTED_LOCALES.map((loc) => (
              <SelectItem key={loc} value={loc}>
                {loc === 'zh-CN' ? '🇨🇳' : loc === 'en-US' ? '🇺🇸' : '🇷🇺'} {LOCALE_LABELS[loc]} ({loc})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 界面字体 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{t('settings.uiFont')}</p>
            <p className="text-[0.68rem] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('settings.uiFontDesc')}
            </p>
          </div>
        </div>
        <FontSelect value={uiFont} onChange={setUiFont} />
      </div>

      {/* 写作字体 */}
      <div className="space-y-1.5">
        <div>
          <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{t('settings.writingFont')}</p>
          <p className="text-[0.68rem] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {t('settings.writingFontDesc')}
          </p>
        </div>
        <FontSelect value={writingFont} onChange={setWritingFont} />
      </div>

      {/* 说明 */}
      <div
        className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs"
        style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-muted)' }}
      >
        <span className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{t('settings.fontHint')}</span>
        <span>{t('settings.fontHintDesc')}</span>
      </div>
    </div>
  )
}

// ==================== 文件区（原原生菜单「文件」） ====================

/** 检查更新 + 退出应用 — 替代原生菜单栏的「文件」菜单 */
function FileSection() {
  const { t } = useTranslation()
  const {
    status, updateInfo, error,
    checkForUpdates, downloadUpdate, installUpdate, openReleasesPage,
  } = useUpdateStore()
  const [checking, setChecking] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [confirmQuit, setConfirmQuit] = useState(false)

  const isChecking = checking || status === 'checking'

  const handleCheck = async () => {
    setChecking(true)
    await checkForUpdates()
    setChecking(false)
  }

  const handleDownload = async () => {
    setDownloading(true)
    await downloadUpdate()
    setDownloading(false)
  }

  const handleQuit = () => {
    if (!confirmQuit) {
      setConfirmQuit(true)
      return
    }
    // 关闭窗口：主进程 close 事件会自动检查未保存内容
    window.close()
  }

  return (
    <div className="max-w-[480px] space-y-5">
      {/* 检查更新卡片 */}
      <div
        className="rounded-xl p-4 space-y-3"
        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{t('settings.checkUpdate')}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('settings.currentVersion')}: v{__APP_VERSION__}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={handleCheck} disabled={isChecking}>
            {isChecking
              ? <Loader2 size={13} className="animate-spin" />
              : <RefreshCw size={13} />}
            {isChecking ? t('status.checking') : t('settings.checkUpdate')}
          </Button>
        </div>

        {/* 更新状态反馈 */}
        {status === 'no-update' && (
          <p className="text-xs flex items-center gap-1" style={{ color: 'var(--color-success)' }}>
            <Check size={13} />
            {t('settings.upToDate')}
          </p>
        )}
        {status === 'available' && updateInfo && (
          <div className="text-xs space-y-2">
            <p style={{ color: 'var(--color-accent)' }}>
              ✨ {t('update.newVersion')} v{updateInfo.version}
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleDownload} disabled={downloading}>
                {downloading
                  ? <Loader2 size={13} className="animate-spin" />
                  : <Download size={13} />}
                {downloading ? t('status.downloading') : t('update.installing')}
              </Button>
              <Button size="sm" variant="ghost" onClick={openReleasesPage}>
                <ExternalLink size={13} />
                {t('action.details')}
              </Button>
            </div>
          </div>
        )}
        {status === 'downloaded' && (
          <div className="text-xs space-y-2">
            <p style={{ color: 'var(--color-success)' }}>
              ✅ {t('update.downloaded')}
            </p>
            <Button size="sm" onClick={() => installUpdate()}>
              <RefreshCw size={13} />
              {t('action.restart')}
            </Button>
          </div>
        )}
        {status === 'error' && (
          <p className="text-xs" style={{ color: 'var(--color-error)' }}>
            {t('update.checkFailed')}{error || t('update.unknownError')}
          </p>
        )}
      </div>

      {/* 退出应用卡片 */}
      <div
        className="rounded-xl p-4 space-y-3"
        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}
      >
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{t('settings.quitApp')}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {t('settings.quitAppDesc')}
          </p>
        </div>
        <Button
          size="sm"
          variant={confirmQuit ? 'destructive' : 'outline'}
          onClick={handleQuit}
          onMouseLeave={() => setConfirmQuit(false)}
        >
          <LogOut size={13} />
          {confirmQuit ? t('settings.quitConfirm') : t('settings.quitApp')}
        </Button>
      </div>
    </div>
  )
}

// ==================== 关于与支持区 ====================

function AboutSection() {
  const { t } = useTranslation()
  const { openReleasesPage, triggerUninstall } = useUpdateStore()
  const [confirmUninstall, setConfirmUninstall] = useState(false)

  const handleUninstall = async () => {
    if (!confirmUninstall) {
      setConfirmUninstall(true)
      return
    }
    await triggerUninstall()
  }

  return (
    <div className="space-y-6 max-w-[600px] p-2">
      {/* 品牌标识 */}
      <div className="flex flex-col items-center justify-center py-10 rounded-xl space-y-3" style={{ backgroundColor: 'var(--color-sidebar)', border: '1px solid var(--color-border)' }}>
        <h1 className="text-2xl font-bold brand-gradient tracking-wider">NovelForge</h1>
        <p className="text-sm opacity-80" style={{ color: 'var(--color-text)' }}>v{__APP_VERSION__}</p>
        <p className="text-xs mt-1 leading-relaxed text-center max-w-[320px]" style={{ color: 'var(--color-text-muted)' }}>
          {t('about.slogan')}
        </p>
        <p className="text-[11px] leading-relaxed text-center max-w-[360px]" style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>
          {t('about.sloganEn')}
        </p>
        <p className="text-[11px] mt-3 px-3 py-1.5 rounded-full" style={{ backgroundColor: 'var(--color-sidebar)', color: 'var(--color-text-muted)' }}>
          {t('about.tagline')}
        </p>
      </div>

      {/* 项目介绍 */}
      <div className="space-y-3 rounded-lg p-4" style={{ backgroundColor: 'var(--color-sidebar)', border: '1px solid var(--color-border)' }}>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text)' }}>
          <MarkdownContent content={t('about.intro')} />
        </p>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          {t('about.opensource')}
        </p>
      </div>

      {/* 帮助操作（原原生菜单「帮助」） */}
      <div
        className="rounded-lg p-4 space-y-4"
        style={{ backgroundColor: 'var(--color-sidebar)', border: '1px solid var(--color-border)' }}
      >
        {/* 查看发布页面 */}
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{t('settings.releasesPage')}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {t('settings.releasesPageDesc')}
          </p>
          <Button size="sm" variant="outline" className="mt-2" onClick={openReleasesPage}>
            <ExternalLink size={13} />
            {t('settings.releasesPage')}
          </Button>
        </div>

        <div style={{ height: 1, backgroundColor: 'var(--color-border)' }} />

        {/* 卸载 */}
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{t('settings.uninstall')}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {t('settings.uninstallDesc')}
          </p>
          <Button
            size="sm"
            variant={confirmUninstall ? 'destructive' : 'outline'}
            className="mt-2"
            onClick={handleUninstall}
            onMouseLeave={() => setConfirmUninstall(false)}
          >
            <Trash2 size={13} />
            {confirmUninstall ? t('settings.uninstallConfirm') : t('settings.uninstall')}
          </Button>
        </div>
      </div>

    </div>
  )
}

// ==================== 工具函数 ====================

function providerEmoji(provider: string) {
  const map: Record<string, string> = {
    openai: '🤖', deepseek: '🐬', gemini: '✨', ollama: '🦙', bigmodel: '🧠', custom: '⚙️',
  }
  return map[provider] ?? '🔧'
}
