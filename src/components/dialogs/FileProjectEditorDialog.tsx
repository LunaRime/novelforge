import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from '../../hooks/useTranslation'
import { ipc } from '../../services/ipc-client'
import { renderLog } from '../../services/render-logger'
import { inferFileImport, type FileImportInference } from '../../services/workflows/file-import-inference'
import type { FileImportChapter, ProjectChannels } from '../../shared/ipc-channels'
import { globalEventBus } from '../../shared/event-bus'
import { Button } from '../ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../ui/Dialog'
import { toast } from '../ui/Toast'

type Opened = ProjectChannels['project:file-editor-open']['return']
type Workspace = Opened & { path: string; active: string }
type Commit = Exclude<ProjectChannels['project:file-editor-commit']['args'][1], { kind: 'create' }>
type Preview = ProjectChannels['project:file-editor-preview']['return'] & { revisionId: number }
type ImportPreview = { path: string; chapters: FileImportChapter[]; firstNumber: string }
type ImportBatch = Omit<ImportPreview, 'firstNumber'> & { firstNumber: number; indexed?: boolean }

const inferenceLabels = {
  worldSetting: 'novelConfig.worldSetting', coreOutline: 'novelConfig.coreOutline',
  protagonistProfile: 'novelConfig.protagonist', writingStyle: 'project.fileEditorInferenceStyle',
} as const satisfies Record<keyof FileImportInference, string>

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
  const [revisionId, setRevisionId] = useState<number>()
  const [preview, setPreview] = useState<Preview>()
  const [importPreview, setImportPreview] = useState<ImportPreview>()
  const [indexBatch, setIndexBatch] = useState<ImportBatch>()
  const [inferencePreview, setInferencePreview] = useState<FileImportInference>()
  const [inferring, setInferring] = useState(false)
  const [confirmation, setConfirmation] = useState<Commit['kind']>()
  const pending = useRef(false)
  const inferenceRun = useRef<AbortController | undefined>(undefined)
  const active = workspace?.tabs.find(tab => tab.locator === workspace.active)
  const dirty = !!active && active.content !== text
  const stagedImport = importPreview?.path === workspace?.path ? importPreview : undefined
  const firstImportNumber = Number(stagedImport?.firstNumber)
  const lifecycle = active?.lifecycle
  const selectedRevision = revisionId ?? lifecycle?.pending[0]?.id
  const chapterId = lifecycle ? active?.locator.slice('doc://chapter/'.length) : undefined

  function remember(path: string, locators: string[], active: string) {
    try { localStorage.setItem(`novelforge-file-editor:${path}`, JSON.stringify({ locators, active })) }
    catch (error) { renderLog('warn', 'FileProjectEditor', String(error)) }
  }

  function display(path: string, result: Opened, preferred: string, requested: string[]) {
    // A preview belongs to the previous document and revision, even if the locator stayed the same.
    setPreview(undefined)
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
    setInferring(false)
    setInferencePreview(undefined)
  }

  async function inferImport() {
    if (pending.current || inferenceRun.current || dirty || !workspace || !indexBatch?.indexed || indexBatch.path !== workspace.path) return
    const run = new AbortController()
    inferenceRun.current = run
    setInferencePreview(undefined)
    setInferring(true)
    try {
      const result = await inferFileImport(workspace.token, indexBatch.firstNumber, indexBatch.chapters, run.signal)
      // 只接受当前运行的结果，取消或换项目后丢弃迟到的回包。
      if (inferenceRun.current === run) setInferencePreview(result)
    } catch (error) {
      if (inferenceRun.current !== run) return
      renderLog('error', 'FileProjectEditor', String(error))
      toast.error(t('project.fileEditorInferenceFailed'))
    } finally {
      if (inferenceRun.current === run) {
        inferenceRun.current = undefined
        setInferring(false)
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

  async function load(path?: string, locator?: string) {
    if (pending.current || dirty) return
    pending.current = true
    setBusy(true)
    try {
      const selectedPath = path ?? await ipc.invoke('dialog:select-folder')
      if (!selectedPath) return
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
      setWorkspace(undefined)
      setText('')
    } finally { pending.current = false; setBusy(false) }
  }

  async function save() {
    if (pending.current || !workspace || !active?.revision || active.readOnly || !dirty) return
    clearInference()
    pending.current = true
    setBusy(true)
    const start = saveClock()
    try {
      const result = await ipc.invoke('project:file-editor-save', workspace.token, active.locator, active.revision, text)
      setWorkspace({ ...workspace, tabs: workspace.tabs.map(tab =>
        tab.locator === active.locator ? { ...tab, content: text, revision: result.revision,
          lifecycle: tab.lifecycle && { ...tab.lifecycle, canFinalize: Boolean(text.trim()) } } : tab) })
      setPreview(undefined)
      renderLog('info', 'Save:FileProjectEditor', `${t('save.success')} (${Math.round(saveClock() - start)}ms)`)
      if (result.indexed) toast.success(t('save.success'))
      else toast.warning(t('project.fileEditorIndexPending'))
    } catch (error) {
      renderLog('error', 'Save:FileProjectEditor', String(error))
      toast.error(t('project.fileEditorSaveConflict'))
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
    clearInference()
    pending.current = true
    setBusy(true)
    let committed = false
    const start = saveClock()
    try {
      await ipc.invoke('project:file-editor-commit', workspace.token, command)
      committed = true
      renderLog('info', 'Save:FileProjectEditor', `${kind} (${Math.round(saveClock() - start)}ms)`)
      // Reload authoritative text, revision and permissions together after the durable receipt.
      const { locators } = storedTabs(workspace.path)
      const result = await ipc.invoke('project:file-editor-open', workspace.path, [...new Set([...locators.slice(-99), active.locator])])
      display(workspace.path, result, active.locator, locators)
      toast.success(t('save.success'))
    } catch (error) {
      // A failure can follow file publication. Hide stale controls until open/recovery runs again.
      setWorkspace(undefined)
      setPreview(undefined)
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
          {workspace && (
            <>
              <p className="truncate text-sm" title={workspace.path}>{workspace.path}</p>
              {workspace.importStartNumber !== undefined && !stagedImport && (
                <Button variant="outline" disabled={busy || dirty} onClick={() => void previewImport()}>{t('project.fileEditorImport')}</Button>
              )}
              {indexBatch?.path === workspace.path && (
                <Button variant="outline" disabled={busy || dirty} onClick={() => void indexImport()}>{t('project.fileEditorIndexImport')}</Button>
              )}
              {indexBatch?.path === workspace.path && indexBatch.indexed && !inferring && (
                <Button variant="outline" disabled={busy || dirty} onClick={() => void inferImport()}>{t('project.fileEditorInferImport')}</Button>
              )}
              {inferring && (
                <div className="flex flex-wrap items-center gap-2">
                  <p role="status" className="text-sm">{t('project.fileEditorInferring')}</p>
                  <Button variant="outline" onClick={clearInference}>{t('action.cancel')}</Button>
                </div>
              )}
              {inferencePreview && (
                <section className="flex flex-col gap-2" aria-label={t('project.fileEditorInferencePreview')}>
                  <h3 className="font-medium">{t('project.fileEditorInferencePreview')}</h3>
                  {(Object.keys(inferenceLabels) as Array<keyof FileImportInference>).map(field => inferencePreview[field] && (
                    <div key={field}>
                      <h4 className="text-sm font-medium">{t(inferenceLabels[field])}</h4>
                      <p className="whitespace-pre-wrap break-words text-sm">{inferencePreview[field]}</p>
                    </div>
                  ))}
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
                  <textarea aria-label={t('project.fileEditorBody')} rows={14} value={text} readOnly={active.readOnly || busy}
                    onChange={event => {
                      if (inferenceRun.current || inferencePreview) clearInference()
                      setText(event.target.value)
                    }}
                    className="resize-y rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-3" />
                  <div className="flex gap-2">
                    <Button type="submit" disabled={busy || !dirty || active.readOnly}>{t('action.save')}</Button>
                    {dirty && <Button type="button" variant="outline" disabled={busy} onClick={() => setText(active.content)}>
                      {t('project.fileEditorDiscard')}
                    </Button>}
                  </div>
                </form>
              )}
              {lifecycle && (
                <div className="flex flex-col gap-2">
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
                  <div className="flex flex-wrap gap-2">
                    {preview && <Button variant="outline" disabled={busy || dirty} onClick={() => setConfirmation('merge')}>{t('project.fileEditorMerge')}</Button>}
                    {lifecycle.canFinalize && <Button variant="outline" disabled={busy || dirty} onClick={() => setConfirmation('finalize')}>{t('project.fileEditorFinalize')}</Button>}
                    {lifecycle.canArchive && <Button variant="outline" disabled={busy || dirty} onClick={() => setConfirmation('archive')}>{t('project.fileEditorArchive')}</Button>}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        {/* Use a nested Radix dialog so the editor's focus trap yields to confirmation. */}
        <Dialog open={Boolean(confirmation)} onOpenChange={next => { if (!next) setConfirmation(undefined) }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('dialog.confirmTitle')}</DialogTitle>
              <DialogDescription>{t(confirmation === 'merge' ? 'project.fileEditorConfirmMerge'
                : confirmation === 'finalize' ? 'project.fileEditorConfirmFinalize' : 'project.fileEditorConfirmArchive')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmation(undefined)}>{t('action.cancel')}</Button>
              <Button onClick={() => {
                if (confirmation) void commit(confirmation)
                setConfirmation(undefined)
              }}>{t('dialog.confirm')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}
