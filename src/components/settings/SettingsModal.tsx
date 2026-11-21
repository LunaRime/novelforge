import { useState, useEffect, useId, useRef } from 'react'
import appIcon from '../../../build/icon.png'
import {
  X, Trash2, Check, Save, Globe, Cpu, Database,
  Type, Settings2, MessageSquare,
  ExternalLink, RefreshCw, LogOut,
  BookMarked, Plug, BarChart3, Search, CircleHelp, Terminal, Route, Gauge,
} from 'lucide-react'
import { Spinner } from '../ui/Spinner'
import { confirm } from '../ui/Confirm'
import { hasUnsavedSettings, useSettingsDirty } from './settings-dirty'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import PromptSettings from './PromptSettings'
import SkillsSettings from './SkillsSettings'
import MCPSettings from './MCPSettings'
import { useLLMStore } from '../../stores/llm-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useConcurrencyStore } from '../../stores/concurrency-store'
import { useThemeStore, FONT_OPTIONS, type FontId } from '../../stores/theme-store'
import { selectWritingAppearance, useEditorPrefsStore, type WritingAppearance } from '../../stores/editor-prefs-store'
import { useShallow } from 'zustand/shallow'
import type { ModelTier, ModelRouteConfig } from '../../services/llm/model-router'
import { Button } from '../ui/Button'
import { SemanticLabel } from '../ui/SemanticLabel'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/Dialog'
import MarkdownContent from '../ui/MarkdownContent'
import { switchLocale, useTranslation } from '../../hooks/useTranslation'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { SUPPORTED_LOCALES, LOCALE_LABELS, type SupportedLocale } from '../../shared/locale'
import type { TextKey } from '../../shared/locale'
import { Input } from '../ui/Input'
import { ModelListSection } from './ModelListSection'
import { ModelRoutingTierDialog } from './ModelRoutingTierDialog'
import { Label } from '../ui/Label'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../ui/Select'
import { ipc } from '../../services/ipc-client'
import { renderLog } from '../../services/render-logger'
import { toast } from '../ui/Toast'
import { Switch } from '../ui/Switch'
import { Disclosure } from '../ui/Disclosure'
import AutomationSection from './AutomationSection'
import ContextCompactionSection from './ContextCompactionSection'
import ThemeSection from './ThemeSection'
import VectorConfigSection from './VectorConfigSection'
import DeveloperModeSection from './DeveloperModeSection'
import UsageStatsView from './UsageStatsView'
import SupportFeedback from './SupportFeedback'
import ShortcutsSection from './ShortcutsSection'
import WritingAppearanceSection from './WritingAppearanceSection'
import { useUpdateStore } from '../../stores/update-store'
import './settings-window.css'

// ==================== 分类定义 ====================

type SettingsSection = 'llm' | 'usage' | 'embedding' | 'proxy' | 'editor' | 'prompts' | 'skills' | 'mcp' | 'dev' | 'about'

const settingsGroups = [
  { label: 'settings.groupWriting', sections: ['editor', 'prompts', 'skills'] },
  { label: 'settings.groupConnections', sections: ['llm', 'embedding', 'mcp', 'proxy'] },
  { label: 'settings.groupApplication', sections: ['usage', 'dev', 'about'] },
] satisfies ReadonlyArray<{ label: TextKey; sections: SettingsSection[] }>

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
    { id: 'dev', label: t('settings.developer'), icon: <Terminal size={16} />, description: t('settings.developerDesc') },
    { id: 'about', label: t('settings.about'), icon: <CircleHelp size={16} />, description: t('settings.aboutDesc') },
  ]
}

// ==================== 主组件 ====================

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

