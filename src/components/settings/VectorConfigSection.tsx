import { DEFAULT_LOCALE } from '../../shared/locale'
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
import { Switch } from '../ui/Switch'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { Label } from '../ui/Label'
import type { ModelProfile } from '../../shared/ipc-channels'
import { BUILTIN_PRESETS } from '../../shared/provider-presets'
import { randomUUID } from '../../utils/id'

// ===== 工作模式配置 =====

const MODE_INFO: Record<VectorWorkMode, {
  label: string
  icon: React.ReactNode
  desc: string
  color: string
}> = {
  auto: {
    label: '智能分配',
    icon: <Sparkles size={14} />,
    desc: '向量模型处理语义搜索，本地模块处理快速比较，自动选择最优方案',
    color: '#10b981',
  },
  model_only: {
    label: '仅向量模型',
    icon: <Cpu size={14} />,
    desc: '仅使用 Embedding API 生成向量，本地模块已关闭',
    color: '#3b82f6',
  },
  module_only: {
    label: '仅本地模块',
    icon: <Database size={14} />,
    desc: '使用纯文本 FTS 搜索 + 本地余弦相似度，不调用 Embedding API',
    color: '#f59e0b',
  },
  disabled: {
    label: '已禁用',
    icon: <WifiOff size={14} />,
    desc: '所有向量功能已关闭，Agent 向量工具将返回错误提示',
    color: '#ef4444',
  },
}

// ===== 主组件 =====

