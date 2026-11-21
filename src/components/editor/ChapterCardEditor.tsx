import { CreateIcon } from '../ui/ActionIcons'
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Save, BookOpen, RefreshCw, Sparkles, PenLine, ScanSearch, X, ListChecks
} from 'lucide-react'
import { Spinner } from '../ui/Spinner'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useVolumeStore } from '../../stores/volume-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useTranslation } from '../../hooks/useTranslation'
import type { ChapterBlueprint } from '../../services/workflows/directory-workflow'
import { ChapterBlueprintRequestCancelled, remapCharacterNameList, WorkflowStartError, type ChapterBlueprintScope, type WorkflowStartRequest } from '../../core'
import { createRendererChapterBlueprintApplication, readChapterBlueprintSnapshot } from '../../services/chapters/chapter-blueprint-adapter'
import { belongsToWorkflowSource } from '../../services/workflows/workflow-source'
import { startWorkflow as startApplicationWorkflow } from '../../services/workflows/start-workflow'
import { generateVerificationReport, type VerificationReport } from '../../services/blueprint-verification-service'
import DirectoryConfigDialog from '../dialogs/DirectoryConfigDialog'
import BlueprintSortBar from './BlueprintSortBar'
import { BlueprintDetail, BlueprintList } from './BlueprintViews'
import { useBlueprintSortStore } from '../../stores/blueprint-sort-store'
import { Button } from '../ui/Button'
import CountBadge from '../ui/CountBadge'
import EditorPageHeader from '../ui/EditorPageHeader'
import { FeatureSplit } from '../ui/FeatureSplit'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import { renderLog } from '../../services/render-logger'
import { globalEventBus } from '../../shared/event-bus'

/** 章节蓝图编辑器 — 读写 directory.json */
export default function ChapterCardEditor() {
  const project = useProjectStore(s => s.currentProject)
  const session = useProjectStore(s => s.projectSession)
  const { t } = useTranslation()
  if (!project) return <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40"><BookOpen size={36} /><span className="text-sm">{t('empty.pleaseOpenProject')}</span></div>
  return <ChapterCardContent key={`${project.id}:${project.path}:${session}`} source={{ id: project.id, path: project.path, session }} />
}

