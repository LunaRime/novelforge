import { DEFAULT_LOCALE, type TextKey } from '../../shared/locale'
/**
 * VectorConfigSection — 向量配置管理面板
 *
 * 功能：
 * 1. 向量模块开关（本地 LanceDB FTS + 余弦相似度）
 * 2. 向量模型开关（Embedding API）+ 模型选择
 * 3. 连通性测试（验证模块/模型/AI 工具三方可用）
 * 4. 工作模式显示（auto / model_only / module_only / disabled）
 */

import { useEffect, useState } from 'react'
import {
  Database, WifiOff, RefreshCw, CheckCircle2,
  XCircle, AlertTriangle, Sparkles, Cpu, ArrowRight,
  Brain,
} from 'lucide-react'
import { useVectorConfigStore, type VectorWorkMode, type VectorTestResult } from '../../stores/vector-config-store'
import { useLLMStore } from '../../stores/llm-store'
import { useTranslation } from '../../hooks/useTranslation'
import { Switch } from '../ui/Switch'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { Label } from '../ui/Label'
import type { ModelProfile } from '../../shared/ipc-channels'
import { BUILTIN_PRESETS } from '../../shared/provider-presets'
import { randomUUID } from '../../utils/id'

// ===== 工作模式配置 =====

function getModeInfo(t: (key: TextKey) => string): Record<VectorWorkMode, {
  label: string
  icon: React.ReactNode
  desc: string
  color: string
}> {
  return {
    auto: {
      label: t('vector.smartDistribute'),
      icon: <Sparkles size={14} />,
      desc: t('vector.smartDistributeDesc'),
      color: 'var(--color-success)',
    },
    model_only: {
      label: t('vector.modelOnly'),
      icon: <Cpu size={14} />,
      desc: t('vector.modelOnlyDesc'),
      color: 'var(--color-info)',
    },
    module_only: {
      label: t('vector.localOnly'),
      icon: <Database size={14} />,
      desc: t('vector.localOnlyDesc'),
      color: 'var(--color-warning)',
    },
    disabled: {
      label: t('vector.disabled'),
      icon: <WifiOff size={14} />,
      desc: t('vector.disabledDesc'),
      color: 'var(--color-error)',
    },
  }
}

// ===== 主组件 =====