export default function VectorConfigSection() {
  const store = useVectorConfigStore()
  const llmStore = useLLMStore()
  const [testResult, setTestResult] = useState<VectorTestResult | null>(
    store.lastTestResult,
  )

  // 初始化加载
  useEffect(() => {
    store.load()
    store.loadLLMCandidates()
  }, [])

  // 模型列表（仅嵌入用途）
  const embeddingModels = llmStore.models.filter((m) =>
    m.purposes?.includes('embedding'),
  )
  const defaultEmbeddingModelId = llmStore.defaultEmbeddingModelId

  // ===== 工作分配说明 =====

  const distributionLogic = () => {
    const parts: string[] = []

    if (!store.isAnyVectorAvailable()) {
      return '所有向量功能已禁用。Agent 的 search_knowledge 将降级为纯文本匹配，compare_texts 和 embed_text 将不可用。'
    }

    if (store.vectorModelEnabled) {
      parts.push('向量模型 (Embedding API): 负责语义搜索 (search_knowledge)、文本嵌入 (embed_text)、语义比较 (compare_texts)')
    }
    if (store.llmEmbeddingEnabled) {
      parts.push('LLM 向量化: 使用 LLM 生成语义向量，作为 Embedding API 的补充或替代方案。当 Embedding API 不可用时自动接管')
    }
    if (store.vectorModuleEnabled) {
      parts.push('本地模块 (LanceDB): 负责 FTS 全文搜索、快速文本匹配、本地相似度验证')
    }

    // 说明降级顺序
    if (store.vectorModelEnabled && store.llmEmbeddingEnabled) {
      parts.push('\n降级链: Embedding API → LLM 向量化 → 本地 FTS')
    } else if (store.vectorModelEnabled) {
      parts.push('\n降级链: Embedding API → 本地 FTS')
    } else if (store.llmEmbeddingEnabled) {
      parts.push('\n降级链: LLM 向量化 → 本地 FTS')
    }

    return parts.join('。\n')
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

  const modeInfo = MODE_INFO[store.workMode]

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
            {modeInfo.label} 模式
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
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
                向量模块
              </span>
            </div>
            <Switch
              checked={store.vectorModuleEnabled}
              onCheckedChange={store.toggleVectorModule}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            LanceDB FTS 全文搜索 + 本地余弦相似度 + Top-K 查找。
            <br />
            不依赖外部 API，纯本地运行。
          </div>
          {!store.vectorModuleEnabled && (
            <div className="mt-2 flex items-center gap-1 text-xs text-yellow-600">
              <AlertTriangle size={12} />
              已关闭 — Agent 向量工具将降级
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
                向量模型
              </span>
            </div>
            <Switch
              checked={store.vectorModelEnabled}
              onCheckedChange={store.toggleVectorModel}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            Embedding API（OpenAI / Gemini）— 语义搜索和文本嵌入。
            <br />
            需要配置 API Key 和网络连接。
          </div>
          {!store.vectorModelEnabled && (
            <div className="mt-2 flex items-center gap-1 text-xs text-yellow-600">
              <AlertTriangle size={12} />
              已关闭 — 本地模块将接管工作
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
          当前工作分配
        </div>
        <div className="text-muted-foreground leading-relaxed">
          {distributionLogic()}
        </div>
      </div>

      {/* ===== 向量模型管理（仅在开启时显示） ===== */}
      {store.vectorModelEnabled && (
        <div className="border rounded-lg p-4" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium" style={{ color: 'var(--color-text)' }}>
              已配置的向量模型
            </h4>
            <Button variant="outline" size="sm" onClick={handleAddEmbeddingModel}>
              + 添加
            </Button>
          </div>

          {embeddingModels.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-3">
              暂无向量模型，请添加一个 Embedding 模型
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
                    <div className="text-muted-foreground truncate">
                      {model.provider} · {model.modelName}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                    {model.id === defaultEmbeddingModelId ? (
                      <Badge variant="success" className="text-[10px]">默认</Badge>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-[10px] h-5"
                        onClick={() => handleSetDefaultEmbedding(model.id)}
                      >
                        设为默认
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
              LLM 向量化
            </h4>
            <Badge variant="outline" className="text-[10px]">实验性</Badge>
          </div>
          <Switch
            checked={store.llmEmbeddingEnabled}
            onCheckedChange={store.toggleLLMEmbedding}
          />
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          将 LLM（如 GPT-4o、DeepSeek）作为向量模型使用。LLM 通过特殊 prompt 输出固定维度的语义向量。
          <br />
          适用于没有专用 Embedding API 但有 LLM API 的场景。
        </p>

        {store.llmEmbeddingEnabled && (
          <div className="space-y-3 mt-3 pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
            {/* LLM 模型选择 */}
            <div>
              <Label>选择 LLM 模型</Label>
              <select
                className="w-full mt-1 px-2 py-1.5 rounded border text-xs bg-background"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                value={store.llmEmbeddingSettings.modelId || ''}
                onChange={(e) => {
                  store.setLLMEmbeddingSettings({ modelId: e.target.value || null })
                }}
              >
                <option value="">-- 选择 LLM 模型 --</option>
                {store.llmCandidates.length === 0 && (
                  <option value="" disabled>加载中...</option>
                )}
                {store.llmCandidates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.modelName} ({m.provider})
                  </option>
                ))}
              </select>
              {store.llmCandidates.length === 0 && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  未找到可用的 LLM 模型。请在「AI 生成模型」中添加非 embedding 用途的模型。
                </p>
              )}
            </div>

            {/* 向量维度 */}
            <div>
              <Label>输出向量维度: {store.llmEmbeddingSettings.dimensions}</Label>
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
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>64 (低精度/低成本)</span>
                <span>256 (推荐)</span>
                <span>1024 (高精度/高成本)</span>
              </div>
            </div>

            {/* 说明 */}
            <div className="p-2 rounded text-[10px]" style={{ backgroundColor: 'var(--color-hover)' }}>
              <div className="font-medium mb-1" style={{ color: 'var(--color-text)' }}>工作原理</div>
              <div className="text-muted-foreground leading-relaxed">
                1. 向 LLM 发送特殊 prompt，要求输出固定维度的语义向量<br />
                2. LLM 返回 JSON 浮点数组<br />
                3. L2 归一化后存入缓存<br />
                4. 后续搜索和比较使用此向量<br />
                <br />
                <span className="text-yellow-600">注意：LLM 向量化比专用 Embedding API 慢 5-20 倍，且成本较高（每次嵌入消耗的 Token 约等于文本长度的 2-3 倍）。仅在无 Embedding API 时使用。</span>
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
              连通性测试
            </h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              验证向量模块、向量模型、AI 工具调用三方是否正常
            </p>
          </div>
          <Button
            variant="ai"
            size="sm"
            onClick={handleTest}
            disabled={store.testing}
          >
            <RefreshCw size={12} className={store.testing ? 'animate-spin' : ''} />
            {store.testing ? '测试中...' : '运行测试'}
          </Button>
        </div>

        {/* 测试结果 */}
        {testResult && (
          <div className="space-y-2 mt-2">
            <TestResultRow
              label="向量模块 (LanceDB)"
              ok={testResult.moduleOk}
              detail={testResult.moduleDetail}
            />
            <TestResultRow
              label="向量模型 (Embedding API)"
              ok={testResult.modelOk}
              detail={testResult.modelDetail}
            />
            <TestResultRow
              label="LLM 向量化"
              ok={testResult.llmEmbeddingOk}
              detail={testResult.llmEmbeddingDetail}
            />
            <TestResultRow
              label="AI 工具调用"
              ok={testResult.agentToolOk}
              detail={
                testResult.agentToolOk
                  ? 'Agent 可正常调用 search_knowledge / compare_texts / embed_text'
                  : 'Agent 工具调用失败 — 请检查配置'
              }
            />
            <div className="text-[10px] text-muted-foreground text-right">
              测试时间: {new Date(testResult.testedAt).toLocaleString(DEFAULT_LOCALE)}
            </div>
          </div>
        )}

        {!testResult && !store.testing && (
          <div className="text-xs text-muted-foreground text-center py-3">
            点击"运行测试"验证向量服务的连通性
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
          {label}: {ok ? '正常' : '异常'}
        </span>
        <div className="text-muted-foreground mt-0.5">{detail}</div>
      </div>
    </div>
  )
}
