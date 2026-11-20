import { FeatureSplit } from '../ui/FeatureSplit'
import MenuRow from '../ui/MenuRow'
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Database, BookOpen, FileText,
  Search, Layers, Zap, Server, Activity, Download, Languages, AlertCircle,
} from 'lucide-react'
import { ProgressBar } from '../ui/ProgressBar'
import { Spinner } from '../ui/Spinner'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { Input } from '../ui/Input'
import { EmptyState } from '../ui/EmptyState'
import { useProjectStore } from '../../stores/project-store'
import { cn } from '../../lib/utils'
import { toast } from '../ui/Toast'
import { globalEventBus } from '../../shared/event-bus'
import { useTranslation } from '../../hooks/useTranslation'
import { KnowledgeRequestCancelled, type KnowledgeDocument as KBDocument, type KnowledgeSearchResult as SearchResult, type KnowledgeStats as KBStatsData, type MaintenanceKind } from '../../core'
import { createRendererKnowledgeApplication } from '../../services/knowledge/knowledge-adapter'
import { createRendererKnowledgeMaintenanceApplication } from '../../services/knowledge/knowledge-maintenance-adapter'
import { createRendererKnowledgeExportApplication } from '../../services/knowledge/knowledge-export-adapter'
import { renderLog } from '../../services/render-logger'
import ChapterExportDialog from '../dialogs/ChapterExportDialog'

/**
 * 知识库概览页面 — LanceDB 向量数据库的管理中心
 * 当侧栏视图为"知识库"时，作为中间编辑区的固定内容展示。
 */
export default function KnowledgeOverview() {
  const project = useProjectStore(s => s.currentProject)
  const session = useProjectStore(s => s.projectSession)
  const { t } = useTranslation()
  if (!project) return (
    <div className="h-full flex flex-col overflow-hidden bg-[var(--color-bg)]">
      <div className="flex items-center justify-between gap-2 px-3 h-9 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-editor-bg)' }}>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-medium truncate text-[var(--color-text-secondary)]">{t('nav.knowledgeBase')}</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto relative">
        <EmptyState icon={<BookOpen size={36} />} message={t('empty.pleaseOpenProject')} opacity={0.4} />
      </div>
    </div>
  )
  return <KnowledgeOverviewContent key={`${project.id}:${project.path}:${session}`} source={{ id: project.id, path: project.path, session }} />
}