export default function VectorConfigSection() {
  const store = useVectorConfigStore()
  const llmStore = useLLMStore()
  const { t } = useTranslation()
  const [testResult, setTestResult] = useState<VectorTestResult | null>(
    store.lastTestResult,
  )

  // 初始化加载
  useEffect(() => {
    store.load()
    store.loadLLMCandidates()
  }, [store])

  // 模型列表（仅嵌入用途）
  const embeddingModels = llmStore.models.filter((m) =>
    m.purposes?.includes('embedding'),
  )
  const defaultEmbeddingModelId = llmStore.defaultEmbeddingModelId

  // ===== 工作分配说明 =====

  const distributionLogic = (t: (key: TextKey) => string) => {
    const parts: string[] = []

    if (!store.isAnyVectorAvailable()) {
      return t('vector.distAllDisabled')
    }

    if (store.vectorModelEnabled) {
      parts.push(t('vector.distModelResp'))
    }
    if (store.llmEmbeddingEnabled) {
      parts.push(t('vector.distLLMResp'))
    }
    if (store.vectorModuleEnabled) {
      parts.push(t('vector.distModuleResp'))
    }

    // 说明降级顺序
    if (store.vectorModelEnabled && store.llmEmbeddingEnabled) {
      parts.push(t('vector.distChainLLM'))
    } else if (store.vectorModelEnabled) {
      parts.push(t('vector.distChainModel'))
    } else if (store.llmEmbeddingEnabled) {
      parts.push(t('vector.distChainLLMOnly'))
    }

    return parts.join('\n')
  }

  // ===== 测试处理器 =====

  const handleTest = async () => {
    const result = await store.testConnection()
    setTestResult(result)
  }

  // ===== 设置默认嵌入模型 =====

  const handleSetDefaultEmbedding = async (modelId: string) => {
    await llmStore.setDefaultEmbeddingModel(modelId)
  }

  // ===== 添加嵌入模型 =====

  const handleAddEmbeddingModel = () => {
    const openaiPreset = BUILTIN_PRESETS.find((p) => p.provider === 'openai') ?? BUILTIN_PRESETS[0]
    const newModel: ModelProfile = {
      id: randomUUID(),
      name: '',
      provider: 'openai',
      protocol: (openaiPreset?.protocol ?? 'openai') as 'openai' | 'gemini',
      modelName: openaiPreset?.embeddingModels?.[0] ?? 'text-embedding-3-small',
      apiKey: '',
      baseUrl: openaiPreset?.baseUrl ?? 'https://api.openai.com',
      temperature: 0,
      maxTokens: 0,
      purposes: ['embedding'],
    }
    llmStore.saveModel(newModel)
  }

  const modeInfo = getModeInfo(t)[store.workMode]

  return (
    <div className="flex flex-col gap-5 text-sm">
      {/* ===== 工作模式状态栏 ===== */}
      <div
        className="flex items-center gap-3 p-3 rounded-lg border"
        style={{
          backgroundColor: `${modeInfo.color}10`,
          borderColor: `${modeInfo.color}40`,
        }}
      >
        <div style={{ color: modeInfo.color }}>{modeInfo.icon}</div>
        <div className="flex-1">
          <div className="font-medium" style={{ color: 'var(--color-text)' }}>
            {modeInfo.label}{t('vector.modeSuffix')}
          </div>
          <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
            {modeInfo.desc}
          </div>
        </div>
      </div>

      {/* ===== 开关控制区 ===== */}
      <div className="grid grid-cols-2 gap-4">
        {/* 向量模块 */}
        <div
          className="p-4 rounded-lg border"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Database size={16} style={{ color: 'var(--color-text)' }} />
              <span className="font-medium" style={{ color: 'var(--color-text)' }}>
                {t('vector.module')}
              </span>
            </div>
            <Switch
              checked={store.vectorModuleEnabled}
              onCheckedChange={store.toggleVectorModule}
            />
          </div>
          <div className="text-xs text-[var(--color-text-muted)] whitespace-pre-line">
            {t('vector.moduleDesc')}
          </div>
          {!store.vectorModuleEnabled && (
            <div className="mt-2 flex items-center gap-1 text-xs text-[var(--color-warning)]">
              <AlertTriangle size={12} />
              {t('vector.moduleOff')}
            </div>
          )}
        </div>

        {/* 向量模型 */}
        <div
          className="p-4 rounded-lg border"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Cpu size={16} style={{ color: 'var(--color-text)' }} />
              <span className="font-medium" style={{ color: 'var(--color-text)' }}>
                {t('settings.vectorModel')}
              </span>
            </div>
            <Switch
              checked={store.vectorModelEnabled}
              onCheckedChange={store.toggleVectorModel}
            />
          </div>
          <div className="text-xs text-[var(--color-text-muted)] whitespace-pre-line">
            {t('vector.modelDesc')}
          </div>
          {!store.vectorModelEnabled && (
            <div className="mt-2 flex items-center gap-1 text-xs text-[var(--color-warning)]">
              <AlertTriangle size={12} />
              {t('vector.modelOff')}
            </div>
          )}
        </div>
      </div>

      {/* ===== 工作分配说明 ===== */}
      <div
        className="p-3 rounded-lg text-xs"
        style={{
          backgroundColor: 'var(--color-hover)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div className="flex items-center gap-1 font-medium mb-1" style={{ color: 'var(--color-text)' }}>
          <ArrowRight size={12} />
          {t('vector.workDistribution')}
        </div>
        <div className="text-[var(--color-text-muted)] leading-relaxed whitespace-pre-line">
          {distributionLogic(t)}
        </div>
      </div>

      {/* ===== 向量模型管理（仅在开启时显示） ===== */}
      {store.vectorModelEnabled && (
        <div className="border rounded-lg p-4" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium" style={{ color: 'var(--color-text)' }}>
              {t('vector.configuredModels')}
            </h4>
            <Button variant="outline" size="sm" onClick={handleAddEmbeddingModel}>
              {t('vector.add')}
            </Button>
          </div>

          {embeddingModels.length === 0 ? (
            <div className="text-xs text-[var(--color-text-muted)] text-center py-3">
              {t('vector.noModel')}
            </div>
          ) : (
            <div className="space-y-2">
              {embeddingModels.map((model) => (
                <div
                  key={model.id}
                  className="flex items-center justify-between p-2 rounded border text-xs"
                  style={{
                    borderColor:
                      model.id === defaultEmbeddingModelId
                        ? 'var(--color-accent)'
                        : 'var(--color-border)',
                    backgroundColor:
                      model.id === defaultEmbeddingModelId
                        ? 'var(--color-accent-bg)'
                        : 'transparent',
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate" style={{ color: 'var(--color-text)' }}>
                      {model.name || model.modelName}
                    </div>
                    <div className="text-[var(--color-text-muted)] truncate">
                      {model.provider} · {model.modelName}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                    {model.id === defaultEmbeddingModelId ? (
                      <Badge variant="success" className="text-[10px]">{t('model.default')}</Badge>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-[10px] h-5"
                        onClick={() => handleSetDefaultEmbedding(model.id)}
                      >
                        {t('model.setDefault')}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== LLM 向量化 ===== */}
      <div className="border rounded-lg p-4" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Brain size={16} style={{ color: 'var(--color-text)' }} />
            <h4 className="font-medium" style={{ color: 'var(--color-text)' }}>
              {t('vector.llmVectorization')}
            </h4>
            <Badge variant="outline" className="text-[10px]">{t('vector.experimental')}</Badge>
          </div>
          <Switch
            checked={store.llmEmbeddingEnabled}
            onCheckedChange={store.toggleLLMEmbedding}
          />
        </div>
        <p className="text-xs text-[var(--color-text-muted)] mb-3 whitespace-pre-line">
          {t('vector.llmVectorDesc')}
        </p>

        {store.llmEmbeddingEnabled && (
          <div className="space-y-3 mt-3 pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
            {/* LLM 模型选择 */}
            <div>
              <Label>{t('vector.selectLLM')}</Label>
              <select
                className="w-full mt-1 px-2 py-1.5 rounded border text-xs bg-[var(--color-bg)]"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                value={store.llmEmbeddingSettings.modelId || ''}
                onChange={(e) => {
                  store.setLLMEmbeddingSettings({ modelId: e.target.value || null })
                }}
              >
                <option value="">{t('vector.selectLLMPlaceholder')}</option>
                {store.llmCandidates.length === 0 && (
                  <option value="" disabled>{t('status.loading')}</option>
                )}
                {store.llmCandidates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.modelName} ({m.provider})
                  </option>
                ))}
              </select>
              {store.llmCandidates.length === 0 && (
                <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
                  {t('vector.noLLM')}
                </p>
              )}
            </div>

            {/* 向量维度 */}
            <div>
              <Label>{t('vector.outputDim').replace('{n}', String(store.llmEmbeddingSettings.dimensions))}</Label>
              <input
                type="range"
                min="64"
                max="1024"
                step="64"
                value={store.llmEmbeddingSettings.dimensions}
                onChange={(e) => {
                  store.setLLMEmbeddingSettings({ dimensions: parseInt(e.target.value) })
                }}
                className="w-full mt-1"
              />
              <div className="flex justify-between text-[10px] text-[var(--color-text-muted)]">
                <span>64 ({t('vector.lowPrecision')})</span>
                <span>256 ({t('vector.recommended')})</span>
                <span>1024 ({t('vector.highPrecision')})</span>
              </div>
            </div>

            {/* 说明 */}
            <div className="p-2 rounded text-[10px]" style={{ backgroundColor: 'var(--color-hover)' }}>
              <div className="font-medium mb-1" style={{ color: 'var(--color-text)' }}>{t('vector.howItWorks')}</div>
              <div className="text-[var(--color-text-muted)] leading-relaxed whitespace-pre-line">
                {t('vector.llmWorkSteps')}
                <br />
                <br />
                <span className="text-[var(--color-warning)]">{t('vector.llmWarning')}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ===== 连通性测试 ===== */}
      <div className="border rounded-lg p-4" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="font-medium" style={{ color: 'var(--color-text)' }}>
              {t('vector.connectivityTest')}
            </h4>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              {t('vector.connectivityDesc')}
            </p>
          </div>
          <Button
            variant="ai"
            size="sm"
            onClick={handleTest}
            disabled={store.testing}
          >
            <RefreshCw size={12} className={store.testing ? 'animate-spin' : ''} />
            {store.testing ? t('status.testing') : t('action.runTest')}
          </Button>
        </div>

        {/* 测试结果 */}
        {testResult && (
          <div className="space-y-2 mt-2">
            <TestResultRow
              label={t('vector.testModule')}
              ok={testResult.moduleOk}
              detail={testResult.moduleDetail}
            />
            <TestResultRow
              label={t('vector.testModelAPI')}
              ok={testResult.modelOk}
              detail={testResult.modelDetail}
            />
            <TestResultRow
              label={t('vector.testLLMEmbedding')}
              ok={testResult.llmEmbeddingOk}
              detail={testResult.llmEmbeddingDetail}
            />
            <TestResultRow
              label={t('vector.testAITool')}
              ok={testResult.agentToolOk}
              detail={
                testResult.agentToolOk
                  ? t('vector.agentOk')
                  : t('vector.agentFail')
              }
            />
            <div className="text-[10px] text-[var(--color-text-muted)] text-right">
              {t('vector.testTime')}{new Date(testResult.testedAt).toLocaleString(DEFAULT_LOCALE)}
            </div>
          </div>
        )}

        {!testResult && !store.testing && (
          <div className="text-xs text-[var(--color-text-muted)] text-center py-3">
            {t('vector.runTestHint')}
          </div>
        )}
      </div>
    </div>
  )
}

// ===== 子组件：测试结果行 =====

function TestResultRow({
  label,
  ok,
  detail,
}: {
  label: string
  ok: boolean
  detail: string
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-start gap-2 text-xs">
      {ok ? (
        <CheckCircle2 size={14} className="text-green-500 flex-shrink-0 mt-0.5" />
      ) : (
        <XCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
      )}
      <div>
        <span
          className="font-medium"
          style={{ color: ok ? '#16a34a' : '#dc2626' }}
        >
          {label}: {ok ? t('status.normal') : t('status.abnormal')}
        </span>
        <div className="text-[var(--color-text-muted)] mt-0.5">{detail}</div>
      </div>
    </div>
  )
}
