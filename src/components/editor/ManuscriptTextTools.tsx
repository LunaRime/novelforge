import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { BookOpen, ClipboardPaste, Copy, FileSearch, ScanText, Scissors, Search, TextCursorInput } from 'lucide-react'
import { selectAll } from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import { Transaction } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { create } from 'zustand'
import { useTranslation } from '../../hooks/useTranslation'
import { useProjectStore } from '../../stores/project-store'
import { useEditorStore } from '../../stores/editor-store'
import { captureDraftProject } from '../../services/draft-index'
import { ipc } from '../../services/ipc-client'
import { openRendererEditorDocument } from '../../services/editor/open-editor-document'
import { draftListScope } from '../../stores/draft-store'
import { VELA } from '../../services/vela-protocol'
import { Button } from '../ui/Button'
import { ContextMenu } from '../ui/ContextMenu'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/Dialog'
import { Input } from '../ui/Input'
import { toast } from '../ui/Toast'
import './manuscript-text-tools.css'

// 跨章节查找结果交给目标编辑器定位，草稿与正式稿共享相同的入口。
// eslint-disable-next-line react-refresh/only-export-components
export const useManuscriptSearchTarget = create<{ target: { path: string; scope: string; query: string; start: number } | null }>(() => ({ target: null }))

export default function ManuscriptTextTools({ view }: { view: EditorView }) {
  const { t } = useTranslation()
  const trigger = useRef<HTMLButtonElement>(null)
  const active = useRef(true)
  const [open, setOpen] = useState(false)
  const [projectSearch, setProjectSearch] = useState(false)
  const [selection, setSelection] = useState('')
  const scope = useProjectStore(draftListScope)
  const loading = useProjectStore(state => state.loading)
  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [view])

  const editClipboard = async (action: 'copy' | 'cut' | 'paste') => {
    const snapshot = view.state
    if (action !== 'copy' && snapshot.readOnly) return
    const range = snapshot.selection.main
    try {
      if (action !== 'paste') await navigator.clipboard.writeText(snapshot.sliceDoc(range.from, range.to))
      const pasted = action === 'paste' ? await navigator.clipboard.readText() : ''
      if (!active.current) return
      if (action === 'copy') { toast.success(t('editor.textCopied')); view.focus(); return }
      // 等待系统剪贴板期间若切换了章节、选区或只读状态，取消修改。
      if (view.state.readOnly || view.state.doc !== snapshot.doc || !view.state.selection.eq(snapshot.selection)) return
      if (action === 'paste' && !pasted) { view.focus(); return }
      const insert = view.state.toText(pasted)
      const userEvent = action === 'cut' ? 'delete.cut' : 'input.paste'
      view.dispatch({ changes: { from: range.from, to: range.to, insert }, selection: { anchor: range.from + insert.length },
        annotations: Transaction.userEvent.of(userEvent), scrollIntoView: true })
      view.focus()
    } catch {
      if (active.current) toast.error(t('editor.clipboardFailed'))
    }
  }

  const writable = !view.state.readOnly
  const selectedText = () => {
    const { from, to } = view.state.selection.main
    return view.state.sliceDoc(from, to)
  }

  return <>
    <Button ref={trigger} type="button" variant="ghost" size="icon" className="size-8 nf-manuscript-tools-trigger"
      aria-haspopup="menu" aria-expanded={open} aria-label={t('editor.textTools')} title={t('editor.textTools')} active={open}
      onMouseDown={event => event.preventDefault()}
      onClick={() => { setSelection(selectedText()); setOpen(previous => !previous) }}>
      <ScanText size={16} aria-hidden="true" />
    </Button>
    {open && <ContextMenu anchor={trigger} label={t('editor.textTools')} onClose={close} items={[
      { key: 'copy', label: t('action.copy'), icon: <Copy size={14} />, disabled: !selection, onClick: () => void editClipboard('copy') },
      { key: 'cut', label: t('editor.textCut'), icon: <Scissors size={14} />, disabled: !selection || !writable, onClick: () => void editClipboard('cut') },
      { key: 'paste', label: t('editor.textPaste'), icon: <ClipboardPaste size={14} />, disabled: !writable, onClick: () => void editClipboard('paste') },
      { key: 'all', label: t('editor.textSelectAll'), icon: <TextCursorInput size={14} />, onClick: () => { selectAll(view); view.focus() } },
      { key: 'break', type: 'divider' },
      { key: 'find', label: t('editor.textFindChapter'), icon: <Search size={14} />, onClick: () => openSearchPanel(view) },
      { key: 'project', label: t('editor.textFindProject'), icon: <FileSearch size={14} />, disabled: !scope || loading, onClick: () => setProjectSearch(true) },
    ]} />}
    {projectSearch && scope && !loading && <ProjectTextSearch key={scope} scope={scope} initialQuery={selection.length <= 200 && !selection.includes('\n') ? selection : ''}
      onClose={() => setProjectSearch(false)} />}
  </>
}