function ChapterCardContent({ source }: { source: ChapterBlueprintScope }) {
  const { t } = useTranslation()
  const currentProject = useProjectStore(s => s.currentProject)
  const [application] = useState(() => createRendererChapterBlueprintApplication(source))
  const mounted = useRef(true)
  const lifetime = useRef({ generation: 0 })
  const loadRequest = useRef(0)
  const editVersion = useRef(0)
  const saveBusy = useRef(false)
  const deleteBusy = useRef(false)
  const blueprintStartBusy = useRef(false)
  const rows = useRef<ChapterBlueprint[]>([])
  const dirtyRows = useRef(new Set<ChapterBlueprint>())
  const active = useCallback(() => {
    if (!mounted.current) return false
    try { application.assertCurrent(); return true } catch { return false }
  }, [application])
  const addLog = useWorkflowStore.getState().addLog
  const volumes = useVolumeStore(s => s.volumes)
  const loadVolumes = useVolumeStore(s => s.load)
  const [blueprints, setBlueprints] = useState<ChapterBlueprint[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [detailOpen, setDetailOpen] = useState(false)
  const saveConfirmation = useRef(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [nextWriteChapter, setNextWriteChapter] = useState<number | null>(null)
  const [showBlueprintDialog, setShowBlueprintDialog] = useState(false)
  const [startingBlueprint, setStartingBlueprint] = useState(false)
  const [verificationReport, setVerificationReport] = useState<VerificationReport | null>(null)
  const [verifying, setVerifying] = useState(false)
  const verifyRequest = useRef(0)
  const publishRows = useCallback((next: ChapterBlueprint[]) => { rows.current = next; setBlueprints(next) }, [])

  useEffect(() => {
    mounted.current = true
    const lifecycle = lifetime.current; const generation = ++lifecycle.generation
    return () => {
      mounted.current = false
      queueMicrotask(() => {
        if (!mounted.current && lifecycle.generation === generation) application.dispose()
      })
    }
  }, [application])
  useEffect(() => {
    queueMicrotask(() => { if (active()) void loadVolumes().catch(error => renderLog('error', 'Load:BlueprintVolumes', String(error))) })
  }, [loadVolumes, active])

  const loadBlueprints = useCallback(async (manual = false) => {
    if (!active() || saveBusy.current || deleteBusy.current) return
    const request = ++loadRequest.current
    const editing = editVersion.current
    try {
      if (dirtyRows.current.size) {
        if (!manual || !await confirm(t('editor.refreshConfirm'), { title: t('dialog.unsavedTitle') })) return
      }
      if (!active() || request !== loadRequest.current || editing !== editVersion.current || saveBusy.current) return
      setLoading(true)
      const result = await application.load(useBlueprintSortStore.getState().config)
      if (!active() || request !== loadRequest.current || editing !== editVersion.current || saveBusy.current) return
      publishRows(result.blueprints); dirtyRows.current.clear()
      setDirty(false); setLoadFailed(false); setSelectedIdx(0); setNextWriteChapter(result.nextWriteChapter)
    } catch (error) {
      if (!active() || request !== loadRequest.current || error instanceof ChapterBlueprintRequestCancelled) return
      setLoadFailed(true); renderLog('error', 'Load:Blueprint', String(error))
    } finally {
      if (active() && request === loadRequest.current) setLoading(false)
    }
  }, [application, active, publishRows, t])
  useEffect(() => { queueMicrotask(() => { if (active()) void loadBlueprints() }) }, [loadBlueprints, active])

  useEffect(() => globalEventBus.on('REFRESH_RESOURCE', ({ characterMerge }) => {
    if (!characterMerge || !active()) return
    verifyRequest.current++
    setVerifying(false)
    setVerificationReport(null)
    if (rows.current.length === 0) {
      void loadBlueprints()
      return
    }
    const names = new Map([[characterMerge.sourceName, characterMerge.targetName]])
    loadRequest.current++
    setLoading(false)
    publishRows(rows.current.map(row => {
      const characters = remapCharacterNameList(row.characters, names)
      if (characters === row.characters) return row
      const next = { ...row, characters }
      if (dirtyRows.current.delete(row)) dirtyRows.current.add(next)
      return next
    }))
  }), [active, loadBlueprints, publishRows])

  const runVerify = useCallback(async () => {
    if (!active() || !currentProject || saveBusy.current || deleteBusy.current) return
    const request = ++verifyRequest.current
    const totalChapters = currentProject.novelConfig.totalChapters
    setVerifying(true)
    try {
      const latest = await readChapterBlueprintSnapshot(source)
      if (!active() || request !== verifyRequest.current) return
      const report = await generateVerificationReport(totalChapters, latest)
      if (active() && request === verifyRequest.current) setVerificationReport(report)
    } catch (error) {
      if (!active() || request !== verifyRequest.current || error instanceof ChapterBlueprintRequestCancelled) return
      toast.error(t('verify.verifyFailed').replace('{error}', String(error)))
    } finally {
      if (active() && request === verifyRequest.current) setVerifying(false)
    }
  }, [active, currentProject, source, t])
  useEffect(() => globalEventBus.on('WORKFLOW_COMPLETE', payload => {
    if (!active() || (payload.runId && !belongsToWorkflowSource(payload.runId, source))) return
    if (payload.type === 'directory') void loadBlueprints()
    if (payload.type === 'post_process' && payload.status !== 'failed') {
      const state = useWorkflowStore.getState()
      const run = [...state.activeRuns, ...state.history].find(item => item.id === payload.runId)
      if (run?.rehydrateParams?.__subflow === 'gap_fill') { void loadBlueprints(); void runVerify() }
    }
  }), [active, source, loadBlueprints, runVerify])

  const selected = blueprints[selectedIdx] ?? null
  const nextWriteBlueprint = nextWriteChapter !== null ? blueprints.find(b => b.chapterNumber === nextWriteChapter) : null

  const updateField = <K extends keyof ChapterBlueprint>(key: K, value: ChapterBlueprint[K]) => {
    if (!active() || deleteBusy.current) return
    const previous = rows.current[selectedIdx]
    if (!previous) return
    const next = { ...previous, [key]: value }
    dirtyRows.current.delete(previous); dirtyRows.current.add(next)
    publishRows(rows.current.map((row, index) => index === selectedIdx ? next : row))
    editVersion.current++; loadRequest.current++; setLoading(false); setDirty(true)
  }

  const saveRows = async (submitted: ChapterBlueprint[], batch: boolean, manual = true, clearSubmitted = true) => {
    if (!active() || saveBusy.current || deleteBusy.current) return
    saveBusy.current = true; loadRequest.current++; setLoading(false); setSaving(true)
    verifyRequest.current++; setVerifying(false)
    const started = Date.now()
    try {
      const receipt = batch ? await application.saveAll(submitted) : await application.saveOne(submitted[0])
      if (!active()) return
      setVerificationReport(null)
      if (clearSubmitted) for (const row of submitted) dirtyRows.current.delete(row)
      setDirty(dirtyRows.current.size > 0)
      const message = batch
        ? t('log.render.blueprintSaveAllSuccess').replace('{count}', String(submitted.length))
        : t('log.render.blueprintSaveSuccess').replace('{num}', String(submitted[0].chapterNumber))
      renderLog(manual ? 'info' : 'debug', 'Save:Blueprint', message.replace('{ms}', String(Date.now() - started)))
      if (manual) toast.success(t('save.success'))
      if (receipt.refreshError) { renderLog('error', 'Refresh:Blueprint', receipt.refreshError); toast.error(t('common.loadFailed')) }
    } catch (error) {
      if (!active() || error instanceof ChapterBlueprintRequestCancelled) return
      const message = batch ? t('log.render.blueprintSaveAllFailed') : t('log.render.blueprintSaveFailed').replace('{num}', String(submitted[0].chapterNumber))
      renderLog('error', 'Save:Blueprint', message.replace('{error}', () => String(error)))
      toast.error(t('save.failed').replace('{error}', () => String(error)))
    } finally {
      saveBusy.current = false
      if (active()) setSaving(false)
    }
  }
  const confirmSave = async (submitted: ChapterBlueprint[], batch: boolean) => {
    if (!submitted.length || !active() || saveConfirmation.current || saveBusy.current || deleteBusy.current) return
    const caption = t(batch ? 'chapter.saveAll' : 'chapter.save')
    const preview = submitted.map(row =>
      t('chapter.label').replace('{n}', String(row.chapterNumber)) + (row.title ? ` ${row.title}` : ''))
    saveConfirmation.current = true
    try {
      const ok = await confirm(t('blueprint.confirmSaveScope').replace('{chapters}', () => preview.join('\n')), {
        title: caption, confirmText: caption,
      })
      if (!ok || !active()) return
      if (!submitted.every(row => rows.current.includes(row))) {
        toast.warning(t('blueprint.saveScopeChanged'))
        return
      }
      await saveRows(submitted, batch)
    } finally {
      saveConfirmation.current = false
    }
  }
  const handleSaveOne = () => { if (selected) void confirmSave([selected], false) }
  const handleSaveAll = () => void confirmSave(rows.current.filter(row => dirtyRows.current.has(row)), true)

  const handleAddChapter = async () => {
    if (!active() || saveBusy.current || deleteBusy.current || loadFailed) return
    const maxNum = rows.current.reduce((max, row) => Math.max(max, row.chapterNumber), 0)
    const newBlueprint: ChapterBlueprint = {
      chapterNumber: maxNum + 1, title: '', role: '发展', purpose: '', keyEvents: '', characters: [],
      suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: '', sortOrder: maxNum + 1, priority: 0,
    }
    dirtyRows.current.add(newBlueprint)
    publishRows([...rows.current, newBlueprint]); setSelectedIdx(rows.current.length - 1); setDetailOpen(true)
    editVersion.current++; loadRequest.current++; setDirty(true)
    await saveRows([newBlueprint], false, false, false)
  }

  const handleDeleteChapter = async () => {
    if (!selected || !active() || saveBusy.current || deleteBusy.current) return
    const target = selected
    const ok = await confirm(t('chapter.confirmDeleteMsg').replace('{n}', String(target.chapterNumber)), {
      title: t('chapter.confirmDeleteTitle'), confirmText: t('chapter.confirmDelete'), danger: true,
    })
    if (!ok || !active() || saveBusy.current || deleteBusy.current || !rows.current.includes(target)) return
    deleteBusy.current = true; setDeleting(true)
    loadRequest.current++; editVersion.current++; setLoading(false)
    verifyRequest.current++; setVerifying(false)
    try {
      await application.deleteOne(target.chapterNumber)
      if (!active()) return
      setVerificationReport(null)
      const previous = rows.current
      const next = previous.filter(row => row.chapterNumber !== target.chapterNumber)
      for (const row of previous) if (row.chapterNumber === target.chapterNumber) dirtyRows.current.delete(row)
      publishRows(next)
      editVersion.current++; loadRequest.current++; setLoading(false)
      setSelectedIdx(index => {
        const survivingIndex = next.indexOf(previous[index])
        return survivingIndex >= 0 ? survivingIndex : Math.max(0, Math.min(index, next.length - 1))
      })
      setDirty(dirtyRows.current.size > 0)
      const message = t('chapterCard.deleteSuccess').replace('{n}', String(target.chapterNumber))
      renderLog('info', 'Delete:Blueprint', message)
      toast.success(message)
      globalEventBus.emit('REFRESH_RESOURCE', { resources: ['blueprints'] })
    } catch (error) {
      if (active()) {
        const message = t('chapterCard.deleteFailed').replace('{n}', String(target.chapterNumber)).replace('{error}', () => error instanceof Error ? error.message : String(error))
        renderLog('error', 'Delete:Blueprint', message)
        toast.error(message)
      }
    } finally {
      deleteBusy.current = false
      if (active()) setDeleting(false)
    }
  }

  const startBlueprint = async (request: Extract<WorkflowStartRequest, { workflow: 'generate_blueprint' | 'fill_blueprint_gaps' }>) => {
    if (!active() || blueprintStartBusy.current) return
    blueprintStartBusy.current = true; setStartingBlueprint(true)
    try {
      await startApplicationWorkflow(request, {
        isCallerCurrent: active,
        confirmBlueprintWarning: async message => active() && await confirm(`${message}\n\n${t('chapter.continueAnyway')}`, {
          title: t('chapter.warningTitle'), confirmText: t('chapter.continue'),
        }) && active(),
      })
      if (active() && request.workflow === 'generate_blueprint') {
        addLog('info', t('blueprintGen.submitted'))
        toast.info(t('blueprintGen.submitted'))
      }
    } catch (error) {
      if (!active() || (error instanceof WorkflowStartError && error.code === 'ERR_CANCELLED')) return
      const message = error instanceof Error ? error.message : String(error)
      if (request.workflow === 'generate_blueprint') {
        addLog('error', message)
        const feedback = t('blueprint.cannotGenerate').replace('{message}', () => message)
        if (error instanceof WorkflowStartError && error.code === 'ERR_GUARD') toast.warning(feedback)
        else toast.error(feedback)
      } else toast.error(message)
    } finally {
      blueprintStartBusy.current = false
      if (active()) setStartingBlueprint(false)
    }
  }

  /** 整本流水线：逐章 写稿→审查→定稿→KB/记忆（应用级入口，不依赖 Agent） */
  const handleRunBookPipeline = async () => {
    if (!active()) return
    if (useWorkflowStore.getState().isTypeRunning('book_pipeline')) {
      toast.warning(t('chapter.bookPipelineRunning'))
      return
    }
    const configured = currentProject?.novelConfig.totalChapters ?? 0
    const maxBlueprint = blueprints.reduce((max, bp) => Math.max(max, bp.chapterNumber), 0)
    const end = Math.max(configured, maxBlueprint)
    if (end < 1) {
      toast.warning(t('chapter.bookPipelineNoBlueprint'))
      return
    }
    try {
      await startApplicationWorkflow({ workflow: 'generate_book', chapterStart: 1, chapterEnd: end, autoReview: true })
      if (!active()) return
      toast.success(t('chapter.bookPipelineStarted').replace('{n}', String(end)))
    } catch (e) {
      if (!active()) return
      toast.error(t('chapter.bookPipelineFailed').replace('{error}', e instanceof Error ? e.message : String(e)))
    }
  }

  /**
   * 写作此章 — 将当前蓝图信息注入创作弹窗
   * 支持指定章节（默认为当前选中章）
   */
  const handleWriteChapter = (bp: ChapterBlueprint) => {
    if (!active()) return
    // 通过 layout-store openChapterCreation 传递预填参数，替代 window.dispatchEvent
    useLayoutStore.getState().openChapterCreation({
      chapterNumber: bp.chapterNumber,
      title: bp.title,
      role: bp.role,
      purpose: bp.purpose,
      keyEvents: bp.keyEvents,
      characters: bp.characters.join('、'),
      userGuidance: bp.userGuidance || '',
    })
  }

  if (loading && !blueprints.length && !loadFailed) {
    return (
      <div className="flex items-center justify-center h-full gap-2" style={{ color: 'var(--color-text-muted)' }}>
        <Spinner size={16}  /> {t('chapterCard.loadingBlueprints')}
      </div>
    )
  }

  if (!currentProject) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
        <BookOpen size={36} />
        <span className="text-sm">{t('empty.pleaseOpenProject')}</span>
      </div>
    )
  }

  return (
    <div className="@container h-full flex flex-col overflow-hidden">
      {/* 顶部工具栏 */}
      <EditorPageHeader
        className="gap-y-2.5 px-4 py-2.5"
        actionsClassName="w-full justify-between gap-x-3 gap-y-2 border-t border-[var(--color-border)] pt-2"
        icon={<BookOpen size={13} />}
        title={t('chapter.blueprintTitle')}
        meta={(
          <>
            <CountBadge value={blueprints.length} unit={t('unit.chapters')} />
            {dirty && <span className="text-micro" style={{ color: 'var(--color-accent)' }}>{t('blueprint.unsaved')}</span>}
          </>
        )}
        actions={(
          <>
          <div className="flex flex-wrap items-center gap-1.5 [&_button]:h-8">
            <BlueprintSortBar />
            {dirty && (
              <Button variant="outline" size="sm" onClick={handleSaveAll} disabled={saving || deleting}>
                <Save size={12} /> {saving ? t('chapter.saving') : t('chapter.saveAll')}
              </Button>
            )}
            {/* 写作入口 — 仅下一章可写且存在对应蓝图时显示 */}
            {nextWriteBlueprint && selected !== nextWriteBlueprint && (
              <Button
                variant="ai"
                size="sm"
                onClick={() => handleWriteChapter(nextWriteBlueprint)}
              >
                <PenLine size={12} />
                {t('chapter.writeChapterN').replace('{n}', String(nextWriteChapter))}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 [&_button]:h-8">
            {/* 线③ 第 5 条：蓝图校检按钮 */}
            <Button
              variant="ghost"
              size="sm"
              onClick={runVerify}
              disabled={verifying || saving || deleting}
              title={t('verify.title')}
            >
              <ScanSearch size={12} className={verifying ? 'animate-pulse' : ''} />
              {verifying ? t('verify.verifying') : t('verify.title')}
            </Button>
            {/* 整本流水线：应用级入口，任何模型/新会话都可继续 */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRunBookPipeline}
              title={t('chapter.bookPipelineTip')}
            >
              <ListChecks size={12} />
              {t('chapter.bookPipeline')}
            </Button>
            {/* AI 生成蓝图 → 弹出 DirectoryConfigDialog */}
            <Button
              variant="ai"
              size="sm"
              onClick={() => setShowBlueprintDialog(true)}
              disabled={startingBlueprint}
              title={t('chapter.aiBlueprint')}
            >
              <Sparkles size={12} />
              {t('blueprint.aiGenerate')}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => void loadBlueprints(true)} title={t('chapter.reload')} aria-label={t('chapter.reload')} disabled={loading || saving || deleting}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleAddChapter} title={t('chapter.newChapter')} aria-label={t('chapter.newChapter')} disabled={saving || deleting || loadFailed}>
              <CreateIcon size={14} />
            </Button>
          </div>
          </>
        )}
      />

      {loadFailed && (
        <div role="alert" className="flex items-center gap-2 border-b px-3 py-2 text-xs" style={{ borderColor: 'var(--color-error)', color: 'var(--color-error)' }}>
          <span>{t('common.loadFailed')}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void loadBlueprints(true)}>{t('action.retry')}</Button>
        </div>
      )}

      {/* 线③ 第 5 条：校检报告（缺口列表 + 逐处补全） */}
      {verificationReport && (
        <div
          className="px-3 py-2 border-b space-y-1.5"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-elevated)' }}
        >
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
            <ScanSearch size={12} />
            <span className="font-medium">{verificationReport.summary}</span>
            <button
              onClick={() => setVerificationReport(null)}
              className="ml-auto opacity-50 hover:opacity-100"
              style={{ color: 'var(--color-text-muted)' }}
              aria-label={t('action.cancel')}
            >
              <X size={12} />
            </button>
          </div>
          {verificationReport.gaps.length > 0 && (
            <div className="space-y-1">
              {verificationReport.gaps.map((gap, i) => {
                const first = gap.missingChapterNumbers[0]
                const last = gap.missingChapterNumbers[gap.missingChapterNumbers.length - 1]
                const label = first === last ? String(first) : `${first}–${last}`
                return (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span style={{ color: 'var(--color-warning)' }}>
                      {t('verify.missingChapter').replace('{n}', label)}
                    </span>
                    <span style={{ color: 'var(--color-text-muted)' }}>
                      {t('verify.chapterFormat').replace('{n}', String(gap.gapSize))}
                    </span>
                    <Button variant="outline" size="sm" disabled={startingBlueprint} onClick={() => void startBlueprint({ workflow: 'fill_blueprint_gaps', gaps: [gap] })}>
                      {t('verify.fill')}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
          {verificationReport.inconsistentRoles.length > 0 && (
            <div className="text-xs space-y-0.5" style={{ color: 'var(--color-warning)' }}>
              {verificationReport.inconsistentRoles.map((r, i) => (
                <div key={i}>
                  {t('verify.roleChapter').replace('{n}', String(r.chapter)).replace('{role}', r.role).replace('{expectedRole}', r.expectedRole)}
                </div>
              ))}
            </div>
          )}
          {verificationReport.gaps.length === 0 && verificationReport.inconsistentRoles.length === 0 && verificationReport.missingTitles.length === 0 && (
            <div className="text-xs" style={{ color: 'var(--color-success)' }}>
              {t('verification.ok')}
            </div>
          )}
        </div>
      )}

      {/* 蓝图生成配置弹窗 */}
      <DirectoryConfigDialog
        isOpen={showBlueprintDialog}
        onClose={() => setShowBlueprintDialog(false)}
        existingCount={blueprints.length}
        onConfirm={directory => void startBlueprint({ workflow: 'generate_blueprint', directory })}
      />

      <FeatureSplit detailOpen={detailOpen} onBack={() => setDetailOpen(false)} list={
        <BlueprintList blueprints={blueprints} volumes={volumes} selectedIdx={selectedIdx} loadFailed={loadFailed}
          onSelect={index => { setSelectedIdx(index); setDetailOpen(true) }} />
      }>
        <BlueprintDetail selected={selected} canWrite={selected !== null && selected === nextWriteBlueprint}
          saving={saving} deleting={deleting} updateField={updateField}
          onWrite={() => { if (selected) handleWriteChapter(selected) }}
          onSave={handleSaveOne} onDelete={handleDeleteChapter} />
      </FeatureSplit>
    </div>
  )
}
