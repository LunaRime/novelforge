import { useState, useEffect } from 'react'
import { Plus, Trash2, Check, Zap, Save, Globe } from 'lucide-react'
import { useLLMStore } from '../../stores/llm-store'
import type { ModelProfile } from '../../shared/ipc-channels'
import { randomUUID } from '../../utils/id'
import { useTranslation } from '../../hooks/useTranslation'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../ui/Select'
import { toast } from '../ui/Toast'
import { renderLog } from '../../services/render-logger'
import { cn } from '../../lib/utils'

/** 模型设置面板 — 在侧边栏 settings 视图中展示 */
export default function ModelSettings() {
  const { t } = useTranslation()
  const models = useLLMStore(s => s.models)
  const defaultModelId = useLLMStore(s => s.defaultModelId)
  const loaded = useLLMStore(s => s.loaded)
  const loadModels = useLLMStore(s => s.loadModels)
  const saveModel = useLLMStore(s => s.saveModel)
  const deleteModel = useLLMStore(s => s.deleteModel)
  const setDefaultModel = useLLMStore(s => s.setDefaultModel)
  const [editingModel, setEditingModel] = useState<ModelProfile | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!loaded) loadModels()
  }, [loaded, loadModels])

  /** 创建新模型配置 */
  const handleAddModel = () => {
    setEditingModel({
      id: randomUUID(),
      name: '',
      provider: 'openai',
      protocol: 'openai',
      modelName: 'deepseek-v4-flash',
      apiKey: '',
      baseUrl: 'https://api.openai.com',
      temperature: 0.7,
      maxTokens: 4096,
      purposes: ['generation'],
    })
  }

  /** 保存模型 */
  const handleSave = async () => {
    if (!editingModel) return
    const t0 = Date.now()
    setSaving(true)
    try {
      await saveModel(editingModel)
      // 保存行为日志流：成功 info + toast 视觉反馈
      renderLog('info', 'Save:Model', `模型保存成功 ${editingModel.id}（${Date.now() - t0}ms）`)
      toast.success(t('save.success'))
    } catch (e) {
      renderLog('error', 'Save:Model', `模型保存失败 ${editingModel.id}: ${String(e)}`)
      toast.error(t('save.failed').replace('{error}', String(e)))
    }
    setEditingModel(null)
    setSaving(false)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 标题栏 */}
      <div className="panel-header flex items-center justify-between">
        <span>{t('model.configTitle')}</span>
        <Button variant="ghost" size="icon" onClick={handleAddModel} title={t('model.addModel')}>
          <Plus size={16} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {/* 编辑表单 */}
        {editingModel && (
          <ModelForm
            model={editingModel}
            onChange={setEditingModel}
            onSave={handleSave}
            onCancel={() => setEditingModel(null)}
            saving={saving}
          />
        )}

        {/* 空状态 */}
        {!editingModel && models.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 opacity-40">
            <Zap size={32} />
            <span className="text-sm">{t('model.noConfig')}</span>
            <Button onClick={handleAddModel} size="sm">{t('model.addFirst')}</Button>
          </div>
        )}

        {/* 模型列表 */}
        {!editingModel && models.map((model) => (
          <div
            key={model.id}
            className={cn(
              'p-3 rounded-lg cursor-pointer group bg-[var(--color-panel)] border',
              defaultModelId === model.id ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'
            )}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium text-sm text-[var(--color-text)]">
                {model.name || model.modelName}
              </span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {defaultModelId !== model.id && (
                  <Button variant="ghost" size="icon" onClick={() => setDefaultModel(model.id)} title={t('model.setDefault')}>
                    <Check size={14} />
                  </Button>
                )}
                <Button variant="ghost" size="icon" onClick={() => setEditingModel({ ...model })} title={t('action.edit')}>
                  <Save size={14} />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => deleteModel(model.id)} title={t('action.delete')} className="hover:text-red-400">
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
            <div className="text-xs text-[var(--color-text-muted)]">
              {model.provider} · {model.modelName}
              {defaultModelId === model.id && (
                <span className="ml-2 px-1.5 py-0.5 rounded text-[0.7rem] bg-[var(--color-accent)] text-white">
                  {t('model.default')}
                </span>
              )}
            </div>
          </div>
        ))}

        {/* 代理配置 */}
        {!editingModel && (
          <ProxySettings />
        )}
      </div>
    </div>
  )
}

