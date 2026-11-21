import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { BookOpen, ChevronLeft, ChevronRight, FolderOpen } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { captureDraftProject } from '../../services/draft-index'
import { ipc } from '../../services/ipc-client'
import { renderLog } from '../../services/render-logger'
import { VELA } from '../../services/vela-protocol'
import { draftListScope, useDraftStore } from '../../stores/draft-store'
import { useEditorPrefsStore } from '../../stores/editor-prefs-store'
import { useEditorStore } from '../../stores/editor-store'
import { useProjectStore } from '../../stores/project-store'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import MarkdownContent from '../ui/MarkdownContent'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select'
import { Spinner } from '../ui/Spinner'
import './reading-workspace.css'

/** 阅读选择与编辑器标签独立，仅切换小说时复用项目的未保存确认流程。 */
export default function ReadingWorkspace({ active }: { active: boolean }) {
  const { t } = useTranslation()
  const project = useProjectStore(s => s.currentProject)
  const recent = useProjectStore(s => s.recentProjects)
  const projectLoading = useProjectStore(s => s.loading)
  const scope = useProjectStore(draftListScope)
  const draftsByChapter = useDraftStore(s => s.draftsScope === scope ? s.draftsByChapter : null)
  const draftsLoading = useDraftStore(s => s.loading)
  const tabs = useEditorStore(s => s.tabs)
  const activeTabId = useEditorStore(s => s.activeTabId)
  const measure = useEditorPrefsStore(s => s.measureWidth)
  const fontSize = useEditorPrefsStore(s => s.proseFontSize)
  const [positions, setPositions] = useState<Record<string, number>>({})
  const [titles, setTitles] = useState<{ scope: string; values: Map<number, string> }>()
  const [loaded, setLoaded] = useState<{ key: string; content: string | null }>()
  const [retry, setRetry] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const offsets = useRef(new Map<string, number>())
  const path = project?.path

  const chapters = useMemo(() => Object.values(draftsByChapter ?? {}).flatMap(versions => {
    const available = versions.find(draft => draft.status === 'finalized') ?? versions.find(draft => draft.status !== 'archived')
    return available ? [available] : []
  }).sort((a, b) => a.chapterNumber - b.chapterNumber), [draftsByChapter])
  const editorChapter = tabs.find(tab => tab.id === activeTabId && tab.type === 'chapter')
  const editorDraftId = editorChapter?.docId ?? (editorChapter?.filePath?.startsWith(VELA.MANUSCRIPT)
    ? Number(editorChapter.filePath.slice(VELA.MANUSCRIPT.length)) : undefined)
  const selected = chapters.find(chapter => path && chapter.chapterNumber === positions[path])
    ?? chapters.find(chapter => chapter.chapterNumber === editorChapter?.chapterNumber || chapter.id === editorDraftId)
    ?? chapters[0]
  const chapterNumber = selected?.chapterNumber
  const chapterName = (n: number) => {
    const title = (titles && titles.scope === scope ? titles.values.get(n) : undefined)?.trim()
    const label = t('chapter.label').replace('{n}', String(n))
    return title ? `${label} ${title}` : label
  }
  const matchingTab = selected && tabs.find(tab => tab.type === 'chapter' &&
    (tab.docId === selected.id || tab.filePath === `${VELA.MANUSCRIPT}${selected.id}`))
  const liveChapter = selected && editorChapter &&
    (editorChapter.chapterNumber === chapterNumber || editorDraftId === selected.id)
    ? editorChapter : matchingTab
  const live = liveChapter?.content
  const draftId = liveChapter?.docId ?? selected?.id
  const chapterKey = path && selected ? JSON.stringify([path, chapterNumber]) : ''
  const requestKey = scope && draftId !== undefined ? JSON.stringify([scope, draftId, selected?.contentHash, selected?.updatedAt, retry]) : ''
  const content = !projectLoading ? live ?? (loaded?.key === requestKey ? loaded.content : undefined) : undefined
  const selectedIndex = selected ? chapters.indexOf(selected) : -1

  useEffect(() => {
    if (!active || !scope || projectLoading) return
    const assertProject = captureDraftProject()
    let cancelled = false
    void ipc.invoke('db:blueprint-get-all').then(rows => {
      if (cancelled) return
      assertProject()
      setTitles({ scope, values: new Map(rows.map(row => [row.chapterNumber, row.title])) })
    }).catch(error => {
      if (!cancelled && draftListScope(useProjectStore.getState()) === scope) renderLog('warn', 'Read:ChapterTitles', String(error))
    })
    return () => { cancelled = true }
  }, [active, scope, projectLoading])

  useEffect(() => {
    if (!active || projectLoading || !requestKey || draftId === undefined || live !== undefined) return
    let cancelled = false
    const assertProject = captureDraftProject()
    void ipc.invoke('db:draft-get-full', draftId).then(draft => {
      if (cancelled) return
      assertProject()
      setLoaded({ key: requestKey, content: draft?.content ?? null })
    }).catch(error => {
      if (cancelled || draftListScope(useProjectStore.getState()) !== scope) return
      renderLog('error', 'Read:Chapter', String(error))
      setLoaded({ key: requestKey, content: null })
    })
    return () => { cancelled = true }
  }, [active, projectLoading, draftId, live, requestKey, scope])

  const ready = typeof content === 'string'
  useLayoutEffect(() => {
    if (active && ready && scrollRef.current) scrollRef.current.scrollTop = offsets.current.get(chapterKey) ?? 0
  }, [active, ready, chapterKey])

  if (!active) return null

  const chooseChapter = (n: number) => {
    if (path) setPositions(previous => ({ ...previous, [path]: n }))
  }
  const turnPage = (n: number) => {
    chooseChapter(n)
    scrollRef.current?.focus({ preventScroll: true })
  }
  const chooseProject = (nextPath: string) => {
    if (nextPath !== path) void useProjectStore.getState().openProject(nextPath, { keepView: true })
  }
  const browse = async () => {
    const folder = await ipc.invoke('dialog:select-folder')
    if (folder) chooseProject(folder)
  }

  return (
    <section className="nf-reader" aria-label={t('reader.enter')}>
      <div className="nf-reader-toolbar">
        <div className="nf-reader-controls">
          <BookOpen size={18} className="nf-reader-symbol" aria-hidden="true" />
          <Select value={path ?? ''} onValueChange={chooseProject} disabled={projectLoading}>
            <SelectTrigger className="nf-reader-project" aria-label={t('reader.novel')}><SelectValue placeholder={t('reader.novel')} /></SelectTrigger>
            <SelectContent>
              {project && <SelectItem value={project.path}>{project.name}</SelectItem>}
              {recent.filter(item => item.path !== path).map(item => <SelectItem key={item.path} value={item.path}>{item.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button type="button" variant="ghost" size="icon" aria-label={t('project.openAnother')} data-tooltip={t('project.openAnother')}
            disabled={projectLoading} onClick={() => void browse()}><FolderOpen size={16} aria-hidden="true" /></Button>
          {selected && (
            <Select value={String(chapterNumber)} onValueChange={value => chooseChapter(Number(value))} disabled={projectLoading}>
              <SelectTrigger className="nf-reader-chapters" aria-label={t('reader.chapters')}><SelectValue /></SelectTrigger>
              <SelectContent>
                {chapters.map(chapter => <SelectItem key={chapter.id} value={String(chapter.chapterNumber)}>{chapterName(chapter.chapterNumber)}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
      <div ref={scrollRef} tabIndex={0} aria-label={t('reader.body')} className="nf-reader-scroll"
        onScroll={event => { if (ready && chapterKey) offsets.current.set(chapterKey, event.currentTarget.scrollTop) }}>
        {projectLoading || (project && !selected && draftsLoading) || (selected && content === undefined) ? (
          <div role="status" className="nf-reader-state"><Spinner size={17} />{t('status.loading')}</div>
        ) : !selected ? (
          <EmptyState className="nf-reader-state" icon={<BookOpen size={28} />} message={t(project ? 'reader.empty' : 'empty.pleaseOpenProject')} />
        ) : content === null ? (
          <div className="nf-reader-state"><p role="alert">{t('common.loadFailed')}</p><Button variant="outline" onClick={() => setRetry(value => value + 1)}>{t('action.retry')}</Button></div>
        ) : (
          <article className="nf-reader-paper" style={{ '--reader-measure': `${measure}px`, '--reader-font-size': `${fontSize}px` } as CSSProperties}>
            <h1>{chapterName(selected.chapterNumber)}</h1>
            <MarkdownContent content={content ?? ''} document />
            <nav className="nf-reader-pagination" aria-label={t('reader.chapters')}>
              <Button variant="outline" disabled={selectedIndex <= 0} onClick={() => turnPage(chapters[selectedIndex - 1].chapterNumber)}>
                <ChevronLeft size={15} aria-hidden="true" />{t('reader.previous')}
              </Button>
              <span>{selectedIndex + 1} / {chapters.length}</span>
              <Button variant="outline" disabled={selectedIndex >= chapters.length - 1} onClick={() => turnPage(chapters[selectedIndex + 1].chapterNumber)}>
                {t('reader.next')}<ChevronRight size={15} aria-hidden="true" />
              </Button>
            </nav>
          </article>
        )}
      </div>
    </section>
  )
}
