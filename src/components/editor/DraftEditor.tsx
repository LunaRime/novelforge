import { useState, useRef, useEffect, useCallback, useMemo } from 'react'

import { useTranslation } from '../../hooks/useTranslation'
import type { TextKey } from '../../shared/locale'
import { useProjectStore } from '../../stores/project-store'
import { useEditorStore } from '../../stores/editor-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import CodeMirrorEditor from './CodeMirrorEditor'
import ThreeWayMerge from './ThreeWayMerge'
import EditorToolbar from './EditorToolbar'
import AIActionDialog, { getReviewDims } from './AIActionDialog'
import { VELA } from '../../services/vela-protocol'
import { useAutoSave } from '../../hooks/useAutoSave'
import { useDirtyCheck } from '../../hooks/useDirtyCheck'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '../ui/Dialog'
import type { DraftMeta, RevisionEntry } from '../../services/draft-index'
import type { DraftStatus } from '../../shared/draft-status'
import { createRendererDraftEditorApplication, getDraftFinalizeScope } from '../../services/editor/draft-editor-adapter'
import { renderLog } from '../../services/render-logger'

import { PostProcessStatusPanel } from '../ui/PostProcessStatusPanel'

interface Props {
  tabId: string
  filePath: string
  content: string
}

/**
 * 草稿编辑器 — 编排层
 * — 子组件：EditorToolbar（工具栏）、AIActionDialog（AI 确认弹窗）
 * — 正文：CodeMirrorEditor + ThreeWayMerge
 */
