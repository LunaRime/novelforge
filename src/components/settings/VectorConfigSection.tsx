import { getCurrentLocale, type TextKey } from '../../shared/locale'
/**
 * VectorConfigSection — 向量配置管理面板
 *
 * 功能：
 * 1. 向量模块开关（本地 LanceDB FTS + 余弦相似度）
 * 2. 向量模型开关（Embedding API）+ 模型选择
 * 3. 连通性测试（验证模块/模型/AI 工具三方可用）
 * 4. 工作模式显示（auto / model_only / module_only / disabled）
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Database, WifiOff, RefreshCw, CheckCircle2,
  XCircle, AlertTriangle, Sparkles, Cpu, ArrowRight,
  Brain, Download, HardDrive, ChevronRight,
} from 'lucide-react'
import { useVectorConfigStore, type VectorWorkMode, type VectorTestResult } from '../../stores/vector-config-store'
import { useTranslation } from '../../hooks/useTranslation'
import { ipc } from '../../services/ipc-client'
import type { AllEventChannels, AllInvokeChannels, LocalEmbeddingConfig } from '../../shared/ipc-channels'
import { Switch } from '../ui/Switch'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { Label } from '../ui/Label'
import { Input } from '../ui/Input'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../ui/Select'

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
  const { t } = useTranslation()
  const [testResult, setTestResult] = useState<VectorTestResult | null>(
    store.lastTestResult,
  )

  // 初始化加载（**只在挂载时跑一次**）
  //
  // ⚠️ 真机 bug 修复（2026-09-13）：原实现依赖 `[store]`，而 store 是 `useVectorConfigStore()`
  //  ——**无选择器订阅，返回整个 state 对象**。每次 set() 都会产生新的 state 对象 → 组件重渲染
  //  → `store` 引用变化 → 本 effect 重跑 → 而 `loadLLMCandidates()` 内部又会
  //  `set({ llmCandidates })`（vector-config-store.ts:186）→ **无限循环**：
  //  持续重渲染 + 每秒上百次 `embedding:list-llm-candidates` IPC。
  //  真机表现：该设置页卡顿、保存/删除慢到像「几分钟没反应」。
  //  修法：用 `getState()` 取动作（不再依赖 store 身份）并固定空依赖，语义就是「初始化一次」。
  useEffect(() => {
    const s = useVectorConfigStore.getState()
    s.load()
    void s.loadLLMCandidates()
  }, [])

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
                {t('vector.embeddingModelCard')}
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

      {/* ===== 本地向量模型（T5，设计 §3.4）===== */}
      <LocalEmbeddingCard />

      {/* ===== LLM 向量化 ===== */}
      <div className="border rounded-lg p-4" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Brain size={16} style={{ color: 'var(--color-text)' }} />
            <h4 className="font-medium" style={{ color: 'var(--color-text)' }}>
              {t('vector.llmVectorization')}
            </h4>
            <Badge variant="outline" className="text-2xs">{t('vector.experimental')}</Badge>
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
              <Select
                value={store.llmEmbeddingSettings.modelId || ''}
                onValueChange={(v) => {
                  // Radix Select 无空值回调：__none__ 表示清除选择
                  store.setLLMEmbeddingSettings({ modelId: v === '__none__' ? null : v })
                }}
              >
                <SelectTrigger className="w-full mt-1">
                  <SelectValue placeholder={t('vector.selectLLMPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {store.llmCandidates.length === 0 && (
                    <SelectItem value="__loading__" disabled>{t('status.loading')}</SelectItem>
                  )}
                  {store.llmCandidates.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name || m.modelName} ({m.provider})
                    </SelectItem>
                  ))}
                  <SelectItem value="__none__">{t('vector.clearSelection')}</SelectItem>
                </SelectContent>
              </Select>
              {store.llmCandidates.length === 0 && (
                <p className="text-2xs text-[var(--color-text-muted)] mt-1">
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
              <div className="flex justify-between text-2xs text-[var(--color-text-muted)]">
                <span>64 ({t('vector.lowPrecision')})</span>
                <span>256 ({t('vector.recommended')})</span>
                <span>1024 ({t('vector.highPrecision')})</span>
              </div>
            </div>

            {/* 说明 */}
            <div className="p-2 rounded text-2xs" style={{ backgroundColor: 'var(--color-hover)' }}>
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
            <div className="text-2xs text-[var(--color-text-muted)] text-right">
              {t('vector.testTime')}{new Date(testResult.testedAt).toLocaleString(getCurrentLocale())}
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
  // final wave W4：本行原用硬编码色（`text-green-500` / `text-red-500` / `#16a34a` / `#dc2626`）
  // ——违反 AGENTS.md 核心约束（颜色只走 CSS 变量）。改用同文件 `:42/:60` 已在用的语义 token，
  // 零行为变化（同色系，且随主题变量而非固定色）。
  return (
    <div className="flex items-start gap-2 text-xs">
      {ok ? (
        <CheckCircle2 size={14} className="text-[var(--color-success)] flex-shrink-0 mt-0.5" />
      ) : (
        <XCircle size={14} className="text-[var(--color-error)] flex-shrink-0 mt-0.5" />
      )}
      <div>
        <span
          className="font-medium"
          style={{ color: ok ? 'var(--color-success)' : 'var(--color-error)' }}
        >
          {label}: {ok ? t('status.normal') : t('status.abnormal')}
        </span>
        <div className="text-[var(--color-text-muted)] mt-0.5">{detail}</div>
      </div>
    </div>
  )
}

// ===== 本地向量模型卡片（T5）=====

/**
 * Ollama 探测结果 / 已装模型 / 拉取进度帧。
 *
 * ⚠️ final wave W8：三者原为**手写镜像**（`{ ok: boolean; version?: string; … }` 等），与
 * `src/shared/ipc-channels.ts` 的通道声明构成两份独立真相 —— 主进程改了载荷，渲染层这边不会
 * 有任何编译错误，只会静默错位。现改为**派生自通道声明**（L4 铁律：`ipc-channels.ts` 是唯一
 * 声明源），零运行时影响：
 *  · `embedding:local-detect` / `embedding:local-list-models` 是 invoke 通道 → `AllInvokeChannels[C]['return']`
 *  · `embedding:local-pull-progress` 是 event 通道 → `AllEventChannels[C]`（事件载荷就是它本身）
 */
type LocalDetectResult = AllInvokeChannels['embedding:local-detect']['return']
type LocalModel = AllInvokeChannels['embedding:local-list-models']['return'][number]
type LocalPullProgress = AllEventChannels['embedding:local-pull-progress']

/** 未知异常 → 可读详情。T2/T4 的错误串是**英文技术描述**，只作「原始详情」呈现（U4） */
function errorDetail(e: unknown): string {
  if (e instanceof Error) return e.message
  return typeof e === 'string' ? e : String(e)
}

/**
 * 模型是否已安装。
 * Ollama 的 `:latest` 是默认 tag 别名，**两侧都要归一化**：
 * 列表可能给 `bge-m3:latest` 而配置是 `bge-m3`（方向一），也可能配置里手填/历史遗留
 * `bge-m3:latest` 而列表是 T2 规范化后的 `bge-m3`（方向二，T5-M4）——只归一化单侧时
 * 方向二会误报「模型未安装」。
 */
function hasLocalModel(models: LocalModel[], model: string): boolean {
  const target = model.trim()
  if (!target) return false
  return models.some((m) => stripLatest(m.name) === stripLatest(target))
}

/** `:latest` 是 Ollama 的默认 tag 别名 —— 已装判定 / 清单归属 / 选中态比较一律两侧归一化 */
function stripLatest(name: string): string {
  return name.replace(/:latest$/, '')
}

/**
 * 智能下载的路径文案：`直连` / `经代理 127.0.0.1:7897`。
 * 回退到 Ollama 自身 pull 时帧里没有 `path` 字段 → 该行整段不渲染（不是显示「未知」）。
 */
function describeDownloadPath(pull: { path?: 'direct' | 'proxy'; pathLabel?: string }, t: (key: TextKey) => string): string {
  if (pull.path === 'proxy') return t('localEmbedding.pathProxy').replace('{proxy}', pull.pathLabel ?? '')
  return t('localEmbedding.pathDirect')
}

/** 速率文案：单位（B/KB/MB）三语通用，不翻译；数值按量级选单位以免出现 1523456 B/s */
function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
  if (bytesPerSec >= 1024) return `${Math.round(bytesPerSec / 1024)} KB/s`
  return `${Math.round(bytesPerSec)} B/s`
}

