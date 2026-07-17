import { useState, useRef, useEffect, useCallback } from 'react'

import { useProjectStore } from '../../stores/project-store'
import { useEditorStore } from '../../stores/editor-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import CodeMirrorEditor from './CodeMirrorEditor'
import ThreeWayMerge from './ThreeWayMerge'
import EditorToolbar from './EditorToolbar'
import AIActionDialog, { REVIEW_DIMS } from './AIActionDialog'
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
      setMeta({ ...m, chapterTitle: bp ? (bp as { title?: string }).title : '未知标题', filePath, fileName: `v${m.version}`, createdAt: m.updatedAt ?? m.createdAt })
      const chapterDir = `vela://draft/ch${m.chapterNumber}`
      const pending = await getPendingRevisions(chapterDir, m.version)
      if (!cancelled) setPendingRevisions(pending)
      const reviews = await getReviewsForVersion(chapterDir, m.version)
      if (!cancelled) setReviewCount(reviews.length)
    }
    load()
    return () => { cancelled = true }
  }, [filePath])

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
    Object.fromEntries(REVIEW_DIMS.map(d => [d.key, true]))
  )
  const [charCount, setCharCount] = useState(0)
  const isDirty = useEditorStore(s => s.tabs.find(t => t.filePath === filePath)?.dirty ?? false)
  const currentBodyRef = useRef(content)

  // 自动保存定时器
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    let cancelled = false

    const initAutoSave = async () => {
      try {
        const config = await ipc.invoke('config:get')
        const intervalMs = (config.autoSaveInterval || 30) * 1000
        if (intervalMs <= 0) return

        timer = setInterval(() => {
          if (cancelled) return
          const dirty = useEditorStore.getState().tabs.find(t => t.filePath === filePath)?.dirty
          if (dirty) {
            doSave(currentBodyRef.current)
          }
        }, intervalMs)
      } catch { /* config:get 不可用时静默 */ }
    }

    initAutoSave()

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath])

  const currentProject = useProjectStore(s => s.currentProject)

  /** 保存 */
  const doSave = async (text: string) => {
    setSaving(true)
    try {
      if (filePath.startsWith('vela://draft/') || filePath.startsWith('vela://manuscript/')) {
        const prefix = filePath.startsWith('vela://draft/') ? 'vela://draft/' : 'vela://manuscript/'
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

  /** AI 修稿 */
  const doRefine = async () => {
    if (!currentProject || !meta) return
    try {
      const { useWorkflowStore } = await import('../../stores/workflow-store')
      const { createRefineOnlyWorkflow } = await import('../../services/workflows/chapter-workflow')
      const body = await readDraftBody(filePath)
      useWorkflowStore.getState().startWorkflow(createRefineOnlyWorkflow({
        chapterNumber: meta.chapterNumber,
        chapterTitle: meta.chapterTitle ?? '未知标题',
        draftPath: filePath,
        draftContent: body,
        userRefinePrompt: userRefinePrompt.trim() || undefined,
      }), false)
    } catch (e) {
      toast.error(`修稿启动失败：${e}`)
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
        chapterTitle: meta.chapterTitle ?? '未知标题',
        draftPath: filePath,
        draftContent: body,
        reviewFocus: REVIEW_DIMS.filter(d => reviewDims[d.key]).map(d => d.label).join('、') || undefined,
      }), false)
    } catch (e) {
      toast.error(`审稿启动失败：${e}`)
    }
  }

  /** 定稿 */
  const doFinalize = async () => {
    if (!meta || isChapterBusy) return
    const ok = await confirm(
      `确定要将第 ${meta.chapterNumber} 章定稿吗？\n\n定稿后章节将标记为完成，不再支持修改和重新后处理。`,
      { title: '确认定稿', confirmText: '确认定稿' }
    )
    if (!ok) return
    try {
      const { useWorkflowStore } = await import('../../stores/workflow-store')
      const { createFinalizeWorkflow } = await import('../../services/workflows/chapter-workflow')
      const body = await readDraftBody(filePath)
      useWorkflowStore.getState().startWorkflow(createFinalizeWorkflow({
        chapterNumber: meta.chapterNumber,
        chapterTitle: meta.chapterTitle ?? '未知标题',
        draftPath: filePath,
        draftContent: body,
      }), false)
    } catch (e) {
      toast.error(`定稿启动失败：${e}`)
    }
  }

  /** 修复定稿后处理 */
  const doRepairFinalize = useCallback(async () => {
    if (!meta || isChapterBusy) return
    try {
      const guard = await guardRepairPostProcess(meta.chapterNumber)
      if (!guard.ok) {
        toast.error(guard.message || '无法执行修复')
        return
      }
      const { useWorkflowStore } = await import('../../stores/workflow-store')
      const { createRepairFinalizeWorkflow } = await import('../../services/workflows/chapter-workflow')
      useWorkflowStore.getState().startWorkflow(createRepairFinalizeWorkflow(meta.chapterNumber), false)
    } catch (e) {
      toast.error(`修复启动失败：${e}`)
    }
  }, [meta, isChapterBusy])

  /** 打开待合并修稿 */
  const openPendingRevision = async (rev: RevisionEntry) => {
    if (!meta) return
    const revPath = `vela://revision/${rev.id}`
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
    const chapterDir = `vela://draft/ch${meta.chapterNumber}`
    try {
      const { useDraftStore } = await import('../../stores/draft-store')
      const result = await useDraftStore.getState().applyMergedRevision(
        chapterDir, meta.chapterNumber, filePath, mergeData.revisionPath, mergedText
      )
      if (result.success) {
        setMergeData(null)
        setMeta(prev => prev ? { ...prev, status: 'revised' } : prev)
        toast.success('✅ 合并完成，草稿已更新')
        const { getPendingRevisions } = await import('../../services/draft-index')
        const pending = await getPendingRevisions(chapterDir, meta.version)
        setPendingRevisions(pending)
      } else {
        toast.error(`合并失败：${result.error}`)
      }
    } catch (e) {
      toast.error(`合并出错：${e}`)
    }
  }

  /** 打开最新审稿报告 */
  const openLatestReview = async () => {
    if (!meta) return
    const chapterDir = `vela://draft/ch${meta.chapterNumber}`
    const { getLatestReview } = await import('../../services/draft-index')
    const latest = await getLatestReview(chapterDir, meta.version)
    if (!latest) return
    const reportContent = await readDraftBody(`vela://review/${latest.id}`)
    if (!reportContent) return
    useEditorStore.getState().openFile({
      id: `review-report-${meta.chapterNumber}-${latest.id}`,
      name: `审稿报告 v${meta.version}`,
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
              修稿合并 — 第{meta?.chapterNumber}章 {meta?.chapterTitle}
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
