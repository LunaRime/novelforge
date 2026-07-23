import { useState, useRef } from 'react'
import { Save, Sparkles, Info, Loader2 } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useLLMStore } from '../../stores/llm-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import type { NovelConfig } from '../../shared/ipc-channels'
import type { GeneratableField } from '../../services/workflows/commands/generate-field.command'
import { Button } from '../ui/Button'
import { DEFAULT_WORDS_PER_CHAPTER } from '../../shared/constants'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { NativeSelect } from '../ui/NativeSelect'
import GenerateConfigDialog from '../dialogs/GenerateConfigDialog'
import { useTranslation } from '../../hooks/useTranslation'

/** 小说配置编辑器 — Tab 内的可视化配置面板 */
export default function NovelConfigEditor() {
  const { t } = useTranslation()

  // ✅ 用 selector 精确订阅：只有 currentProject 变化时才重新渲染
  //    不订阅 fileTree、recentProjects 等无关字段
  const currentProject = useProjectStore(s => s.currentProject)
  const updateNovelConfig = useProjectStore(s => s.updateNovelConfig)
  const saveProject = useProjectStore(s => s.saveProject)
  const defaultModelId = useLLMStore(s => s.defaultModelId)
  // ✅ addLog 用 getState() 命令式调用，不订阅 workflow store
  //    避免 AI 流式生成时 globalLogs 高频更新导致本组件被动重渲染
  const addLog = useWorkflowStore.getState().addLog
  const [saving, setSaving] = useState(false)
  const [showGenerateConfig, setShowGenerateConfig] = useState(false)

  // 各区块的独立生成状态
  const [generatingField, setGeneratingField] = useState<GeneratableField | null>(null)

  // 直接从 Store 读取配置 — 单一数据源，无需 local state 镜像
  const config = currentProject?.novelConfig ?? null

  if (!config) return (
    <div className="h-full flex items-center justify-center" style={{ color: 'var(--color-text-muted)' }}>
      <span className="text-sm opacity-50">{t('novelConfig.loading')}</span>
    </div>
  )

  // 直接写 Store — 消除双向同步风险
  const update = <K extends keyof NovelConfig>(key: K, value: NovelConfig[K]) => {
    updateNovelConfig({ [key]: value })
  }

  /** 保存配置 — Store 已是最新数据，仅需持久化到磁盘 */
  const handleSave = async () => {
    if (!config || saving) return
    setSaving(true)
    try {
      await saveProject()
      addLog('info', `📝 ${t('novelConfig.saved')}`)
    } catch (error) {
      console.error('[NovelConfigEditor] 保存失败:', error)
      addLog('error', t('error.saveFailed').replace('{error}', String(error)))
    } finally {
      setSaving(false)
    }
  }

  /** AI 生成配置 — 打开弹框 */
  const handleAIGenerate = () => {
    if (!defaultModelId) {
      addLog('error', `⚠️ ${t('tip.configModelFirst')}`)
      return
    }
    setShowGenerateConfig(true)
  }

  /** 单字段 AI 生成 */
  const handleFieldGenerate = async (fieldKey: GeneratableField) => {
    if (!defaultModelId) {
      addLog('error', `⚠️ ${t('tip.configModelFirst')}`)
      return
    }
    if (generatingField) return // 防止并发

    setGeneratingField(fieldKey)
    try {
      const { GenerateFieldCommand } = await import('../../services/workflows/commands/generate-field.command')
      const cmd = new GenerateFieldCommand(fieldKey)
      await cmd.execute({
        step: { id: '', commandId: '', name: '', params: {} },
        context: { data: {}, cancelled: false },
        callbacks: {
          log: (msg: string) => useWorkflowStore.getState().addLog('info', msg),
          setProgress: () => { },
          appendText: () => { },
        },
      })
    } catch (e) {
      addLog('error', t('error.genFailed') + '：' + String(e))
    } finally {
      setGeneratingField(null)
    }
  }

  const genres = ['玄幻', '仙侠', '都市', '科幻', '历史', '军事', '游戏', '末世', '悬疑', '灵异', '言情', '古言', '现言', '奇幻', '武侠', '轻小说', '同人', '职场']

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-8 py-6">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-6">
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

        {/* 配置表单 */}
        <div className="space-y-5">
          {/* 基本信息 */}
          <Section title={t('novelConfig.basicInfo')}>
            <div className="grid grid-cols-3 gap-4">
              <Field label={t('novelConfig.type')}>
                <NativeSelect value={config.genre} onChange={(e) => update('genre', e.target.value)}>
                  {genres.map((g) => <option key={g} value={g}>{g}</option>)}
                </NativeSelect>
              </Field>
              <Field label={t('novelConfig.subType')}>
                <Input value={config.subGenre} onChange={(e) => update('subGenre', e.target.value)} placeholder={t('novelConfig.subTypePlaceholder')} />
              </Field>
              <Field label={t('novelConfig.audience')}>
                <NativeSelect value={config.targetAudience} onChange={(e) => update('targetAudience', e.target.value)}>
                  <option value="男频">{t('novelConfig.audienceMale')}</option>
                  <option value="女频">{t('novelConfig.audienceFemale')}</option>
                  <option value="双性向">{t('novelConfig.audienceBoth')}</option>
                  <option value="全龄">{t('novelConfig.audienceAll')}</option>
                </NativeSelect>
              </Field>
            </div>
            <div className="grid grid-cols-4 gap-4 mt-4">
              <Field label={t('novelConfig.structure')} tipItems={[
                t('novelConfig.structureTip1'),
                t('novelConfig.structureTip2'),
                t('novelConfig.structureTip3'),
                t('novelConfig.structureTip4'),
                t('novelConfig.structureTip5'),
                t('novelConfig.structureTip6'),
              ]}>
                <NativeSelect value={config.plotStructure || 'three_act'} onChange={(e) => update('plotStructure', e.target.value as NovelConfig['plotStructure'])}>
                  <option value="three_act">{t('novelConfig.structureThreeAct')}</option>
                  <option value="heros_journey">{t('novelConfig.structureHerosJourney')}</option>
                  <option value="save_the_cat">{t('novelConfig.structureSaveTheCat')}</option>
                  <option value="kishotenketsu">{t('novelConfig.structureKishotenketsu')}</option>
                  <option value="multi_thread">{t('novelConfig.structureMultiThread')}</option>
                  <option value="freeform">{t('novelConfig.structureFreeform')}</option>
                </NativeSelect>
              </Field>
              <Field label={t('novelConfig.pov')} tipItems={[
                t('novelConfig.povTip1'),
                t('novelConfig.povTip2'),
                t('novelConfig.povTip3'),
                t('novelConfig.povTip4'),
              ]}>
                <NativeSelect value={config.narrativePOV || 'third_limited'} onChange={(e) => update('narrativePOV', e.target.value as NovelConfig['narrativePOV'])}>
                  <option value="first_person">{t('novelConfig.povFirstPerson')}</option>
                  <option value="third_limited">{t('novelConfig.povThirdLimited')}</option>
                  <option value="third_omniscient">{t('novelConfig.povThirdOmniscient')}</option>
                  <option value="multi_pov">{t('novelConfig.povMultiPov')}</option>
                </NativeSelect>
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
          <Section
            title={t('novelConfig.coreOutline')}
            desc={t('novelConfig.coreOutlineDesc')}
            aiFieldKey="coreOutline"
            generatingField={generatingField}
            onAIGenerate={handleFieldGenerate}
          >
            <Textarea value={config.coreOutline} onChange={(e) => update('coreOutline', e.target.value)} placeholder={t('novelConfig.coreOutlinePlaceholder')} rows={4} />
          </Section>

          {/* 世界观设定 */}
          <Section
            title={t('novelConfig.worldSetting')}
            desc={t('novelConfig.worldSettingDesc')}
            aiFieldKey="worldSetting"
            generatingField={generatingField}
            onAIGenerate={handleFieldGenerate}
          >
            <Textarea value={config.worldSetting} onChange={(e) => update('worldSetting', e.target.value)} placeholder={t('novelConfig.worldSettingPlaceholder')} rows={4} />
          </Section>

          {/* 金手指 */}
          <Section
            title={t('novelConfig.cheat')}
            desc={t('novelConfig.cheatDesc')}
            aiFieldKey="goldenFinger"
            generatingField={generatingField}
            onAIGenerate={handleFieldGenerate}
          >
            <Textarea value={config.goldenFinger} onChange={(e) => update('goldenFinger', e.target.value)} placeholder={t('novelConfig.cheatPlaceholder')} rows={3} />
          </Section>

          {/* 主角人设 */}
          <Section
            title={t('novelConfig.protagonist')}
            desc={t('novelConfig.protagonistDesc')}
            aiFieldKey="protagonistProfile"
            generatingField={generatingField}
            onAIGenerate={handleFieldGenerate}
          >
            <Textarea value={config.protagonistProfile} onChange={(e) => update('protagonistProfile', e.target.value)} placeholder={t('novelConfig.protagonistPlaceholder')} rows={4} />
          </Section>

          {/* 全局写作要求 */}
          <Section
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
          <Section
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
          <Section title={t('novelConfig.referenceWorks')} desc={t('novelConfig.referenceWorksDesc')}>
            <Textarea value={config.referenceWorks || ''} onChange={(e) => update('referenceWorks', e.target.value)} placeholder={t('novelConfig.referenceWorksPlaceholder')} rows={2} />
          </Section>
        </div>
      </div>

      {/* AI 生成配置弹框 */}
      <GenerateConfigDialog
        isOpen={showGenerateConfig}
        onClose={() => setShowGenerateConfig(false)}
        onGenerated={(parsed) => {
          // 直接写 Store，组件自动重新渲染
          updateNovelConfig(parsed)
        }}
      />
    </div>
  )
}

/** 表单分组 — 支持右上角 AI 生成按钮 */
function Section({
  title,
  desc,
  children,
  aiFieldKey,
  generatingField,
  onAIGenerate,
}: {
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
    <div className="p-4 rounded-xl bg-[var(--color-sidebar)] border border-[var(--color-border)]">
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
              ? <Loader2 size={11} className="animate-spin" />
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
  const tipRef = useRef<HTMLDivElement>(null)

  return (
    <div>
      <label className="text-xs mb-1 flex items-center gap-1 font-medium text-[var(--color-text-muted)]">
        {label}
        {tipItems && tipItems.length > 0 && (
          <span
            style={{ position: 'relative', display: 'inline-flex' }}
            onMouseEnter={() => setShowTip(true)}
            onMouseLeave={() => setShowTip(false)}
          >
            <Info size={11} style={{ opacity: 0.5 }} />
            {showTip && (
              <div
                ref={tipRef}
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  marginBottom: 6,
                  padding: '8px 12px',
                  borderRadius: 8,
                  fontSize: 11,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-line',
                  color: 'var(--color-text)',
                  background: 'var(--color-bg-elevated, var(--color-sidebar))',
                  border: '1px solid var(--color-border)',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
                  zIndex: 9999,
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
