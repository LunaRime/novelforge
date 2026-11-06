import { useState, useEffect, useCallback, useRef } from 'react'
import { getCurrentLocale, type TextKey } from '../../shared/locale'
import {
  Save, BookOpen, RefreshCw, Plus, Trash2,
  Sparkles, PenLine, ScanSearch, X, ListChecks
} from 'lucide-react'
import { Spinner } from '../ui/Spinner'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useVolumeStore } from '../../stores/volume-store'
import { useLayoutStore } from '../../stores/layout-store'
import { ipc } from '../../services/ipc-client'
import { useTranslation } from '../../hooks/useTranslation'
import type { ChapterBlueprint, DirectoryWorkflowParams } from '../../services/workflows/directory-workflow'
import { ChapterBlueprintRequestCancelled, type ChapterBlueprintScope } from '../../core'
import { createRendererChapterBlueprintApplication } from '../../services/chapters/chapter-blueprint-adapter'
import { belongsToWorkflowSource } from '../../services/workflows/workflow-source'
import { guardDirectoryGeneration } from '../../services/workflows/workflow-guards'
import { startWorkflow as startApplicationWorkflow } from '../../services/workflows/start-workflow'
import { generateVerificationReport, type VerificationReport, type BlueprintGap } from '../../services/blueprint-verification-service'
import DirectoryConfigDialog from '../dialogs/DirectoryConfigDialog'
import BlueprintSortBar from './BlueprintSortBar'
import { useBlueprintSortStore } from '../../stores/blueprint-sort-store'
import { Button } from '../ui/Button'
import CountBadge from '../ui/CountBadge'
import EditorPageHeader from '../ui/EditorPageHeader'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { Label } from '../ui/Label'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../ui/Select'
import { cn } from '../../lib/utils'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import { renderLog } from '../../services/render-logger'
import { globalEventBus } from '../../shared/event-bus'

const ROLES = ['建置', '铺垫', '发展', '冲突', '高潮', '转折', '收尾']

/** 章节角色 value（中文数据，存库兼容）→ i18n key（下拉显示时 t()） */
const ROLE_LABEL_KEYS: Record<string, TextKey> = {
  '建置': 'chapter.role.establishment',
  '铺垫': 'chapter.role.setup',
  '发展': 'chapter.role.development',
  '冲突': 'chapter.role.conflict',
  '高潮': 'chapter.role.climax',
  '转折': 'chapter.role.twist',
  '收尾': 'chapter.role.resolution',
}

