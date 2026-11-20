import { FeatureSplit } from '../ui/FeatureSplit'
import MenuRow from '../ui/MenuRow'
import { toast } from '../ui/Toast'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Sparkles, CheckCircle2, Circle, RefreshCw, FileText, BookOpen, AlertTriangle, FolderTree } from 'lucide-react'
import { Spinner } from '../ui/Spinner'
import { useProjectStore } from '../../stores/project-store'
import { useCharacterStore } from '../../stores/character-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { renderIcon } from '../panels/sidebar/SidebarShared'
import { useTranslation } from '../../hooks/useTranslation'
import type { TextKey } from '../../shared/locale'

import ArchitectureConfirmDialog from '../dialogs/ArchitectureConfirmDialog'

import { Button } from '../ui/Button'
import CountBadge from '../ui/CountBadge'
import EditorPageHeader from '../ui/EditorPageHeader'
import { confirm } from '../ui/Confirm'
import { EmptyState } from '../ui/EmptyState'
import { ArchitectureRequestCancelled, EditorOpenScopeChanged, type ArchitectureScope, type ArchitectureStep } from '../../core'
import { createRendererArchitectureOverviewApplication } from '../../services/architecture/architecture-adapter'
import { renderLog } from '../../services/render-logger'
import { globalEventBus } from '../../shared/event-bus'

type ArchStepKey = ArchitectureStep

type ArchFileItem = {
  key: ArchStepKey
  fileName: string
  label: string
  iconName: string
  desc: string
}

function getArchFiles(t: (key: TextKey) => string): ArchFileItem[] {
  return [
    { key: 'premise', fileName: 'premise.md', label: t('arch.storyPremise'), iconName: 'target', desc: t('arch.premiseFileDesc') },
    { key: 'characters', fileName: 'characters.md', label: t('arch.characterMap'), iconName: 'users', desc: t('arch.characterFileDesc') },
    { key: 'worldbuilding', fileName: 'worldbuilding.md', label: t('arch.worldBuilding'), iconName: 'globe', desc: t('arch.worldBuildingFileDesc') },
    { key: 'synopsis', fileName: 'synopsis.md', label: t('arch.plotOutline'), iconName: 'map', desc: t('arch.synopsisFileDesc') },
  ]
}

/** 故事架构编辑器 — 显示四个架构文件状态，并提供 AI 生成入口 */
export default function WorldBuildingEditor() {
  const currentProject = useProjectStore(s => s.currentProject)
  const session = useProjectStore(s => s.projectSession)
  const { t } = useTranslation()
  if (!currentProject) {
    return (
      <div className="h-full flex flex-col overflow-hidden bg-[var(--color-bg)]">
        <div
          className="flex items-center justify-between gap-2 px-3 h-9 flex-shrink-0"
          style={{
            borderBottom: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-editor-bg)',
          }}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-medium truncate text-[var(--color-text-secondary)]">
              {t('editor.storyArch')}
            </span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto relative">
          <EmptyState icon={<BookOpen size={36} />} message={t('empty.pleaseOpenProject')} opacity={0.4} />
        </div>
      </div>
    )
  }

  return <ArchitectureOverviewContent key={`${currentProject.id}:${currentProject.path}:${session}`} source={{ id: currentProject.id, path: currentProject.path, session }} genre={currentProject.novelConfig.genre} />
}