/** Ollama 默认地址（R2「重置为默认」的目标；与主进程 `DEFAULT_LOCAL_EMBEDDING.baseUrl` 同值） */
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434'

/**
 * R1：内置精选向量模型清单 —— **恰好四项**，不再让用户自由输入模型名。
 *
 * 真机发现（设计文档 §9.7）：原下拉 = 已安装模型 ∪ 配置里的 `model`（封闭选择），而「下载模型」
 * 下载的是**配置里的那个模型** → 想装 `nomic-embed-text` 只能回终端 `ollama pull`；UI 宣称的
 * 「双通道」在默认模型之外退化成单通道。用户裁决：**不做自由输入**（用户既不知道有哪些向量模型
 * 可下载，也不知道哪个好）→ 内置一份带「参数规模 + 定位」的精选清单，每项可一键下载。
 *
 * ⚠️ 只放 name / params / descKey：**维度**由 `embedding:local-test` 实测后显示，**下载体积**取
 * `embedding:local-pull-progress` 的真实 `total`（U1）—— 清单里不硬编码这两项。
 */
interface EmbeddingCatalogEntry {
  /** Ollama 模型名（稳定标识，也是写入配置的 model 值） */
  name: string
  /** 参数规模（Ollama 官方博客；bge-m3 为真机实测）——纯展示，语言中立 */
  params: string
  /** 一句话定位的 i18n key（四条固定 key，三语齐全） */
  descKey: TextKey
}