export default function DraftEditor({ tabId, filePath, content }: Props) {
  const { t } = useTranslation()
  const currentProject = useProjectStore(s => s.currentProject)
  const projectSession = useProjectStore(s => s.projectSession)
  const application = useMemo(() => createRendererDraftEditorApplication(currentProject, projectSession, t), [currentProject, projectSession, t])
  const [meta, setMeta] = useState<(DraftMeta & { chapterTitle?: string }) | null>(null)
  const [pendingRevisions, setPendingRevisions] = useState<RevisionEntry[]>([])
  const [reviewCount, setReviewCount] = useState(0)
  const [mergeData, setMergeData] = useState<{
    originalContent: string
    modifiedContent: string
    revisionPath: string
  } | null>(null)
  const [hasProcessFailure, setHasProcessFailure] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const loaded = await application.load(filePath)
      application.assertCurrent()
      if (cancelled || !loaded) return
      setMeta({ ...loaded.meta, chapterTitle: loaded.meta.chapterTitle ?? t('editor.unknownTitle'), createdAt: loaded.meta.updatedAt ?? loaded.meta.createdAt })
      setPendingRevisions(loaded.pending)
      setReviewCount(loaded.reviewCount)
    }
    void load().catch(() => { if (!cancelled) setMeta(null) })
    return () => { cancelled = true }
  }, [filePath, t, application])

  const status: DraftStatus = meta?.status ?? 'draft'
  const isReadonly = status === 'finalized' || status === 'archived'

  const activeRuns = useWorkflowStore(s => s.activeRuns)
  const activeChapterRun = activeRuns.find(r =>
    r.type === 'chapter_creation' && meta && (r.title.includes(`第${meta.chapterNumber}章`) || r.title.includes(`第 ${meta.chapterNumber} 章`))
  )
  const isChapterBusy = !!activeChapterRun

  const [saving, setSaving] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'refine' | 'review' | null>(null)
  const [userRefinePrompt, setUserRefinePrompt] = useState('')
  const [reviewDims, setReviewDims] = useState<Record<string, boolean>>(
    Object.fromEntries(getReviewDims(t).map(d => [d.key, true]))
  )
  const [charCount, setCharCount] = useState(0)
  const isDirty = useDirtyCheck(filePath)
  const currentBodyRef = useRef(content)
  // 外部（Agent/同步）更新 content 时同步 ref；否则 30s 自动保存会把旧文本写回 DB
  useEffect(() => { currentBodyRef.current = content }, [content])


  /**
   * 保存（手动/自动共用）
   * - 手动：toast 视觉反馈（成功/失败）+ info 日志
   * - 自动（useAutoSave 30s）：仅 debug 日志（不 toast，避免高频打扰）
   */
  const doSave = useCallback(async (text: string, opts?: { manual?: boolean }) => {
    const manual = opts?.manual ?? false
    const t0 = Date.now()
    setSaving(true)
    try {
      await application.save(filePath, text)
      application.assertCurrent()
      const tabs = useEditorStore.getState().tabs
      const targetTab = tabs.find(t => t.id === tabId)
      if (targetTab && currentBodyRef.current === text) {
        useEditorStore.getState().markTabSaved(targetTab.id)
        useEditorStore.getState().syncTabContent(targetTab.id, text)
      }
      // 保存行为日志流：手动 info（公测可见）/ 自动 debug（dev 可见）
      renderLog(manual ? 'info' : 'debug', 'Save:Draft', t('log.render.draftSaveSuccess')
        .replace('{mode}', () => manual ? t('log.render.modeManual') : t('log.render.modeAuto'))
        .replace('{path}', () => filePath)
        .replace('{ms}', String(Date.now() - t0)))
      if (manual) toast.success(t('save.success'))
    } catch (e) {
      // 保存失败不再静默：toast 视觉反馈 + error 日志（含原因）
      renderLog('error', 'Save:Draft', t('log.render.draftSaveFailed')
        .replace('{path}', () => filePath)
        .replace('{error}', () => String(e)))
      toast.error(t('save.failed').replace('{error}', String(e)))
    } finally {
      setSaving(false)
    }
  }, [tabId, filePath, t, application])

  // 自动保存定时器（通过 useAutoSave hook 复用）
  useAutoSave(filePath, currentBodyRef, doSave)

  /** AI 修稿 */
  const doRefine = async () => {
    if (!currentProject || !meta) return
    try {
      await application.workflow('refine', filePath, meta, meta.chapterTitle ?? t('editor.unknownTitle'), {
        userRefinePrompt: userRefinePrompt.trim() || undefined,
      })
    } catch (e) {
      toast.error(t('error.polishFailed').replace('{error}', String(e)))
    }
  }

  /** AI 审稿 */
  const doReview = async () => {
    if (!currentProject || !meta) return
    try {
      await application.workflow('review', filePath, meta, meta.chapterTitle ?? t('editor.unknownTitle'), {
        reviewFocus: getReviewDims(t).filter(d => reviewDims[d.key]).map(d => d.label).join('、') || undefined,
      })
    } catch (e) {
      toast.error(t('error.reviewFailed').replace('{error}', String(e)))
    }
  }

  /** 定稿 */
  const doFinalize = useCallback(async () => {
    if (!meta || isChapterBusy) return
    const ok = await confirm(
      t('editor.confirmFinalizeMsg').replace('{n}', String(meta.chapterNumber)),
      { title: t('dialog.confirmFinalize'), confirmText: t('dialog.confirmFinalize') }
    )
    if (!ok) return
    try {
      await application.workflow('finalize', filePath, meta, meta.chapterTitle ?? t('editor.unknownTitle'))
    } catch (e) {
      toast.error(t('error.finalizeFailed').replace('{error}', String(e)))
    }
  }, [meta, isChapterBusy, filePath, t, application])

  /** 修复定稿后处理 */
  const doRepairFinalize = useCallback(async () => {
    if (!meta || isChapterBusy) return
    try {
      const guard = await application.repair(meta)
      if (!guard.ok) {
        toast.error(guard.message || t('error.noFixTarget'))
        return
      }
    } catch (e) {
      toast.error(t('error.repairFailed').replace('{error}', String(e)))
    }
  }, [meta, isChapterBusy, t, application])

  /** 打开待合并修稿 */
  const openPendingRevision = useCallback(async (rev: RevisionEntry) => {
    if (!meta || !currentProject) return
    const loaded = await application.revision(filePath, VELA.REVISION + rev.id)
    if (loaded.originalContent || loaded.modifiedContent) setMergeData(loaded)
  }, [meta, filePath, currentProject, application])

  /** 合并完成回调 */
  const handleMergeComplete = async (mergedText: string) => {
    if (!meta || !mergeData) return

    try {
      const result = await application.merge(meta, filePath, mergeData.revisionPath, mergedText)
      application.assertCurrent()
      if (result.success) {
        setMergeData(null)
        setMeta(prev => prev ? { ...prev, status: 'revised' } : prev)
        toast.success(t('editor.mergeSuccessToast'))
        if (result.pending) setPendingRevisions(result.pending)
        if (result.refreshError) renderLog('error', 'Load:Draft', result.refreshError)
      } else {
        toast.error(t('error.mergeFailed').replace('{error}', String(result.error)))
      }
    } catch (e) {
      toast.error(t('error.mergeError').replace('{error}', String(e)))
    }
  }

  /** 打开最新审稿报告 */
  const openLatestReview = useCallback(async () => {
    if (!meta || !currentProject) return
    const latest = await application.review(meta)
    application.assertCurrent()
    if (!latest) return
    const reportContent = latest.content
    useEditorStore.getState().openFile({
      id: `review-report-${meta.chapterNumber}-${latest.id}`,
      name: t('editor.reviewTab').replace('{version}', String(meta.version)),
      type: 'review-report',
      content: reportContent,
      filePath,
      reviewReport: reportContent,
      chapterNumber: meta.chapterNumber,
    })
  }, [meta, filePath, t, currentProject, application])

  /** 正文翻译：目标语言 → LLM 翻译 → 新建 source='translation' 草稿 → 打开新 Tab（原文保留） */
  const doTranslate = useCallback(async (lang: 'zh' | 'en' | 'ru') => {
    const text = currentBodyRef.current
    if (!text?.trim()) return
    try {
      if (!meta) return
      const langLabel = t(`translate.lang.${lang}` as TextKey)
      const created = await application.translation(meta, text,
        t('translate.prompt').replace('{lang}', langLabel).replace('{content}', text.slice(0, 12000)), t('ai.systemPrompt'))
      application.assertCurrent()
      const translated = created.content

      // 打开新 Tab（翻译稿独立于原文，可对比/续用）
      useEditorStore.getState().openFile({
        id: `draft-${created.id}-translation`,
        name: `${t('translate.title')} · ${langLabel}`,
        type: 'chapter',
        filePath: `vela://draft/${created.id}`,
        content: translated,
      })
      toast.success(t('translate.success'))
    } catch (e) {
      toast.error(t('translate.failed').replace('{error}', String(e)))
    }
  }, [meta, t, application])

  // 稳定回调（配合 memo(EditorToolbar) / CodeMirrorEditor 的 handleUpdate 依赖）——
  // 否则流式期间（activeRuns 每 100ms 变化）内联函数重建，EditorToolbar 的 memo 形同虚设
  const handleToolbarSave = useCallback(() => doSave(currentBodyRef.current, { manual: true }), [doSave])
  const handleToolbarRefine = useCallback(() => { setUserRefinePrompt(''); setConfirmAction('refine') }, [])
  const handleToolbarReview = useCallback(() => setConfirmAction('review'), [])
  const handleEditorChange = useCallback((text: string) => {
    currentBodyRef.current = text
    useEditorStore.getState().updateTabContent(tabId, text)
  }, [tabId])
  const handleEditorSave = useCallback((text: string) => doSave(text, { manual: true }), [doSave])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 工具栏 — 提取到 EditorToolbar */}
      <EditorToolbar
        meta={meta}
        charCount={charCount}
        isDirty={isDirty}
        isReadonly={isReadonly}
        saving={saving}
        isChapterBusy={isChapterBusy}
        pendingRevisions={pendingRevisions}
        reviewCount={reviewCount}
        hasProcessFailure={hasProcessFailure}
        onSave={handleToolbarSave}
        onRefine={handleToolbarRefine}
        onReview={handleToolbarReview}
        onTranslate={doTranslate}
        onFinalize={doFinalize}
        onRepairFinalize={doRepairFinalize}
        onOpenRevision={openPendingRevision}
        onOpenReview={openLatestReview}
      />

      {/* 后处理状态面板 */}
      {status === 'finalized' && meta && (
        <div className="px-3 py-1.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <PostProcessStatusPanel
            scope={getDraftFinalizeScope(meta.chapterNumber)}
            onRetry={() => doRepairFinalize()}
            onStatusLoad={setHasProcessFailure}
          />
        </div>
      )}

      {/* 正文区 */}
      <div className="flex-1 overflow-hidden relative">
        <CodeMirrorEditor
          tabId={tabId}
          mode="prose"
          content={content}
          filePath={filePath}
          editable={!isReadonly && !isChapterBusy}
          hideStatusBar
          onCharCountChange={setCharCount}
          onChange={handleEditorChange}
          onSave={handleEditorSave}
        />
      </div>

      {/* AI 操作确认弹窗 — 提取到 AIActionDialog */}
      <AIActionDialog
        action={confirmAction}
        chapterTitle={meta?.chapterTitle}
        version={meta?.version}
        refinePrompt={userRefinePrompt}
        reviewDims={reviewDims}
        onClose={() => setConfirmAction(null)}
        onRefinePromptChange={setUserRefinePrompt}
        onReviewDimToggle={(key) => setReviewDims(prev => ({ ...prev, [key]: !prev[key] }))}
        onConfirm={() => {
          const act = confirmAction
          setConfirmAction(null)
          if (act === 'refine') doRefine()
          else if (act === 'review') doReview()
        }}
      />

      {/* 弹出式三栏合并视图 */}
      <Dialog open={mergeData !== null} onOpenChange={(v) => !v && setMergeData(null)}>
        <DialogContent preventOutsideClose
          className="p-0"
          style={{ width: '90vw', maxWidth: '90vw', height: '85vh', maxHeight: '85vh', overflow: 'hidden' }}
        >
          <DialogHeader className="px-4 py-0" style={{ height: 38, display: 'flex', alignItems: 'center' }}>
            <DialogTitle className="flex items-center gap-2 text-xs">
              {t('editor.mergeTitle').replace('{n}', String(meta?.chapterNumber)).replace('{title}', meta?.chapterTitle ?? '')}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden" style={{ height: 'calc(85vh - 38px - 1px)' }}>
            {mergeData && (
              <ThreeWayMerge
                originalContent={mergeData.originalContent}
                modifiedContent={mergeData.modifiedContent}
                onComplete={handleMergeComplete}
                onCancel={() => setMergeData(null)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
