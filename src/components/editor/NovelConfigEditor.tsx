import { FeatureSplit } from '../ui/FeatureSplit'
import MenuRow from '../ui/MenuRow'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Save, Sparkles, Info } from 'lucide-react'
import { Spinner } from '../ui/Spinner'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import type { NovelConfig } from '../../shared/ipc-channels'
import type { GeneratableField } from '../../services/workflows/commands/generate-field.command'
import { Button } from '../ui/Button'
import { DEFAULT_WORDS_PER_CHAPTER } from '../../shared/constants'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../ui/Select'
import GenerateConfigDialog from '../dialogs/GenerateConfigDialog'
import { createRendererNovelConfigApplication } from '../../services/config/novel-config-adapter'
import { ProjectConfigResultUnknown } from '../../services/config/project-config-save'
import { NovelConfigRequestCancelled, type NovelConfigScope } from '../../core'
import { useTranslation } from '../../hooks/useTranslation'
import { useFloatingPosition } from '../../hooks/useFloatingPosition'
import type { TextKey } from '../../shared/locale'
import { toast } from '../ui/Toast'
import { renderLog } from '../../services/render-logger'

const sections = [
  'novelConfig.basicInfo', 'novelConfig.coreOutline', 'novelConfig.worldSetting', 'novelConfig.cheat',
  'novelConfig.protagonist', 'novelConfig.globalWriting', 'novelConfig.styleConfig', 'novelConfig.referenceWorks',
] as const

/** 小说配置编辑器 — Tab 内的可视化配置面板 */
export default function NovelConfigEditor() {
  const project = useProjectStore(s => s.currentProject)
  const session = useProjectStore(s => s.projectSession)
  const { t } = useTranslation()
  if (!project) return <div className="h-full flex items-center justify-center" style={{ color: 'var(--color-text-muted)' }}><span className="text-sm opacity-50">{t('novelConfig.loading')}</span></div>
  return <NovelConfigContent key={`${project.id}:${project.path}:${session}`} source={{ id: project.id, path: project.path, session }} />
}

