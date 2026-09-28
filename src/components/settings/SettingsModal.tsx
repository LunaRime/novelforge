import { useState, useEffect, useRef } from 'react'
import {
  X, Trash2, Check, Save, Globe, Cpu, Database,
  Type, Settings2, MessageSquare,
  ExternalLink, RefreshCw, Download, LogOut,
  BookMarked, Plug, BarChart3, ArrowUp,
} from 'lucide-react'
import { Spinner } from '../ui/Spinner'
import { confirm } from '../ui/Confirm'
import PromptSettings from './PromptSettings'
import SkillsSettings from './SkillsSettings'
import MCPSettings from './MCPSettings'
import { useLLMStore } from '../../stores/llm-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useConcurrencyStore } from '../../stores/concurrency-store'
import { useThemeStore, FONT_OPTIONS, type FontId } from '../../stores/theme-store'
import type { ModelTier, ModelRouteConfig } from '../../services/llm/model-router'
import { Button } from '../ui/Button'
import MarkdownContent from '../ui/MarkdownContent'
import { switchLocale, useTranslation } from '../../hooks/useTranslation'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { SUPPORTED_LOCALES, LOCALE_LABELS, type SupportedLocale } from '../../shared/locale'
import type { TextKey } from '../../shared/locale'
import { Input } from '../ui/Input'
import { ProviderAccountsSection } from './ProviderAccountsSection'
import { ModelListSection } from './ModelListSection'
import { Label } from '../ui/Label'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../ui/Select'
import { cn } from '../../lib/utils'
import { ipc } from '../../services/ipc-client'
import { renderLog } from '../../services/render-logger'
import { toast } from '../ui/Toast'
import { Switch } from '../ui/Switch'
import AutomationSection from './AutomationSection'
import ContextCompactionSection from './ContextCompactionSection'
import VectorConfigSection from './VectorConfigSection'
import DeveloperModeSection from './DeveloperModeSection'
import UsageStatsView from './UsageStatsView'
import { useUpdateStore } from '../../stores/update-store'

// ==================== 分类定义 ====================

type SettingsSection = 'llm' | 'usage' | 'embedding' | 'proxy' | 'editor' | 'prompts' | 'skills' | 'mcp' | 'file' | 'dev' | 'about'

interface SectionItem {
  id: SettingsSection
  label: string
  icon: React.ReactNode
  description: string
}

