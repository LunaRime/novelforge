import { useRef, useState } from 'react'
import { useTranslation } from '../../hooks/useTranslation'
import { ipc } from '../../services/ipc-client'
import { renderLog } from '../../services/render-logger'
import type { ProjectChannels } from '../../shared/ipc-channels'
import { Button } from '../ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../ui/Dialog'
import { toast } from '../ui/Toast'

type Opened = ProjectChannels['project:file-editor-open']['return']
type Workspace = Opened & { path: string; active: string }

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

export function FileProjectEditorDialog() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [workspace, setWorkspace] = useState<Workspace>()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const active = workspace?.tabs.find(tab => tab.locator === workspace.active)
  const dirty = !!active && active.content !== text

  function remember(path: string, locators: string[], active: string) {
    try { localStorage.setItem(`novelforge-file-editor:${path}`, JSON.stringify({ locators, active })) }
    catch (error) { renderLog('warn', 'FileProjectEditor', String(error)) }
  }

  function display(path: string, result: Opened, preferred: string, requested: string[]) {
    const selected = result.tabs.find(tab => tab.locator === preferred) ?? result.tabs[0]
    setWorkspace({ ...result, path, active: selected?.locator ?? '' })
    setText(selected?.content ?? '')
    const locators = [...new Set([...result.tabs.map(tab => tab.locator), ...result.missing.filter(locator => requested.includes(locator))])]
    remember(path, locators, selected?.locator ?? preferred)
  }

  async function load(path?: string, locator?: string) {
    if (pending.current || dirty) return
    pending.current = true
    setBusy(true)
    try {
      const selectedPath = path ?? await ipc.invoke('dialog:select-folder')
      if (!selectedPath) return
      const previous = storedTabs(selectedPath)
      const requested = locator ? [...new Set([...previous.locators.slice(-99), locator])] : previous.locators
      let result = await ipc.invoke('project:file-editor-open', selectedPath, requested)
      if (!result.tabs.length && result.documents.length && !locator) {
        result = await ipc.invoke('project:file-editor-open', selectedPath, [...requested.slice(-99), result.documents[0].locator])
      }
      display(selectedPath, result, locator ?? previous.active, requested)
    } catch (error) {
      renderLog('error', 'FileProjectEditor', String(error))
      toast.error(t('dialog.openFailed'))
      setWorkspace(undefined)
      setText('')
    } finally { pending.current = false; setBusy(false) }
  }

  async function save() {
    if (pending.current || !workspace || !active?.revision || active.readOnly || !dirty) return
    pending.current = true
    setBusy(true)
    const start = Date.now()
    try {
      const result = await ipc.invoke('project:file-editor-save', workspace.token, active.locator, active.revision, text)
      setWorkspace({ ...workspace, tabs: workspace.tabs.map(tab =>
        tab.locator === active.locator ? { ...tab, content: text, revision: result.revision } : tab) })
      renderLog('info', 'Save:FileProjectEditor', `${t('save.success')} (${Date.now() - start}ms)`)
      if (result.indexed) toast.success(t('save.success'))
      else toast.warning(t('project.fileEditorIndexPending'))
    } catch (error) {
      renderLog('error', 'Save:FileProjectEditor', String(error))
      toast.error(t('project.fileEditorSaveConflict'))
    } finally { pending.current = false; setBusy(false) }
  }

  function changeOpen(next: boolean) {
    if (!next) {
      if (pending.current) return
      if (dirty) { toast.warning(t('project.fileEditorSaveFirst')); return }
      if (workspace) void ipc.invoke('project:file-editor-close', workspace.token).catch(error => renderLog('warn', 'FileProjectEditor', String(error)))
      setWorkspace(undefined)
      setText('')
    }
    setOpen(next)
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button variant="outline" className="w-full">{t('project.fileEditor')}</Button></DialogTrigger>
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
                    onChange={event => setText(event.target.value)}
                    className="resize-y rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-3" />
                  <div className="flex gap-2">
                    <Button type="submit" disabled={busy || !dirty || active.readOnly}>{t('action.save')}</Button>
                    {dirty && <Button type="button" variant="outline" disabled={busy} onClick={() => setText(active.content)}>
                      {t('project.fileEditorDiscard')}
                    </Button>}
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
