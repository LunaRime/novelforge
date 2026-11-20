import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from '../../hooks/useTranslation'
import { ipc } from '../../services/ipc-client'
import { renderLog } from '../../services/render-logger'
import { inferFileImport, inferFileImportBlueprints, type FileImportBlueprintInference, type FileImportInference } from '../../services/workflows/file-import-inference'
import type { FileAgentEditProposal, FileDraftCommand, FileImportChapter, FileImportSettingField, ProjectChannels } from '../../shared/ipc-channels'
import { globalEventBus } from '../../shared/event-bus'
import { Button } from '../ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../ui/Dialog'
import { toast } from '../ui/Toast'
import { VersionActions, type VersionAction } from '../editor/VersionActions'
import { FileChapterContinuation, type ContinuationCommand } from './FileChapterContinuation'
import { FileProjectAgent } from './FileProjectAgent'

type Opened = ProjectChannels['project:file-editor-open']['return']
type Workspace = Opened & { path: string; active: string }
type Commit = Exclude<ProjectChannels['project:file-editor-commit']['args'][1], { kind: 'create' }>
type Preview = ProjectChannels['project:file-editor-preview']['return'] & { revisionId: number }
type ImportPreview = { path: string; chapters: FileImportChapter[]; firstNumber: string }
type ImportBatch = Omit<ImportPreview, 'firstNumber'> & { firstNumber: number; indexed?: boolean }
type BlueprintReceipt = ProjectChannels['project:file-editor-apply-import-blueprints']['return']
type Confirmation = Commit['kind'] | 'apply-settings' | 'apply-blueprints' | 'activate'

const inferenceLabels = {
  worldSetting: 'novelConfig.worldSetting', coreOutline: 'novelConfig.coreOutline',
  protagonistProfile: 'novelConfig.protagonist', writingStyle: 'project.fileEditorInferenceStyle',
} as const satisfies Record<FileImportSettingField, string>
const roleLabels = {
  建置: 'chapter.role.establishment', 铺垫: 'chapter.role.setup', 发展: 'chapter.role.development',
  冲突: 'chapter.role.conflict', 高潮: 'chapter.role.climax', 转折: 'chapter.role.twist', 收尾: 'chapter.role.resolution',
} as const

const saveClock = () => performance.now()

function storedTabs(path: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(`novelforge-file-editor:${path}`) ?? 'null')
    if (Array.isArray(saved?.locators)) return {
      locators: saved.locators.filter((value: unknown) => typeof value === 'string' && value.length <= 200).slice(0, 100) as string[],
      active: typeof saved.active === 'string' ? saved.active : '',
    }
  } catch { /* Use the first available document when restoration data is unreadable. */ }
  return { locators: [], active: '' }
}

