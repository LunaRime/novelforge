import ArchitectureDocumentList from './ArchitectureDocumentList'
import { toast } from '../ui/Toast'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Sparkles, RefreshCw, BookOpen, AlertTriangle } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useCharacterStore } from '../../stores/character-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useTranslation } from '../../hooks/useTranslation'
import type { TextKey } from '../../shared/locale'

import ArchitectureConfirmDialog from '../dialogs/ArchitectureConfirmDialog'

import { Button } from '../ui/Button'
import { confirm } from '../ui/Confirm'
import { EmptyState } from '../ui/EmptyState'
import { ArchitectureRequestCancelled, EditorOpenScopeChanged, type ArchitectureScope, type ArchitectureStep } from '../../core'
import { createRendererArchitectureOverviewApplication } from '../../services/architecture/architecture-adapter'
import { renderLog } from '../../services/render-logger'
import { globalEventBus } from '../../shared/event-bus'

type ArchStepKey = ArchitectureStep

type ArchFileItem = {
  key: ArchStepKey
  label: string
  iconName: string
  desc: string
}

function getArchFiles(t: (key: TextKey) => string): ArchFileItem[] {
  return [
    { key: 'premise', label: t('arch.storyPremise'), iconName: 'target', desc: t('arch.premiseFileDesc') },
    { key: 'characters', label: t('arch.characterMap'), iconName: 'users', desc: t('arch.characterFileDesc') },
    { key: 'worldbuilding', label: t('arch.worldBuilding'), iconName: 'globe', desc: t('arch.worldBuildingFileDesc') },
    { key: 'synopsis', label: t('arch.plotOutline'), iconName: 'map', desc: t('arch.synopsisFileDesc') },
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

  const openArchFile = async (key: ArchitectureStep, label: string) => {
    if (!active()) return
    try {
      const result = await application.open(key, label)
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

  const documents = archFiles.map(file => ({
    key: file.key,
    label: file.label,
    iconName: file.iconName,
    description: file.desc,
    generated: Boolean(archStatus[file.key]),
    wordCount: wordCounts[file.key] ?? 0,
    extractionFailed: file.key === 'characters' && charExtractStatus?.allCriticalPassed === false,
    canExtract: file.key === 'characters' && Boolean(archStatus[file.key]) && !loading && characterCount === 0,
  }))

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 border-b border-[var(--color-border)] px-3 py-1">
        <Button type="button" variant="ghost" size="icon" className="size-8" onClick={loadStatus}
          title={t('tip.refreshStatus')} aria-label={t('tip.refreshStatus')}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} aria-hidden="true" />
        </Button>
        <Button type="button" variant="ai" size="sm" onClick={() => setShowArchDialog(true)} title={t('tip.regenerateArch')}>
          <Sparkles size={12} aria-hidden="true" /> {t('arch.aiGenBtn')}
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {loadFailed && (
          <div role="alert" className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--color-error)] px-3 py-2 text-xs text-[var(--color-error)]">
            <AlertTriangle size={14} aria-hidden="true" />
            <span>{t('common.loadFailed')}</span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void loadStatus()}>{t('action.retry')}</Button>
          </div>
        )}
        <ArchitectureDocumentList documents={documents} loading={loading} extracting={extracting}
          onOpen={(key, label) => void openArchFile(key, label)}
          onCopy={key => { void navigator.clipboard.writeText(`vela://core/${key}`).catch(() => {}) }}
          onExtract={() => void handleExtractCharacters()} />
      </div>

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
