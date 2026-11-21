import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Check, ChevronRight, Copy, FileText, FolderOpen, ListEnd, ListStart, RefreshCw, ScrollText, Search } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { ipc } from '../../services/ipc-client'
import { getCurrentLogEnv } from '../../services/render-logger'
import type { LogEnvMode, LogFileInfo } from '../../shared/ipc-channels'
import { SortDirectionIcon } from '../ui/ActionIcons'
import { Button } from '../ui/Button'
import { FilterButtons } from '../ui/ChoiceControls'
import CountBadge from '../ui/CountBadge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/Dialog'
import { EmptyState } from '../ui/EmptyState'
import { Input } from '../ui/Input'
import { Spinner } from '../ui/Spinner'
import { toast } from '../ui/Toast'
import './log-file-dialog.css'

const MAX_LINES = 2000
const LEVEL_KEYS = { DEBUG: 'log.levelDebug', INFO: 'log.filterInfo', WARN: 'log.filterWarn', ERROR: 'log.filterError' } as const
type Level = keyof typeof LEVEL_KEYS
type LogRecord = { id: number; time?: string; timestamp: number; level?: Level; source?: string; raw: string; message: string }

/** 将堆栈续行留在所属记录内，倒序和搜索时仍能完整阅读。 */
function parseRecords(text: string): LogRecord[] {
  const records: LogRecord[] = []
  for (const line of text.trimEnd().split(/\r?\n/)) {
    if (!line && records.length === 0) continue
    const match = /^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\] \[(DEBUG|INFO|WARN|ERROR)\s*\] \[([^\]]+)\] (.*)$/.exec(line)
    if (match) {
      records.push({ id: records.length, time: match[1], timestamp: Date.parse(match[1]) || 0, level: match[2] as Level, source: match[3], message: match[4], raw: line })
    } else {
      const last = records.at(-1)
      if (last) { last.raw += '\n' + line; last.message += '\n' + line }
      else records.push({ id: 0, timestamp: 0, message: line, raw: line })
    }
  }
  return records
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

type FileContent = { success: boolean; content?: string; totalLines?: number; error?: string }