function getSections(t: (key: TextKey) => string): SectionItem[] {
  return [
    { id: 'llm', label: t('settings.aiModel'), icon: <Cpu size={16} />, description: t('settings.aiModelDesc') },
    { id: 'usage', label: t('settings.usage'), icon: <BarChart3 size={16} />, description: t('settings.usageDesc') },
    { id: 'embedding', label: t('settings.vectorModel'), icon: <Database size={16} />, description: t('settings.vectorModelDesc') },
    { id: 'proxy', label: t('settings.proxy'), icon: <Globe size={16} />, description: t('settings.proxyDesc') },
    { id: 'editor', label: t('settings.editor'), icon: <Type size={16} />, description: t('settings.editorDesc') },
    { id: 'prompts', label: t('settings.promptTemplates'), icon: <MessageSquare size={16} />, description: t('settings.promptTemplatesDesc') },
    { id: 'skills', label: t('settings.skills'), icon: <BookMarked size={16} />, description: t('settings.skillsDesc') },
    { id: 'mcp', label: t('settings.mcp'), icon: <Plug size={16} />, description: t('settings.mcpDesc') },
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
  // 初始分区：支持 openSettings('llm') 深链；无指定或分区无效时回默认 llm
  const settingsSection = useLayoutStore(s => s.settingsSection)
  const sections = getSections(t)
  const [section, setSection] = useState<SettingsSection>(
    () => (settingsSection && sections.some(s => s.id === settingsSection)
      ? settingsSection as SettingsSection
      : 'llm')
  )

  // Esc 关闭：本组件自绘全屏模态（未走 ui/Dialog / Radix），此前**没有** Esc ——
  // 键盘用户只能靠 Tab 找到 × 或点遮罩。hooks 必须在 `if (!open) return null` 之前。
  useEscapeKey(onClose, open)

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center"
      style={{ backgroundColor: 'var(--color-backdrop)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
        className="relative flex w-[880px] h-[600px] rounded-2xl overflow-hidden shadow-[var(--shadow-popover)]"
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
            {section === 'llm' && (
              <>
                {/* 供应商账户 —— 一份凭据挂多个模型；其下勾选的模型会出现在下面的模型列表里 */}
                <ProviderAccountsSection />
                <div className="mt-6">
                  <ModelListSection purposes={['generation', 'refinement', 'summary']} purposeLabel={t('model.purposeGen')} />
                </div>
                {/* 模型路由 — 三层调度（此前功能存在但无 UI 入口，静默失效） */}
                <div className="mt-6">
                  <ModelRoutingSection />
                </div>
                {/* 并发控制（此前功能存在但无 UI 入口） */}
                <div className="mt-6">
                  <ConcurrencySection />
                </div>
                {/* 写作自动化（D 档）：触发器 → 执行 → 三态处置 */}
                <div className="mt-6">
                  <AutomationSection />
                </div>
                {/* 上下文与压缩（§7.1-C2）：三个保留旋钮，只影响之后的压缩 */}
                <div className="mt-6">
                  <ContextCompactionSection />
                </div>
              </>
            )}
            {section === 'usage' && <UsageStatsView />}
            {section === 'embedding' && (
              <>
                <VectorConfigSection />
                {/* 嵌入模型的供应商账户 —— 同一账户既可挂生成也可挂向量模型（勾选清单里一并列出） */}
                <div className="mt-6">
                  <ProviderAccountsSection />
                </div>
                {/* 嵌入模型管理 — 与生成模型同套增删改/默认标记（原散落在向量配置内且无编辑/删除） */}
                <div className="mt-6">
                  <ModelListSection purposes={['embedding']} purposeLabel={t('model.purposeEmbedding')} />
                </div>
              </>
            )}
            {section === 'proxy' && <ProxySection />}
            {section === 'editor' && <EditorSection />}
            {section === 'prompts' && <PromptSettings />}
            {section === 'skills' && <SkillsSettings />}
            {section === 'mcp' && <MCPSettings />}
            {section === 'dev' && <DeveloperModeSection />}
            {section === 'about' && <AboutSection />}
          </div>
        </main>
      </div>
    </div>
  )
}


// ==================== 模型路由区 ====================

/**
 * 三层路由配置（elite/standard/budget）— 每层是**有序优先级列表**：
 * 数组顺序即 ModelRouter 的取用顺序，层内为空时回退用户默认模型（不再有 autoDetectTiers 自动填充）。
 */
export function ModelRoutingSection() {
  const { t } = useTranslation()
  const models = useLLMStore(s => s.models)
  const modelRoutes = useLLMStore(s => s.modelRoutes)
  const updateModelRoutes = useLLMStore(s => s.updateModelRoutes)

  const candidates = models.filter((m) => !m.purposes?.includes('embedding'))

  const labelOf = (id: string) => {
    const m = models.find(x => x.id === id)
    return m ? `${m.name || m.modelName} (${m.provider})` : id
  }

  const tiers: Array<{ id: ModelTier; label: string; desc: string }> = [
    { id: 'elite', label: t('settings.routeElite'), desc: t('settings.routeEliteDesc') },
    { id: 'standard', label: t('settings.routeStandard'), desc: t('settings.routeStandardDesc') },
    { id: 'budget', label: t('settings.routeBudget'), desc: t('settings.routeBudgetDesc') },
  ]

  const setTier = (tier: ModelTier, ids: string[]) => {
    const patch: Partial<ModelRouteConfig> = {}
    patch[tier] = ids
    updateModelRoutes(patch)
  }

  return (
    <div
      className="rounded-xl p-4 space-y-4"
      style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}
    >
      <div>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{t('settings.routeTitle')}</p>
        <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          {t('settings.routeDesc')}
        </p>
        <p className="text-micro mt-1" style={{ color: 'var(--color-text-muted)' }}>
          {t('settings.routePriorityHint')}
        </p>
      </div>

      {/* A 档动态策略：按 Agent 对话的「思考等级」档位自动选层（默认关闭 = 静态映射） */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label>{t('settings.routeDynamic')}</Label>
          <p className="text-micro mt-0.5 leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
            {t('settings.routeDynamicDesc')}
          </p>
        </div>
        <Switch
          checked={modelRoutes.strategy === 'dynamic'}
          onCheckedChange={(v) => updateModelRoutes({ strategy: v ? 'dynamic' : 'static' })}
        />
      </div>

      {tiers.map(tier => {
        const ids = modelRoutes[tier.id] ?? []
        return (
          <div key={tier.id} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <Label>{tier.label}</Label>
              <span className="text-micro" style={{ color: 'var(--color-text-muted)' }}>{tier.desc}</span>
            </div>

            {ids.length === 0 && (
              <p className="text-micro" style={{ color: 'var(--color-text-muted)' }}>{t('settings.routeClear')}</p>
            )}

            {ids.map((id, i) => (
              <div
                key={id}
                className="flex items-center gap-2 rounded-md px-2 py-1"
                style={{ backgroundColor: 'var(--color-hover)' }}
              >
                <span className="text-micro font-mono w-3 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{i + 1}</span>
                <span className="text-xs flex-1 truncate" style={{ color: 'var(--color-text)' }}>{labelOf(id)}</span>
                {i > 0 && (
                  <button
                    type="button"
                    aria-label={t('settings.routeMoveUp')}
                    onClick={() => {
                      const next = [...ids]
                      const prev = next[i - 1]
                      next[i - 1] = next[i]
                      next[i] = prev
                      setTier(tier.id, next)
                    }}
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    <ArrowUp size={11} />
                  </button>
                )}
                <button
                  type="button"
                  aria-label={t('settings.routeRemove')}
                  onClick={() => setTier(tier.id, ids.filter((_, j) => j !== i))}
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  <X size={11} />
                </button>
              </div>
            ))}

            {/* key 随层内数量变化 → 添加后重挂载，选择器自动复位（非受控） */}
            <Select key={`add-${tier.id}-${ids.length}`} onValueChange={(v) => { if (v) setTier(tier.id, [...ids, v]) }}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('settings.routeAdd')} />
              </SelectTrigger>
              <SelectContent>
                {candidates.filter(m => !ids.includes(m.id)).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name || m.modelName} ({m.provider})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )
      })}
    </div>
  )
}

// ==================== 并发控制区 ====================

/** 并发控制 — 最大并发请求数与排队上限（此前功能存在但无 UI 入口） */
function ConcurrencySection() {
  const { t } = useTranslation()
  const status = useConcurrencyStore(s => s.status)
  const updateConfig = useConcurrencyStore(s => s.updateConfig)
  const [maxConcurrent, setMaxConcurrent] = useState(status.maxConcurrent)
  const [maxQueueSize, setMaxQueueSize] = useState(status.maxQueueSize)
  const [saving, setSaving] = useState(false)

  // 挂载时拉取主进程当前并发状态——用户已修改时不覆盖（刷新返回晚于用户输入的竞态，P2 修复）
  const userEditedRef = useRef(false)
  useEffect(() => {
    useConcurrencyStore.getState().refreshStatus().then(() => {
      const s = useConcurrencyStore.getState().status
      if (!userEditedRef.current) {
        setMaxConcurrent(s.maxConcurrent)
        setMaxQueueSize(s.maxQueueSize)
      }
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSave = async () => {
    setSaving(true)
    const ok = await updateConfig({ maxConcurrent, maxQueueSize })
    if (ok) {
      toast.success(t('save.success'))
    } else {
      toast.error(t('save.failed').replace('{error}', t('status.unknown')))
    }
    setSaving(false)
  }

  return (
    <div
      className="rounded-xl p-4 space-y-4"
      style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}
    >
      <div>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{t('settings.concurrencyTitle')}</p>
        <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          {t('settings.concurrencyDesc')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label>{t('settings.concurrencyMax')}</Label>
          <Input
            type="number"
            min={1}
            max={20}
            value={String(maxConcurrent)}
            onChange={(e) => { userEditedRef.current = true; setMaxConcurrent(Math.max(1, parseInt(e.target.value) || 1)) }}
          />
          <p className="text-micro" style={{ color: 'var(--color-text-muted)' }}>{t('settings.concurrencyMaxDesc')}</p>
        </div>
        <div className="space-y-1">
          <Label>{t('settings.concurrencyQueue')}</Label>
          <Input
            type="number"
            min={1}
            max={500}
            value={String(maxQueueSize)}
            onChange={(e) => { userEditedRef.current = true; setMaxQueueSize(Math.max(1, parseInt(e.target.value) || 1)) }}
          />
          <p className="text-micro" style={{ color: 'var(--color-text-muted)' }}>{t('settings.concurrencyQueueDesc')}</p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <Spinner size={13}  /> : <Save size={13} />}
          {t('action.save')}
        </Button>
      </div>
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
      renderLog('info', 'Save:Settings', t('log.render.proxySaveSuccess').replace('{ms}', String(Date.now() - t0)))
    } catch (e) {
      renderLog('error', 'Save:Settings', t('log.render.proxySaveFailed').replace('{error}', () => String(e)))
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
                  <span className="text-micro opacity-60">{opt.labelEn}</span>
                </div>
                <p className="text-micro truncate opacity-60">
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
            <p className="text-micro mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
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
            <p className="text-micro mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
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
          <p className="text-micro mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
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

// ==================== 关于与支持区 ====================

function AboutSection() {
  const { t } = useTranslation()
  const {
    status, updateInfo, error,
    checkForUpdates, downloadUpdate, installUpdate,
    openReleasesPage, triggerUninstall,
  } = useUpdateStore()
  const [checking, setChecking] = useState(false)
  const [downloading, setDownloading] = useState(false)

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

  /** 退出应用 — confirm 二次确认（替代原 onMouseLeave 复位，键盘/触屏可操作） */
  const handleQuit = async () => {
    const ok = await confirm(t('settings.quitConfirmMsg'), {
      title: t('settings.quitApp'),
      confirmText: t('settings.quitConfirm'),
      danger: true,
    })
    if (ok) {
      // 关闭窗口：主进程 close 事件会自动检查未保存内容
      window.close()
    }
  }

  /** 卸载 — confirm 二次确认 */
  const handleUninstall = async () => {
    const ok = await confirm(t('settings.uninstallConfirmMsg'), {
      title: t('settings.uninstall'),
      confirmText: t('settings.uninstallConfirm'),
      danger: true,
    })
    if (ok) await triggerUninstall()
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
        <p className="text-micro leading-relaxed text-center max-w-[360px]" style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>
          {t('about.sloganEn')}
        </p>
        <p className="text-micro mt-3 px-3 py-1.5 rounded-full" style={{ backgroundColor: 'var(--color-sidebar)', color: 'var(--color-text-muted)' }}>
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

      {/* 检查更新（原「文件」区） */}
      <div
        className="rounded-lg p-4 space-y-3"
        style={{ backgroundColor: 'var(--color-sidebar)', border: '1px solid var(--color-border)' }}
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
              ? <Spinner size={13}  />
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
                  ? <Spinner size={13}  />
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

        {/* 退出应用（原「文件」区） */}
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{t('settings.quitApp')}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {t('settings.quitAppDesc')}
          </p>
          <Button size="sm" variant="outline" className="mt-2" onClick={handleQuit}>
            <LogOut size={13} />
            {t('settings.quitApp')}
          </Button>
        </div>

        <div style={{ height: 1, backgroundColor: 'var(--color-border)' }} />

        {/* 卸载 */}
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{t('settings.uninstall')}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {t('settings.uninstallDesc')}
          </p>
          <Button size="sm" variant="outline" className="mt-2" onClick={handleUninstall}>
            <Trash2 size={13} />
            {t('settings.uninstall')}
          </Button>
        </div>
      </div>

    </div>
  )
}