const EMBEDDING_CATALOG: readonly EmbeddingCatalogEntry[] = [
  { name: 'bge-m3', params: '567M', descKey: 'localEmbedding.catalog.bgeM3' },
  { name: 'nomic-embed-text', params: '137M', descKey: 'localEmbedding.catalog.nomicEmbedText' },
  { name: 'mxbai-embed-large', params: '334M', descKey: 'localEmbedding.catalog.mxbaiEmbedLarge' },
  { name: 'all-minilm', params: '23M', descKey: 'localEmbedding.catalog.allMinilm' },
]

/** 清单项 + 兼容项（配置里的 model 不在清单内时追加，见 `modelOptions`） */
interface ModelOption extends EmbeddingCatalogEntry {
  /** true = 来自当前配置的历史值（不在清单内）→ 文案/徽标不同，但**必须**保持可见且选中 */
  custom: boolean
}

/** 地址基础校验：必须能被 URL 解析且为 http/https；空串按非法（**不写库**） */
function isValidBaseUrl(raw: string): boolean {
  const value = raw.trim()
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 可折叠的原始详情（U4）。
 * 主进程的错误串是英文技术描述（T2 契约），因此**不得**当主文案：统一收进 `<details>`，
 * 用户需要诊断时展开，不需要时不打扰。
 */
function RawDetail({ text }: { text: string }) {
  const { t } = useTranslation()
  return (
    <details className="mt-0.5">
      <summary className="cursor-pointer text-2xs text-[var(--color-text-muted)]">
        {t('localEmbedding.detail')}
      </summary>
      <pre className="mt-0.5 whitespace-pre-wrap break-all text-2xs text-[var(--color-text-muted)]">
        {text}
      </pre>
    </details>
  )
}

/**
 * 本地向量模型卡片 —— 本地 Ollama 向量档的三个真实状态：
 * 「未连接」/「已连接但模型缺失」/「就绪」，外加 U2 的维度重建告警。
 *
 * 数据来源（U5）：挂载时**并行**取 `local-get-config` / `local-detect` / `local-list-models`，
 * 任一失败只降级该项（可折叠详情），不破整卡片。
 * 本地连通性一律来自 `local-detect`，**不复用** `vector-config-store` 的 `kb:search` 自检（U3）。
 */
function LocalEmbeddingCard() {
  const { t } = useTranslation()

  const [config, setConfig] = useState<LocalEmbeddingConfig | null>(null)
  const [detect, setDetect] = useState<LocalDetectResult | null>(null)
  const [models, setModels] = useState<LocalModel[]>([])
  // 三路数据各自的失败详情（U5）
  const [configError, setConfigError] = useState<string | null>(null)
  const [detectError, setDetectError] = useState<string | null>(null)
  const [modelsError, setModelsError] = useState<string | null>(null)

  const [baseUrlDraft, setBaseUrlDraft] = useState('')
  const [baseUrlInvalid, setBaseUrlInvalid] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [pull, setPull] = useState<LocalPullProgress | null>(null)
  const [pulling, setPulling] = useState(false)
  const [pullError, setPullError] = useState<string | null>(null)

  const [testRunning, setTestRunning] = useState(false)
  const [testDim, setTestDim] = useState<number | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [dimMismatch, setDimMismatch] = useState<{ local: number; index: number } | null>(null)
  /** R3：换成与当前不同的模型 + 索引里已有向量 → 需重建索引后才能写入 */
  const [modelSwitchWarn, setModelSwitchWarn] = useState(false)

  /** 重新拉取已装模型列表（下载成功终帧后刷新下拉） */
  const refreshModels = useCallback(async (): Promise<void> => {
    try {
      const list = await ipc.invoke('embedding:local-list-models')
      setModels(Array.isArray(list) ? list : [])
      setModelsError(null)
    } catch (e) {
      setModels([])
      setModelsError(errorDetail(e))
    }
  }, [])

  // 挂载：三路并行（Promise.allSettled → 单路失败不影响其它两路，U5）
  useEffect(() => {
    let cancelled = false
    void Promise.allSettled([
      ipc.invoke('embedding:local-get-config'),
      ipc.invoke('embedding:local-detect'),
      ipc.invoke('embedding:local-list-models'),
    ]).then(([cfg, det, list]) => {
      if (cancelled) return
      if (cfg.status === 'fulfilled') {
        setConfig(cfg.value)
        setBaseUrlDraft(cfg.value.baseUrl)
        setConfigError(null)
      } else {
        setConfigError(errorDetail(cfg.reason))
      }
      if (det.status === 'fulfilled') {
        setDetect(det.value)
        setDetectError(det.value.ok ? null : (det.value.error ?? null))
      } else {
        setDetect(null)
        setDetectError(errorDetail(det.reason))
      }
      if (list.status === 'fulfilled' && Array.isArray(list.value)) {
        setModels(list.value)
        setModelsError(null)
      } else if (list.status === 'rejected') {
        setModels([])
        setModelsError(errorDetail(list.reason))
      }
    })
    return () => { cancelled = true }
  }, [])

  // 下载进度事件（U1）：挂载即订阅；**卸载必须 unsub**（否则监听器泄漏，参照 llm-store 的 unsubChunk）
  useEffect(() => {
    const unsub = ipc.on('embedding:local-pull-progress', (p) => {
      if (p.status === 'success') {
        // 终帧：进度条收掉（否则会一直停在「正在下载」），并重取列表——此前列表不含新模型
        setPull(null)
        setPulling(false)
        void refreshModels()
        return
      }
      // FW-1 终态失败帧：和 success 一样收掉进度条并退出「下载中」（否则进度条永久停在最后一帧、
      // 下载按钮永久 disabled —— 用户唯一的主动作变成无法重试的假进行态）。失败原文交给既有
      // pullError 面：主文案 t('localEmbedding.pullFailed') + 可折叠的原始详情（U4）。
      if (p.status === 'error') {
        setPull(null)
        setPulling(false)
        setPullError(p.error ?? '')
        return
      }
      setPull(p)
    })
    return unsub
  }, [refreshModels])

  const model = config?.model ?? ''
  const connected = detect?.ok === true
  const modelInstalled = hasLocalModel(models, model)
  // 配置读取失败时无法诚实呈现任何档位状态 → 归到「未连接」并由详情交代原因（U5）
  const status: 'disconnected' | 'modelMissing' | 'ready' =
    config === null || !connected ? 'disconnected' : modelInstalled ? 'ready' : 'modelMissing'
  const editable = config !== null
  const canAct = editable && connected

  const statusLabel =
    status === 'ready'
      ? t('localEmbedding.statusReady')
      : status === 'modelMissing'
        ? t('localEmbedding.statusModelMissing').replace('{model}', model)
        : t('localEmbedding.statusDisconnected')

  const modelOptions = useMemo<ModelOption[]>(() => {
    const options: ModelOption[] = EMBEDDING_CATALOG.map((entry) => ({ ...entry, custom: false }))
    // 兼容（R1）：配置里的 model 不在清单内（历史配置 / 用户手工改过）时，**仍要把它显示出来并保持
    // 选中** —— 否则用户被锁在清单之外，且当前配置会被静默丢弃（`model` 才是配置真值）。
    // 归属判定两侧都归一化 `:latest`：配置写 `bge-m3:latest` 时不能被当成清单外的第二项。
    if (model !== '' && !EMBEDDING_CATALOG.some((e) => stripLatest(e.name) === stripLatest(model))) {
      options.push({ name: model, params: '', descKey: 'localEmbedding.catalogCustom', custom: true })
    }
    return options
  }, [model])

  /** 选中态比较（两侧归一化 `:latest`，与已装判定同一套口径） */
  const isSelectedModel = (name: string): boolean => stripLatest(name) === stripLatest(model)

  // U1：T2 的 pullModel **不 clamp** percent（completed > total 时会 >100）→ UI 侧必须 clamp，
  //     且 total 缺失时退化为不确定态（不显示百分比）
  const pullPercent =
    pull && typeof pull.total === 'number' && pull.total > 0
      ? Math.min(100, Math.max(0, pull.percent ?? 0))
      : null

  /** 写配置（部分更新，主进程合并写回）；返回 true = 已写库（调用方可据此决定是否继续） */
  const patchConfig = async (patch: Partial<LocalEmbeddingConfig>): Promise<boolean> => {
    setSaveError(null)
    try {
      const res = await ipc.invoke('embedding:local-set-config', patch)
      if (res.success) {
        setConfig((prev) => (prev ? { ...prev, ...patch } : prev))
        return true
      }
      setSaveError(res.error ?? '')
      return false
    } catch (e) {
      setSaveError(errorDetail(e))
      return false
    }
  }

  /**
   * R1：选中清单项 → 写配置（部分更新，只有 model 键）。
   * R3：切到不同模型可能改变向量维度，而写入侧有维度守卫（维度不符**硬拒绝**）→
   *     索引里已有向量（`kb:stats.vectorDimension > 0`）时提前提示需重建（0 维新库不提示）。
   */
  const selectModel = async (next: string): Promise<boolean> => {
    if (isSelectedModel(next)) return true
    setModelSwitchWarn(false)
    if (!(await patchConfig({ model: next }))) return false
    try {
      const stats = await ipc.invoke('kb:stats')
      if (stats.vectorDimension > 0) setModelSwitchWarn(true)
    } catch {
      // kb:stats 失败只影响「能否提示」，不影响选择本身
    }
    return true
  }

  /** R2：重置为默认地址（检测失败时的排障入口）—— 用户显式点按，因此**总是**写回配置 */
  const resetBaseUrl = (): void => {
    setBaseUrlInvalid(false)
    setBaseUrlDraft(DEFAULT_OLLAMA_BASE_URL)
    void patchConfig({ baseUrl: DEFAULT_OLLAMA_BASE_URL })
  }

  /** 地址提交（失焦 / Enter）：非法 → 内联提示且不写库 */
  const commitBaseUrl = (): void => {
    const next = baseUrlDraft.trim()
    if (!isValidBaseUrl(next)) {
      setBaseUrlInvalid(true)
      return
    }
    setBaseUrlInvalid(false)
    if (next === config?.baseUrl) return
    void patchConfig({ baseUrl: next })
  }

  /**
   * 下载**指定项**的向量模型：`local-pull` **只发起**（下载分钟级，等它会撞 30s IPC 超时）→ 进度靠事件。
   *
   * ⚠️ `embedding:local-pull` **不收渲染层入参**（T4 契约：baseUrl/model 一律由主进程读全局配置，
   * 防止被 XSS 的渲染层让主进程打任意内网地址）→ 想下载「清单里的这一项」，就必须**先**把这一项
   * 写成当前配置的 `model`；否则主进程拉的是配置里的旧模型（真机发现 §9.7 的根因）。
   * 已是当前模型则跳过写入（避免每次下载都产生一次无意义写库）。
   */
  const handlePull = async (target: string): Promise<void> => {
    setPullError(null)
    if (!(await selectModel(target))) return
    try {
      const res = await ipc.invoke('embedding:local-pull')
      if (res.started) {
        // 只置「下载中」标志：不伪造进度帧，首帧真实进度到了才渲染百分比（U1 不确定态）
        setPulling(true)
      } else {
        setPulling(false)
        setPullError(res.error ?? '')
      }
    } catch (e) {
      setPulling(false)
      setPullError(errorDetail(e))
    }
  }

  /** 测试：local-test 拿真实维度 → 另取 kb:stats 做 U2 维度比对 */
  const handleLocalTest = async (): Promise<void> => {
    setTestRunning(true)
    setTestError(null)
    setTestDim(null)
    setDimMismatch(null)
    try {
      const res = await ipc.invoke('embedding:local-test')
      const dim = typeof res.dim === 'number' && res.dim > 0 ? res.dim : null
      if (!res.success || dim === null) {
        setTestError(res.error ?? '')
        return
      }
      setTestDim(dim)
      // U2：维度与现有索引不一致 → 写入会被 T3/T4 的维度守卫**硬拒绝**，必须提前告警；
      //     vectorDimension === 0（新库）不告警
      try {
        const stats = await ipc.invoke('kb:stats')
        if (stats.vectorDimension > 0 && stats.vectorDimension !== dim) {
          setDimMismatch({ local: dim, index: stats.vectorDimension })
        }
      } catch {
        // kb:stats 失败只影响「能否告警」，不影响测试结果本身
      }
    } catch (e) {
      setTestError(errorDetail(e))
    } finally {
      setTestRunning(false)
    }
  }

  return (
    <div className="border rounded-lg p-4" style={{ borderColor: 'var(--color-border)' }}>
      {/* 标题 + 三态徽标 + 开关 */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <HardDrive size={16} style={{ color: 'var(--color-text)' }} />
          <h4 className="font-medium" style={{ color: 'var(--color-text)' }}>
            {t('localEmbedding.title')}
          </h4>
          <Badge
            variant={status === 'ready' ? 'success' : status === 'modelMissing' ? 'warning' : 'outline'}
          >
            {statusLabel}
          </Badge>
          {connected && detect?.version && (
            <span className="text-2xs text-[var(--color-text-muted)]">
              {t('localEmbedding.statusConnected').replace('{version}', detect.version)}
            </span>
          )}
        </div>
        <Switch
          checked={config?.enabled ?? false}
          onCheckedChange={(checked) => { void patchConfig({ enabled: checked }) }}
          disabled={!editable}
          aria-label={t('localEmbedding.enable')}
        />
      </div>
      <p className="text-xs text-[var(--color-text-muted)] mt-1">{t('localEmbedding.enableDesc')}</p>

      {/* 模型：R1 精选清单（不可自由输入）*/}
      {editable && (
        <div className="mt-3">
          <Label>{t('localEmbedding.model')}</Label>
          <div role="radiogroup" aria-label={t('localEmbedding.model')} className="mt-1 space-y-1">
            {modelOptions.map((opt, index) => {
              const installed = hasLocalModel(models, opt.name)
              const selected = isSelectedModel(opt.name)
              const fieldId = `local-embedding-model-${index}`
              return (
                <div
                  key={opt.name}
                  className="flex items-start gap-2 p-2 rounded-lg border"
                  style={{
                    borderColor: selected ? 'var(--color-accent)' : 'var(--color-border)',
                    backgroundColor: selected ? 'var(--color-hover)' : 'transparent',
                  }}
                >
                  <input
                    id={fieldId}
                    type="radio"
                    name="local-embedding-model"
                    className="mt-0.5 flex-shrink-0"
                    aria-label={opt.name}
                    checked={selected}
                    onChange={() => { void selectModel(opt.name) }}
                  />
                  <label htmlFor={fieldId} className="flex-1 min-w-0 cursor-pointer">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                        {opt.name}
                      </span>
                      {opt.params !== '' && (
                        // Minor 3：裸数字紧挨下载按钮会被读成「下载体积」（bge-m3 实际 ~1.2 GB）→ 标明这是参数量
                        <span className="text-2xs text-[var(--color-text-muted)]">
                          {t('localEmbedding.paramCount').replace('{n}', opt.params)}
                        </span>
                      )}
                      <Badge variant={installed ? 'success' : 'outline'} className="text-2xs">
                        {installed ? t('localEmbedding.installed') : t('localEmbedding.downloadable')}
                      </Badge>
                      {opt.custom && (
                        <Badge variant="warning" className="text-2xs">
                          {t('localEmbedding.customBadge')}
                        </Badge>
                      )}
                    </div>
                    <div className="text-2xs text-[var(--color-text-muted)] mt-0.5">
                      {t(opt.descKey)}
                    </div>
                  </label>
                  {/* 未安装项 → 这一项**自己**的下载入口（R1：修 §9.7 只能下载配置模型的缺陷） */}
                  {!installed && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { void handlePull(opt.name) }}
                      disabled={!canAct || pulling}
                    >
                      <Download size={12} />
                      {t('localEmbedding.download').replace('{model}', opt.name)}
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
          <p className="text-2xs text-[var(--color-text-muted)] mt-1">{t('localEmbedding.moreModels')}</p>
        </div>
      )}

      {/* R2：地址**默认不渲染**（默认值本来就是对的一般用户不必看见）；只有检测失败时才作为
          排障信息出现 + 一个「重置为默认」。可编辑输入收进卡末的「高级设置」（默认收起）。*/}
      {editable && !connected && (
        <div className="mt-2 flex items-start gap-1 text-xs" style={{ color: 'var(--color-warning)' }}>
          <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
          <div>
            <div>{t('localEmbedding.addressTroubleshoot').replace('{url}', config.baseUrl)}</div>
            {/* Minor 5：地址已是默认值时「重置为默认」是无效按钮（点了什么也不会变）→ 只在地址非默认时显示 */}
            {config.baseUrl !== DEFAULT_OLLAMA_BASE_URL && (
              <Button variant="outline" size="sm" className="mt-1" onClick={resetBaseUrl}>
                <RefreshCw size={12} />
                {t('localEmbedding.resetBaseUrl')}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* 操作：测试（每项的下载入口在各行的清单里）*/}
      <div className="flex items-center gap-2 mt-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => { void handleLocalTest() }}
          disabled={!canAct || testRunning}
        >
          <RefreshCw size={12} className={testRunning ? 'animate-spin' : ''} />
          {testRunning ? t('localEmbedding.testing') : t('localEmbedding.test')}
        </Button>
      </div>

      {/* 三态引导 + 说明 */}
      <div className="mt-2 space-y-1">
        {status === 'disconnected' && (
          <div className="flex items-start gap-1 text-xs" style={{ color: 'var(--color-warning)' }}>
            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
            <span>{t('localEmbedding.installGuide')}</span>
          </div>
        )}
        {status === 'modelMissing' && (
          <div className="flex items-start gap-1 text-xs" style={{ color: 'var(--color-warning)' }}>
            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
            <span>{t('localEmbedding.modelMissingHint').replace('{model}', model)}</span>
          </div>
        )}
        {/* 文案分流：未连接时「需先安装 Ollama」是准确的；已连接时那句话是错误信息
            （真机反馈：卡片显示「就绪 / 已连接」却仍在提示先安装 Ollama），只留中性的目录说明。 */}
        <p className="text-2xs text-[var(--color-text-muted)]">
          {connected ? t('localEmbedding.hintConnected') : t('localEmbedding.hint')}
        </p>
      </div>

      {/* 优先级：本地优先 / API 优先 → local-set-config */}
      {editable && (
        <div className="mt-3">
          <Label>{t('localEmbedding.priority')}</Label>
          <div className="flex items-center gap-4 mt-1">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input
                type="radio"
                name="local-embedding-priority"
                aria-label={t('localEmbedding.preferLocal')}
                checked={config?.preferLocal === true}
                onChange={() => { void patchConfig({ preferLocal: true }) }}
              />
              {t('localEmbedding.preferLocal')}
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input
                type="radio"
                name="local-embedding-priority"
                aria-label={t('localEmbedding.preferApi')}
                checked={config?.preferLocal === false}
                onChange={() => { void patchConfig({ preferLocal: false }) }}
              />
              {t('localEmbedding.preferApi')}
            </label>
          </div>
        </div>
      )}

      {/* 下载进度（U1：clamp + 不确定态；发起后到首帧之间也是不确定态）*/}
      {(pull !== null || pulling) && (
        <div className="mt-3">
          <div role="status" aria-live="polite" className="text-2xs text-[var(--color-text-muted)]">
            {pullPercent === null
              ? t('localEmbedding.downloadingPending')
              : t('localEmbedding.downloading').replace('{percent}', String(pullPercent))}
          </div>
          <div
            className="mt-1 h-1 rounded-full overflow-hidden"
            style={{ backgroundColor: 'var(--color-border)' }}
          >
            <div
              className={pullPercent === null ? 'h-full rounded-full animate-pulse' : 'h-full rounded-full'}
              style={{
                width: pullPercent === null ? '100%' : `${pullPercent}%`,
                backgroundColor: 'var(--color-accent)',
                opacity: pullPercent === null ? 0.4 : 1,
              }}
            />
          </div>
          {/* 智能下载（2026-09-25）：如实显示「走哪条路 + 实测多快」。
              选路是自动的，但不显示的话，用户无法区分「应用选错了路」和「网络就这样」。 */}
          {pull?.path && (
            <div className="mt-1 text-2xs text-[var(--color-text-muted)]">
              {describeDownloadPath(pull, t)}
              {typeof pull.bytesPerSec === 'number' && pull.bytesPerSec > 0
                ? ` · ${formatSpeed(pull.bytesPerSec)}`
                : ''}
            </div>
          )}
          {/* 换路是自动发生的，必须说明「刚才为什么慢了一下」，否则会被读成网络故障 */}
          {pull?.switchedFrom && (
            <div className="mt-1 text-2xs" style={{ color: 'var(--color-warning)' }}>
              {t('localEmbedding.switchedTo').replace('{path}', describeDownloadPath(pull, t))}
            </div>
          )}
          {pull && <RawDetail text={pull.status} />}
        </div>
      )}

      {/* 测试结果 / U2 维度告警 / R3 换模型维度提示（同一处告警区，不另起一套 UI）*/}
      {(testDim !== null || testError !== null || dimMismatch !== null || modelSwitchWarn) && (
        <div className="mt-3 space-y-1 text-xs">
          {testDim !== null && (
            <div className="flex items-center gap-1" style={{ color: 'var(--color-success)' }}>
              <CheckCircle2 size={12} />
              <span>{t('localEmbedding.testOk').replace('{dim}', String(testDim))}</span>
            </div>
          )}
          {testError !== null && (
            <div className="flex items-start gap-1" style={{ color: 'var(--color-error)' }}>
              <XCircle size={12} className="mt-0.5 flex-shrink-0" />
              <div>
                <div>{t('localEmbedding.testFailed')}</div>
                {testError !== '' && <RawDetail text={testError} />}
              </div>
            </div>
          )}
          {dimMismatch && (
            <div className="flex items-start gap-1" style={{ color: 'var(--color-warning)' }}>
              <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
              <span>
                {t('localEmbedding.dimMismatch')
                  .replace('{local}', String(dimMismatch.local))
                  .replace('{index}', String(dimMismatch.index))}
              </span>
            </div>
          )}
          {modelSwitchWarn && (
            <div className="flex items-start gap-1" style={{ color: 'var(--color-warning)' }}>
              <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
              <span>{t('localEmbedding.modelSwitchDimWarn')}</span>
            </div>
          )}
        </div>
      )}

      {/* 失败面：写入失败给 t() 主文案；读取/探测失败只给可折叠原始详情（U4/U5） */}
      <div className="mt-2 space-y-0.5">
        {saveError !== null && (
          <div className="text-2xs" style={{ color: 'var(--color-error)' }}>
            {t('localEmbedding.saveFailed')}
            {saveError !== '' && <RawDetail text={saveError} />}
          </div>
        )}
        {pullError !== null && (
          <div className="text-2xs" style={{ color: 'var(--color-error)' }}>
            {t('localEmbedding.pullFailed')}
            {pullError !== '' && <RawDetail text={pullError} />}
          </div>
        )}
        {configError && <RawDetail text={configError} />}
        {detectError && <RawDetail text={detectError} />}
        {modelsError && <RawDetail text={modelsError} />}
      </div>

      {/*
        R2 高级设置：可编辑的 Ollama 地址收进**默认收起**的折叠区。
        真机反馈：地址框默认展示且可随意编辑，被用户读成「下载地址」而困惑，也容易被改坏
        （默认 http://localhost:11434 本来就是对的，普通用户不需要看见它）。
        ⚠️ 位置固定在**卡片最末**：卡片上方已有若干「原始详情」details（U4/U5），
        `<details>` 的既有用例按 DOM 顺序取首个 details，这里不能插到它们前面。
      */}
      {editable && (
        <details className="group mt-3">
          {/* 真机反馈（2026-09-22）：「看起来不能点击」——原来的 10px 灰字、行高仅 14px、
              无箭头无 hover，虽然点得动但完全不像可点。补上箭头（展开时旋转 90°）+ hover 底色
              + 加大点击区 + 提亮文字。 */}
          <summary
            className="cursor-pointer flex items-center gap-1 text-micro font-medium -mx-1.5 px-1.5 py-1 rounded transition-colors select-none hover:bg-[var(--color-hover)]"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <ChevronRight
              size={11}
              strokeWidth={2}
              className="flex-shrink-0 transition-transform group-open:rotate-90"
            />
            {t('localEmbedding.advanced')}
          </summary>
          <div className="mt-2">
            <Label>{t('localEmbedding.baseUrl')}</Label>
            <Input
              className="mt-1"
              aria-label={t('localEmbedding.baseUrl')}
              value={baseUrlDraft}
              onChange={(e) => {
                setBaseUrlDraft(e.target.value)
                if (baseUrlInvalid) setBaseUrlInvalid(false)
              }}
              onBlur={commitBaseUrl}
              onKeyDown={(e) => { if (e.key === 'Enter') commitBaseUrl() }}
            />
            {baseUrlInvalid && (
              <p className="text-2xs mt-1" style={{ color: 'var(--color-warning)' }}>
                {t('localEmbedding.baseUrlInvalid')}
              </p>
            )}
            <p className="text-2xs text-[var(--color-text-muted)] mt-1">
              {t('localEmbedding.advancedHint')}
            </p>
          </div>
        </details>
      )}
    </div>
  )
}