export default function LogFileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, locale } = useTranslation()
  const [env, setEnv] = useState<LogEnvMode>(getCurrentLogEnv)
  const [groups, setGroups] = useState<Array<{ env: LogEnvMode; files: LogFileInfo[] }>>([])
  const [fileName, setFileName] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [listState, setListState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [fileResult, setFileResult] = useState<{ key: string; data: FileContent }>()
  const [query, setQuery] = useState('')
  const [listAsc, setListAsc] = useState(false)
  const [recordsAsc, setRecordsAsc] = useState(true)
  const [copied, setCopied] = useState(false)
  const scroll = useRef<HTMLDivElement>(null)

  const newestFirst = useMemo(() => [...(groups.find(group => group.env === env)?.files ?? [])]
    .sort((a, b) => b.mtime - a.mtime), [groups, env])
  const files = listAsc ? [...newestFirst].reverse() : newestFirst
  const selected = newestFirst.find(file => file.name === fileName) ?? newestFirst[0]
  const selectedName = selected?.name
  const key = selectedName ? JSON.stringify([env, selectedName, refresh]) : ''
  const result = fileResult?.key === key ? fileResult?.data : undefined
  const content = result?.success ? result.content ?? '' : ''
  const search = query.trim().toLowerCase()
  const records = useMemo(() => parseRecords(content).sort((a, b) => a.timestamp - b.timestamp), [content])
  const visible = useMemo(() => {
    const matches = records.filter(item => !search || item.raw.toLowerCase().includes(search))
    return recordsAsc ? matches : matches.reverse()
  }, [records, search, recordsAsc])
  const date = useMemo(() => new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }), [locale])
  const time = useMemo(() => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }), [locale])

  useEffect(() => {
    if (!open) return
    let stale = false
    void ipc.invoke('log:list-files').then(response => {
      if (!stale) { setGroups(response); setListState('ready') }
    }).catch(() => { if (!stale) setListState('failed') })
    return () => { stale = true }
  }, [open, refresh])

  useEffect(() => {
    if (!open || !selectedName) return
    let stale = false
    void ipc.invoke('log:read-file', env, selectedName, MAX_LINES)
      .then(data => { if (!stale) setFileResult({ key, data }) })
      .catch(() => { if (!stale) setFileResult({ key, data: { success: false } }) })
    return () => { stale = true }
  }, [open, env, selectedName, key])

  useEffect(() => {
    const pane = scroll.current
    if (pane) pane.scrollTop = recordsAsc && !search ? pane.scrollHeight : 0
  }, [result, recordsAsc, search])
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(visible.map(item => item.raw).join('\n'))
      setCopied(true)
    } catch { toast.error(t('log.copyFailed')) }
  }
  const openDir = async () => {
    try {
      if (!(await ipc.invoke('log:open-dir')).success) toast.error(t('log.openDirFailed'))
    } catch { toast.error(t('log.openDirFailed')) }
  }

  const total = result?.totalLines ?? 0
  return (
    <Dialog open={open} onOpenChange={next => {
      if (!next) { setQuery(''); setCopied(false); setFileResult(undefined); setListState('loading') }
      onOpenChange(next)
    }}>
      <DialogContent className="nf-log-file-dialog">
        <DialogHeader className="nf-log-file-header">
          <div className="flex min-w-0 items-center gap-3">
            <span className="nf-log-file-mark"><ScrollText size={18} aria-hidden="true" /></span>
            <div><DialogTitle>{t('log.title')}</DialogTitle><DialogDescription>{t('log.fileHint')}</DialogDescription></div>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <FilterButtons size="sm" value={env} onChange={value => { setEnv(value); setFileName(''); setQuery('') }}
              items={[{ value: 'dev', label: t('log.envDev') }, { value: 'release', label: t('log.envRelease') }]} />
            <Button variant="ghost" size="icon" onClick={() => { setListState('loading'); setRefresh(value => value + 1) }}
              title={t('log.refresh')} aria-label={t('log.refresh')}><RefreshCw size={15} aria-hidden="true" /></Button>
            <Button variant="ghost" size="icon" onClick={() => void openDir()}
              title={t('log.openDir')} aria-label={t('log.openDir')}><FolderOpen size={15} aria-hidden="true" /></Button>
          </div>
        </DialogHeader>

        <div className="nf-log-file-layout">
          <aside className="nf-log-file-list" aria-label={t('log.fileList')}>
            <div className="nf-log-file-list-head">
              <strong>{t('log.fileList')}</strong><CountBadge value={files.length} />
              <Button variant="ghost" size="icon" className="ms-auto size-8" onClick={() => setListAsc(value => !value)}
                title={t(listAsc ? 'log.filesOldest' : 'log.filesNewest')} aria-label={t(listAsc ? 'log.filesOldest' : 'log.filesNewest')}>
                <SortDirectionIcon direction={listAsc ? 'asc' : 'desc'} />
              </Button>
            </div>
            <div className="nf-log-file-items">
              {listState === 'failed' ? <p role="alert" className="p-3 text-xs text-[var(--color-error)]">{t('log.loadError')}</p>
                : files.length === 0 ? <EmptyState size="xs" message={t(listState === 'ready' ? 'log.noFiles' : 'status.loading')} />
                  : files.map(file => (
                    <button key={file.name} type="button" aria-current={selectedName === file.name || undefined} className="nf-log-file-item"
                      onClick={() => { setFileName(file.name); setQuery('') }} data-tooltip={file.name}>
                      <FileText size={15} aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium">{file.name}</span>
                        <span className="nf-log-file-meta">
                          {file.mtime > 0 && <span><CalendarDays size={11} aria-hidden="true" /> {date.format(file.mtime)}</span>}
                          <span>{sizeLabel(file.size)}</span>
                        </span>
                      </span>
                      <ChevronRight size={13} className="ms-auto shrink-0 opacity-50" aria-hidden="true" />
                    </button>
                  ))}
            </div>
          </aside>

          <div className="nf-log-file-body">
            <div className="nf-log-file-tools">
              <div className="nf-log-file-search">
                <Search size={14} aria-hidden="true" />
                <Input type="search" value={query} onChange={event => setQuery(event.target.value)} disabled={!content}
                  aria-label={t('log.fileSearch')} placeholder={t('log.fileSearch')} className="h-8" />
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" disabled={!content} onClick={() => setRecordsAsc(value => !value)}
                  title={t(recordsAsc ? 'log.sortAsc' : 'log.sortDesc')} aria-label={t(recordsAsc ? 'log.sortAsc' : 'log.sortDesc')}>
                  <SortDirectionIcon direction={recordsAsc ? 'asc' : 'desc'} />
                </Button>
                <Button variant="ghost" size="icon" disabled={!visible.length}
                  onClick={() => { if (scroll.current) scroll.current.scrollTop = recordsAsc ? scroll.current.scrollHeight : 0 }}
                  title={t('log.jumpLatest')} aria-label={t('log.jumpLatest')}>
                  {recordsAsc ? <ListEnd size={16} aria-hidden="true" /> : <ListStart size={16} aria-hidden="true" />}
                </Button>
                <Button variant="ghost" size="icon" disabled={!visible.length} onClick={() => void copy()}
                  title={t(copied ? 'log.copied' : 'log.copy')} aria-label={t(copied ? 'log.copied' : 'log.copy')}>
                  {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                </Button>
              </div>
            </div>
            <div ref={scroll} className="nf-log-file-scroll" tabIndex={0} aria-label={t('log.fileContent')}>
              {!selected ? <EmptyState size="sm" icon={<FileText size={25} />} message={t('log.selectHint')} />
                : !result ? <div className="nf-log-file-state" role="status"><Spinner size={16} />{t('status.loading')}</div>
                  : !result.success ? <div className="nf-log-file-state text-[var(--color-error)]" role="alert">{result.error ?? t('log.loadError')}</div>
                    : !visible.length ? <EmptyState size="sm" message={t(search ? 'log.fileNoMatches' : 'status.noLogs')} />
                      : visible.map(item => (
                        <article className="nf-log-record" key={item.id} data-level={item.level}>
                          {item.level && (
                            <header className="nf-log-record-head">
                              {item.time && <time dateTime={item.time} title={item.time}>
                                {Number.isFinite(Date.parse(item.time)) ? time.format(Date.parse(item.time)) : item.time}
                              </time>}
                              <span className="nf-log-severity">{t(LEVEL_KEYS[item.level])}</span>
                              <span className="nf-log-source">{item.source}</span>
                            </header>
                          )}
                          <p>{item.message}</p>
                        </article>
                      ))}
            </div>
            <footer className="nf-log-file-footer" role="status">
              {result?.success && <span>{t(total > MAX_LINES ? 'log.totalLines' : 'log.fileLines')
                .replace('{total}', String(total)).replace('{shown}', String(MAX_LINES))}</span>}
              {search && <span>{t('log.fileMatches').replace('{total}', String(visible.length))}</span>}
            </footer>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
