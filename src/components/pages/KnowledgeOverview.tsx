import { useState, useEffect, useCallback } from 'react'
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
import { ipc } from '../../services/ipc-client'
import {
  loadKBData, getVectorlessCount, searchKB, backfillVectors, backfillTokens,
  type KBDocument, type SearchResult, type KBStatsData,
} from '../../services/knowledge-service'
import ChapterExportDialog from '../dialogs/ChapterExportDialog'

/**
 * 知识库概览页面 — LanceDB 向量数据库的管理中心
 * 当侧栏视图为"知识库"时，作为中间编辑区的固定内容展示。
 */
export default function KnowledgeOverview() {
  const [documents, setDocuments] = useState<KBDocument[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  const [stats, setStats] = useState<KBStatsData>({ documentCount: 0, totalChunks: 0, vectorDimension: 0 })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [topK, setTopK] = useState(10)
  const [vectorlessCount, setVectorlessCount] = useState(0)
  const [backfilling, setBackfilling] = useState(false)
  const [tokenBackfilling, setTokenBackfilling] = useState(false)
  // 导出状态
  const [exportOpen, setExportOpen] = useState(false)
  const [exportChapters, setExportChapters] = useState<number[]>([])
  const [exportTitleMap, setExportTitleMap] = useState<Record<number, string>>({})

  const currentProject = useProjectStore(s => s.currentProject)

  const { t } = useTranslation()

  /** 提取文档章节号 */
  const extractChNum = (doc: KBDocument): number => {
    const rawName = doc.fileName.replace(/\.[^.]+$/, '')
    const chMatch = rawName.match(/^(?:chapter_(\d+)|第(\d+)章)/)
    return chMatch ? parseInt(chMatch[1] || chMatch[2], 10) : 0
  }

  /** 批量导出所有已入库章节 */
  const openBatchExport = async () => {
    const chapters: number[] = []
    const titles: Record<number, string> = {}
    for (const doc of documents) {
      const cn = extractChNum(doc)
      if (cn > 0) {
        chapters.push(cn)
        try {
          const res = await ipc.invoke('db:blueprint-get', cn)
          titles[cn] = res?.title || doc.fileName
        } catch {
          titles[cn] = doc.fileName
        }
      }
    }
    setExportChapters(chapters)
    setExportTitleMap(titles)
    setExportOpen(true)
  }

  const loadData = useCallback(async () => {
    if (!currentProject) return
    try {
      const { documents: docs, stats: s } = await loadKBData()
      setDocuments(docs)
      setStats(s)
      setLoadFailed(false)
    } catch (e) {
      // 2026-09-25 修：此前只 console.warn → 统计卡片全 0、导出按钮消失，
      // 用户读到的是「这本书还没入库任何内容」，而事实是加载失败
      console.warn('[KnowledgeOverview] 加载知识库数据失败:', e)
      setLoadFailed(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.path])

  const checkVectorless = useCallback(async () => {
    if (!currentProject) return
    try {
      setVectorlessCount(await getVectorlessCount())
    } catch (e) { console.warn('[KnowledgeOverview] 查询无向量文本块数失败:', e) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.path])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData()
    checkVectorless()
  }, [loadData, checkVectorless])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { checkVectorless() }, [checkVectorless, documents])

  // 通过 EventBus 监听资源刷新和定稿完成事件
  useEffect(() => {
    const unsub1 = globalEventBus.on('REFRESH_RESOURCE', (payload: { resources: string[] }) => {
      if (payload.resources.includes('all') || payload.resources.includes('fileTree')) {
        loadData()
        checkVectorless()
      }
    })
    const unsub2 = globalEventBus.on('FINALIZE_COMPLETE', () => {
      loadData()
      checkVectorless()
    })
    return () => { unsub1(); unsub2() }
  }, [loadData, checkVectorless])

  // 判断检索模式
  const hasVectors = stats.vectorDimension > 0
  const searchMode = hasVectors ? t('knowledge.fusion') : t('knowledge.bm25')

  if (!currentProject) {
    return (
      <div className="h-full flex flex-col overflow-hidden bg-[var(--color-bg)]">
        <div
          className="flex items-center justify-between gap-2 px-3 h-9 flex-shrink-0"
          style={{
            borderBottom: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-editor-bg)',
          }}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-medium truncate text-[var(--color-text-secondary)]">
              {t('nav.knowledgeBase')}
            </span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto relative">
          <EmptyState icon={<BookOpen size={36} />} message={t('empty.pleaseOpenProject')} opacity={0.4} />
        </div>
      </div>
    )
  }

  /** 语义检索 */
  const handleSearch = async () => {
    setSearching(true)
    try {
      const results = await searchKB(searchQuery, topK)
      setSearchResults(results)
    } catch (e) { 
      console.warn('[KnowledgeOverview] 语义检索失败:', e)
    }
    setSearching(false)
  }

  /** 向量回填 */
  const handleBackfill = async () => {
    setBackfilling(true)
    try {
      const result = await backfillVectors()
      if (result.success) {
        if (result.failed > 0) {
          toast.success(t('knowledge.rebuildPartialSuccess').replace('{processed}', String(result.processed)).replace('{failed}', String(result.failed)))
        } else {
          toast.success(t('knowledge.rebuildAllSuccess').replace('{processed}', String(result.processed)))
        }
      } else {
        toast.error(result.error || t('knowledge.backfillFailed'))
      }
    } catch (e) {
      toast.error(t('error.vectorBackfillFailed').replace('{error}', String(e)))
    } finally {
      setBackfilling(false)
      globalEventBus.emit('REFRESH_RESOURCE', { resources: ['all'] })
    }
  }

  /**
   * 分词回填（L3 T2 / IMP-2 接线）
   *
   * 为存量 chunks 补齐中文分词 `tokens`（纯本地 jieba、无需 Embedding 配置、幂等）。
   * 不触发 REFRESH_RESOURCE：tokens 只服务于 FTS 词级通道，不改变文档/统计的展示。
   */
  const handleTokenBackfill = async () => {
    setTokenBackfilling(true)
    try {
      const result = await backfillTokens()
      if (result.success) {
        if (result.failed > 0) {
          toast.success(t('knowledge.tokenBackfillPartial').replace('{processed}', String(result.processed)).replace('{failed}', String(result.failed)))
        } else {
          toast.success(t('knowledge.tokenBackfillSuccess').replace('{processed}', String(result.processed)))
        }
      } else {
        toast.error(result.error || t('knowledge.tokenBackfillFailed'))
      }
    } catch (e) {
      toast.error(t('error.tokenBackfillFailed').replace('{error}', String(e)))
    } finally {
      setTokenBackfilling(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto" style={{ backgroundColor: 'var(--color-editor-bg)' }}>
      <div className="max-w-4xl mx-auto px-8 py-6">

        {/* ===== 标题 ===== */}
        <div className="flex items-center gap-3 mb-6">
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
              disabled={tokenBackfilling}
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
        <div className="grid grid-cols-4 gap-3 mb-6">
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
                disabled={backfilling}
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

        {/* ===== 语义检索区域 ===== */}
        <div
          className="rounded-xl border border-[var(--color-border)] mb-6 overflow-hidden"
          style={{ backgroundColor: 'var(--color-sidebar)' }}
        >
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
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
            <div className="flex items-center gap-2">
              <Input
                className="flex-1 h-9"
                placeholder={t('knowledge.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="text-micro text-[var(--color-text-muted)]">{t('knowledge.topK')}</span>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={topK}
                  onChange={(e) => setTopK(Math.max(1, Math.min(50, Number(e.target.value) || 10)))}
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

          {/* 检索结果 */}
          {searchResults.length > 0 && (
            <div className="border-t border-[var(--color-border)]">
              <div className="px-4 py-2 flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--color-text-muted)]">
                  {t('knowledge.searchResults').replace('{n}', String(searchResults.length))}
                </span>
                <button
                  className="text-micro text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                  onClick={() => setSearchResults([])}
                >
                  {t('knowledge.clear')}
                </button>
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
