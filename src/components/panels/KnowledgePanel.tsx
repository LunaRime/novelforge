import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { getCurrentLocale } from '../../shared/locale'
import { KnowledgeRequestCancelled } from '../../core'
import {
  Database, RefreshCw, BookOpen, Download, Archive, SortAsc, Search, X, Trash2, AlertCircle, Sparkles,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { EmptyState } from '../ui/EmptyState'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/Select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/Dialog'
import { useProjectStore } from '../../stores/project-store'
import { globalEventBus } from '../../shared/event-bus'
import { useTranslation } from '../../hooks/useTranslation'
import type { KBDocument, KBStatsData, SearchResult } from '../../services/knowledge-service'
import { createRendererKnowledgeApplication } from '../../services/knowledge/knowledge-adapter'
import { renderLog } from '../../services/render-logger'
import { confirm } from '../ui/Confirm'
import { toast } from '../ui/Toast'
import ChapterExportDialog from '../dialogs/ChapterExportDialog'

/** A new project session gets a fresh view, with no previous project's transient results. */
export default function KnowledgePanel() {
  const { t } = useTranslation()
  const project = useProjectStore(s => s.currentProject)
  const session = useProjectStore(s => s.projectSession)
  if (!project) return <EmptyState icon={<BookOpen size={36} />} message={t('empty.pleaseOpenProject')} className="pb-[15vh]" opacity={0.4} />
  return <KnowledgePanelContent key={`${project.id}:${project.path}:${session}`} source={{ id: project.id, path: project.path, session }} />
}

function KnowledgePanelContent({ source }: { source: { id: string; path: string; session: number } }) {
  const { t } = useTranslation()
  const [application] = useState(() => createRendererKnowledgeApplication(source))
  const mounted = useRef(true)
  const lifetime = useRef({ generation: 0 })
  const sequences = useRef({ load: 0, search: 0, summary: 0, titles: 0 })
  const deleting = useRef(new Set<string>())
  const [documents, setDocuments] = useState<KBDocument[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  const [stats, setStats] = useState<KBStatsData>({ documentCount: 0, totalChunks: 0, vectorDimension: 0 })
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 20
  const [titleMap, setTitleMap] = useState<Record<string, string>>({})
  const [sortMode, setSortMode] = useState<'time' | 'chapter' | 'name'>('chapter')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportChapters, setExportChapters] = useState<number[]>([])
  const [exportTitleMap, setExportTitleMap] = useState<Record<number, string>>({})
  const [summarizing, setSummarizing] = useState(false)
  const [summaryDoc, setSummaryDoc] = useState<KBDocument | null>(null)
  const [summaryText, setSummaryText] = useState('')
  const active = useCallback(() => {
    const current = useProjectStore.getState()
    return mounted.current && current.currentProject?.id === source.id && current.currentProject.path === source.path && current.projectSession === source.session
  }, [source.id, source.path, source.session])

  useEffect(() => {
    mounted.current = true
    const lifecycle = lifetime.current
    const generation = ++lifecycle.generation
    return () => {
      mounted.current = false
      // React StrictMode rehearses cleanup/setup synchronously; dispose only a real unmount.
      queueMicrotask(() => { if (!mounted.current && lifecycle.generation === generation) application.dispose() })
    }
  }, [application])

  const loadData = useCallback(async () => {
    const seq = ++sequences.current.load
    try {
      const data = await application.load()
      if (!active() || seq !== sequences.current.load) return
      setDocuments(data.documents); setStats(data.stats); setLoadFailed(false)
    } catch (error) {
      if (!active() || seq !== sequences.current.load || error instanceof KnowledgeRequestCancelled) return
      renderLog('error', 'Load:Knowledge', String(error)); setLoadFailed(true)
    }
  }, [application, active])
  useEffect(() => { void loadData() }, [loadData])
  useEffect(() => {
    const refresh = () => { void loadData() }
    const unsub1 = globalEventBus.on('REFRESH_RESOURCE', refresh)
    const unsub2 = globalEventBus.on('FINALIZE_COMPLETE', refresh)
    return () => { unsub1(); unsub2() }
  }, [loadData])

  useEffect(() => {
    const requests = sequences.current
    const seq = ++requests.titles
    if (!documents.length) return
    void application.titles(documents).then(titles => {
      if (!active() || seq !== sequences.current.titles) return
      const projected: Record<string, string> = {}
      for (const doc of documents) {
        let title = titles[doc.id] || doc.fileName
        if (title === doc.fileName) {
          const match = doc.fileName.replace(/\.[^.]+$/, '').match(/^(?:chapter_(\d+)|第(\d+)章)\s*(.*)$/)
          if (match) {
            const label = t('chapter.nLabel').replace('{n}', match[1] || match[2])
            title = match[3]?.trim() ? `${label} ${match[3].trim()}` : label
          }
        }
        projected[doc.id] = title
      }
      setTitleMap(projected)
    }).catch(error => {
      if (active() && seq === sequences.current.titles && !(error instanceof KnowledgeRequestCancelled)) renderLog('debug', 'Load:Knowledge', String(error))
    })
    return () => { if (seq === requests.titles) ++requests.titles }
  }, [documents, application, active, t])

  const changeSearch = (query: string) => {
    ++sequences.current.search; application.cancelSearch()
    setSearchQuery(query); setSearchResults([]); setSearching(false)
  }
  const handleSearch = async () => {
    const query = searchQuery.trim()
    if (!query) { changeSearch(''); return }
    const seq = ++sequences.current.search
    setSearching(true)
    try {
      const results = await application.search(query)
      if (active() && seq === sequences.current.search) setSearchResults(results)
    } catch (error) {
      if (active() && seq === sequences.current.search && !(error instanceof KnowledgeRequestCancelled)) toast.error(t('knowledge.searchFailed').replace('{error}', () => String(error)))
    } finally {
      if (active() && seq === sequences.current.search) setSearching(false)
    }
  }
  const closeSummary = () => {
    ++sequences.current.summary; application.cancelSummary()
    setSummaryDoc(null); setSummaryText(''); setSummarizing(false)
  }
  const handleSummarize = async (doc: KBDocument) => {
    if (summarizing) return
    const seq = ++sequences.current.summary
    setSummarizing(true); setSummaryDoc(doc); setSummaryText('')
    try {
      const result = await application.summarize(doc, t('knowledge.summarySystemPrompt'))
      if (!active() || seq !== sequences.current.summary) return
      if (result.status === 'empty') { toast.warning(t('knowledge.searchEmpty')); setSummaryDoc(null) }
      else setSummaryText(result.text)
    } catch (error) {
      if (!active() || seq !== sequences.current.summary || error instanceof KnowledgeRequestCancelled) return
      toast.error(t('knowledge.summaryFailed').replace('{error}', () => String(error))); setSummaryDoc(null)
    } finally {
      if (active() && seq === sequences.current.summary) setSummarizing(false)
    }
  }
  const handleDelete = async (doc: KBDocument) => {
    if (deleting.current.has(doc.id)) return
    deleting.current.add(doc.id)
    const label = titleMap[doc.id] || doc.fileName
    try {
      const ok = await confirm(t('knowledge.deleteConfirm').replace('{name}', () => label), { title: t('action.delete'), confirmText: t('action.delete'), danger: true })
      if (!ok || !active()) return
      ++sequences.current.load; ++sequences.current.titles
      changeSearch(''); closeSummary()
      const result = await application.remove(doc)
      if (!active()) return
      // Requests may have completed while persistence was pending. Clear those projections too.
      ++sequences.current.load; ++sequences.current.titles
      changeSearch(''); closeSummary()
      const message = t('knowledge.deleteSuccess').replace('{name}', () => label)
      renderLog('info', 'Delete:Knowledge', message); toast.success(message)
      setDocuments(prev => prev.filter(item => item.id !== doc.id))
      setTitleMap(prev => { const next = { ...prev }; delete next[doc.id]; return next })
      if (result.data) { setDocuments(result.data.documents); setStats(result.data.stats); setLoadFailed(false) }
      if (result.refreshError) {
        setLoadFailed(true); renderLog('error', 'Load:Knowledge', result.refreshError)
        toast.error(t('common.loadFailed'))
      }
    } catch (error) {
      if (!active() || error instanceof KnowledgeRequestCancelled) return
      const message = t('knowledge.deleteFailed').replace('{error}', () => String(error))
      renderLog('error', 'Delete:Knowledge', message); toast.error(message)
    } finally { deleting.current.delete(doc.id) }
  }
  const extractChapterNumber = (doc: KBDocument): number => {
    const match = doc.fileName.replace(/\.[^.]+$/, '').match(/^(?:chapter_(\d+)|第(\d+)章)/)
    return match ? parseInt(match[1] || match[2], 10) : 0
  }
  const openSingleExport = (doc: KBDocument) => {
    const number = extractChapterNumber(doc)
    setExportChapters([number]); setExportTitleMap({ [number]: titleMap[doc.id] || doc.fileName }); setExportOpen(true)
  }
  const openBatchExport = () => {
    const chapters: number[] = [], titles: Record<number, string> = {}
    for (const doc of documents) {
      const number = extractChapterNumber(doc)
      if (number > 0) { chapters.push(number); titles[number] = titleMap[doc.id] || doc.fileName }
    }
    setExportChapters(chapters); setExportTitleMap(titles); setExportOpen(true)
  }

  // 排序 + 分页（提前计算，避免 JSX 内嵌 IIFE 的深层括号）
  const sortedDocs = useMemo(() => {
    return [...documents].sort((a, b) => {
      if (sortMode === 'chapter') {
        const diff = extractChapterNumber(a) - extractChapterNumber(b)
        return diff !== 0 ? diff : a.fileName.localeCompare(b.fileName, getCurrentLocale())
      }
      if (sortMode === 'name') return a.fileName.localeCompare(b.fileName, getCurrentLocale())
      return new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime()
    })
  }, [documents, sortMode])
  const totalPages = Math.max(1, Math.ceil(documents.length / pageSize))
  const pageDocs = sortedDocs.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  return (
    <div className="h-full flex flex-col overflow-hidden text-sm">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 h-9 flex-shrink-0 border-b border-[var(--color-border)]">
        <span className="text-xs font-medium text-[var(--color-text)] flex items-center gap-1.5 min-w-0">
          <Database size={13} />
          <span className="truncate">{t('nav.knowledgeBase')}</span>
          <span className="text-micro text-[var(--color-text-muted)] flex-shrink-0">
            {t('knowledge.docChunks').replace('{docs}', String(stats.documentCount)).replace('{chunks}', String(stats.totalChunks))}
          </span>
        </span>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {/* 批量导出按钮 */}
          {documents.length > 0 && (
            <Button
              variant="ghost" size="icon"
              onClick={openBatchExport}
              title={t('export.batchExportTip')}
              className="h-6 w-6"
            >
              <Archive size={12} />
            </Button>
          )}
          <Button
            variant="ghost" size="icon"
            onClick={() => loadData()}
            title={t('action.refresh')}
            className="h-6 w-6"
          >
            <RefreshCw size={11} />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* P2-1：搜索框（Enter 触发；有结果时显示结果视图） */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-[var(--color-border)]">
          <Search size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          {/* 同上：面板内的紧凑搜索框，外观与交互走 ui/Input（flex-1 让它吃掉图标与清除按钮之间的余量） */}
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => changeSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSearch() }}
            placeholder={t('knowledge.searchPlaceholder')}
            className="flex-1 min-w-0 h-6 px-1.5 text-micro"
          />
          {searchResults.length > 0 && (
            <button
              onClick={() => changeSearch('')}
              title={t('knowledge.closeSearch')}
              className="p-0.5 rounded hover:bg-[var(--color-hover)] cursor-pointer"
              style={{ color: 'var(--color-text-muted)' }}
              type="button"
            >
              <X size={11} />
            </button>
          )}
        </div>

        {/* 搜索结果视图 / 空态 / 列表视图（互斥；独立条件块避免嵌套三元+fragment 解析问题） */}
        {searchResults.length > 0 && (
          <div className="pb-4">
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-micro text-[var(--color-text-muted)] font-medium">
                {t('knowledge.searchResults').replace('{n}', String(searchResults.length))}
              </span>
            </div>
            {searchResults.map((r, i) => (
              <div key={i} className="px-3 py-2 hover:bg-[var(--color-hover)] transition-colors">
                <div className="flex items-center gap-2 text-micro" style={{ color: 'var(--color-text-muted)' }}>
                  <span className="truncate flex-1">{r.fileName}</span>
                  <span className="flex-shrink-0">{Math.round(r.score * 100)}%</span>
                </div>
                <div className="text-xs text-[var(--color-text-secondary)] mt-0.5 line-clamp-3">{r.text.slice(0, 200)}</div>
              </div>
            ))}
          </div>
        )}
        {searchQuery.trim() !== '' && !searching && searchResults.length === 0 && (
          <EmptyState message={t('knowledge.searchEmpty')} size="xs" className="text-center" />
        )}
        {searchResults.length === 0 && !(searchQuery.trim() !== '' && !searching) && (
          <DocListView
            documents={documents}
            loadFailed={loadFailed}
            onRetry={() => { setLoadFailed(false); void loadData() }}
            titleMap={titleMap}
            sortMode={sortMode}
            onSortModeChange={(v) => { setSortMode(v); setCurrentPage(1) }}
            pageDocs={pageDocs}
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            onDelete={(doc) => void handleDelete(doc)}
            onExport={(doc) => openSingleExport(doc)}
            onSummarize={(doc) => void handleSummarize(doc)}
            summarizing={summarizing}
            t={t}
          />
        )}
      </div>

      {/* 线③ 第 5 条：知识文档 AI 总结对话框 */}
      <Dialog open={summaryDoc !== null} onOpenChange={(v) => !v && closeSummary()}>
        <DialogContent className="max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles size={14} className="text-[var(--color-accent)]" />
              {t('knowledge.summaryTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="px-5 py-2 pb-4 text-sm space-y-2">
            <div className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
              {summaryDoc ? (titleMap[summaryDoc.id] || summaryDoc.fileName) : ''}
            </div>
            <div className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              {summarizing ? t('knowledge.summarizing') : summaryText}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 章节导出对话框 */}
      <ChapterExportDialog
        chapterNumbers={exportChapters}
        chapterTitles={exportTitleMap}
        open={exportOpen}
        onClose={() => setExportOpen(false)}
      />
    </div>
  )
}

