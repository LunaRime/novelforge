import { useState, useRef, useEffect, useCallback } from 'react'

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
import {
  parseDraftMeta,
  type DraftMeta,
  type DraftStatus,
} from '../../services/workflows/chapter-workflow'
import { captureDraftProject, saveDraftContent, getNextDraftVersion, getPendingRevisions, getReviewsForVersion, type RevisionEntry } from '../../services/draft-index'
import { startWorkflow } from '../../services/workflows/start-workflow'
import { readDraftBody } from '../../stores/draft-store'
import { computeTextStats } from '../../services/text-stats'
import { ipc } from '../../services/ipc-client'
import { renderLog } from '../../services/render-logger'

import { PostProcessStatusPanel } from '../ui/PostProcessStatusPanel'
import { getChapterFinalizeScope } from '../../services/workflows/workflow-utils'
import { guardRepairPostProcess } from '../../services/workflows/workflow-guards'

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
      const assertProject = captureDraftProject(currentProject?.path)
      const m = await parseDraftMeta(filePath)
      assertProject()
      if (cancelled || !m) return
      const { ipc } = await import('../../services/ipc-client')
      if (cancelled) return
      assertProject()
      const bps = await ipc.invoke('db:blueprint-get-all')
      assertProject()
      if (cancelled) return
      const bp = Array.isArray(bps) ? bps.find((b: unknown) => (b as { chapterNumber?: number }).chapterNumber === m.chapterNumber) : null
      setMeta({ ...m, chapterTitle: bp ? (bp as { title?: string }).title : t('editor.unknownTitle'), createdAt: m.updatedAt ?? m.createdAt })

      const pending = await getPendingRevisions(m.id, m.version)
      assertProject()
      if (cancelled) return
      setPendingRevisions(pending)
      const reviews = await getReviewsForVersion(m.id, m.version)
      assertProject()
      if (!cancelled) setReviewCount(reviews.length)
    }
    void load().catch(() => { if (!cancelled) setMeta(null) })
    return () => { cancelled = true }
  }, [filePath, t, currentProject])

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
      if (!currentProject) throw new Error(t('error.noProject'))
      const assertProject = captureDraftProject(currentProject.path)
      if (filePath.startsWith(VELA.DRAFT) || filePath.startsWith(VELA.MANUSCRIPT)) {
        await saveDraftContent(filePath, text, currentProject.path)
        const { globalEventBus } = await import('../../shared/event-bus')
        captureDraftProject(currentProject.path)()
        globalEventBus.emit('REFRESH_RESOURCE', { resources: ['drafts'] })
      } else {
        const res = await ipc.invoke('fs:write-file', filePath, text)
        if (!res.success) throw new Error(res.error ?? t('status.unknown'))
      }
      assertProject()
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
  }, [tabId, filePath, t, currentProject])

  // 自动保存定时器（通过 useAutoSave hook 复用）
  useAutoSave(filePath, currentBodyRef, doSave)

  /** AI 修稿 */
  const doRefine = async () => {
    if (!currentProject || !meta) return
    try {
      if (!currentProject) throw new Error(t('error.noProject'))
      const assertProject = captureDraftProject(currentProject.path)
      const body = await readDraftBody(filePath)
      assertProject()
      await startWorkflow({ workflow: 'refine', chapterNumber: meta.chapterNumber, draft: {
        chapterTitle: meta.chapterTitle ?? t('editor.unknownTitle'),
        draftPath: filePath,
        draftContent: body,
        userRefinePrompt: userRefinePrompt.trim() || undefined,
      } })
    } catch (e) {
      toast.error(t('error.polishFailed').replace('{error}', String(e)))
    }
  }

  /** AI 审稿 */
  const doReview = async () => {
    if (!currentProject || !meta) return
    try {
      if (!currentProject) throw new Error(t('error.noProject'))
      const assertProject = captureDraftProject(currentProject.path)
      const body = await readDraftBody(filePath)
      assertProject()
      await startWorkflow({ workflow: 'review', chapterNumber: meta.chapterNumber, draft: {
        chapterTitle: meta.chapterTitle ?? t('editor.unknownTitle'),
        draftPath: filePath,
        draftContent: body,
        reviewFocus: getReviewDims(t).filter(d => reviewDims[d.key]).map(d => d.label).join('、') || undefined,
      } })
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
      if (!currentProject) throw new Error(t('error.noProject'))
      const assertProject = captureDraftProject(currentProject.path)
      const body = await readDraftBody(filePath)
      assertProject()
      await startWorkflow({ workflow: 'finalize', chapterNumber: meta.chapterNumber, draft: {
        chapterTitle: meta.chapterTitle ?? t('editor.unknownTitle'),
        draftPath: filePath,
        draftContent: body,
      } })
    } catch (e) {
      toast.error(t('error.finalizeFailed').replace('{error}', String(e)))
    }
  }, [meta, isChapterBusy, filePath, t, currentProject])

  /** 修复定稿后处理 */
  const doRepairFinalize = useCallback(async () => {
    if (!meta || isChapterBusy) return
    try {
      if (!currentProject) throw new Error(t('error.noProject'))
      const assertProject = captureDraftProject(currentProject.path)
      const guard = await guardRepairPostProcess(meta.chapterNumber)
      if (!guard.ok) {
        toast.error(guard.message || t('error.noFixTarget'))
        return
      }
      assertProject()
      await startWorkflow({ workflow: 'repair_finalize', chapterNumber: meta.chapterNumber })
    } catch (e) {
      toast.error(t('error.repairFailed').replace('{error}', String(e)))
    }
  }, [meta, isChapterBusy, t, currentProject])

  /** 打开待合并修稿 */
  const openPendingRevision = useCallback(async (rev: RevisionEntry) => {
    if (!meta || !currentProject) return
    const assertProject = captureDraftProject(currentProject.path)
    const revPath = `${VELA.REVISION}${rev.id}`
    const [origContent, revContent] = await Promise.all([
      readDraftBody(filePath),
      readDraftBody(revPath),
    ])
    assertProject()
    if (!origContent && !revContent) return
    setMergeData({ originalContent: origContent, modifiedContent: revContent, revisionPath: revPath })
  }, [meta, filePath, currentProject])

  /** 合并完成回调 */
  const handleMergeComplete = async (mergedText: string) => {
    if (!meta || !mergeData) return

    try {
      if (!currentProject) throw new Error(t('error.noProject'))
      const assertProject = captureDraftProject(currentProject.path)
      const { useDraftStore } = await import('../../stores/draft-store')
      assertProject()
      const result = await useDraftStore.getState().applyMergedRevision(
        meta.chapterNumber, filePath, mergeData.revisionPath, mergedText
      )
      assertProject()
      if (result.success) {
        setMergeData(null)
        setMeta(prev => prev ? { ...prev, status: 'revised' } : prev)
        toast.success(t('editor.mergeSuccessToast'))
        const { getPendingRevisions } = await import('../../services/draft-index')
        const pending = await getPendingRevisions(meta.id, meta.version)
        assertProject()
        setPendingRevisions(pending)
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
    const assertProject = captureDraftProject(currentProject.path)

    const { getLatestReview } = await import('../../services/draft-index')
    assertProject()
    const latest = await getLatestReview(meta.id, meta.version)
    assertProject()
    if (!latest) return
    const reportContent = await readDraftBody(`${VELA.REVIEW}${latest.id}`)
    assertProject()
    if (!reportContent) return
    useEditorStore.getState().openFile({
      id: `review-report-${meta.chapterNumber}-${latest.id}`,
      name: t('editor.reviewTab').replace('{version}', String(meta.version)),
      type: 'review-report',
      content: reportContent,
      filePath,
      reviewReport: reportContent,
      chapterNumber: meta.chapterNumber,
    })
  }, [meta, filePath, t, currentProject])

  /** 正文翻译：目标语言 → LLM 翻译 → 新建 source='translation' 草稿 → 打开新 Tab（原文保留） */
  const doTranslate = useCallback(async (lang: 'zh' | 'en' | 'ru') => {
    const text = currentBodyRef.current
    if (!text?.trim()) return
    try {
      if (!currentProject) throw new Error(t('error.noProject'))
      const assertProject = captureDraftProject(currentProject.path)
      const langLabel = t(`translate.lang.${lang}` as TextKey)
      const { useLLMStore } = await import('../../stores/llm-store')
      assertProject()
      const res = await useLLMStore.getState().generate(
        [
          { role: 'system', content: t('ai.systemPrompt') },
          { role: 'user', content: t('translate.prompt').replace('{lang}', langLabel).replace('{content}', text.slice(0, 12000)) },
        ],
        undefined,
        { temperature: 0.3 },
      )
      if (!res.success || !res.content) throw new Error(res.error || 'empty response')
      assertProject()
      const translated = res.content.trim()
      if (!meta) throw new Error('no draft meta')

      const version = await getNextDraftVersion(meta.chapterNumber)
      assertProject()
      const created = await ipc.invoke('db:draft-create', {
        chapterNumber: meta.chapterNumber,
        version,
        source: 'translation',
        content: translated,
        wordCount: computeTextStats(translated).novelWordCount,
      })
      assertProject()
      if (!created.success || !created.id) throw new Error(created.error || 'create failed')

      // 打开新 Tab（翻译稿独立于原文，可对比/续用）
      useEditorStore.getState().openFile({
        id: `draft-${created.id}-translation`,
        name: `${t('translate.title')} · ${langLabel}`,
        type: 'chapter',
        filePath: `vela://draft/${created.id}`,
        content: translated,
      })
      toast.success(t('translate.success'))
      // 通知侧栏刷新（草稿箱出现翻译稿）
      const { globalEventBus } = await import('../../shared/event-bus')
      globalEventBus.emit('REFRESH_RESOURCE', { resources: ['drafts'] })
    } catch (e) {
      toast.error(t('translate.failed').replace('{error}', String(e)))
    }
  }, [meta, t, currentProject])

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
            scope={getChapterFinalizeScope(meta.chapterNumber)}
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