function ArchitectureOverviewContent({ source, genre }: { source: ArchitectureScope; genre: string }) {
  const { t } = useTranslation()
  const [application] = useState(() => createRendererArchitectureOverviewApplication(source))
  const mounted = useRef(true)
  const lifetime = useRef({ generation: 0 })
  const sequence = useRef(0)
  const extractingBusy = useRef(false)
  const generatingBusy = useRef(false)
  const extractionRun = useRef<string | null>(null)
  const characterCount = useCharacterStore(s => s.characters.length)
  const [archStatus, setArchStatus] = useState<Record<string, boolean>>({})
  const [wordCounts, setWordCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [showArchDialog, setShowArchDialog] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extractionRunId, setExtractionRunId] = useState<string | null>(null)
  const [charExtractStatus, setCharExtractStatus] = useState<{ allCriticalPassed: boolean } | null>(null)
  const extractionOutcome = useWorkflowStore(s => extractionRunId
    ? (s.activeRuns.find(run => run.id === extractionRunId)?.status ?? s.history.find(run => run.id === extractionRunId)?.status ?? 'missing')
    : null)
  const active = useCallback(() => {
    if (!mounted.current) return false
    try { application.assertCurrent(); return true } catch { return false }
  }, [application])
  const archFiles = getArchFiles(t)
  const [activeFile, setActiveFile] = useState(archFiles[0]?.key)
  const [detailOpen, setDetailOpen] = useState(false)

  useEffect(() => {
    mounted.current = true
    const lifecycle = lifetime.current; const generation = ++lifecycle.generation
    return () => {
      mounted.current = false
      queueMicrotask(() => { if (!mounted.current && lifecycle.generation === generation) application.dispose() })
    }
  }, [application])

  const loadStatus = useCallback(async () => {
    if (!active()) return
    const request = ++sequence.current
    setLoading(true)
    try {
      const result = await application.load()
      if (!active() || request !== sequence.current) return
      const valid: Record<string, boolean> = {}
      const counts: Record<string, number> = {}
      const errors: string[] = []
      for (const key of Object.keys(result.fields) as ArchitectureStep[]) {
        const field = result.fields[key]
        if (field.status === 'ready') { valid[key] = field.generated; counts[key] = field.wordCount }
        else errors.push(field.status === 'failed' ? field.error : `${key}: missing`)
      }
      setArchStatus(previous => ({ ...previous, ...valid }))
      setWordCounts(previous => ({ ...previous, ...counts }))
      if (result.postProcess.status === 'ready') {
        const passed = result.postProcess.allCriticalPassed
        setCharExtractStatus(passed === null ? null : { allCriticalPassed: passed })
      } else errors.push(result.postProcess.error)
      setLoadFailed(errors.length > 0)
      if (errors.length) renderLog('error', 'Load:ArchitectureOverview', errors.join('\n'))
    } catch (error) {
      if (!active() || request !== sequence.current || error instanceof ArchitectureRequestCancelled) return
      renderLog('error', 'Load:ArchitectureOverview', String(error)); setLoadFailed(true)
    } finally {
      if (active() && request === sequence.current) setLoading(false)
    }
  }, [application, active])
  useEffect(() => { queueMicrotask(() => { if (active()) void loadStatus() }) }, [loadStatus, active])

  useEffect(() => {
    // Legacy events carry no source data: they only request a fresh read of this bound project.
    const refresh = () => { void loadStatus() }
    const unsub1 = globalEventBus.on('ARCH_POSTPROCESS_UPDATED', refresh)
    const unsub2 = globalEventBus.on('CHARACTER_EXTRACT_FAILED', refresh)
    const unsub3 = globalEventBus.on('ARCH_FILE_UPDATED', refresh)
    const unsub4 = globalEventBus.on('WORKFLOW_COMPLETE', payload => {
      if (!active() || !payload.runId || !application.ownsRun(payload.runId)) return
      if (payload.type === 'architecture_generation' || payload.type === 'post_process') void loadStatus()
      if (payload.runId === extractionRun.current) {
        extractionRun.current = null; extractingBusy.current = false
        setExtracting(false); setExtractionRunId(null)
      }
    })
    return () => { unsub1(); unsub2(); unsub3(); unsub4() }
  }, [application, active, loadStatus])

  useEffect(() => {
    if (!extractionRunId || !['completed', 'failed', 'missing'].includes(extractionOutcome ?? '')) return
    queueMicrotask(() => {
      if (!active() || extractionRun.current !== extractionRunId) return
      extractionRun.current = null; extractingBusy.current = false
      setExtracting(false); setExtractionRunId(null); void loadStatus()
    })
  }, [extractionRunId, extractionOutcome, active, loadStatus])

  const handleExtractCharacters = async () => {
    if (!active() || extractingBusy.current) return
    extractingBusy.current = true; setExtracting(true)
    let started = false
    try {
      const existing = await application.existingCharacterCount()
      if (!active()) return
      if (existing > 0 && !await confirm(t('character.extractConfirm'), { title: t('character.extractConfirmTitle') })) return
      if (!active()) return
      const result = await application.extract(genre)
      if (!active()) return
      if (result.status === 'started') {
        started = true; extractionRun.current = result.runId; setExtractionRunId(result.runId)
      } else toast.error(t('arch.charExtractFailed'))
    } catch (error) {
      if (!active() || error instanceof ArchitectureRequestCancelled) return
      renderLog('error', 'Extract:ArchitectureOverview', String(error)); toast.error(t('arch.charExtractFailed'))
    } finally {
      if (!started) {
        extractingBusy.current = false
        if (active()) setExtracting(false)
      }
    }
  }

  const openArchFile = async (file: ArchFileItem) => {
    if (!active()) return
    try {
      const result = await application.open(file.key, file.label)
      if (active() && result.status === 'missing') toast.error(t('common.loadFailed'))
    } catch (error) {
      if (!active() || error instanceof ArchitectureRequestCancelled || error instanceof EditorOpenScopeChanged) return
      renderLog('error', 'Open:ArchitectureOverview', String(error)); toast.error(t('common.loadFailed'))
    }
  }

  const handleConfirm = async (selectedSteps: ArchStepKey[], stepGuidance: Record<string, string>) => {
    if (!active() || generatingBusy.current) return
    generatingBusy.current = true
    try {
      await application.generate(selectedSteps, stepGuidance)
      if (active()) setShowArchDialog(false)
    } catch (error) {
      if (!active() || error instanceof ArchitectureRequestCancelled) return
      renderLog('error', 'Generate:ArchitectureOverview', String(error)); toast.error(String(error))
    } finally { generatingBusy.current = false }
  }

  const generatedCount = archFiles.filter(f => archStatus[f.key]).length
  const allDone = archFiles.length > 0 && generatedCount === archFiles.length

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 顶部工具栏 */}
      <EditorPageHeader
        icon={<FolderTree size={14} />}
        title={t('editor.storyArch')}
        meta={(
          <CountBadge
            value={generatedCount}
            total={archFiles.length}
            progress
            tone={allDone ? 'success' : generatedCount > 0 ? 'warning' : 'muted'}
          />
        )}
        actions={(
          <>
          <Button
            variant="ghost"
            size="icon"
            onClick={loadStatus}
            title={t('tip.refreshStatus')}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </Button>
          {/* AI 生成架构 — 与小说配置/章节蓝图保持一致的按钮位置 */}
          <Button
            variant="ai"
            size="sm"
            onClick={() => setShowArchDialog(true)}
            title={t('tip.regenerateArch')}
          >
            <Sparkles size={12} />
            {t('arch.aiGenBtn')}
          </Button>
          </>
        )}
      />

      <FeatureSplit detailOpen={detailOpen} onBack={() => setDetailOpen(false)} list={archFiles.map(file => (
        <MenuRow key={file.key} title={file.label} titleHint={file.label}
          icon={renderIcon(file.iconName, 13)}
          current={activeFile === file.key ? 'page' : undefined} active={activeFile === file.key}
          onPrimary={() => { setActiveFile(file.key); setDetailOpen(true) }} />
      ))}>
      {/* 文件卡片列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {loadFailed && (
          <div role="alert" className="flex items-center gap-2 rounded-lg border px-4 py-2 text-xs" style={{ borderColor: 'var(--color-error)', color: 'var(--color-error)' }}>
            <AlertTriangle size={14} />
            <span>{t('common.loadFailed')}</span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void loadStatus()}>{t('action.retry')}</Button>
          </div>
        )}
        {archFiles.map(f => {
          const generated = archStatus[f.key]
          const words = wordCounts[f.key] ?? 0
          const isCharacters = f.key === 'characters'
          // 角色图谱卡片：提取失败时显示红色警告
          const charExtractFailed = isCharacters && charExtractStatus && !charExtractStatus.allCriticalPassed
          // 动态边框颜色：提取失败 → 红 | 已生成 → 绿 | 未生成 → 默认
          const cardBorderColor = charExtractFailed
            ? 'var(--color-error)'
            : generated
              ? 'var(--color-success)'
              : 'var(--color-border)'
          return (
            <div key={f.key} hidden={activeFile !== f.key} className="space-y-2">
              <div
                className="relative rounded-lg border p-3 flex flex-wrap items-center gap-2 cursor-pointer transition-all"
                style={{
                  borderColor: cardBorderColor,
                  backgroundColor: charExtractFailed ? 'rgba(var(--color-error-rgb), 0.03)' : 'var(--color-panel)',
                  opacity: loading ? 0.6 : 1,
                }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = cardBorderColor}
                title={`${t('tip.clickView')} — ${f.desc}`}
              >
                <button type="button" aria-label={f.label}
                  className="absolute inset-0 rounded-lg cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
                  onClick={() => void openArchFile(f)} />
                {/* 状态图标 */}
                {generated
                  ? <CheckCircle2 size={16} style={{ flexShrink: 0, color: 'var(--color-success)' }} />
                  : <Circle size={16} style={{ flexShrink: 0, color: 'var(--color-text-muted)' }} />
                }

                {/* 图标 */}
                <span className="flex-shrink-0" style={{ color: generated ? 'var(--color-text-secondary)' : 'var(--color-text-muted)' }}>{renderIcon(f.iconName, 24)}</span>

                {/* 标题 + 描述 */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    {f.label}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                    {f.desc}
                  </div>
                </div>

                {/* 右侧状态标签 / 字数 / 提取按钮 */}
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  {generated ? (
                    <>
                      <span className="text-micro px-1.5 py-0.5 rounded font-medium bg-[rgba(var(--color-success-rgb),0.1)] text-[var(--color-success)]">
                        {t('status.generated')}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        {words.toLocaleString()} {t('unit.characters')}
                      </span>
                    </>
                  ) : (
                    <span
                      className="text-micro px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: 'rgba(var(--color-accent-rgb),0.1)', color: 'var(--color-accent)' }}
                    >
                      {t('status.pendingGen')}
                    </span>
                  )}
                  {/* 角色图谱已生成但角色卡为空时，显示重新提取按钮（带质感的警告色） */}
                  {isCharacters && generated && !loading && characterCount === 0 && (
                    <Button
                      size="sm"
                      disabled={extracting}
                      className="relative gap-1.5 mt-0.5 bg-gradient-to-r from-[var(--color-error)] to-[var(--color-warning)] text-white shadow-[var(--shadow-sm)] hover:brightness-90 border-none hover:shadow hover:-translate-y-[0.5px] transition-all"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleExtractCharacters()
                      }}
                      title={t('arch.charArchiveEmptyRetry')}
                    >
                      {extracting
                        ? <Spinner size={12} className="opacity-90" />
                        : <AlertTriangle size={12} className="opacity-90" />
                      }
                      {extracting ? t('arch.charExtracting') : t('arch.charExtractBtn')}
                    </Button>
                  )}
                  {/* 查看箭头提示 */}
                  {generated && !(isCharacters && !loading && characterCount === 0) && (
                    <span className="text-micro flex items-center gap-0.5" style={{ color: 'var(--color-text-muted)' }}>
                      <FileText size={10} /> {t('tip.clickView')}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      </FeatureSplit>

      {/* AI 生成架构确认弹窗 */}
      <ArchitectureConfirmDialog
        isOpen={showArchDialog}
        onClose={() => setShowArchDialog(false)}
        archStatus={archStatus}
        onConfirm={handleConfirm}
      />
    </div>
  )
}