/**
 * 已入库章节列表视图（排序头 + 列表体）— 独立子组件：
 * 顶层 fragment 合法，避免父组件深层条件表达式中嵌套 fragment 的解析问题
 */
function DocListView({ documents, loadFailed, onRetry, titleMap, sortMode, onSortModeChange, pageDocs, currentPage, totalPages, onPageChange, onDelete, onExport, onSummarize, summarizing, t }: {
  documents: KBDocument[]
  /** 加载失败：与「加载成功但确实没数据」是两回事，必须分开渲染 */
  loadFailed: boolean
  onRetry: () => void
  titleMap: Record<string, string>
  sortMode: 'time' | 'chapter' | 'name'
  onSortModeChange: (v: 'time' | 'chapter' | 'name') => void
  pageDocs: KBDocument[]
  currentPage: number
  totalPages: number
  onPageChange: (p: number) => void
  onDelete: (doc: KBDocument) => void
  onExport: (doc: KBDocument) => void
  onSummarize: (doc: KBDocument) => void
  summarizing: boolean
  t: ReturnType<typeof useTranslation>['t']
}) {
  return (
    <>
      {/* 排序头 */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-micro text-[var(--color-text-muted)] font-medium">
          {t('knowledge.indexedChapters')}
        </span>
        {/* 排序选择：章节号 / 导入时间 / 名称 */}
        <Select
          value={sortMode}
          onValueChange={(v) => onSortModeChange(v as 'time' | 'chapter' | 'name')}
        >
          <SelectTrigger
            className="h-6 gap-1 text-micro px-1.5"
            title={t('knowledge.sortBy')}
            style={{ minWidth: 0, borderColor: 'var(--color-border)' }}
          >
            <SortAsc size={11} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="chapter">{t('knowledge.sortChapter')}</SelectItem>
            <SelectItem value="time">{t('knowledge.sortTime')}</SelectItem>
            <SelectItem value="name">{t('knowledge.sortName')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loadFailed ? (
        /* 错误态与空态必须分开：失败渲染成「暂无数据」会让用户以为本来就没有 */
        <EmptyState
          icon={<AlertCircle size={36} style={{ color: 'var(--color-error)' }} />}
          message={t('common.loadFailed')}
          opacity={1}
          className="py-8"
        >
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t('action.retry')}
          </Button>
        </EmptyState>
      ) : documents.length === 0 ? (
        <EmptyState
          icon={<BookOpen size={36} />}
          message={t('knowledge.empty')}
          size="xs"
          opacity={0.4}
          className="py-8"
        >
          <span className="text-micro text-center px-4">{t('knowledge.autoIndexHint')}</span>
        </EmptyState>
      ) : (
        <div className="pb-4">
          {pageDocs.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center justify-between px-3 py-2 hover:bg-[var(--color-hover)] transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[var(--color-text)] truncate" title={doc.fileName}>
                  {titleMap[doc.id] || doc.fileName}
                </div>
                <div className="flex items-center gap-2 text-micro text-[var(--color-text-muted)] mt-0.5">
                  <span>{t('knowledge.chunks').replace('{n}', String(doc.chunkCount))}</span>
                  <span>{new Date(doc.importedAt).toLocaleDateString(getCurrentLocale())}</span>
                </div>
              </div>
              {/* 线③ 第 5 条：AI 总结 — hover 显示 */}
              <button
                className="flex items-center justify-center rounded transition-all opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-[var(--color-hover)]"
                style={{ width: 22, height: 22, flexShrink: 0, color: 'var(--color-text-muted)' }}
                title={t('knowledge.summarize')}
                onClick={() => onSummarize(doc)}
                disabled={summarizing}
                type="button"
              >
                <Sparkles size={12} />
              </button>
              {/* 单章导出 — hover 显示 */}
              <button
                className="flex items-center justify-center rounded transition-all opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-[var(--color-hover)]"
                style={{ width: 22, height: 22, flexShrink: 0, color: 'var(--color-text-muted)' }}
                title={t('export.singleExportTip')}
                onClick={() => onExport(doc)}
                type="button"
              >
                <Download size={12} />
              </button>
              {/* P2-1：删除文档 — hover 显示 */}
              <button
                className="flex items-center justify-center rounded transition-all opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-[var(--color-hover)]"
                style={{ width: 22, height: 22, flexShrink: 0, color: 'var(--color-text-muted)' }}
                title={t('action.delete')}
                onClick={() => onDelete(doc)}
                type="button"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-3 pt-3">
              <span className="text-micro text-[var(--color-text-muted)]">
                {currentPage} / {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline" size="sm"
                  className="h-6 text-micro px-2"
                  disabled={currentPage === 1}
                  onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                >
                  {t('knowledge.prevPage')}
                </Button>
                <Button
                  variant="outline" size="sm"
                  className="h-6 text-micro px-2"
                  disabled={currentPage === totalPages}
                  onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                >
                  {t('knowledge.nextPage')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