/** 应用设置窗口，包含搜索、分区内容和未应用修改的关闭确认。 */
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

  // 设置页已打开时，支持再次深链切区（用量页「样式设置」→ 编辑器）
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 同步外部深链，目标值来自 store
  useEffect(() => {
    if (!open || !settingsSection) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 同步外部深链，目标值来自 store
    if (sections.some(s => s.id === settingsSection)) setSection(settingsSection as SettingsSection)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sections 由 t 派生，随语言变化，不需要触发切区
  }, [open, settingsSection])
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const normalizedQuery = query.trim().toLowerCase()
  const visibleSections = normalizedQuery
    ? sections.filter((s) => `${s.label} ${s.description}`.toLowerCase().includes(normalizedQuery))
    : sections
  const activeSection = sections.find(item => item.id === section)

  const dialogRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const currentSectionRef = useRef<HTMLButtonElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useFocusTrap(dialogRef, open, titleRef)
  useEffect(() => {
    if (open) currentSectionRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [open, section, normalizedQuery])

  const savedAppearance = useEditorPrefsStore(useShallow(selectWritingAppearance))
  const [appearanceChanges, setAppearanceChanges] = useState<Partial<WritingAppearance>>({})
  const appearance = { ...savedAppearance, ...appearanceChanges }
  const appearanceDirty = appearance.proseFontSize !== savedAppearance.proseFontSize
    || appearance.measureWidth !== savedAppearance.measureWidth
    || appearance.prosePaper !== savedAppearance.prosePaper
    || appearance.listDensity !== savedAppearance.listDensity
  useSettingsDirty(open && appearanceDirty)

  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const settingsFocus = useRef<HTMLElement | null>(null)

  function closeSettings() {
    setConfirmDiscard(false)
    setAppearanceChanges({})
    setQuery('')
    onClose()
  }

  function requestClose() {
    if (!hasUnsavedSettings()) {
      closeSettings()
      return
    }
    settingsFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setConfirmDiscard(true)
  }

  function applyAppearance() {
    const started = performance.now()
    try {
      useEditorPrefsStore.getState().applyWritingAppearance(appearance)
      setAppearanceChanges({})
      renderLog('info', 'Save:Settings', `${t('settings.typography')} ${t('save.success')} (${Math.round(performance.now() - started)}ms)`)
      toast.success(t('save.success'))
    } catch (error) {
      const message = t('save.failed').replace('{error}', String(error))
      renderLog('error', 'Save:Settings', message)
      toast.error(message)
    }
  }

  // 遮罩阻挡背景操作。关闭按钮和 Esc 共用未应用修改的确认流程。
  useEscapeKey(requestClose, open && !confirmDiscard)

  if (!open) return null

  return (
    <div className="nf-settings-backdrop">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
        className="nf-settings-window"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
            e.preventDefault()
            searchRef.current?.focus()
            searchRef.current?.select()
          }
        }}
      >
        <header className="nf-settings-title">
          <Settings2 size={17} aria-hidden="true" />
          <h2 ref={titleRef} tabIndex={-1}>{t('settings.title')}</h2>
          <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0"
            onClick={requestClose} aria-label={t('action.close')} title={t('action.close')}>
            <X size={16} aria-hidden="true" />
          </Button>
        </header>
        <div className="nf-settings-body">
          <aside className="nf-settings-navigation">
            {/* Ctrl/Cmd+F 聚焦搜索框，搜索结果只匹配设置分区。 */}
            <div className="nf-settings-search">
              <Search size={14} aria-hidden="true" />
              <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)}
                onKeyDown={event => {
                  if (event.key !== 'Enter' || event.nativeEvent.isComposing || !normalizedQuery || !visibleSections.length) return
                  event.preventDefault()
                  setSection(visibleSections[0].id)
                  setQuery('')
                  headingRef.current?.focus()
                }}
                placeholder={t('settings.searchPlaceholder')} aria-label={t('settings.searchPlaceholder')} />
              {query && (
                <Button variant="ghost" type="button" size="icon" className="size-8 shrink-0"
                  aria-label={t('settings.clearSearch')} title={t('settings.clearSearch')}
                  onClick={() => { setQuery(''); searchRef.current?.focus() }}>
                  <X size={14} aria-hidden="true" />
                </Button>
              )}
            </div>
            <nav className="nf-settings-sections" aria-label={t('settings.title')}>
              {settingsGroups.map(group => {
                const items = group.sections.flatMap(id => visibleSections.filter(item => item.id === id))
                if (items.length === 0) return null
                return (
                  <div className="nf-settings-nav-group" key={group.label}>
                    <h3>{t(group.label)}</h3>
                    {items.map(item => (
                      <button key={item.id} type="button" onClick={() => setSection(item.id)}
                        ref={section === item.id ? currentSectionRef : undefined}
                        className="nf-settings-section" aria-current={section === item.id ? 'page' : undefined}>
                        <span className="flex shrink-0" aria-hidden="true">{item.icon}</span>
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                )
              })}
              {visibleSections.length === 0 && (
                <p className="p-2 text-micro text-[var(--color-text-muted)]">{t('settings.searchEmpty')}</p>
              )}
            </nav>
          </aside>
          <div className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden">
            {activeSection && (
              <header className="nf-settings-section-heading">
                <span className="nf-settings-heading-icon" aria-hidden="true">{activeSection.icon}</span>
                <div className="min-w-0">
                  <h3 ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-[var(--color-text)]">{activeSection.label}</h3>
                  <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">{activeSection.description}</p>
                </div>
              </header>
            )}

            {/* 区域内容 */}
            <div className="nf-settings-content" key={section}>
              {section === 'llm' && (
                <div className="nf-settings-stack">
                  {/* 供应商账户集中管理凭据和模型，下面独立配置调度与运行策略。 */}
                  <ModelListSection />
                  <ModelRoutingSection />
                  <ConcurrencySection />
                  <AutomationSection />
                  <ContextCompactionSection />
                </div>
              )}
              {section === 'usage' && <UsageStatsView />}
              {section === 'embedding' && <VectorConfigSection />}
              {section === 'proxy' && <section className="nf-settings-panel"><ProxySection /></section>}
              {section === 'editor' && (
                <EditorSection appearance={appearance} appearanceDirty={appearanceDirty} onApplyAppearance={applyAppearance}
                  onChangeAppearance={change => setAppearanceChanges(previous => ({ ...previous, ...change }))} />
              )}
              {section === 'prompts' && <PromptSettings />}
              {section === 'skills' && <SkillsSettings />}
              {section === 'mcp' && <MCPSettings />}
              {section === 'dev' && <section className="nf-settings-panel"><DeveloperModeSection /></section>}
              {section === 'about' && <AboutSection />}
            </div>
          </div>
        </div>
      </div>
      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent preventOutsideClose onCloseAutoFocus={event => {
          event.preventDefault()
          if (settingsFocus.current?.isConnected) settingsFocus.current.focus({ preventScroll: true })
          settingsFocus.current = null
        }}>
          <DialogHeader>
            <DialogTitle>{t('dialog.unsavedTitle')}</DialogTitle>
            <DialogDescription>{t('settings.discardConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDiscard(false)}>{t('action.cancel')}</Button>
            <Button variant="destructive" onClick={closeSettings}>{t('action.discard')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

  /** 正在编辑优先级的层（null = 弹窗关闭）——弹窗按需挂载，草稿随卸载丢弃 */
  const [editingTier, setEditingTier] = useState<ModelTier | null>(null)

  const candidates = models.filter((m) => !m.purposes?.includes('embedding'))

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

  const editingMeta = editingTier ? tiers.find(x => x.id === editingTier) ?? null : null

  return (
    <section className="nf-settings-panel">
      {/* 标题独占一行在上（用户：标题在上面）；动态路由开关收在同排右侧、标题行不再挂说明文字 */}
      <header className="nf-settings-resource-bar">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
          <Route size={16} className="shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
          {t('settings.routeTitle')}
        </h4>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs cursor-default" style={{ color: 'var(--color-text-secondary)' }}>
            {t('settings.routeDynamic')}
          </span>
          <Switch
            aria-label={t('settings.routeDynamic')}
            checked={modelRoutes.strategy === 'dynamic'}
            onCheckedChange={(v) => updateModelRoutes({ strategy: v ? 'dynamic' : 'static' })}
          />
        </div>
      </header>

      {/* 说明折叠在标题下面（口径不变：三层说明 + 优先级说明 + 动态路由说明） */}
      <div className="mt-2">
        <Disclosure label={t('settings.cardHint')}>
          <div className="space-y-1">
            <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>{t('settings.routeDesc')}</p>
            <p className="text-micro leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>{t('settings.routePriorityHint')}</p>
            <p className="text-micro leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>{t('settings.routeDynamicDesc')}</p>
          </div>
        </Disclosure>
      </div>

      {/* 三层：每层一块层卡 —— 层名 + 数量/回退口径 +「编辑优先级」入口
          （⚠️ 卡片上**不显示模型型号**：名单与顺序进弹窗看 —— 2026-10-16 用户要求） */}
      <div className="mt-3 space-y-2">
        {tiers.map(tier => {
          const ids = modelRoutes[tier.id] ?? []
          return (
            <div
              key={tier.id}
              data-testid={`route-tier-${tier.id}`}
              className="rounded-lg p-3 space-y-2"
              style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h5
                    className="text-xs font-medium truncate"
                    style={{ color: 'var(--color-text)' }}
                    title={tier.desc}
                  >
                    {tier.label}
                  </h5>
                  {/* ⚠️ 2026-10-16 用户要求：卡片上**不显示模型型号信息**（此前在这里列
                      「N 个模型 · 首选 <模型名>」+ 层内 ①②③ 型号芯片）。现在只给数量/回退口径，
                      选了哪些、什么顺序一律进「编辑优先级」弹窗看。
                      **不要再把型号名/优先级序号加回卡片**。 */}
                  <p className="text-micro" style={{ color: 'var(--color-text-muted)' }} title={tier.desc}>
                    {ids.length === 0
                      ? t('route.tierEmpty')
                      : t('route.tierCount').replace('{n}', String(ids.length))}
                  </p>
                </div>
                {/* 「编辑优先级」= 设置页的**描边小按钮**（`Button variant="outline" size="sm"`）。
                    ⚠️ 2026-10-16 用户指出：此前是手写的「accent 文字 + 悬停下划线」空心链接形态 ——
                    全设置页唯一一处（其余 20+ 处动作全走 Button 的 outline/ghost），既没有可点的
                    「面」、形状语言也与同页不一致。改为同页一致的描边按钮（悬停变 accent 描边 + 悬停底）。 */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid={`route-edit-${tier.id}`}
                  onClick={() => setEditingTier(tier.id)}
                  className="flex-shrink-0"
                >
                  {t('route.editPriority')}
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      {/* 优先级弹窗：按需挂载（每次打开 = 最新已存值播种草稿），保存才写库 */}
      {editingTier && editingMeta && (
        <ModelRoutingTierDialog
          tier={editingTier}
          tierLabel={editingMeta.label}
          routeIds={modelRoutes[editingTier] ?? []}
          candidates={candidates}
          onSave={setTier}
          onClose={() => setEditingTier(null)}
        />
      )}
    </section>
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
  const maxConcurrentId = useId()
  const maxQueueId = useId()

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
    <section className="nf-settings-panel space-y-3">
      <header className="nf-settings-resource-bar">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
          <Gauge size={16} className="shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
          {t('settings.concurrencyTitle')}
        </h4>
      </header>
      <div className="space-y-1">
        <Disclosure label={t('settings.cardHint')}>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
            {t('settings.concurrencyDesc')}
          </p>
        </Disclosure>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3">
        <div className="space-y-1">
          <Label htmlFor={maxConcurrentId}>{t('settings.concurrencyMax')}</Label>
          <Input
            id={maxConcurrentId}
            type="number"
            min={1}
            max={20}
            value={String(maxConcurrent)}
            onChange={(e) => { userEditedRef.current = true; setMaxConcurrent(Math.max(1, parseInt(e.target.value) || 1)) }}
          />
          <p className="text-micro" style={{ color: 'var(--color-text-muted)' }}>{t('settings.concurrencyMaxDesc')}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={maxQueueId}>{t('settings.concurrencyQueue')}</Label>
          <Input
            id={maxQueueId}
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
    </section>
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
  /** 已保存基线：与当前表单不一致即视为有未保存改动（关闭设置页时确认） */
  const [baseline, setBaseline] = useState<string>('')

  useEffect(() => {
    ipc.invoke('config:get').then((cfg) => {
      if (cfg?.proxy) {
        const loaded = {
          enabled: cfg.proxy.enabled ?? false, // 明确默认关闭
          type: cfg.proxy.type ?? 'http',
          host: cfg.proxy.host ?? '',
          port: cfg.proxy.port ?? 7890,
        }
        setProxy(loaded)
        setBaseline(JSON.stringify(loaded))
      }
    }).catch(() => { })
  }, [])

  useSettingsDirty(baseline !== '' && JSON.stringify(proxy) !== baseline)

  const handleSave = async () => {
    const t0 = Date.now()
    setSaving(true)
    try {
      await ipc.invoke('config:set', { proxy })
      setBaseline(JSON.stringify(proxy))
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
    <div className="max-w-[640px] space-y-5">
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

function EditorSection({ appearance, appearanceDirty, onChangeAppearance, onApplyAppearance }: {
  appearance: WritingAppearance
  appearanceDirty: boolean
  onChangeAppearance: (change: Partial<WritingAppearance>) => void
  onApplyAppearance: () => void
}) {
  // 原子 selector：仅订阅字体相关字段
  const writingFont = useThemeStore(s => s.writingFont)
  const setWritingFont = useThemeStore(s => s.setWritingFont)
  const uiFont = useThemeStore(s => s.uiFont)
  const setUiFont = useThemeStore(s => s.setUiFont)
  const typewriter = useEditorPrefsStore(s => s.typewriter)
  const toggleTypewriter = useEditorPrefsStore(s => s.toggleTypewriter)
  const paragraphFocus = useEditorPrefsStore(s => s.paragraphFocus)
  const toggleParagraphFocus = useEditorPrefsStore(s => s.toggleParagraphFocus)
  const { t, locale } = useTranslation()

  return (
    <div className="max-w-3xl space-y-6">
      {/* 正文工具栏可以直达本页，排版预览放在编辑器偏好的首位。 */}
      <WritingAppearanceSection appearance={appearance} dirty={appearanceDirty}
        onChange={onChangeAppearance} onApply={onApplyAppearance} />

      {/* 主题卡片与工作台标题栏的主题菜单共用主题设置。 */}
      <ThemeSection />

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
                {loc === 'zh-CN' ? 'ZH' : loc === 'en-US' ? 'EN' : 'RU'}  {LOCALE_LABELS[loc]} ({loc})
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

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="text-micro" style={{ color: 'var(--color-text-secondary)' }}>{t('settings.typewriter')}</span>
            <p className="text-micro" style={{ color: 'var(--color-text-muted)' }}>{t('settings.typewriterDesc')}</p>
          </div>
          <Switch aria-label={t('settings.typewriter')} checked={typewriter} onCheckedChange={() => toggleTypewriter()} />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="text-micro" style={{ color: 'var(--color-text-secondary)' }}>{t('settings.paragraphFocus')}</span>
            <p className="text-micro" style={{ color: 'var(--color-text-muted)' }}>{t('settings.paragraphFocusDesc')}</p>
          </div>
          <Switch aria-label={t('settings.paragraphFocus')} checked={paragraphFocus} onCheckedChange={() => toggleParagraphFocus()} />
        </div>
      </div>

      {/* 快捷键（分类折叠，默认收起） */}
      <ShortcutsSection />

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
    checkForUpdates, openReleasesPage, triggerUninstall,
  } = useUpdateStore()
  const [checking, setChecking] = useState(false)

  const isChecking = checking || status === 'checking'

  const handleCheck = async () => {
    setChecking(true)
    await checkForUpdates()
    setChecking(false)
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
    <div className="nf-settings-about">
      {/* 品牌标识 */}
      <div className="flex flex-col items-center justify-center py-10 rounded-xl space-y-3" style={{ backgroundColor: 'var(--color-sidebar)', border: '1px solid var(--color-border)' }}>
        <img src={appIcon} width={52} height={52} alt="" />
        <h3 className="text-2xl font-semibold text-[var(--color-text)]">NovelForge</h3>
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
        <div className="text-xs leading-relaxed" style={{ color: 'var(--color-text)' }}>
          <MarkdownContent content={t('about.intro')} />
        </div>
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
              <SemanticLabel name="update">{t('update.newVersion')} v{updateInfo.version}</SemanticLabel>
            </p>
            {/* 下载/安装统一由状态栏执行，避免出现第二套入口 */}
            <p style={{ color: 'var(--color-text-muted)' }}>{t('settings.updateInStatusBar')}</p>
            <Button size="sm" variant="ghost" onClick={openReleasesPage}>
              <ExternalLink size={13} />
              {t('action.details')}
            </Button>
          </div>
        )}
        {status === 'downloaded' && (
          <div className="text-xs space-y-2">
            <p style={{ color: 'var(--color-success)' }}>
              <SemanticLabel name="success">{t('update.downloaded')}</SemanticLabel>
            </p>
            <p style={{ color: 'var(--color-text-muted)' }}>{t('settings.updateInStatusBar')}</p>
          </div>
        )}
        {status === 'error' && (
          <p className="text-xs" style={{ color: 'var(--color-error)' }}>
            {t('update.checkFailed')}{error || t('update.unknownError')}
          </p>
        )}
      </div>

      <SupportFeedback />

      {/* 其他应用支持操作 */}
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