function KnowledgeOverviewContent({ source }: { source: { id: string; path: string; session: number } }) {
  const [application] = useState(() => createRendererKnowledgeApplication(source))
  const [maintenance] = useState(() => createRendererKnowledgeMaintenanceApplication(source))
  const [exportApplication] = useState(() => createRendererKnowledgeExportApplication(source))
  const mounted = useRef(true)
  const lifetime = useRef({ generation: 0 })
  const searchSequence = useRef(0)
  const maintenanceBusy = useRef(false)
  const active = useCallback(() => {
    const state = useProjectStore.getState()
    return mounted.current && state.currentProject?.id === source.id && state.currentProject.path === source.path && state.projectSession === source.session
  }, [source.id, source.path, source.session])
  const [documents, setDocuments] = useState<KBDocument[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  const [stats, setStats] = useState<KBStatsData>({ documentCount: 0, totalChunks: 0, vectorDimension: 0 })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchEmpty, setSearchEmpty] = useState(false)
  const [section, setSection] = useState<'overview' | 'search'>('overview')
  const [detailOpen, setDetailOpen] = useState(false)
  const [topK, setTopK] = useState(10)
  const [vectorlessCount, setVectorlessCount] = useState(0)
  const [backfilling, setBackfilling] = useState(false)
  const [tokenBackfilling, setTokenBackfilling] = useState(false)
  // 导出状态
  const [exportOpen, setExportOpen] = useState(false)
  const [exportChapters, setExportChapters] = useState<number[]>([])
  const [exportTitleMap, setExportTitleMap] = useState<Record<number, string>>({})

  const { t } = useTranslation()
  useEffect(() => {
    mounted.current = true
    const lifecycle = lifetime.current
    const generation = ++lifecycle.generation
    return () => {
      mounted.current = false
      queueMicrotask(() => {
        if (!mounted.current && lifecycle.generation === generation) {
          application.dispose(); maintenance.dispose(); exportApplication.dispose()
        }
      })
    }
  }, [application, maintenance, exportApplication])
  const openBatchExport = async () => {
    try {
      const metadata = await exportApplication.prepare(documents)
      if (!active()) return
      setExportChapters(metadata.chapterNumbers); setExportTitleMap(metadata.chapterTitles); setExportOpen(true)
    } catch (error) {
      if (!active() || error instanceof KnowledgeRequestCancelled) return
      renderLog('error', 'Export:Knowledge', String(error)); toast.error(t('common.loadFailed'))
    }
  }
  const loadData = useCallback(async () => {
    try {
      const data = await application.load()
      if (!active()) return
      setDocuments(data.documents); setStats(data.stats); setLoadFailed(false)
    } catch (error) {
      if (!active() || error instanceof KnowledgeRequestCancelled) return
      renderLog('error', 'Load:Knowledge', String(error)); setLoadFailed(true)
    }
  }, [application, active])
  const checkVectorless = useCallback(async () => {
    try {
      const count = await maintenance.count()
      if (active()) setVectorlessCount(count)
    } catch (error) {
      if (!active() || error instanceof KnowledgeRequestCancelled) return
      renderLog('error', 'Refresh:Knowledge', String(error))
    }
  }, [maintenance, active])
  useEffect(() => {
    queueMicrotask(() => { if (active()) { void loadData(); void checkVectorless() } })
  }, [loadData, checkVectorless, active])
  useEffect(() => {
    const refresh = () => { void loadData(); void checkVectorless() }
    const unsub1 = globalEventBus.on('REFRESH_RESOURCE', (payload: { resources: string[] }) => {
      if (payload.resources.includes('all') || payload.resources.includes('fileTree')) refresh()
    })
    const unsub2 = globalEventBus.on('FINALIZE_COMPLETE', refresh)
    return () => { unsub1(); unsub2() }
  }, [loadData, checkVectorless])
  const cancelSearch = () => {
    searchSequence.current++; application.cancelSearch(); setSearchResults([]); setSearching(false); setSearchEmpty(false)
  }
  const handleSearch = async () => {
    const sequence = ++searchSequence.current
    setSearching(true)
    setSearchEmpty(false)
    try {
      const results = await application.search(searchQuery, topK)
      if (active() && sequence === searchSequence.current) {
        setSearchResults(results)
        setSearchEmpty(results.length === 0)
      }
    } catch (error) {
      if (!active() || sequence !== searchSequence.current || error instanceof KnowledgeRequestCancelled) return
      renderLog('error', 'Search:Knowledge', String(error)); toast.error(t('knowledge.searchFailed').replace('{error}', String(error)))
    } finally {
      if (active() && sequence === searchSequence.current) setSearching(false)
    }
  }
  const runMaintenance = async (kind: MaintenanceKind) => {
    if (maintenanceBusy.current || !active()) return
    maintenanceBusy.current = true
    const setBusy = kind === 'vectors' ? setBackfilling : setTokenBackfilling
    setBusy(true)
    try {
      const receipt = await maintenance.run(kind)
      if (!active()) return
      const result = receipt.result
      renderLog(result.success ? 'info' : 'error', 'Maintain:Knowledge', JSON.stringify({ kind, ...result }))
      if (result.success) {
        const key = kind === 'vectors'
          ? (result.failed > 0 ? 'knowledge.rebuildPartialSuccess' : 'knowledge.rebuildAllSuccess')
          : (result.failed > 0 ? 'knowledge.tokenBackfillPartial' : 'knowledge.tokenBackfillSuccess')
        toast.success(t(key).replace('{processed}', String(result.processed)).replace('{failed}', String(result.failed)))
      } else {
        toast.error(result.error || t(kind === 'vectors' ? 'knowledge.backfillFailed' : 'knowledge.tokenBackfillFailed'))
      }
      if (receipt.vectorlessCount !== undefined) setVectorlessCount(receipt.vectorlessCount)
      if (receipt.refreshError) {
        renderLog('error', 'Refresh:Knowledge', receipt.refreshError); toast.error(t('common.loadFailed'))
      }
      if (kind === 'vectors' && (result.success || result.processed > 0)) globalEventBus.emit('REFRESH_RESOURCE', { resources: ['all'] })
    } catch (error) {
      if (!active() || error instanceof KnowledgeRequestCancelled) return
      renderLog('error', 'Maintain:Knowledge', String(error))
      toast.error(t(kind === 'vectors' ? 'error.vectorBackfillFailed' : 'error.tokenBackfillFailed').replace('{error}', String(error)))
    } finally {
      maintenanceBusy.current = false
      if (active()) setBusy(false)
    }
  }
  const handleBackfill = () => runMaintenance('vectors')
  const handleTokenBackfill = () => runMaintenance('tokens')
  const hasVectors = stats.vectorDimension > 0
  const searchMode = hasVectors ? t('knowledge.fusion') : t('knowledge.bm25')

  return (
    <div className="h-full min-h-0 flex flex-col" style={{ backgroundColor: 'var(--color-editor-bg)' }}>
      <div className="w-full min-w-0 px-4 py-3">

        {/* ===== 标题 ===== */}
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-hover))' }}
          >
            <Database size={20} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-[var(--color-text)]">{t('nav.knowledgeBase')}</h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              {t('knowledge.desc')}
            </p>
          </div>
          {/* 分词回填入口（L3 T2 / IMP-2）：为存量块补齐中文分词 tokens。
              ⚠️ 刻意挂在页面头部动作区（与「批量导出」同排、同样式 outline），**不放进**下方
              「向量索引待升级」卡片——那张卡片仅在 vectorlessCount > 0 时渲染，而本入口要服务的
              正是「向量齐全但 tokens 缺失」的老库，放进去等于没有入口。
              条件 stats.totalChunks > 0 = 有块可回填（空库无可回填对象）。 */}
          {stats.totalChunks > 0 && (
            <Button
              variant="outline"
              className="flex-shrink-0"
              title={t('knowledge.tokenBackfillDesc')}
              onClick={handleTokenBackfill}
              disabled={tokenBackfilling || backfilling}
            >
              {tokenBackfilling ? (
                <><Spinner size={14} className="mr-1.5" />{t('knowledge.tokenBackfilling')}</>
              ) : (
                <><Languages size={14} className="mr-1.5" />{t('knowledge.tokenBackfill')}</>
              )}
            </Button>
          )}
          {/* 批量导出按钮 */}
          {documents.length > 0 && (
            <Button
              variant="outline"
              className="flex-shrink-0"
              onClick={openBatchExport}
            >
              <Download size={14} className="mr-1.5" />
              {t('action.export')}
            </Button>
          )}
        </div>

      </div>
      <FeatureSplit detailOpen={detailOpen} onBack={() => setDetailOpen(false)} list={
        (['overview', 'search'] as const).map(view => (
          <MenuRow key={view} title={t(view === 'overview' ? 'knowledge.overview' : 'knowledge.semanticSearch')}
            current={section === view ? 'page' : undefined} active={section === view}
            onPrimary={() => { setSection(view); setDetailOpen(true) }} />
        ))
      }>
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
        <section hidden={section !== 'overview'}>
        {/* 加载失败横幅：统计卡片全 0 不等于「没有数据」，必须区分 */}
        {loadFailed && (
          <div
            className="flex items-center gap-2 rounded-xl border px-4 py-2.5 mb-4 text-xs"
            style={{ borderColor: 'var(--color-error)', color: 'var(--color-error)', backgroundColor: 'color-mix(in srgb, var(--color-error) 8%, transparent)' }}
          >
            <AlertCircle size={14} />
            <span>{t('common.loadFailed')}</span>
            <button
              type="button"
              className="ml-auto px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
              style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
              onClick={() => void loadData()}
            >
              {t('action.retry')}
            </button>
          </div>
        )}

        {/* ===== 统计卡片 ===== */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-3 mb-6">
          <StatCard icon={<FileText size={14} />} label={t('knowledge.docCount')} value={stats.documentCount} />
          <StatCard icon={<Layers size={14} />} label={t('knowledge.chunkCount')} value={stats.totalChunks} />
          <StatCard
            icon={<Server size={14} />}
            label={t('knowledge.storageEngine')}
            value="LanceDB"
            accent
          />
          <StatCard
            icon={<Activity size={14} />}
            label={t('knowledge.retrievalMode')}
            value={hasVectors ? t('knowledge.ftsVector') : t('knowledge.fts')}
            badge={hasVectors ? t('knowledge.hybrid') : t('knowledge.basic')}
            badgeTone={hasVectors ? 'success' : 'info'}
          />
        </div>

        {/* ===== 向量回填卡片 ===== */}
        {vectorlessCount > 0 && (
          <div
            className="rounded-xl border mb-6 overflow-hidden"
            style={{
              // 原为 border-amber-500/20 + rgba(245,158,11,.06)：Tailwind 调色板类与硬编码色
              // 都违反「颜色只用 CSS 变量」；245,158,11 正是 --color-warning-rgb。
              borderColor: 'rgba(var(--color-warning-rgb), 0.2)',
              backgroundColor: 'rgba(var(--color-warning-rgb), 0.06)',
            }}
          >
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[rgba(var(--color-warning-rgb),0.15)] flex items-center justify-center">
                  <Zap size={16} className="text-[var(--color-warning)]" />
                </div>
                <div>
                  <div className="text-sm font-medium text-[var(--color-warning)]">{t('knowledge.vectorUpgrade')}</div>
                  <div className="text-micro text-[var(--color-warning)] opacity-70">
                    {t('knowledge.vectorUpgradeDesc').replace('{n}', String(vectorlessCount))}
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                className="text-xs border-[rgba(var(--color-warning-rgb),0.3)] text-[var(--color-warning)] hover:bg-[rgba(var(--color-warning-rgb),0.2)]"
                onClick={handleBackfill}
                disabled={backfilling || tokenBackfilling}
              >
                {backfilling ? (
                  <><Spinner size={12} className="mr-1.5" />{t('knowledge.rebuilding')}</>
                ) : (
                  <>{t('knowledge.rebuildBtn')}</>
                )}
              </Button>
            </div>
            {/* 进度条（回填时显示） */}
            {backfilling && (
              <ProgressBar height={4} color="var(--color-warning)" indeterminate />
            )}
          </div>
        )}

        </section>
        <section hidden={section !== 'search'}>
        {/* ===== 语义检索区域 ===== */}
        <div
          className="rounded-xl border border-[var(--color-border)] mb-6 overflow-hidden"
          style={{ backgroundColor: 'var(--color-sidebar)' }}
        >
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
            <Search size={14} className="text-[var(--color-accent)] flex-shrink-0" />
            <span className="text-sm font-semibold text-[var(--color-text)]">{t('knowledge.semanticSearch')}</span>
            <Badge variant={hasVectors ? 'success' : 'info'} className="px-1.5">
              {searchMode}
            </Badge>
            <span className="text-micro text-[var(--color-text-muted)] ml-auto">
              {hasVectors ? t('knowledge.fusionDesc') : t('knowledge.bm25Desc')}
            </span>
          </div>
          <div className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="flex-1 h-9"
                placeholder={t('knowledge.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => { cancelSearch(); setSearchQuery(e.target.value) }}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="text-micro text-[var(--color-text-muted)]">{t('knowledge.topK')}</span>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={topK}
                  onChange={(e) => { cancelSearch(); setTopK(Math.max(1, Math.min(50, Number(e.target.value) || 10))) }}
                  className="w-12 h-7 text-xs rounded px-1.5 text-center"
                />
              </div>
              <Button
                variant="ai"
                onClick={handleSearch}
                disabled={searching}
              >
                {searching ? <Spinner size={13}  /> : <Search size={13} />}
                {t('knowledge.searchBtn')}
              </Button>
            </div>
          </div>

          {searchEmpty && <p role="status" className="px-4 py-2 text-xs text-[var(--color-text-muted)]">{t('knowledge.empty')}</p>}

          {/* 检索结果 */}
          {searchResults.length > 0 && (
            <div className="border-t border-[var(--color-border)]">
              <div className="px-4 py-2 flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--color-text-muted)]">
                  {t('knowledge.searchResults').replace('{n}', String(searchResults.length))}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-micro"
                  onClick={cancelSearch}
                >
                  {t('knowledge.clear')}
                </Button>
              </div>
              <div className="max-h-[400px] overflow-y-auto">
                {[...searchResults].reverse().map((r, i) => (
                  <div
                    key={i}
                    className="px-4 py-3 border-t border-[var(--color-border)] hover:bg-[var(--color-hover)] transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-[var(--color-text-muted)] flex items-center gap-1.5">
                        <FileText size={10} />
                        {r.fileName}
                      </span>
                      <span className={cn(
                        'text-micro px-1.5 py-0.5 rounded font-mono',
                        r.score > 0.8 ? 'bg-[rgba(var(--color-success-rgb),0.2)] text-[var(--color-success)]' :
                        r.score > 0.6 ? 'bg-[rgba(var(--color-warning-rgb),0.2)] text-[var(--color-warning)]' :
                        'bg-[var(--color-hover)] text-[var(--color-text-muted)]'
                      )}>
                        {r.score === 0.5 ? t('knowledge.fullTextMatch') : t('knowledge.similarity').replace('{percent}', (r.score * 100).toFixed(1))}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap">
                      {r.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        </section>
        </div>
      </FeatureSplit>

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

/** 统计卡片子组件 */
function StatCard({ icon, label, value, accent, badge, badgeTone = 'info' }: {
  icon: React.ReactNode
  label: string
  value: number | string
  accent?: boolean
  /** 行内小徽标（**放在标题之后**：窄卡片里长本地化文案不会再把它挤成竖排胶囊） */
  badge?: string
  /** 徽标语义色调——映射到 Badge 的 success/info 变体（色值在变体内用 CSS 变量 token） */
  badgeTone?: 'success' | 'info'
}) {
  return (
    <div
      className="rounded-xl p-4 border border-[var(--color-border)]"
      style={{ backgroundColor: 'var(--color-sidebar)' }}
    >
      {/* 徽标与标题同行：value 独占下一行整宽 */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-[var(--color-text-muted)]">{icon}</span>
        <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
        {badge && (
          <Badge variant={badgeTone} className="px-1.5 text-2xs">
            {badge}
          </Badge>
        )}
      </div>
      <div className={cn(
        'text-2xl font-bold break-words',
        accent ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)]'
      )}>
        {value}
      </div>
    </div>
  )
}