type Match = { path: string; id: number; title: string; snippet: string; matched: string; before: string; after: string; start: number; version: number; final: boolean }
const MAX_RESULTS = 100

function ProjectTextSearch({ initialQuery, scope, onClose }: { initialQuery: string; scope: string; onClose: () => void }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState(initialQuery)
  const [result, setResult] = useState<{ matches: Match[]; limited: boolean } | null>(null)
  const [searching, setSearching] = useState(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState(false)
  const request = useRef(0)
  useEffect(() => () => { request.current++ }, [])

  const search = async (event: FormEvent) => {
    event.preventDefault()
    const needle = query.trim()
    if (!needle) return
    const sequence = ++request.current
    setSearching(true)
    setError(false)
    setResult(null)
    try {
      const assertProject = captureDraftProject()
      const [chapters, numbers] = await Promise.all([ipc.invoke('db:blueprint-get-all'), ipc.invoke('db:draft-get-all-chapter-numbers')])
      const titles = new Map(chapters.map(chapter => [chapter.chapterNumber, chapter.title]))
      const matches: Match[] = []
      // 按章读取正文，逐章检查项目会话。已打开版本以工作区的即时内容为准。
      const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
      scan: for (const number of numbers.sort((a, b) => a - b)) {
        if (request.current !== sequence) return
        assertProject()
        const versions = await ipc.invoke('db:draft-list', number)
        for (const version of versions) {
          if (version.status === 'archived') continue
          if (request.current !== sequence) return
          assertProject()
          const final = version.status === 'finalized'
          const path = (final ? VELA.MANUSCRIPT : VELA.DRAFT) + version.id
          const live = useEditorStore.getState().tabs.find(tab => tab.docId === version.id || tab.filePath === path)?.content
          const content = live ?? (await ipc.invoke('db:draft-get-full', version.id))?.content ?? ''
          pattern.lastIndex = 0
          const title = titles.get(number) || t('chapter.label').replace('{n}', String(number))
          for (const found of content.matchAll(pattern)) {
            const start = found.index
            const end = start + found[0].length
            const before = content.slice(Math.max(0, start - 32), start)
            const after = content.slice(end, end + 56)
            matches.push({ path, id: version.id, title, snippet: before + found[0] + after, matched: found[0], before, after, start, version: version.version, final })
            if (matches.length > MAX_RESULTS) break scan
          }
        }
      }
      assertProject()
      if (request.current === sequence) setResult({ matches: matches.slice(0, MAX_RESULTS), limited: matches.length > MAX_RESULTS })
    } catch {
      if (request.current === sequence) setError(true)
    } finally {
      if (request.current === sequence) setSearching(false)
    }
  }

  const openMatch = async (match: Match) => {
    if (opening || draftListScope(useProjectStore.getState()) !== scope) return
    setOpening(true)
    try {
      const response = await openRendererEditorDocument(match.final
        ? { kind: 'path', documentKind: 'chapter', locator: match.path, name: match.title }
        : { kind: 'draft', draftId: match.id, name: match.title })
      if (response.status === 'opened' && draftListScope(useProjectStore.getState()) === scope) {
        useManuscriptSearchTarget.setState({ target: { path: match.path, scope, query: match.matched, start: match.start } })
        onClose()
        return
      }
    } catch {
      // 项目切换后不在其他项目中弹出本次操作的错误。
    }
    if (draftListScope(useProjectStore.getState()) === scope) toast.error(t('common.loadFailed'))
    setOpening(false)
  }

  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="nf-manuscript-search">
      <DialogHeader>
        <DialogTitle>{t('editor.textFindProject')}</DialogTitle>
        <DialogDescription>{t('editor.textFindDescription')}</DialogDescription>
      </DialogHeader>
      <form onSubmit={event => void search(event)}>
        <Input value={query} maxLength={200} onChange={event => setQuery(event.target.value)}
          type="search" autoFocus aria-label={t('editor.textFindProject')} />
        <Button type="submit" disabled={searching || !query.trim()}><Search size={14} aria-hidden="true" />{t('action.search')}</Button>
      </form>
      <p className="nf-manuscript-search-status" role="status">{searching ? t('status.loading') : error ? t('common.loadFailed') : result &&
        t(result.limited ? 'editor.textFindLimit' : 'editor.textFindCount').replace('{count}', String(result.matches.length))}</p>
      {result && <ul aria-label={t('editor.textFindProject')}>
        {result.matches.map(match => <li key={`${match.path}:${match.start}`}>
          <button type="button" title={match.snippet} disabled={opening} onClick={() => void openMatch(match)}>
            {match.final ? <BookOpen size={15} aria-hidden="true" /> : <FileSearch size={15} aria-hidden="true" />}
            <span><strong>{match.title}</strong><small>{match.final ? t('draftStatus.finalized') : `${t('editor.draft')} v${match.version}`}</small>
              <span className="nf-manuscript-search-snippet">{match.before}<mark>{match.matched}</mark>{match.after}</span></span>
          </button>
        </li>)}
      </ul>}
    </DialogContent>
  </Dialog>
}