export function FileProjectEditorDialog({ showTrigger = true }: { showTrigger?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [workspace, setWorkspace] = useState<Workspace>()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [savingBody, setSavingBody] = useState(false)
  const [indexPending, setIndexPending] = useState(false)
  const [recovery, setRecovery] = useState<{ locator: string; committed: boolean }>()
  const [openingDocument, setOpeningDocument] = useState(false)
  const [revisionId, setRevisionId] = useState<number>()
  const [preview, setPreview] = useState<Preview>()
  const [importPreview, setImportPreview] = useState<ImportPreview>()
  const [indexBatch, setIndexBatch] = useState<ImportBatch>()
  const [inferencePreview, setInferencePreview] = useState<FileImportInference & { applied?: FileImportSettingField[] }>()
  const [blueprintPreview, setBlueprintPreview] = useState<FileImportBlueprintInference & { receipt?: BlueprintReceipt }>()
  const [inferenceMode, setInferenceMode] = useState<'settings' | 'blueprints'>()
  const [blueprintProgress, setBlueprintProgress] = useState<{ completed: number; total: number }>()
  const [confirmation, setConfirmation] = useState<Confirmation>()
  const [confirmationOrigin, setConfirmationOrigin] = useState<HTMLElement | null>(null)
  const pending = useRef(false)
  const inferenceRun = useRef<AbortController | undefined>(undefined)
  const active = workspace?.tabs.find(tab => tab.locator === workspace.active)
  const dirty = !!active && active.content !== text
  const stagedImport = importPreview?.path === workspace?.path ? importPreview : undefined
  const firstImportNumber = Number(stagedImport?.firstNumber)
  const lifecycle = active?.lifecycle
  const selectedRevision = revisionId ?? lifecycle?.pending[0]?.id
  const chapterId = lifecycle ? active?.locator.slice('doc://chapter/'.length) : undefined
  const nextNumber = workspace?.importStartNumber
  const continuationSource = active?.number !== undefined && active.number + 1 === nextNumber && active.revision && active.content.trim()
    ? { chapterId: active.locator.slice('doc://chapter/'.length), revision: active.revision } : undefined
  const settingsOffer = inferencePreview?.settingsOffer
  const canApplySettings = !inferencePreview?.applied && (settingsOffer?.available.some(field =>
    !settingsOffer.occupied.includes(field) && Boolean(inferencePreview?.values[field])) ?? false)

  function requestConfirmation(action: Confirmation) {
    setConfirmationOrigin(document.activeElement as HTMLElement | null)
    setConfirmation(action)
  }

  function remember(path: string, locators: string[], active: string) {
    try { localStorage.setItem(`novelforge-file-editor:${path}`, JSON.stringify({ locators, active })) }
    catch (error) { renderLog('warn', 'FileProjectEditor', String(error)) }
  }

  function display(path: string, result: Opened, preferred: string, requested: string[]) {
    // A preview belongs to the previous document and revision, even if the locator stayed the same.
    setPreview(undefined)
    setRecovery(undefined)
    setIndexPending(previous => workspace?.path === path && previous)
    setRevisionId(undefined)
    setImportPreview(previous => previous?.path === path ? previous : undefined)
    setIndexBatch(previous => previous?.path === path ? previous : undefined)
    const selected = result.tabs.find(tab => tab.locator === preferred) ?? result.tabs[0]
    setWorkspace({ ...result, path, active: selected?.locator ?? '' })
    setText(selected?.content ?? '')
    const locators = [...new Set([...result.tabs.map(tab => tab.locator), ...result.missing.filter(locator => requested.includes(locator))])]
    remember(path, locators, selected?.locator ?? preferred)
  }

  function clearInference() {
    const previous = inferenceRun.current
    inferenceRun.current = undefined
    previous?.abort()
    setInferenceMode(undefined)
    setBlueprintProgress(undefined)
    setInferencePreview(undefined)
    setBlueprintPreview(undefined)
    setConfirmation(previous => previous === 'apply-settings' || previous === 'apply-blueprints' ? undefined : previous)
  }

  async function applyInferredSettings() {
    if (pending.current || inferenceRun.current || dirty || !workspace || !indexBatch || indexBatch.path !== workspace.path ||
        !inferencePreview || !settingsOffer || !canApplySettings) return
    pending.current = true
    setBusy(true)
    const start = saveClock()
    try {
      const { applied } = await ipc.invoke('project:file-editor-apply-import-settings', workspace.token,
        settingsOffer.id, indexBatch.firstNumber, indexBatch.chapters, inferencePreview.values)
      const message = t('project.fileEditorSettingsApplied').replace('{count}', String(applied.length))
      renderLog('info', 'Save:FileProjectEditor', `${message} (${Math.round(saveClock() - start)}ms)`)
      toast.success(message)
      setInferencePreview({ ...inferencePreview, applied })
    } catch (error) {
      renderLog('error', 'Save:FileProjectEditor', String(error))
      toast.error(t('project.fileEditorSettingsApplyFailed'))
    } finally { pending.current = false; setBusy(false) }
  }

  async function applyInferredBlueprints() {
    if (pending.current || inferenceRun.current || dirty || !workspace || !indexBatch || indexBatch.path !== workspace.path ||
        !blueprintPreview?.offerId || !blueprintPreview.items.length || blueprintPreview.receipt) return
    pending.current = true
    setBusy(true)
    const start = saveClock()
    try {
      const receipt = await ipc.invoke('project:file-editor-apply-import-blueprints', workspace.token,
        blueprintPreview.offerId, indexBatch.firstNumber, indexBatch.chapters, blueprintPreview.items)
      const message = t('project.fileEditorBlueprintsApplied').replace('{inserted}', String(receipt.insertedChapterNumbers.length))
        .replace('{skipped}', String(receipt.skippedChapterNumbers.length))
      renderLog('info', 'Save:FileProjectEditor', `${message} (${Math.round(saveClock() - start)}ms)`)
      toast.success(message)
      setBlueprintPreview({ ...blueprintPreview, receipt })
    } catch (error) {
      renderLog('error', 'Save:FileProjectEditor', String(error))
      toast.error(t('project.fileEditorBlueprintApplyFailed'))
    } finally { pending.current = false; setBusy(false) }
  }

  async function inferImport(mode: 'settings' | 'blueprints') {
    if (pending.current || inferenceRun.current || dirty || !workspace || !indexBatch || indexBatch.path !== workspace.path ||
        (mode === 'settings' && !indexBatch.indexed)) return
    const run = new AbortController()
    inferenceRun.current = run
    if (mode === 'settings') setInferencePreview(undefined)
    else setBlueprintPreview(undefined)
    setBlueprintProgress(undefined)
    setInferenceMode(mode)
    try {
      // 只接受当前运行的结果，取消或换项目后丢弃迟到的回包。
      if (mode === 'settings') {
        const result = await inferFileImport(workspace.token, indexBatch.firstNumber, indexBatch.chapters, run.signal)
        if (inferenceRun.current === run) setInferencePreview(result)
      } else {
        const result = await inferFileImportBlueprints(workspace.token, indexBatch.firstNumber, indexBatch.chapters, run.signal,
          (completed, total) => { if (inferenceRun.current === run) setBlueprintProgress({ completed, total }) })
        if (inferenceRun.current === run) setBlueprintPreview(result)
      }
    } catch (error) {
      if (inferenceRun.current !== run) return
      renderLog('error', 'FileProjectEditor', String(error))
      toast.error(t(mode === 'settings' ? 'project.fileEditorInferenceFailed' : 'project.fileEditorBlueprintInferenceFailed'))
    } finally {
      if (inferenceRun.current === run) {
        inferenceRun.current = undefined
        setInferenceMode(undefined)
      }
    }
  }

  async function previewImport() {
    if (pending.current || dirty || !workspace?.importStartNumber) return
    pending.current = true
    setBusy(true)
    try {
      const files = await ipc.invoke('dialog:select-novel-files')
      if (!files?.length) return
      const split = await ipc.invoke('import:split-chapters', files)
      if (!split.success || split.chapters.length === 0) throw new Error(split.error ?? t('import.chapterSplitFailed'))
      setImportPreview({ path: workspace.path, firstNumber: String(workspace.importStartNumber),
        chapters: split.chapters.map(({ title, content }) => ({ title, content })) })
    } catch (error) {
      renderLog('error', 'FileProjectEditor', String(error))
      toast.error(t('import.chapterSplitFailed'))
    } finally { pending.current = false; setBusy(false) }
  }

  async function importChapters() {
    if (pending.current || dirty || !workspace || !stagedImport ||
        !Number.isSafeInteger(firstImportNumber) || firstImportNumber < 1) return
    clearInference()
    pending.current = true
    setBusy(true)
    const start = saveClock()
    let saved = false
    try {
      const result = await ipc.invoke('project:file-editor-import', workspace.token, firstImportNumber, stagedImport.chapters)
      saved = result.completed > 0
      const summary = t(result.blockedNumber ? 'project.fileEditorImportBlocked' : 'project.fileEditorImportDone')
        .replace('{count}', String(result.completed)).replace('{number}', String(result.blockedNumber))
      renderLog(result.blockedNumber ? 'warn' : 'info', 'Save:FileProjectEditor', `${summary} (${Math.round(saveClock() - start)}ms)`)
      if (result.firstLocator) {
        // 保留发布时的请求，索引失败后可以沿用原回执单独重试。
        setIndexBatch({ path: workspace.path, firstNumber: firstImportNumber, chapters: stagedImport.chapters })
        const locators = [...new Set([...storedTabs(workspace.path).locators.slice(-99), result.firstLocator])]
        const opened = await ipc.invoke('project:file-editor-open', workspace.path, locators)
        display(workspace.path, opened, result.firstLocator, locators)
      }
      if (result.blockedNumber) toast.warning(summary)
      else { setImportPreview(undefined); toast.success(summary) }
    } catch (error) {
      // 重新打开项目时恢复中断的发布。同一项目保留本次拆章结果和起始章号供重试。
      setWorkspace(undefined)
      renderLog('error', 'Save:FileProjectEditor', String(error))
      toast.error(t(saved ? 'project.fileEditorReloadFailed' : 'project.fileEditorOperationFailed'))
    } finally { pending.current = false; setBusy(false) }
  }

  async function indexImport() {
    if (pending.current || dirty || !workspace || !indexBatch || indexBatch.path !== workspace.path) return
    clearInference()
    pending.current = true
    setBusy(true)
    const start = saveClock()
    try {
      const { indexed } = await ipc.invoke('project:file-editor-index-import', workspace.token, indexBatch.firstNumber, indexBatch.chapters)
      const message = t('project.fileEditorIndexDone').replace('{count}', String(indexed))
      renderLog('info', 'Save:FileProjectEditor', `${message} (${Math.round(saveClock() - start)}ms)`)
      toast.success(message)
      setIndexBatch({ ...indexBatch, indexed: indexed > 0 })
    } catch (error) {
      renderLog('error', 'Save:FileProjectEditor', String(error))
      toast.error(t('project.fileEditorIndexFailed'))
    } finally { pending.current = false; setBusy(false) }
  }

  async function rebuildIndex() {
    if (pending.current || dirty || !workspace) return
    clearInference()
    pending.current = true
    setBusy(true)
    const start = saveClock()
    try {
      // 重建以磁盘上已保存的正文为准，编辑器只传当前会话凭据。
      const { indexed } = await ipc.invoke('project:file-editor-rebuild-index', workspace.token)
      setIndexPending(false)
      const message = t('project.fileEditorRebuildIndexDone').replace('{count}', String(indexed))
      renderLog('info', 'Save:FileProjectEditor', `${message} (${Math.round(saveClock() - start)}ms)`)
      toast.success(message)
    } catch (error) {
      renderLog('error', 'Save:FileProjectEditor', String(error))
      toast.error(t('project.fileEditorRebuildIndexFailed'))
    } finally { pending.current = false; setBusy(false) }
  }

  async function load(path?: string, locator?: string) {
    if (pending.current || dirty) return
    pending.current = true
    setBusy(true)
    try {
      const selectedPath = path ?? await ipc.invoke('dialog:select-folder')
      if (!selectedPath) return
      setOpeningDocument(true)
      clearInference()
      const previous = storedTabs(selectedPath)
      const requested = locator ? [...new Set([...previous.locators.slice(-99), locator])] : previous.locators
      let result = await ipc.invoke('project:file-editor-open', selectedPath, requested)
      if (!result.tabs.length && result.documents.length && !locator) {
        result = await ipc.invoke('project:file-editor-open', selectedPath, [...requested.slice(-99), result.documents[0].locator])
      }
      display(selectedPath, result, locator ?? previous.active, requested)
    } catch (error) {
      clearInference()
      renderLog('error', 'FileProjectEditor', String(error))
      toast.error(t('dialog.openFailed'))
      if (!recovery) {
        setWorkspace(undefined)
        setText('')
      }
    } finally { pending.current = false; setBusy(false); setOpeningDocument(false) }
  }

  async function save(proposal?: FileAgentEditProposal): Promise<boolean> {
    if (pending.current || !workspace || !active?.revision || active.readOnly) return false
    if (proposal ? dirty || proposal.locator !== active.locator || proposal.revision !== active.revision : !dirty) return false
    clearInference()
    pending.current = true
    setBusy(true)
    setSavingBody(!proposal)
    const start = saveClock()
    try {
      // 采纳提案只传编号，使用主进程实际落盘的正文更新编辑器。
      let content = text
      let result: { indexed: boolean; revision: string }
      if (proposal) {
        const applied = await ipc.invoke('project:file-editor-agent-resolve-edit', workspace.token, proposal.id, 'apply')
        if (applied.status !== 'saved') return false
        content = applied.content
        result = applied
        setText(content)
      } else {
        result = await ipc.invoke('project:file-editor-save', workspace.token, active.locator, active.revision, content)
      }
      setWorkspace({ ...workspace, tabs: workspace.tabs.map(tab =>
        tab.locator === active.locator ? { ...tab, content, revision: result.revision,
          lifecycle: tab.lifecycle && { ...tab.lifecycle, canFinalize: Boolean(content.trim()),
            pending: tab.lifecycle.canStageRevision && result.revision !== tab.revision ? [] : tab.lifecycle.pending } } : tab) })
      if (lifecycle?.canStageRevision && result.revision !== active.revision) setRevisionId(undefined)
      setPreview(undefined)
      if (!result.indexed) setIndexPending(true)
      renderLog('info', 'Save:FileProjectEditor', `${t('save.success')} (${Math.round(saveClock() - start)}ms)`)
      if (result.indexed) toast.success(t('save.success'))
      else toast.warning(t('project.fileEditorIndexPending'))
      return true
    } catch (error) {
      renderLog('error', 'Save:FileProjectEditor', String(error))
      toast.error(t('project.fileEditorSaveConflict'))
      return false
    } finally { pending.current = false; setBusy(false); setSavingBody(false) }
  }

  async function stageAgentRevision(proposal: FileAgentEditProposal): Promise<boolean> {
    if (pending.current || dirty || !workspace || !active || !lifecycle?.canStageRevision ||
        proposal.locator !== active.locator || proposal.revision !== active.revision) return false
    pending.current = true
    setBusy(true)
    const start = saveClock()
    try {
      const result = await ipc.invoke('project:file-editor-agent-resolve-edit', workspace.token, proposal.id, 'stage')
      if (result.status !== 'staged') return false
      // 待合并列表可立即预览，正文仍使用当前已保存的版本。
      setWorkspace({ ...workspace, tabs: workspace.tabs.map(tab => tab.locator === active.locator ? {
        ...tab, lifecycle: { ...lifecycle, pending: [...lifecycle.pending, { id: result.revisionId }] },
      } : tab) })
      setRevisionId(result.revisionId)
      setPreview(undefined)
      renderLog('info', 'Save:FileProjectEditor', `revision ${result.revisionId} (${Math.round(saveClock() - start)}ms)`)
      toast.success(t('project.fileEditorAgentStaged'))
      return true
    } catch (error) {
      renderLog('error', 'Save:FileProjectEditor', String(error))
      toast.error(t('project.fileEditorAgentStageFailed'))
      return false
    } finally { pending.current = false; setBusy(false) }
  }

  async function previewRevision() {
    if (pending.current || dirty || !workspace || !chapterId || !selectedRevision) return
    pending.current = true
    setBusy(true)
    setPreview(undefined)
    try {
      const result = await ipc.invoke('project:file-editor-preview', workspace.token, chapterId, selectedRevision)
      setPreview({ ...result, revisionId: selectedRevision })
    } catch (error) {
      renderLog('error', 'FileProjectEditor', String(error))
      toast.error(t('project.fileEditorOperationFailed'))
    } finally { pending.current = false; setBusy(false) }
  }

  async function commit(kind: Commit['kind']) {
    if (pending.current || dirty || !workspace || !active?.revision || !chapterId) return
    const base = { chapterId, expectedRevision: active.revision }
    let command: Commit
    if (kind === 'merge') {
      if (!preview) return
      command = { ...base, kind, revisionId: preview.revisionId, proposalHash: preview.contentHash }
    } else {
      if (!(kind === 'finalize' ? lifecycle?.canFinalize : lifecycle?.canArchive)) return
      command = { ...base, kind }
    }
    await persistCommit(command, active.locator)
  }

  async function publishContinuation(command: ContinuationCommand) {
    if (!continuationSource || !command.source?.contextRevision || command.number !== nextNumber || command.source.chapterId !== continuationSource.chapterId ||
        command.source.revision !== continuationSource.revision) return
    await persistCommit(command, `doc://chapter/${command.chapterId}`)
  }

  async function activateProject() {
    if (pending.current || dirty || !workspace?.canActivate) return
    pending.current = true
    setBusy(true)
    clearInference()
    const start = saveClock()
    let activated = false
    try {
      await ipc.invoke('project:file-editor-activate', workspace.token)
      activated = true
      const locators = workspace.tabs.map(tab => tab.locator)
      const reopened = await ipc.invoke('project:file-editor-open', workspace.path, locators)
      display(workspace.path, reopened, workspace.active, locators)
      renderLog('info', 'Save:FileProjectEditor', `${t('project.fileEditorActivated')} (${Math.round(saveClock() - start)}ms)`)
      toast.success(t('project.fileEditorActivated'))
    } catch (error) {
      if (activated) setWorkspace(undefined)
      renderLog('error', 'Save:FileProjectEditor', String(error))
      toast.error(t(activated ? 'project.fileEditorReloadFailed' : 'project.fileEditorActivateFailed'))
    } finally { pending.current = false; setBusy(false) }
  }

  async function persistCommit(command: FileDraftCommand, locator: string) {
    if (pending.current || dirty || !workspace) return
    clearInference()
    pending.current = true
    setBusy(true)
    let committed = false
    const start = saveClock()
    try {
      await ipc.invoke('project:file-editor-commit', workspace.token, command)
      committed = true
      renderLog('info', 'Save:FileProjectEditor', `${command.kind} (${Math.round(saveClock() - start)}ms)`)
      // 收到持久化回执后，重新读取正文、revision 和可用操作。
      const { locators } = storedTabs(workspace.path)
      const requested = [...new Set([...locators.slice(-99), locator])]
      const result = await ipc.invoke('project:file-editor-open', workspace.path, requested)
      if (command.kind === 'create' && !result.tabs.some(tab => tab.locator === locator)) throw new Error('Created chapter could not be reopened')
      display(workspace.path, result, locator, requested)
      toast.success(t('save.success'))
    } catch (error) {
      // Show the captured text and preview while the normal open path verifies the receipt.
      setRecovery({ locator, committed })
      renderLog('error', 'Save:FileProjectEditor', String(error))
      toast.error(t(committed ? 'project.fileEditorReloadFailed' : 'project.fileEditorOperationFailed'))
    } finally { pending.current = false; setBusy(false) }
  }

  function changeOpen(next: boolean) {
    if (!next) {
      if (pending.current) return
      if (dirty) { toast.warning(t('project.fileEditorSaveFirst')); return }
      clearInference()
      if (workspace) void ipc.invoke('project:file-editor-close', workspace.token).catch(error => renderLog('warn', 'FileProjectEditor', String(error)))
      setWorkspace(undefined)
      setText('')
      setPreview(undefined)
      setRecovery(undefined)
      setIndexPending(false)
      setImportPreview(undefined)
      setIndexBatch(undefined)
      setRevisionId(undefined)
      setConfirmation(undefined)
    }
    setOpen(next)
  }

  const openFromProjectEntry = useEffectEvent(({ projectPath }: { projectPath?: string }) => {
    if (pending.current) return
    setOpen(true)
    if (!projectPath) return
    // A route request must preserve any unsaved text in the existing file editor.
    if (dirty) { toast.warning(t('project.fileEditorSaveFirst')); return }
    void load(projectPath)
  })
  useEffect(() => globalEventBus.on('OPEN_FILE_PROJECT_EDITOR', request => openFromProjectEntry(request)), [])
  useEffect(() => () => {
    const run = inferenceRun.current
    inferenceRun.current = undefined
    run?.abort()
  }, [])

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      {showTrigger && <DialogTrigger asChild><Button variant="outline" className="w-full">{t('project.fileEditor')}</Button></DialogTrigger>}
      <DialogContent preventOutsideClose className="flex max-h-[85vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>{t('project.fileEditor')}</DialogTitle>
          <DialogDescription>{t('project.fileEditorDescription')}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-3 overflow-auto p-4" aria-busy={busy}>
          <Button variant="outline" disabled={busy || dirty} onClick={() => void load()}>{t('project.fileEditorChoose')}</Button>
          {workspace && recovery && (
            <div className="flex flex-col gap-2">
              <p role="status">{t(recovery.committed ? 'project.fileEditorReloadFailed' : 'project.fileEditorOperationFailed')}</p>
              <Button type="button" variant="outline" disabled={busy} onClick={() => void load(workspace.path, recovery.locator)}>
                {t('action.retry')}
              </Button>
              <textarea aria-label={t('project.fileEditorBody')} rows={10} readOnly value={text}
                className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-3" />
              {preview && <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded border border-[var(--color-border)] p-3">{preview.content}</pre>}
            </div>
          )}
          {workspace && !recovery && (
            <>
              <p className="truncate text-sm" title={workspace.path}>{workspace.path}</p>
              {workspace.activation && <p className="text-sm">{t('project.fileEditorActivated')}</p>}
              {indexPending && <p role="status" className="text-sm">{t('project.fileEditorIndexPending')}</p>}
              {workspace.canActivate && <Button variant="outline" disabled={busy || dirty}
                onClick={() => requestConfirmation('activate')}>{t('project.fileEditorActivate')}</Button>}
              {!openingDocument && <FileProjectAgent key={workspace.token} token={workspace.token} locator={active?.locator} disabled={busy}
                editableRevision={dirty || active?.readOnly ? undefined : active?.revision} onApply={save}
                onStage={lifecycle?.canStageRevision ? stageAgentRevision : undefined} />}
              {!openingDocument && continuationSource && active && nextNumber !== undefined && <FileChapterContinuation
                key={`${workspace.token}:${active.locator}:${active.revision}`} token={workspace.token} number={nextNumber}
                source={continuationSource} disabled={busy || dirty} onPublish={publishContinuation} />}
              {workspace.importStartNumber !== undefined && (
                <>
                  {!stagedImport && <Button variant="outline" disabled={busy || dirty}
                    onClick={() => void previewImport()}>{t('project.fileEditorImport')}</Button>}
                  <Button variant="outline" disabled={busy || dirty}
                    onClick={() => void rebuildIndex()}>{t('project.fileEditorRebuildIndex')}</Button>
                </>
              )}
              {indexBatch?.path === workspace.path && (
                <Button variant="outline" disabled={busy || dirty} onClick={() => void indexImport()}>{t('project.fileEditorIndexImport')}</Button>
              )}
              {indexBatch?.path === workspace.path && indexBatch.indexed && !inferenceMode && (
                <Button variant="outline" disabled={busy || dirty} onClick={() => void inferImport('settings')}>{t('project.fileEditorInferImport')}</Button>
              )}
              {indexBatch?.path === workspace.path && !inferenceMode && (
                <Button variant="outline" disabled={busy || dirty} onClick={() => void inferImport('blueprints')}>{t('project.fileEditorInferBlueprints')}</Button>
              )}
              {inferenceMode && (
                <div className="flex flex-wrap items-center gap-2">
                  <p role="status" className="text-sm">{inferenceMode === 'settings' ? t('project.fileEditorInferring')
                    : blueprintProgress ? t('project.fileEditorBlueprintProgress').replace('{done}', String(blueprintProgress.completed))
                      .replace('{total}', String(blueprintProgress.total)) : t('status.loading')}</p>
                  <Button variant="outline" onClick={clearInference}>{t('action.cancel')}</Button>
                </div>
              )}
              {inferencePreview && (
                <section className="flex flex-col gap-2" aria-label={t('project.fileEditorInferencePreview')}>
                  <h3 className="font-medium">{t('project.fileEditorInferencePreview')}</h3>
                  {(Object.keys(inferenceLabels) as FileImportSettingField[]).map(field => inferencePreview.values[field] && (
                    <div key={field}>
                      <h4 className="text-sm font-medium">{t(inferenceLabels[field])}</h4>
                      {settingsOffer?.occupied.includes(field) && <p className="text-sm">{t('project.fileEditorSettingOccupied')}</p>}
                      {!settingsOffer?.available.includes(field) && <p className="text-sm">{t('project.fileEditorSettingPreviewOnly')}</p>}
                      {inferencePreview.applied?.includes(field) && <p className="text-sm">{t('project.fileEditorSettingApplied')}</p>}
                      <p className="whitespace-pre-wrap break-words text-sm">{inferencePreview.values[field]}</p>
                    </div>
                  ))}
                  {canApplySettings && (
                    <Button variant="outline" disabled={busy || dirty || !!inferenceMode} onClick={() => requestConfirmation('apply-settings')}>
                      {t('project.fileEditorApplySettings')}
                    </Button>
                  )}
                </section>
              )}
              {blueprintPreview && (
                <section className="flex flex-col gap-2" aria-label={t('project.fileEditorBlueprintPreview')}>
                  <h3 className="font-medium">{t('project.fileEditorBlueprintPreview')}</h3>
                  {blueprintPreview.existingChapterNumbers.length > 0 && (
                    <p className="text-sm">{t('project.fileEditorBlueprintsExisting').replace('{count}', String(blueprintPreview.existingChapterNumbers.length))}</p>
                  )}
                  {blueprintPreview.items.map(item => (
                    <details key={item.chapterNumber} className="text-sm">
                      <summary>{item.chapterNumber}. {item.title}</summary>
                      <dl className="flex flex-col gap-1">
                        <dt>{t('chapter.role')}</dt><dd>{t(roleLabels[item.role as keyof typeof roleLabels] ?? 'chapter.role.development')}</dd>
                        <dt>{t('chapter.purpose')}</dt><dd className="whitespace-pre-wrap break-words">{item.purpose}</dd>
                        <dt>{t('chapter.keyEvents')}</dt><dd className="whitespace-pre-wrap break-words">{item.keyEvents}</dd>
                        <dt>{t('chapter.characters')}</dt><dd>{item.characters.join(', ')}</dd>
                        <dt>{t('project.fileEditorBlueprintHook')}</dt><dd className="whitespace-pre-wrap break-words">{item.suspenseHook}</dd>
                      </dl>
                    </details>
                  ))}
                  {blueprintPreview.items.length > 0 && !blueprintPreview.offerId && <p className="text-sm">{t('project.fileEditorSettingPreviewOnly')}</p>}
                  {blueprintPreview.receipt && <p className="text-sm">{t('project.fileEditorBlueprintsApplied')
                    .replace('{inserted}', String(blueprintPreview.receipt.insertedChapterNumbers.length))
                    .replace('{skipped}', String(blueprintPreview.receipt.skippedChapterNumbers.length))}</p>}
                  {blueprintPreview.offerId && !blueprintPreview.receipt && (
                    <Button variant="outline" disabled={busy || dirty || !!inferenceMode} onClick={() => requestConfirmation('apply-blueprints')}>
                      {t('project.fileEditorApplyBlueprints')}
                    </Button>
                  )}
                </section>
              )}
              {stagedImport && (
                <form className="flex flex-col gap-2" onSubmit={event => { event.preventDefault(); void importChapters() }}>
                  <p className="text-sm">{t('project.fileEditorImportPreview').replace('{count}', String(stagedImport.chapters.length))}</p>
                  <label className="flex flex-col gap-1 text-sm">
                    {t('project.fileEditorImportStart')}
                    <input type="number" min={1} step={1} required value={stagedImport.firstNumber} disabled={busy || dirty}
                      onChange={event => setImportPreview({ ...stagedImport, firstNumber: event.target.value })}
                      className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2" />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={busy || dirty || !Number.isSafeInteger(firstImportNumber) || firstImportNumber < 1}>
                      {t(busy ? 'import.importing' : 'import.startImport')}
                    </Button>
                    <Button type="button" variant="outline" disabled={busy} onClick={() => setImportPreview(undefined)}>{t('action.cancel')}</Button>
                  </div>
                </form>
              )}
              {workspace.missing.length > 0 && <p role="status">{t('project.fileEditorUnavailable')}</p>}
              {workspace.documents.length === 0 ? <p>{t('project.fileEditorEmpty')}</p> : (
                <label className="flex flex-col gap-1 text-sm">
                  {t('project.fileEditorDocument')}
                  <select value={workspace.active} disabled={busy || dirty} onChange={event => void load(workspace.path, event.target.value)}
                    className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
                    {!workspace.active && <option value="" disabled>{t('project.fileEditorDocument')}</option>}
                    {workspace.documents.map(document => (
                      <option key={document.locator} value={document.locator}>
                        {document.locator.startsWith('doc://history/')
                          ? t('project.fileEditorHistory').replace('{name}', document.name).replace('{id}', document.locator.slice('doc://history/'.length))
                          : document.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {active && (
                <form className="flex flex-col gap-2" onSubmit={event => { event.preventDefault(); void save() }}>
                  <textarea aria-label={t('project.fileEditorBody')} rows={14} value={text} readOnly={active.readOnly || (busy && !savingBody)}
                    onChange={event => {
                      if (inferenceRun.current || inferencePreview || blueprintPreview) clearInference()
                      setText(event.target.value)
                    }}
                    className="resize-y rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-3" />
                  <div className="flex gap-2">
                    <Button type="submit" disabled={busy || !dirty || active.readOnly}>{t(savingBody ? 'status.saving' : 'action.save')}</Button>
                    {dirty && <Button type="button" variant="outline" disabled={busy} onClick={() => setText(active.content)}>
                      {t('project.fileEditorDiscard')}
                    </Button>}
                  </div>
                </form>
              )}
              {lifecycle && (
                <div className="nf-version-action-container flex flex-col gap-2">
                  {lifecycle.pending.length > 0 && (
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="flex flex-col gap-1 text-sm">
                        {t('project.fileEditorRevision')}
                        <select value={selectedRevision} disabled={busy || dirty} onChange={event => {
                          setRevisionId(Number(event.target.value))
                          setPreview(undefined)
                        }} className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
                          {lifecycle.pending.map(revision => <option key={revision.id} value={revision.id}>#{revision.id}</option>)}
                        </select>
                      </label>
                      <Button variant="outline" disabled={busy || dirty} onClick={() => void previewRevision()}>{t('project.fileEditorPreview')}</Button>
                    </div>
                  )}
                  {preview && <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded border border-[var(--color-border)] p-3">{preview.content}</pre>}
                  <VersionActions actions={([
                    { enabled: Boolean(preview), label: 'project.fileEditorMerge', kind: 'merge' },
                    { enabled: lifecycle.canFinalize, label: 'project.fileEditorFinalize', kind: 'finalize' },
                    { enabled: lifecycle.canArchive, label: 'project.fileEditorArchive', kind: 'archive' },
                  ] as const).filter(action => action.enabled).map(({ label, kind }): VersionAction => ({
                    label: t(label), disabled: busy || dirty, onSelect: () => requestConfirmation(kind),
                  }))} />
                </div>
              )}
            </>
          )}
        </div>
        {/* Use a nested Radix dialog so the editor's focus trap yields to confirmation. */}
        <Dialog open={Boolean(confirmation)} onOpenChange={next => { if (!next) setConfirmation(undefined) }}>
          <DialogContent onCloseAutoFocus={event => {
            if (!confirmationOrigin?.isConnected) return
            event.preventDefault()
            confirmationOrigin.focus()
          }}>
            <DialogHeader>
              <DialogTitle>{t('dialog.confirmTitle')}</DialogTitle>
              <DialogDescription>{t(confirmation === 'activate' ? 'project.fileEditorConfirmActivate'
                : confirmation === 'apply-blueprints' ? 'project.fileEditorConfirmApplyBlueprints'
                : confirmation === 'apply-settings' ? 'project.fileEditorConfirmApplySettings'
                : confirmation === 'merge' ? 'project.fileEditorConfirmMerge'
                : confirmation === 'finalize' ? 'project.fileEditorConfirmFinalize' : 'project.fileEditorConfirmArchive')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmation(undefined)}>{t('action.cancel')}</Button>
              <Button onClick={() => {
                if (confirmation === 'activate') void activateProject()
                else if (confirmation === 'apply-blueprints') void applyInferredBlueprints()
                else if (confirmation === 'apply-settings') void applyInferredSettings()
                else if (confirmation) void commit(confirmation)
                setConfirmation(undefined)
              }}>{t('dialog.confirm')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}
