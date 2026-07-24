import { useState, useRef, useEffect, useCallback } from 'react'

import { useTranslation } from '../../hooks/useTranslation'
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
import { getPendingRevisions, getReviewsForVersion, type RevisionEntry } from '../../services/draft-index'
import { readDraftBody } from '../../stores/draft-store'
import { ipc } from '../../services/ipc-client'

import { PostProcessStatusPanel } from '../ui/PostProcessStatusPanel'
import { getChapterFinalizeScope } from '../../services/workflows/workflow-utils'
import { guardRepairPostProcess } from '../../services/workflow-guards'

interface Props {
  filePath: string
  content: string
}

/**
 * 草稿编辑器 — 编排层
 * — 子组件：EditorToolbar（工具栏）、AIActionDialog（AI 确认弹窗）
 * — 正文：CodeMirrorEditor + ThreeWayMerge
 */
export default function DraftEditor({ filePath, content }: Props) {
  const { t } = useTranslation()
  const [meta, setMeta] = useState<(DraftMeta & { chapterTitle?: string; filePath?: string }) | null>(null)
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
      const m = await parseDraftMeta(filePath)
      if (cancelled || !m) return
      const { ipc } = await import('../../services/ipc-client')
      const bps = await ipc.invoke('db:blueprint-get-all')
      const bp = Array.isArray(bps) ? bps.find((b: unknown) => (b as { chapterNumber?: number }).chapterNumber === m.chapterNumber) : null
      setMeta({ ...m, chapterTitle: bp ? (bp as { title?: string }).title : t('editor.unknownTitle'), filePath, fileName: `v${m.version}`, createdAt: m.updatedAt ?? m.createdAt })
      const chapterDir = `${VELA.DRAFT}ch${m.chapterNumber}`
      const pending = await getPendingRevisions(chapterDir, m.version)
      if (!cancelled) setPendingRevisions(pending)
      const reviews = await getReviewsForVersion(chapterDir, m.version)
      if (!cancelled) setReviewCount(reviews.length)
    }
    load()
    return () => { cancelled = true }
  }, [filePath, t])

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

  const currentProject = useProjectStore(s => s.currentProject)

  /** 保存 */
  const doSave = async (text: string) => {
    setSaving(true)
    try {
      if (filePath.startsWith(VELA.DRAFT) || filePath.startsWith(VELA.MANUSCRIPT)) {
        const prefix = filePath.startsWith(VELA.DRAFT) ? VELA.DRAFT : VELA.MANUSCRIPT
        const draftId = parseInt(filePath.replace(prefix, ''))
        await ipc.invoke('db:draft-update-content', draftId, text, text.length)
      } else {
        await ipc.invoke('fs:write-file', filePath, text)
      }
      const tabs = useEditorStore.getState().tabs
      const targetTab = tabs.find(t => t.filePath === filePath)
      if (targetTab) {
        useEditorStore.getState().markTabSaved(targetTab.id)
        useEditorStore.getState().syncTabContent(targetTab.id, text)
      }
    } finally {
      setSaving(false)
    }
  }

  // 自动保存定时器（通过 useAutoSave hook 复用）
  useAutoSave(filePath, currentBodyRef, doSave)

  /** AI 修稿 */
  const doRefine = async () => {
    if (!currentProject || !meta) return
    try {
      const { useWorkflowStore } = await import('../../stores/workflow-store')
      const { createRefineOnlyWorkflow } = await import('../../services/workflows/chapter-workflow')
      const body = await readDraftBody(filePath)
      useWorkflowStore.getState().startWorkflow(createRefineOnlyWorkflow({
        chapterNumber: meta.chapterNumber,
        chapterTitle: meta.chapterTitle ?? t('editor.unknownTitle'),
        draftPath: filePath,
        draftContent: body,
        userRefinePrompt: userRefinePrompt.trim() || undefined,
      }), false)
    } catch (e) {
      toast.error(t('error.polishFailed').replace('{error}', String(e)))
    }
  }

  /** AI 审稿 */
  const doReview = async () => {
    if (!currentProject || !meta) return
    try {
      const { useWorkflowStore } = await import('../../stores/workflow-store')
      const { createReviewOnlyWorkflow } = await import('../../services/workflows/chapter-workflow')
      const body = await readDraftBody(filePath)
      useWorkflowStore.getState().startWorkflow(createReviewOnlyWorkflow({
        chapterNumber: meta.chapterNumber,
        chapterTitle: meta.chapterTitle ?? t('editor.unknownTitle'),
        draftPath: filePath,
        draftContent: body,
        reviewFocus: getReviewDims(t).filter(d => reviewDims[d.key]).map(d => d.label).join('、') || undefined,
      }), false)
    } catch (e) {
      toast.error(t('error.reviewFailed').replace('{error}', String(e)))
    }
  }

  /** 定稿 */
  const doFinalize = async () => {
    if (!meta || isChapterBusy) return
    const ok = await confirm(
      t('editor.confirmFinalizeMsg').replace('{n}', String(meta.chapterNumber)),
      { title: t('dialog.confirmFinalize'), confirmText: t('dialog.confirmFinalize') }
    )
    if (!ok) return
    try {
      const { useWorkflowStore } = await import('../../stores/workflow-store')
      const { createFinalizeWorkflow } = await import('../../services/workflows/chapter-workflow')
      const body = await readDraftBody(filePath)
      useWorkflowStore.getState().startWorkflow(createFinalizeWorkflow({
        chapterNumber: meta.chapterNumber,
        chapterTitle: meta.chapterTitle ?? t('editor.unknownTitle'),
        draftPath: filePath,
        draftContent: body,
      }), false)
    } catch (e) {
      toast.error(t('error.finalizeFailed').replace('{error}', String(e)))
    }
  }

  /** 修复定稿后处理 */
  const doRepairFinalize = useCallback(async () => {
    if (!meta || isChapterBusy) return
    try {
      const guard = await guardRepairPostProcess(meta.chapterNumber)
      if (!guard.ok) {
        toast.error(guard.message || t('error.noFixTarget'))
        return
      }
      const { useWorkflowStore } = await import('../../stores/workflow-store')
      const { createRepairFinalizeWorkflow } = await import('../../services/workflows/chapter-workflow')
      useWorkflowStore.getState().startWorkflow(createRepairFinalizeWorkflow(meta.chapterNumber), false)
    } catch (e) {
      toast.error(t('error.repairFailed').replace('{error}', String(e)))
    }
  }, [meta, isChapterBusy, t])

  /** 打开待合并修稿 */
  const openPendingRevision = async (rev: RevisionEntry) => {
    if (!meta) return
    const revPath = `${VELA.REVISION}${rev.id}`
    const [origContent, revContent] = await Promise.all([
      readDraftBody(filePath),
      readDraftBody(revPath),
    ])
    if (!origContent && !revContent) return
    setMergeData({ originalContent: origContent, modifiedContent: revContent, revisionPath: revPath })
  }

  /** 合并完成回调 */
  const handleMergeComplete = async (mergedText: string) => {
    if (!meta || !mergeData) return
    const chapterDir = `${VELA.DRAFT}ch${meta.chapterNumber}`
    try {
      const { useDraftStore } = await import('../../stores/draft-store')
      const result = await useDraftStore.getState().applyMergedRevision(
        chapterDir, meta.chapterNumber, filePath, mergeData.revisionPath, mergedText
      )
      if (result.success) {
        setMergeData(null)
        setMeta(prev => prev ? { ...prev, status: 'revised' } : prev)
        toast.success(t('editor.mergeSuccessToast'))
        const { getPendingRevisions } = await import('../../services/draft-index')
        const pending = await getPendingRevisions(chapterDir, meta.version)
        setPendingRevisions(pending)
      } else {
        toast.error(t('error.mergeFailed').replace('{error}', String(result.error)))
      }
    } catch (e) {
      toast.error(t('error.mergeError').replace('{error}', String(e)))
    }
  }

  /** 打开最新审稿报告 */
  const openLatestReview = async () => {
    if (!meta) return
    const chapterDir = `${VELA.DRAFT}ch${meta.chapterNumber}`
    const { getLatestReview } = await import('../../services/draft-index')
    const latest = await getLatestReview(chapterDir, meta.version)
    if (!latest) return
    const reportContent = await readDraftBody(`${VELA.REVIEW}${latest.id}`)
    if (!reportContent) return
    useEditorStore.getState().openFile({
      id: `review-report-${meta.chapterNumber}-${latest.id}`,
      name: t('editor.reviewTab').replace('{version}', String(meta.version)),
      type: 'review-report',
      content: reportContent,
      filePath,
      reviewReport: reportContent,
      chapterNumber: meta.chapterNumber,
      chapterDir,
    })
  }

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
        onSave={() => doSave(currentBodyRef.current)}
        onRefine={() => { setUserRefinePrompt(''); setConfirmAction('refine') }}
        onReview={() => setConfirmAction('review')}
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
          mode="prose"
          content={content}
          filePath={filePath}
          editable={!isReadonly && !isChapterBusy}
          hideStatusBar
          onCharCountChange={setCharCount}
          onChange={(text) => {
            currentBodyRef.current = text
            useEditorStore.getState().updateTabContent(filePath, text)
          }}
          onSave={(text) => doSave(text)}
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
        <DialogContent
          className="p-0"
          style={{ width: '90vw', maxWidth: '90vw', height: '85vh', maxHeight: '85vh', overflow: 'hidden' }}
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader className="px-4 py-0" style={{ height: 38, display: 'flex', alignItems: 'center' }}>
            <DialogTitle className="flex items-center gap-2 text-[0.8rem]">
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
