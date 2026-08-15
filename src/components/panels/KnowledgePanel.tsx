import { useState, useEffect, useCallback, useMemo } from 'react'
import { getCurrentLocale } from '../../shared/locale'
import {
  Database, RefreshCw, BookOpen, Download, Archive, SortAsc, Search, X, Trash2,
} from 'lucide-react'
import { ipc } from '../../services/ipc-client'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/Select'
import { useProjectStore } from '../../stores/project-store'
import { globalEventBus } from '../../shared/event-bus'
import { useTranslation } from '../../hooks/useTranslation'
import { loadKBData, type KBDocument } from '../../services/knowledge-service'
import { confirm } from '../ui/Confirm'
import { toast } from '../ui/Toast'
import ChapterExportDialog from '../dialogs/ChapterExportDialog'



/** 知识库管理面板（侧栏）— 只读展示 + 搜索 + 删除，数据由定稿自动驱动 */
export default function KnowledgePanel() {
  const { t } = useTranslation()
  const [documents, setDocuments] = useState<KBDocument[]>([])
  const [stats, setStats] = useState({ documentCount: 0, totalChunks: 0 })
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 20
  const [titleMap, setTitleMap] = useState<Record<string, string>>({})
  // 排序方式：chapter = 章节号（升序，默认——章节是主索引）/ time = 导入时间（降序）/ name = 名称（升序）
  const [sortMode, setSortMode] = useState<'time' | 'chapter' | 'name'>('chapter')
  // P2-1：知识库内容搜索（结果视图）
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Array<{ text: string; score: number; fileName: string }>>([])
  const [searching, setSearching] = useState(false)
  // 导出状态
  const [exportOpen, setExportOpen] = useState(false)
  const [exportChapters, setExportChapters] = useState<number[]>([])
  const [exportTitleMap, setExportTitleMap] = useState<Record<number, string>>({})

  /** 从文档文件名提取章节号 */
  const extractChapterNumber = (doc: KBDocument): number => {
    const rawName = doc.fileName.replace(/\.[^.]+$/, '')
    const chMatch = rawName.match(/^(?:chapter_(\d+)|第(\d+)章)/)
    return chMatch ? parseInt(chMatch[1] || chMatch[2], 10) : 0
  }

  /** 单章导出 */
  const openSingleExport = (doc: KBDocument) => {
    const cn = extractChapterNumber(doc)
    setExportChapters([cn])
    setExportTitleMap({ [cn]: titleMap[doc.id] || doc.fileName })
    setExportOpen(true)
  }

  /** 批量导出所有已入库章节 */
  const openBatchExport = () => {
    const chapters: number[] = []
    const titles: Record<number, string> = {}
    for (const doc of documents) {
      const cn = extractChapterNumber(doc)
      if (cn > 0) {
        chapters.push(cn)
        titles[cn] = titleMap[doc.id] || doc.fileName
      }
    }
    setExportChapters(chapters)
    setExportTitleMap(titles)
    setExportOpen(true)
  }

  // P2-1：知识库搜索（输入防抖省略——列表页轻量查询，Enter/按钮触发）
  const handleSearch = async () => {
    const q = searchQuery.trim()
    if (!q) {
      setSearchResults([])
      return
    }
    setSearching(true)
    try {
      const results = await ipc.invoke('kb:search', q, 10) as Array<{ text: string; score: number; fileName: string }>
      setSearchResults(Array.isArray(results) ? results : [])
    } catch (e) {
      toast.error(t('knowledge.searchFailed').replace('{error}', () => String(e)))
    } finally {
      setSearching(false)
    }
  }

  // P2-1：删除文档（确认 + IPC + 刷新）
  const handleDelete = async (doc: KBDocument) => {
    const ok = await confirm(
      t('knowledge.deleteConfirm').replace('{name}', titleMap[doc.id] || doc.fileName),
      { title: t('action.delete'), confirmText: t('action.delete'), danger: true },
    )
    if (!ok) return
    try {
      const res = await ipc.invoke('kb:remove-document', doc.id)
      if (!res.success) throw new Error('remove failed')
      toast.success(t('knowledge.deleteSuccess').replace('{name}', titleMap[doc.id] || doc.fileName))
      await loadData()
    } catch (e) {
      toast.error(t('knowledge.deleteFailed').replace('{error}', () => String(e)))
    }
  }

  /** 加载文档列表 + 统计（通过 Service 层） */
  const loadData = useCallback(async () => {
    try {
      const { documents: docs, stats: s } = await loadKBData()
      setDocuments(docs)
      setStats(s)
    } catch (e) { console.warn('[KnowledgePanel] 加载知识库数据失败:', e) }
  }, [])

  useEffect(() => { 
    let mounted = true
    Promise.resolve().then(() => { if (mounted) loadData() })
    return () => { mounted = false }
  }, [loadData])

  // 通过 EventBus 监听资源刷新和定稿完成事件
  useEffect(() => {
    const unsub1 = globalEventBus.on('REFRESH_RESOURCE', () => { loadData() })
    const unsub2 = globalEventBus.on('FINALIZE_COMPLETE', () => { loadData() })
    return () => { unsub1(); unsub2() }
  }, [loadData])

  useEffect(() => {
    let cancelled = false
    const loadTitles = async () => {
      if (documents.length === 0) return
      const missing = documents.filter(d => d.filePath && !titleMap[d.id])
      if (missing.length === 0) return

      const newTitles: Record<string, string> = {}
      await Promise.all(
        missing.map(async (doc) => {
          let title = doc.fileName
          const rawName = doc.fileName.replace(/\.[^.]+$/, '')
          const chMatch = rawName.match(/^(?:chapter_(\d+)|第(\d+)章)\s*(.*)$/)
          if (chMatch) {
            const num = chMatch[1] ? parseInt(chMatch[1], 10) : parseInt(chMatch[2], 10)
            const rest = (chMatch[3] || '').trim()
            const chLabel = t('chapter.nLabel').replace('{n}', String(num))
            title = rest ? `${chLabel} ${rest}` : chLabel
          }

          try {
            const res = await ipc.invoke('fs:read-file', doc.filePath)
            if (res.success && res.content) {
              const firstLine = res.content.split('\n').find((l: string) => l.trim())
              if (firstLine) {
                title = firstLine.replace(/^#+\s*/, '').trim() || title
              }
            }
          } catch { /* 忽略 — 非关键路径，单个文档标题读取失败不影响整体 */ }
          newTitles[doc.id] = title
        })
      )
      if (!cancelled) setTitleMap(prev => ({ ...prev, ...newTitles }))
    }
    loadTitles()
    return () => { cancelled = true }
  }, [documents]) // eslint-disable-line react-hooks/exhaustive-deps -- titleMap 不需要作为依赖：内部通过 prev => 合并即可获取最新值

  const currentProject = useProjectStore(s => s.currentProject)

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

  if (!currentProject) {
    return (
      <EmptyState 
        icon={<BookOpen size={36} />} 
        message={t('knowledge.openProjectFirst')}
        className="pb-[15vh]" 
        opacity={0.4} 
      />
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden text-sm">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 h-9 flex-shrink-0 border-b border-[var(--color-border)]">
        <span className="text-xs font-medium text-[var(--color-text)] flex items-center gap-1.5 min-w-0">
          <Database size={13} />
          <span className="truncate">{t('nav.knowledgeBase')}</span>
          <span className="text-[0.7rem] text-[var(--color-text-muted)] flex-shrink-0">
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
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); if (!e.target.value) setSearchResults([]) }}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSearch() }}
            placeholder={t('knowledge.searchPlaceholder')}
            className="flex-1 min-w-0 h-6 px-1.5 text-[0.7rem] rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          />
          {searchResults.length > 0 && (
            <button
              onClick={() => { setSearchQuery(''); setSearchResults([]) }}
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
              <span className="text-[0.7rem] text-[var(--color-text-muted)] font-medium uppercase tracking-wide">
                {t('knowledge.searchResults').replace('{n}', String(searchResults.length))}
              </span>
            </div>
            {searchResults.map((r, i) => (
              <div key={i} className="px-3 py-2 hover:bg-[var(--color-hover)] transition-colors">
                <div className="flex items-center gap-2 text-[0.7rem]" style={{ color: 'var(--color-text-muted)' }}>
                  <span className="truncate flex-1">{r.fileName}</span>
                  <span className="flex-shrink-0">{Math.round(r.score * 100)}%</span>
                </div>
                <div className="text-xs text-[var(--color-text-secondary)] mt-0.5 line-clamp-3">{r.text.slice(0, 200)}</div>
              </div>
            ))}
          </div>
        )}
        {searchQuery.trim() !== '' && !searching && searchResults.length === 0 && (
          <div className="text-center py-8 opacity-40 text-xs">{t('knowledge.searchEmpty')}</div>
        )}
        {searchResults.length === 0 && !(searchQuery.trim() !== '' && !searching) && (
          <DocListView
            documents={documents}
            titleMap={titleMap}
            sortMode={sortMode}
            onSortModeChange={(v) => { setSortMode(v); setCurrentPage(1) }}
            pageDocs={pageDocs}
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            onDelete={(doc) => void handleDelete(doc)}
            onExport={(doc) => openSingleExport(doc)}
            t={t}
          />
        )}
      </div>

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
function DocListView({ documents, titleMap, sortMode, onSortModeChange, pageDocs, currentPage, totalPages, onPageChange, onDelete, onExport, t }: {
  documents: KBDocument[]
  titleMap: Record<string, string>
  sortMode: 'time' | 'chapter' | 'name'
  onSortModeChange: (v: 'time' | 'chapter' | 'name') => void
  pageDocs: KBDocument[]
  currentPage: number
  totalPages: number
  onPageChange: (p: number) => void
  onDelete: (doc: KBDocument) => void
  onExport: (doc: KBDocument) => void
  t: ReturnType<typeof useTranslation>['t']
}) {
  return (
    <>
      {/* 排序头 */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[0.7rem] text-[var(--color-text-muted)] font-medium uppercase tracking-wide">
          {t('knowledge.indexedChapters')}
        </span>
        {/* 排序选择：章节号 / 导入时间 / 名称 */}
        <Select
          value={sortMode}
          onValueChange={(v) => onSortModeChange(v as 'time' | 'chapter' | 'name')}
        >
          <SelectTrigger
            className="h-6 gap-1 text-[0.7rem] px-1.5"
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

      {documents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2 opacity-40">
          <BookOpen size={28} />
          <span className="text-xs">{t('knowledge.empty')}</span>
          <span className="text-[0.7rem] text-center px-4">{t('knowledge.autoIndexHint')}</span>
        </div>
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
                <div className="flex items-center gap-2 text-[0.7rem] text-[var(--color-text-muted)] mt-0.5">
                  <span>{t('knowledge.chunks').replace('{n}', String(doc.chunkCount))}</span>
                  <span>{new Date(doc.importedAt).toLocaleDateString(getCurrentLocale())}</span>
                </div>
              </div>
              {/* 单章导出 — hover 显示 */}
              <button
                className="flex items-center justify-center rounded-sm transition-all opacity-0 group-hover:opacity-100 hover:bg-[var(--color-hover)]"
                style={{ width: 22, height: 22, flexShrink: 0, color: 'var(--color-text-muted)' }}
                title={t('export.singleExportTip')}
                onClick={() => onExport(doc)}
                type="button"
              >
                <Download size={12} />
              </button>
              {/* P2-1：删除文档 — hover 显示 */}
              <button
                className="flex items-center justify-center rounded-sm transition-all opacity-0 group-hover:opacity-100 hover:bg-[var(--color-hover)]"
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
              <span className="text-[0.65rem] text-[var(--color-text-muted)]">
                {currentPage} / {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline" size="sm"
                  className="h-6 text-[0.65rem] px-2"
                  disabled={currentPage === 1}
                  onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                >
                  {t('knowledge.prevPage')}
                </Button>
                <Button
                  variant="outline" size="sm"
                  className="h-6 text-[0.65rem] px-2"
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