function NovelConfigContent({ source }: { source: NovelConfigScope }) {
  const { t } = useTranslation()
  const [application] = useState(() => createRendererNovelConfigApplication(source))
  const mounted = useRef(true)
  const lifetime = useRef({ generation: 0 })
  const saveBusy = useRef(false)
  const generationStarting = useRef(false)
  const active = useCallback(() => {
    if (!mounted.current) return false
    try { application.assertCurrent(); return true } catch { return false }
  }, [application])
  useEffect(() => {
    mounted.current = true
    const lifecycle = lifetime.current; const generation = ++lifecycle.generation
    return () => {
      mounted.current = false
      queueMicrotask(() => { if (!mounted.current && lifecycle.generation === generation) application.dispose() })
    }
  }, [application])

  // ✅ 用 selector 精确订阅：只有 currentProject 变化时才重新渲染
  //    不订阅 fileTree、recentProjects 等无关字段
  const currentProject = useProjectStore(s => s.currentProject)
  // ✅ addLog 用 getState() 命令式调用，不订阅 workflow store
  //    避免 AI 流式生成时 globalLogs 高频更新导致本组件被动重渲染
  const addLog = useWorkflowStore.getState().addLog
  const [saving, setSaving] = useState(false)
  const [showGenerateConfig, setShowGenerateConfig] = useState(false)
  const [section, setSection] = useState(0)
  const [detailOpen, setDetailOpen] = useState(false)

  // 线③ 第 2 条：生成中字段从 workflow-store 推导（单字段走 startWorkflow，删假 step）。
  // selector 返回 fieldKey 字符串，仅 fieldKey 变化时才重渲染（避免流式 steps 高频重渲染）
  const generatingField = useWorkflowStore(s => {
    const run = s.activeRuns.find(r => r.type === 'config_generation' && r.rehydrateParams?.mode === 'field' && application.ownsRun(r.id))
    return (run?.rehydrateParams?.fieldKey as GeneratableField | null) ?? null
  })
  const isConfigRunning = useWorkflowStore(s => s.activeRuns.some(run => run.type === 'config_generation'
    && ['running', 'waiting', 'paused'].includes(run.status) && application.ownsRun(run.id)))

  // 直接从 Store 读取配置 — 单一数据源，无需 local state 镜像
  const config = currentProject?.novelConfig ?? null

  if (!config) return (
    <div className="h-full flex items-center justify-center" style={{ color: 'var(--color-text-muted)' }}>
      <span className="text-sm opacity-50">{t('novelConfig.loading')}</span>
    </div>
  )

  // 直接写 Store — 消除双向同步风险
  const update = <K extends keyof NovelConfig>(key: K, value: NovelConfig[K]) => {
    if (active()) application.update({ [key]: value })
  }

  /** 保存配置 — Store 已是最新数据，仅需持久化到磁盘 */
  const handleSave = async () => {
    if (!config || saveBusy.current || !active()) return
    saveBusy.current = true
    const t0 = Date.now()
    setSaving(true)
    try {
      await application.save()
      if (!active()) return
      // 保存行为日志流：成功 info + toast 视觉反馈
      renderLog('info', 'Save:Config', t('log.render.configSaveSuccess').replace('{ms}', String(Date.now() - t0)))
      toast.success(t('save.success'))
    } catch (error) {
      if (!active() || error instanceof NovelConfigRequestCancelled) return
      if (error instanceof ProjectConfigResultUnknown) {
        renderLog('warn', 'Save:Config', error.message)
        toast.warning(error.message)
        return
      }
      // 失败：toast + error 日志（含原因）
      renderLog('error', 'Save:Config', t('log.render.configSaveFailed').replace('{error}', () => String(error)))
      toast.error(t('save.failed').replace('{error}', String(error)))
    } finally {
      saveBusy.current = false
      if (active()) setSaving(false)
    }
  }

  /** AI 生成配置 — 打开弹框 */
  const handleAIGenerate = () => {
    if (!active()) return
    if (!application.hasModel()) {
      addLog('error', t('tip.configModelFirst'))
      return
    }
    setShowGenerateConfig(true)
  }

  /** 单字段 AI 生成（线③ 第 2 条：走 startWorkflow，删假 step——可取消/流式/进面板/统一失败面） */
  const handleFieldGenerate = async (fieldKey: GeneratableField) => {
    if (!active()) return
    if (!application.hasModel()) {
      addLog('error', t('tip.configModelFirst'))
      return
    }
    if (generationStarting.current || isConfigRunning) return
    generationStarting.current = true
    try { await application.startField(fieldKey) }
    catch (error) { if (active() && !(error instanceof NovelConfigRequestCancelled)) toast.error(String(error)) }
    finally { generationStarting.current = false }
  }
  const handleBulkGenerate = async (idea: string, totalChapters: number, wordsPerChapter: number) => {
    application.assertCurrent()
    if (generationStarting.current || isConfigRunning) throw new Error(t('tip.configRunning'))
    generationStarting.current = true
    try { await application.startBulk(idea, totalChapters, wordsPerChapter) }
    finally { generationStarting.current = false }
  }

  // 题材 value 保持中文原文（数据兼容），显示文本走 i18n
  const genres = ['玄幻', '仙侠', '都市', '科幻', '历史', '军事', '游戏', '末世', '悬疑', '灵异', '言情', '古言', '现言', '奇幻', '武侠', '轻小说', '同人', '职场']
  const GENRE_KEYS: Record<string, TextKey> = {
    '玄幻': 'genre.xuanhuan', '仙侠': 'genre.xianxia', '都市': 'genre.urban', '科幻': 'genre.scifi',
    '历史': 'genre.history', '军事': 'genre.military', '游戏': 'genre.game', '末世': 'genre.apocalypse',
    '悬疑': 'genre.suspense', '灵异': 'genre.horror', '言情': 'genre.romance', '古言': 'genre.ancientRomance',
    '现言': 'genre.modernRomance', '奇幻': 'genre.fantasy', '武侠': 'genre.wuxia', '轻小说': 'genre.lightNovel',
    '同人': 'genre.fanfic', '职场': 'genre.workplace',
  }

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="w-full min-w-0 px-4 py-3">
        {/* 头部 */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>
              {t('novelConfig.title')}
            </h2>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
              {t('novelConfig.desc')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ai" onClick={handleAIGenerate}>
              <Sparkles size={13} /> {t('tip.aiGeneratedConfig')}
            </Button>
            <Button variant="outline" onClick={handleSave} disabled={saving}>
              <Save size={13} /> {saving ? t('status.saving') : t('action.save')}
            </Button>
          </div>
        </div>

      </div>
      <FeatureSplit detailOpen={detailOpen} onBack={() => setDetailOpen(false)} list={
        sections.map((label, index) => (
          <MenuRow key={label} title={t(label)} titleHint={t(label)}
            current={section === index ? 'page' : undefined} active={section === index}
            onPrimary={() => { setSection(index); setDetailOpen(true) }} />
        ))
      }>
        <div className="flex-1 min-h-0 overflow-y-auto p-3" data-config-section={section}>
          {/* 基本信息 */}
          <Section hidden={section !== 0} title={t('novelConfig.basicInfo')}>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-4">
              <Field label={t('novelConfig.type')}>
                <Select value={config.genre} onValueChange={(v) => update('genre', v)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {genres.map((g) => <SelectItem key={g} value={g}>{t(GENRE_KEYS[g] ?? 'genre.fantasy')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t('novelConfig.subType')}>
                <Input value={config.subGenre} onChange={(e) => update('subGenre', e.target.value)} placeholder={t('novelConfig.subTypePlaceholder')} />
              </Field>
              <Field label={t('novelConfig.audience')}>
                <Select value={config.targetAudience} onValueChange={(v) => update('targetAudience', v)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="男频">{t('novelConfig.audienceMale')}</SelectItem>
                    <SelectItem value="女频">{t('novelConfig.audienceFemale')}</SelectItem>
                    <SelectItem value="双性向">{t('novelConfig.audienceBoth')}</SelectItem>
                    <SelectItem value="全龄">{t('novelConfig.audienceAll')}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-4 mt-4">
              <Field label={t('novelConfig.structure')} tipItems={[
                t('novelConfig.structureTip1'),
                t('novelConfig.structureTip2'),
                t('novelConfig.structureTip3'),
                t('novelConfig.structureTip4'),
                t('novelConfig.structureTip5'),
                t('novelConfig.structureTip6'),
              ]}>
                <Select value={config.plotStructure || 'three_act'} onValueChange={(v) => update('plotStructure', v as NovelConfig['plotStructure'])}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="three_act">{t('novelConfig.structureThreeAct')}</SelectItem>
                    <SelectItem value="heros_journey">{t('novelConfig.structureHerosJourney')}</SelectItem>
                    <SelectItem value="save_the_cat">{t('novelConfig.structureSaveTheCat')}</SelectItem>
                    <SelectItem value="kishotenketsu">{t('novelConfig.structureKishotenketsu')}</SelectItem>
                    <SelectItem value="multi_thread">{t('novelConfig.structureMultiThread')}</SelectItem>
                    <SelectItem value="freeform">{t('novelConfig.structureFreeform')}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t('novelConfig.pov')} tipItems={[
                t('novelConfig.povTip1'),
                t('novelConfig.povTip2'),
                t('novelConfig.povTip3'),
                t('novelConfig.povTip4'),
              ]}>
                <Select value={config.narrativePOV || 'third_limited'} onValueChange={(v) => update('narrativePOV', v as NovelConfig['narrativePOV'])}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="first_person">{t('novelConfig.povFirstPerson')}</SelectItem>
                    <SelectItem value="third_limited">{t('novelConfig.povThirdLimited')}</SelectItem>
                    <SelectItem value="third_omniscient">{t('novelConfig.povThirdOmniscient')}</SelectItem>
                    <SelectItem value="multi_pov">{t('novelConfig.povMultiPov')}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t('novelConfig.totalChapters')}>
                <Input
                  type="number"
                  value={config.totalChapters}
                  onChange={(e) => update('totalChapters', (e.target.value === '' ? '' : parseInt(e.target.value)) as number)}
                  onBlur={() => {
                    const v = Number(config.totalChapters)
                    if (!v || v < 1) update('totalChapters', 100)
                  }}
                  placeholder="100"
                  min={1}
                />
              </Field>
              <Field label={t('novelConfig.wordsPerChapter')}>
                <Input
                  type="number"
                  value={config.wordsPerChapter}
                  onChange={(e) => update('wordsPerChapter', (e.target.value === '' ? '' : parseInt(e.target.value)) as number)}
                  onBlur={() => {
                    const v = Number(config.wordsPerChapter)
                    if (!v || v < 100) update('wordsPerChapter', DEFAULT_WORDS_PER_CHAPTER)
                  }}
                  placeholder="3000"
                  min={100}
                />
              </Field>
            </div>
          </Section>

          {/* 核心大纲 */}
          <Section hidden={section !== 1}
            title={t('novelConfig.coreOutline')}
            desc={t('novelConfig.coreOutlineDesc')}
            aiFieldKey="coreOutline"
            generatingField={generatingField}
            onAIGenerate={handleFieldGenerate}
          >
            <Textarea value={config.coreOutline} onChange={(e) => update('coreOutline', e.target.value)} placeholder={t('novelConfig.coreOutlinePlaceholder')} rows={4} />
          </Section>

          {/* 世界观设定 */}
          <Section hidden={section !== 2}
            title={t('novelConfig.worldSetting')}
            desc={t('novelConfig.worldSettingDesc')}
            aiFieldKey="worldSetting"
            generatingField={generatingField}
            onAIGenerate={handleFieldGenerate}
          >
            <Textarea value={config.worldSetting} onChange={(e) => update('worldSetting', e.target.value)} placeholder={t('novelConfig.worldSettingPlaceholder')} rows={4} />
          </Section>

          {/* 金手指 */}
          <Section hidden={section !== 3}
            title={t('novelConfig.cheat')}
            desc={t('novelConfig.cheatDesc')}
            aiFieldKey="goldenFinger"
            generatingField={generatingField}
            onAIGenerate={handleFieldGenerate}
          >
            <Textarea value={config.goldenFinger} onChange={(e) => update('goldenFinger', e.target.value)} placeholder={t('novelConfig.cheatPlaceholder')} rows={3} />
          </Section>

          {/* 主角人设 */}
          <Section hidden={section !== 4}
            title={t('novelConfig.protagonist')}
            desc={t('novelConfig.protagonistDesc')}
            aiFieldKey="protagonistProfile"
            generatingField={generatingField}
            onAIGenerate={handleFieldGenerate}
          >
            <Textarea value={config.protagonistProfile} onChange={(e) => update('protagonistProfile', e.target.value)} placeholder={t('novelConfig.protagonistPlaceholder')} rows={4} />
          </Section>

          {/* 全局写作要求 */}
          <Section hidden={section !== 5}
            title={t('novelConfig.globalWriting')}
            desc={t('novelConfig.globalWritingDesc')}
            aiFieldKey="globalGuidance"
            generatingField={generatingField}
            onAIGenerate={handleFieldGenerate}
          >
            <Textarea
              value={config.globalGuidance}
              onChange={(e) => update('globalGuidance', e.target.value)}
              placeholder={t('novelConfig.globalWritingPlaceholder')}
              rows={6}
            />
          </Section>

          {/* 文风配置 */}
          <Section hidden={section !== 6}
            title={t('novelConfig.styleConfig')}
            desc={t('novelConfig.styleConfigDesc')}
            aiFieldKey="writingStyle"
            generatingField={generatingField}
            onAIGenerate={handleFieldGenerate}
          >
            <Textarea
              value={config.writingStyle || ''}
              onChange={(e) => update('writingStyle', e.target.value)}
              placeholder={t('novelConfig.stylePlaceholder')}
              rows={6}
            />
          </Section>

          {/* 参考作品 */}
          <Section hidden={section !== 7} title={t('novelConfig.referenceWorks')} desc={t('novelConfig.referenceWorksDesc')}>
            <Textarea value={config.referenceWorks || ''} onChange={(e) => update('referenceWorks', e.target.value)} placeholder={t('novelConfig.referenceWorksPlaceholder')} rows={2} />
          </Section>
        </div>
      </FeatureSplit>

      {/* AI 生成配置弹框 */}
      <GenerateConfigDialog
        isOpen={showGenerateConfig}
        onClose={() => setShowGenerateConfig(false)}
        config={config}
        isConfigRunning={isConfigRunning}
        hasModel={() => application.hasModel()}
        assertCurrent={() => application.assertCurrent()}
        onUpdateConfig={patch => { if (active()) application.update(patch) }}
        onGenerate={handleBulkGenerate}
      />
    </div>
  )
}

/** 表单分组 — 支持右上角 AI 生成按钮 */
function Section({
  hidden,
  title,
  desc,
  children,
  aiFieldKey,
  generatingField,
  onAIGenerate,
}: {
  hidden: boolean
  title: string
  desc?: string
  children: React.ReactNode
  /** 对应 NovelConfig 中的字段 key，传入则显示 AI 生成按钮 */
  aiFieldKey?: GeneratableField
  /** 当前正在生成的字段（全局共享状态，防止并发） */
  generatingField?: GeneratableField | null
  /** AI 生成回调 */
  onAIGenerate?: (fieldKey: GeneratableField) => void
}) {
  const { t } = useTranslation()
  const isGenerating = aiFieldKey != null && generatingField === aiFieldKey
  const isAnyGenerating = generatingField != null
  const showAIButton = aiFieldKey != null && onAIGenerate != null

  return (
    <div hidden={hidden} className="p-4 rounded-xl bg-[var(--color-sidebar)] border border-[var(--color-border)]">
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">{title}</h3>
          {desc && <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{desc}</p>}
        </div>
        {showAIButton && (
          <Button
            variant="ai"
            size="sm"
            onClick={() => onAIGenerate(aiFieldKey)}
            disabled={isAnyGenerating}
            className="flex-shrink-0 ml-3"
            title={isGenerating ? t('status.generating') : t('tip.aiGenerateField').replace('{field}', title)}
          >
            {isGenerating
              ? <Spinner size={11}  />
              : <Sparkles size={11} />
            }
            {isGenerating ? t('novelConfig.generatingBtn') : t('arch.aiGenLabel')}
          </Button>
        )}
      </div>
      {children}
    </div>
  )
}

/** 表单字段 */
function Field({ label, tipItems, children }: { label: string; tipItems?: string[]; children: React.ReactNode }) {
  const [showTip, setShowTip] = useState(false)
  const tipAnchorRef = useRef<HTMLSpanElement>(null)
  /**
   * ⚠️ 2026-09-25 修：原实现是 `position: absolute; bottom: 100%` —— 而本组件的祖先是
   * `:123` 的 `h-full overflow-y-auto`（`overflow-y: auto` 会把另一轴的 computed 也变成 auto，
   * **两轴都裁**）→ 位于滚动区上方 ~150px 内的字段（如「结构」「视角」）向上展开时上半截被切掉。
   * 改用与其它浮层同一套 `useFloatingPosition`：`position: fixed` 不受任何祖先 overflow 裁剪，
   * 且自带翻转与双轴夹取（原先 260px 宽 + translateX(-50%) 完全无避让）。
   */
  const tipRef = useFloatingPosition<HTMLDivElement>(tipAnchorRef, showTip, { placement: 'above', align: 'start' })

  return (
    <div>
      <label className="text-xs mb-1 flex items-center gap-1 font-medium text-[var(--color-text-muted)]">
        {label}
        {tipItems && tipItems.length > 0 && (
          <span
            ref={tipAnchorRef}
            className="inline-flex"
            onMouseEnter={() => setShowTip(true)}
            onMouseLeave={() => setShowTip(false)}
          >
            <Info size={11} style={{ opacity: 0.5 }} />
            {showTip && (
              <div
                ref={tipRef}
                style={{
                  // 初始位置：在视口外测量，定位后由 hook 写成实际坐标并显示
                  position: 'fixed',
                  visibility: 'hidden',
                  top: 0,
                  left: 0,
                  padding: '8px 12px',
                  borderRadius: 8,
                  fontSize: 11,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-line',
                  color: 'var(--color-text)',
                  background: 'var(--color-bg-elevated)',
                  border: '1px solid var(--color-border)',
                  boxShadow: 'var(--shadow-popover)',
                  zIndex: 'var(--z-tooltip)',
                  width: 260,
                  pointerEvents: 'none',
                }}
              >
                {tipItems.map((item, i) => (
                  <div key={i} style={{ paddingLeft: 0 }}>
                    <span style={{ color: 'var(--color-accent)', fontWeight: 600 }}>{item.split('：')[0]}</span>
                    {'：' + item.split('：').slice(1).join('：')}
                  </div>
                ))}
              </div>
            )}
          </span>
        )}
      </label>
      {children}
    </div>
  )
}