/** 模型编辑表单 */
function ModelForm({
  model,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  model: ModelProfile
  onChange: (m: ModelProfile) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
}) {
  const { t } = useTranslation()
  const testConnection = useLLMStore(s => s.testConnection)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean, error?: string } | null>(null)

  const update = <K extends keyof ModelProfile>(key: K, value: ModelProfile[K]) => {
    onChange({ ...model, [key]: value })
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    const result = await testConnection(model)
    setTestResult(result)
    setTesting(false)
    setTimeout(() => setTestResult(null), 3000)
  }

  return (
    <div className="p-3 rounded-lg space-y-3 bg-[var(--color-panel)] border border-[var(--color-accent)]">
      <div>
        <Label>{t('form.name')}</Label>
        <Input value={model.name} onChange={(e) => update('name', e.target.value)} placeholder={t('model.namePlaceholderSidebar')} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>{t('form.provider')}</Label>
          <Select value={model.provider} onValueChange={(v) => update('provider', v as ModelProfile['provider'])}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI</SelectItem>
              <SelectItem value="deepseek">DeepSeek</SelectItem>
              <SelectItem value="gemini">Gemini</SelectItem>
              <SelectItem value="ollama">Ollama</SelectItem>
              <SelectItem value="custom">{t('model.providerCustom')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t('form.protocol')}</Label>
          <Select value={model.protocol} onValueChange={(v) => update('protocol', v as ModelProfile['protocol'])}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">{t('model.protoOpenAI')}</SelectItem>
              <SelectItem value="gemini">Gemini</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label>{t('model.modelName')}</Label>
        <Input value={model.modelName} onChange={(e) => update('modelName', e.target.value)} placeholder="gpt-5.6-luna / deepseek-v4-flash" />
      </div>
      <div>
        <Label>{t('form.apiAddress')}</Label>
        <Input value={model.baseUrl} onChange={(e) => update('baseUrl', e.target.value)} placeholder="https://api.openai.com" />
      </div>
      <div>
        <Label>{t('form.apiKey')}</Label>
        <Input type="password" value={model.apiKey} onChange={(e) => update('apiKey', e.target.value)} placeholder="sk-..." />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>{t('form.temperature')}</Label>
          <Input
            value={String(model.temperature)}
            onChange={(e) => update('temperature', (e.target.value === '' ? '' : parseFloat(e.target.value)) as number)}
            onBlur={() => {
              let v = Number(model.temperature);
              if (isNaN(v)) { update('temperature', 0.7); return }
              if (v < 0 || v > 2) {
                v = Math.max(0, Math.min(2, v))
                update('temperature', v)
                toast.info(t('model.toast.tempLimited').replace('{v}', String(v)))
              }
            }}
          />
        </div>
        <div>
          <Label>{t('form.maxTokens')}</Label>
          <Input
            value={String(model.maxTokens)}
            onChange={(e) => update('maxTokens', (e.target.value === '' ? '' : parseInt(e.target.value)) as number)}
            onBlur={() => {
              let v = Number(model.maxTokens);
              if (!v || v < 1) { update('maxTokens', 4096); return }
              if (v > 131072) {
                v = 131072
                update('maxTokens', v)
                toast.info(t('model.toast.tokensLimited').replace('{v}', String(v)))
              }
            }}
          />
        </div>
      </div>

      {/* 操作按钮 */}
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
          {saving ? t('model.saving') : t('action.save')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>{t('action.cancel')}</Button>
      </div>
      {testResult && (
        <div className={`text-xs p-2 rounded ${testResult.success ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'} break-all`}>
          {testResult.success ? '✅ ' + t('model.testSuccess') : '❌ ' + t('model.testFailed').replace('{error}', testResult.error ?? '')}
        </div>
      )}
    </div>
  )
}

/** 代理配置面板 */
function ProxySettings() {
  const { t } = useTranslation()
  const [proxy, setProxy] = useState<{
    enabled: boolean; type: 'http' | 'socks5'; host: string; port: number
  }>({ enabled: false, type: 'http', host: '', port: 7890 })
  const [saving, setSaving] = useState(false)

  const loadProxy = async () => {
    try {
      const { ipc } = await import('../../services/ipc-client')
      const config = await ipc.invoke('config:get')
      if (config.proxy) setProxy(config.proxy)
    } catch { /* 忽略 */ }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProxy()
  }, [])

  const handleSave = async () => {
    const t0 = Date.now()
    setSaving(true)
    try {
      const { ipc } = await import('../../services/ipc-client')
      await ipc.invoke('config:set', { proxy })
      // 保存行为日志流：成功 info + toast 视觉反馈
      renderLog('info', 'Save:Model', `代理配置保存成功（${Date.now() - t0}ms）`)
      toast.success(t('save.success'))
    } catch (e) {
      // 失败不再静默（原 catch 忽略）
      renderLog('error', 'Save:Model', `代理配置保存失败: ${String(e)}`)
      toast.error(t('save.failed').replace('{error}', String(e)))
    }
    setSaving(false)
  }

  return (
    <div className="mt-4 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-[var(--color-text)] flex items-center gap-1">
          <Globe size={13} /> {t('proxy.configTitle')}
        </span>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={proxy.enabled}
            onChange={(e) => setProxy({ ...proxy, enabled: e.target.checked })}
            className="rounded"
          />
          <span className="text-[0.7rem] text-[var(--color-text-muted)]">
            {proxy.enabled ? t('proxy.enabled') : t('proxy.disabled')}
          </span>
        </label>
      </div>
      {proxy.enabled && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label className="text-[0.7rem] w-12 flex-shrink-0">{t('proxy.type')}</Label>
            <Select
              value={proxy.type}
              onValueChange={(v) => setProxy({ ...proxy, type: v as 'http' | 'socks5' })}
            >
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="http">HTTP</SelectItem>
                <SelectItem value="socks5">SOCKS5</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-[0.7rem] w-12 flex-shrink-0">{t('proxy.host')}</Label>
            <Input
              className="h-7 text-xs flex-1"
              value={proxy.host}
              onChange={(e) => setProxy({ ...proxy, host: e.target.value })}
              placeholder="127.0.0.1"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-[0.7rem] w-12 flex-shrink-0">{t('form.port')}</Label>
            <Input
              className="h-7 text-xs w-24"
              type="number"
              value={proxy.port}
              onChange={(e) => setProxy({ ...proxy, port: (e.target.value === '' ? '' : parseInt(e.target.value)) as number })}
              onBlur={() => {
                const v = Number(proxy.port);
                if (!v) setProxy({ ...proxy, port: 7890 });
              }}
            />
          </div>
          <Button variant="outline" size="sm" onClick={handleSave} disabled={saving} className="w-full mt-2">
            <Save size={12} /> {saving ? t('model.saving') : t('form.saveProxyConfig')}
          </Button>
        </div>
      )}
    </div>
  )
}