const ROLE_COLORS: Record<string, string> = {
  高潮: 'bg-[rgba(var(--color-error-rgb),0.2)] text-[var(--color-error)]',
  冲突: 'bg-[rgba(var(--color-warning-rgb),0.2)] text-[var(--color-warning)]',
  转折: 'bg-[rgba(var(--color-accent-rgb),0.2)] text-[var(--color-accent)]',
  建置: 'bg-[rgba(var(--color-info-rgb),0.2)] text-[var(--color-info)]',
  收尾: 'bg-[rgba(var(--color-success-rgb),0.2)] text-[var(--color-success)]',
}

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
  const [verificationReader] = useState(() => createRendererChapterBlueprintApplication(source))
  const mounted = useRef(true)
  const lifetime = useRef({ generation: 0 })
  const loadRequest = useRef(0)
  const editVersion = useRef(0)
  const saveBusy = useRef(false)
  const deleteBusy = useRef(false)
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
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [nextWriteChapter, setNextWriteChapter] = useState<number | null>(null)
  const [showBlueprintDialog, setShowBlueprintDialog] = useState(false)
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
        if (!mounted.current && lifecycle.generation === generation) { application.dispose(); verificationReader.dispose() }
      })
    }
  }, [application, verificationReader])
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

  const runVerify = useCallback(async () => {
    if (!active() || !currentProject) return
    const request = ++verifyRequest.current
    const totalChapters = currentProject.novelConfig.totalChapters
    setVerifying(true)
    try {
      const latest = await verificationReader.load({ key: 'chapter_number', direction: 'asc' })
      if (!active() || request !== verifyRequest.current) return
      const report = await generateVerificationReport(totalChapters, latest.blueprints)
      if (active() && request === verifyRequest.current) setVerificationReport(report)
    } catch (error) {
      if (!active() || request !== verifyRequest.current || error instanceof ChapterBlueprintRequestCancelled) return
      toast.error(t('verify.verifyFailed').replace('{error}', String(error)))
    } finally {
      if (active() && request === verifyRequest.current) setVerifying(false)
    }
  }, [active, currentProject, verificationReader, t])
  useEffect(() => globalEventBus.on('WORKFLOW_COMPLETE', payload => {
    if (!active() || (payload.runId && !belongsToWorkflowSource(payload.runId, source))) return
    if (payload.type === 'directory') void loadBlueprints()
    if (payload.type === 'post_process' && payload.status !== 'failed') {
      const state = useWorkflowStore.getState()
      const run = [...state.activeRuns, ...state.history].find(item => item.id === payload.runId)
      if (run?.rehydrateParams?.__subflow === 'gap_fill') { void loadBlueprints(); void runVerify() }
    }
  }), [active, source, loadBlueprints, runVerify])

  const handleFillGap = async (gap: BlueprintGap) => {
    if (!active()) return
    try { await startApplicationWorkflow({ workflow: 'fill_blueprint_gaps', gaps: [gap] }) }
    catch (error) { if (active()) toast.error(String(error)) }
  }
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
    const started = Date.now()
    try {
      const receipt = batch ? await application.saveAll(submitted) : await application.saveOne(submitted[0])
      if (!active()) return
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
  const handleSaveOne = () => { if (selected) return saveRows([selected], false) }
  const handleSaveAll = () => saveRows([...rows.current], true)

  const handleAddChapter = async () => {
    if (!active() || saveBusy.current || deleteBusy.current || loadFailed) return
    const maxNum = rows.current.reduce((max, row) => Math.max(max, row.chapterNumber), 0)
    const newBlueprint: ChapterBlueprint = {
      chapterNumber: maxNum + 1, title: '', role: '发展', purpose: '', keyEvents: '', characters: [],
      suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: '', sortOrder: maxNum + 1, priority: 0,
    }
    dirtyRows.current.add(newBlueprint)
    publishRows([...rows.current, newBlueprint]); setSelectedIdx(rows.current.length - 1)
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
    try {
      const result = await ipc.invoke('db:blueprint-delete', target.chapterNumber)
      if (!active()) return
      if (!result.success) {
        addLog('error', t('chapterCard.deleteFailed').replace('{n}', String(target.chapterNumber)).replace('{error}', result.error || t('status.unknown')))
        return
      }
      const next = rows.current.filter(row => row.chapterNumber !== target.chapterNumber)
      for (const row of rows.current) if (row.chapterNumber === target.chapterNumber) dirtyRows.current.delete(row)
      publishRows(next)
      editVersion.current++; loadRequest.current++; setLoading(false)
      setSelectedIdx(index => Math.max(0, Math.min(index, next.length - 1))); setDirty(dirtyRows.current.size > 0)
      addLog('info', `Blueprint Ch.${target.chapterNumber} deleted`)
    } catch (error) {
      if (active()) addLog('error', t('chapterCard.deleteError').replace('{n}', String(target.chapterNumber)).replace('{error}', String(error)))
    } finally {
      deleteBusy.current = false
      if (active()) setDeleting(false)
    }
  }

  /** 触发蓝图批量生成（来自 DirectoryConfigDialog 的确认回调） */
  const handleBatchGenerate = async (params: DirectoryWorkflowParams) => {
    if (!currentProject || !active()) return

    // 前置校验：故事架构是否就绪
    const guard = await guardDirectoryGeneration()
    if (!active()) return
    if (!guard.ok) {
      // 校验失败：阻断并提示
      addLog('error', `Guard failed: ${guard.message}`)
      toast.warning(t('blueprint.cannotGenerate').replace('{message}', guard.message || ''))
      return
    }
    if (guard.message) {
      // 有警告但允许继续：弹出确认
      const yes = await confirm(`${guard.message}\n\n${t('chapter.continueAnyway')}`, {
        title: t('chapter.warningTitle'),
        confirmText: t('chapter.continue'),
      })
      if (!yes || !active()) return
    }

    try { await startApplicationWorkflow({ workflow: 'generate_blueprint', directory: params }) }
    catch (error) { if (active()) toast.error(String(error)); return }
    if (!active()) return
    addLog('info', 'Blueprint generation started')
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
    <div className="h-full flex flex-col overflow-hidden">
      {/* 顶部工具栏 */}
      <EditorPageHeader
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
          {/* 写作入口 — 仅下一章可写且存在对应蓝图时显示 */}
          {nextWriteBlueprint && (
            <Button
              variant="ai"
              size="sm"
              onClick={() => handleWriteChapter(nextWriteBlueprint)}
            >
              <PenLine size={12} />
              {t('chapter.writeChapterN').replace('{n}', String(nextWriteChapter))}
            </Button>
          )}
          {/* 排序工具栏 */}
          <BlueprintSortBar />
          {/* 线③ 第 5 条：蓝图校检按钮 */}
          <Button
            variant="ghost"
            size="sm"
            onClick={runVerify}
            disabled={verifying}
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
            title={t('chapter.aiBlueprint')}
          >
            <Sparkles size={12} />
            {t('blueprint.aiGenerate')}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => void loadBlueprints(true)} title={t('chapter.reload')} disabled={loading || saving || deleting}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleAddChapter} title={t('chapter.newChapter')} disabled={saving || deleting || loadFailed}>
            <Plus size={14} />
          </Button>
          {dirty && (
            <Button variant="outline" size="sm" onClick={handleSaveAll} disabled={saving || deleting}>
              <Save size={12} /> {saving ? t('chapter.saving') : t('chapter.saveAll')}
            </Button>
          )}
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
                    <Button variant="outline" size="sm" onClick={() => handleFillGap(gap)}>
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
        onConfirm={handleBatchGenerate}
      />

      {/* 主区域：左侧列表 + 右侧编辑 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧章节列表 */}
        <div
          className="flex flex-col flex-shrink-0 w-[200px] border-r overflow-hidden"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-sidebar)' }}
        >
          {blueprints.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 opacity-40 p-4">
              <BookOpen size={36} />
              <span className="text-xs text-center">{t(loadFailed ? 'common.loadFailed' : 'blueprint.emptyHint')}</span>
            </div>
          ) : (
          <div className="flex-1 overflow-y-auto p-1">
            {blueprints.map((bp, idx) => (
              <div
                key={bp.chapterNumber}
                className={cn(
                  'group relative px-2.5 py-2 rounded-md text-xs cursor-pointer mb-0.5 transition-colors',
                  selectedIdx === idx
                    ? 'bg-[var(--color-active)] text-[var(--color-text)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'
                )}
                onClick={() => setSelectedIdx(idx)}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-micro opacity-40 flex-shrink-0">
                    {bp.chapterNumber}
                  </span>
                  <span className="font-medium truncate flex-1">{bp.title || t('character.unnamed')}</span>
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  {(() => {
                    const vol = volumes.find(v =>
                      v.chapterStart <= bp.chapterNumber &&
                      (v.chapterEnd === 0 || bp.chapterNumber <= v.chapterEnd))
                    return vol ? (
                      <span
                        className="text-micro px-1 py-0.5 rounded"
                        style={{ backgroundColor: 'rgba(var(--color-accent-rgb), 0.12)', color: 'var(--color-accent)' }}
                        title={vol.title || undefined}
                      >
                        {t('volume.ordinal').replace('{n}', String(vol.volumeNumber))}
                      </span>
                    ) : null
                  })()}
                  <span className={cn(
                    'text-micro px-1 py-0.5 rounded',
                    ROLE_COLORS[bp.role] || 'bg-[var(--color-hover)] text-[var(--color-text-muted)]'
                  )}>
                    {t(ROLE_LABEL_KEYS[bp.role] ?? 'chapter.role.development')}
                  </span>
                  {bp.userGuidance && (
                    <span
                      className="text-micro px-1 py-0.5 rounded"
                      style={{ backgroundColor: 'rgba(var(--color-accent-rgb), 0.15)', color: 'var(--color-accent)' }}
                      title={t('chapter.authorGuidance')}
                    >
                      {t('chapter.hasGuidance')}
                    </span>
                  )}
                  {bp.notes && (
                    <span
                      className="text-micro px-1 py-0.5 rounded"
                      style={{ backgroundColor: 'rgba(var(--color-success-rgb), 0.15)', color: 'var(--color-success)' }}
                      title={t('chapter.blueprintNotes')}
                    >
                      {t('chapter.hasNotes')}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          )}
        </div>

        {/* 右侧编辑区 */}
        <div className="flex-1 overflow-y-auto">
          {selected ? (
            <fieldset className="min-w-0 max-w-2xl mx-auto px-5 py-4" disabled={deleting}>
              {/* 编辑区头部 */}
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
                  {t('import.chapterLabel').replace('{n}', String(selected.chapterNumber)).replace('{title}', selected.title || t('chapter.unnamed'))}
                </h3>
                <div className="flex items-center gap-1.5">
                  {/* 仅下一章允许写作 */}
                  {nextWriteBlueprint && selected === nextWriteBlueprint && (
                    <Button
                      variant="ai"
                      size="sm"
                      onClick={() => handleWriteChapter(selected)}
                      title={t('chapter.generateDraft')}
                    >
                      <PenLine size={12} /> {t('chapter.writeThisChapter')}
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={handleDeleteChapter} title={t('chapter.deleteChapter')} disabled={saving || deleting}>
                    <Trash2 size={13} style={{ color: 'var(--color-text-muted)' }} />
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleSaveOne} disabled={saving || deleting}>
                    <Save size={12} /> {saving ? t('chapter.saving') : t('chapter.save')}
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                {/* 基本信息 */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label>{t('blueprint.chapterNumber')}</Label>
                    <Input
                      type="number"
                      value={selected.chapterNumber === 0 ? '' : selected.chapterNumber}
                      onChange={e => {
                        const raw = e.target.value
                        if (raw === '') {
                          updateField('chapterNumber', 0)
                        } else {
                          const n = parseInt(raw, 10)
                          if (!isNaN(n)) updateField('chapterNumber', n)
                        }
                      }}
                      onBlur={() => {
                        if (!selected.chapterNumber || selected.chapterNumber < 1) {
                          updateField('chapterNumber', 1)
                        }
                      }}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label>{t('blueprint.chapterTitle')}</Label>
                    <Input
                      value={selected.title}
                      onChange={e => updateField('title', e.target.value)}
                      placeholder={t('chapter.placeholderTitle')}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t('blueprint.chapterPosition')}</Label>
                    <Select value={selected.role} onValueChange={(v) => updateField('role', v)}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ROLES.map(r => <SelectItem key={r} value={r}>{t(ROLE_LABEL_KEYS[r] ?? 'chapter.role.development')}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{t('blueprint.keyCharacters')}</Label>
                    <Input
                      value={selected.characters.join('、')}
                      onChange={e => updateField('characters', e.target.value.split(/[,，、\s]+/).filter(Boolean))}
                      placeholder={t('chapter.placeholderCharacters')}
                    />
                  </div>
                </div>

                <div>
                  <Label>{t('blueprint.mcGoal')}</Label>
                  <Textarea
                    value={selected.purpose}
                    onChange={e => updateField('purpose', e.target.value)}
                    placeholder={t('chapter.placeholderConflict')}
                    rows={2}
                  />
                </div>

                <div>
                  <Label>{t('blueprint.conflict')}</Label>
                  <Textarea
                    value={selected.keyEvents}
                    onChange={e => updateField('keyEvents', e.target.value)}
                    placeholder={t('chapter.placeholderActions')}
                    rows={4}
                  />
                </div>

                <div>
                  <Label>{t('blueprint.cliffhanger')}</Label>
                  <Textarea
                    value={selected.suspenseHook}
                    onChange={e => updateField('suspenseHook', e.target.value)}
                    placeholder={t('chapter.placeholderSuspense')}
                    rows={2}
                  />
                </div>

                {/* 作者微操指导 — 特别标注，写稿时注入为最高优先级 */}
                <div
                  className="p-3 rounded-lg border"
                  style={{
                    borderColor: 'var(--color-accent)',
                    backgroundColor: 'rgba(var(--color-accent-rgb), 0.06)',
                  }}
                >
                  <Label className="flex items-center gap-1.5">
                    <span>{t('blueprint.authorGuidance')}</span>
                    <span
                      className="text-micro font-normal"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {t('chapter.guidanceHint')}
                    </span>
                  </Label>
                  <Textarea
                    value={selected.userGuidance}
                    onChange={e => updateField('userGuidance', e.target.value)}
                    placeholder={t('chapter.placeholderGuidance')}
                    rows={3}
                    className="mt-1.5"
                  />
                </div>
                {/* 章节要点（定稿后自动生成，也可手动编辑） */}
                <div
                  className="p-3 rounded-lg border"
                  style={{
                    borderColor: 'var(--color-border)',
                    backgroundColor: 'rgba(var(--color-success-rgb),0.04)',
                  }}
                >
                  <Label className="flex items-center gap-1.5">
                    <span>{t('blueprint.keyPoints')}</span>
                    <span
                      className="text-micro font-normal"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {selected.notesUpdatedAt
                        ? t('chapter.notesAuto').replace('{date}', new Date(selected.notesUpdatedAt).toLocaleDateString(getCurrentLocale()))
                        : t('chapter.notesAutoManual')
                      }
                    </span>
                  </Label>
                  <Textarea
                    value={selected.notes || ''}
                    onChange={e => updateField('notes', e.target.value)}
                    placeholder={t('chapter.placeholderNotes')}
                    rows={4}
                  />
                </div>
              </div>
            </fieldset>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 opacity-30">
              <BookOpen size={36} />
              <span className="text-sm">{t('blueprint.selectChapter')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
