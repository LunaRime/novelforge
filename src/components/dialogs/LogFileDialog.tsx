/**
 * LogFileDialog — 日志文件查看器（精准定位问题）
 *
 * 双环境日志流可视化：
 * - 环境切换：开发（dev/内测）/ 发布（公测/正式），默认选中当前应用环境
 * - 文件列表：名称 + 大小 + 日期（新→旧）
 * - 内容区：等宽只读，尾部 maxLines 截断（防大文件卡 UI），显示总行数
 * - 工具栏：刷新 / 复制 / 在文件管理器中打开日志目录
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { RefreshCw, Copy, Check, FolderOpen, FileText, ArrowUp, ArrowDown } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { t, getCurrentLocale } from '../../shared/locale'
import { ipc } from '../../services/ipc-client'
import { getCurrentLogEnv } from '../../services/render-logger'
import type { LogEnvMode, LogFileInfo } from '../../shared/ipc-channels'

/** 内容区最多显示尾部行数 */
const MAX_CONTENT_LINES = 2000

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(mtime: number): string {
  if (!mtime) return ''
  return new Date(mtime).toLocaleString(getCurrentLocale(), {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

/** 解析日志行首 ISO 时间戳（logger 文件格式 `[2026-08-07T14:30:01.123Z] [INFO ] [source] msg`）；解析失败返回 -Infinity */
function parseLogLineTs(line: string): number {
  const m = line.match(/^\[([^\]]+)\]/)
  if (!m) return -Infinity
  const ts = Date.parse(m[1])
  return Number.isNaN(ts) ? -Infinity : ts
}

interface LogFileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function LogFileDialog({ open, onOpenChange }: LogFileDialogProps) {
  const [env, setEnv] = useState<LogEnvMode>(() => getCurrentLogEnv())
  const [envFiles, setEnvFiles] = useState<Array<{ env: LogEnvMode; files: LogFileInfo[] }>>([])
  const [selected, setSelected] = useState<LogFileInfo | null>(null)
  const [content, setContent] = useState('')
  const [totalLines, setTotalLines] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [copied, setCopied] = useState(false)
  /** 文件列表排序方向：false = 按 mtime 降序（新→旧，默认），true = 升序 */
  const [listSortAsc, setListSortAsc] = useState(false)
  /** 内容行排序方向：true = 按行首时间戳升序（文件原序，默认），false = 倒序（最新在上） */
  const [contentSortAsc, setContentSortAsc] = useState(true)
  const contentRef = useRef<HTMLPreElement>(null)

  const currentFiles = useMemo(
    () => envFiles.find(e => e.env === env)?.files ?? [],
    [envFiles, env],
  )

  /** 文件列表显式按 mtime 排序（不依赖主进程返回顺序；mtime 缺失排最后） */
  const sortedFiles = useMemo(() => {
    return [...currentFiles].sort((a, b) => {
      const ka = a.mtime || 0
      const kb = b.mtime || 0
      return listSortAsc ? ka - kb : kb - ka
    })
  }, [currentFiles, listSortAsc])

  /** 内容行按行首时间戳排序（升序=文件原序；无时间戳行稳定排最后） */
  const displayedLines = useMemo(() => {
    if (!content) return content
    const lines = content.split('\n')
    if (contentSortAsc) return content
    const withTs = lines.map(line => ({ line, ts: parseLogLineTs(line) }))
    withTs.sort((a, b) => {
      // 无时间戳行(空行/堆栈续行)key=Infinity——升降序都排最后
      const ka = a.ts === -Infinity ? Infinity : a.ts
      const kb = b.ts === -Infinity ? Infinity : b.ts
      return kb - ka
    })
    return withTs.map(x => x.line).join('\n')
  }, [content, contentSortAsc])

  /** 加载两环境文件列表 */
  const loadFiles = useCallback(async () => {
    try {
      const list = await ipc.invoke('log:list-files')
      setEnvFiles(list)
    } catch {
      setEnvFiles([])
    }
  }, [])

  // 打开对话框时加载文件列表
  useEffect(() => {
    if (!open) return
    // setState 放入微任务（项目惯例：effect 内同步 setState 被 ESLint 拦截）
    Promise.resolve().then(loadFiles)
  }, [open, loadFiles])

  // 选中文件有效性：环境切换 / 文件列表刷新后，若当前选中不在列表中则回退到第一个（最新）文件；
  // 手动选中的文件在刷新后保留（不重置用户选择）
  useEffect(() => {
    const files = envFiles.find(e => e.env === env)?.files ?? []
    Promise.resolve().then(() => {
      if (files.length > 0) {
        if (!selected || !files.some(f => f.name === selected.name)) {
          setSelected(sortedFiles[0] ?? files[0])
        }
      } else {
        setSelected(null)
        setContent('')
      }
    })
  }, [env, envFiles, selected, sortedFiles])

  // 选中文件 → 加载内容（尾部截断）
  useEffect(() => {
    if (!selected) return
    let cancelled = false
    // 异步标记 loading + 清错误（项目惯例：effect 内同步 setState 被 ESLint 拦截）
    Promise.resolve().then(() => {
      if (cancelled) return
      setLoading(true)
      setLoadError('')
    })
    ipc.invoke('log:read-file', selected.env, selected.name, MAX_CONTENT_LINES)
      .then((res) => {
        if (cancelled) return
        if (res.success) {
          setContent(res.content ?? '')
          setTotalLines(res.totalLines ?? 0)
        } else {
          setLoadError(res.error ?? t('log.loadError'))
        }
      })
      .catch(() => { if (!cancelled) setLoadError(t('log.loadError')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selected])

  // 内容加载完成后滚动：正序回到底部（最新在下），倒序回到顶部（最新在上）
  useEffect(() => {
    if (contentRef.current && !loading) {
      contentRef.current.scrollTop = contentSortAsc ? contentRef.current.scrollHeight : 0
    }
  }, [content, loading, contentSortAsc])

  const copyContent = async () => {
    try {
      await navigator.clipboard.writeText(displayedLines)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* 剪贴板不可用 */ }
  }

  const openDir = async () => {
    await ipc.invoke('log:open-dir')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[70vh] flex flex-col p-0 gap-0">
        <DialogHeader className="flex flex-row items-center justify-between pr-12">
          <DialogTitle>{t('log.title')}</DialogTitle>
          <div className="flex items-center gap-1">
            {/* 环境切换 */}
            <div className="flex items-center rounded-lg border border-[var(--color-border)] overflow-hidden">
              <button
                type="button"
                onClick={() => setEnv('dev')}
                title={t('log.envDev')}
                className={`px-2.5 py-1 text-xs transition-colors ${
                  env === 'dev'
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]'
                }`}
              >
                {t('log.envDev')}
              </button>
              <button
                type="button"
                onClick={() => setEnv('release')}
                title={t('log.envRelease')}
                className={`px-2.5 py-1 text-xs transition-colors ${
                  env === 'release'
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]'
                }`}
              >
                {t('log.envRelease')}
              </button>
            </div>
            <Button variant="ghost" size="icon" onClick={loadFiles} title={t('log.refresh')}>
              <RefreshCw size={13} />
            </Button>
            <Button variant="ghost" size="icon" onClick={openDir} title={t('log.openDir')}>
              <FolderOpen size={13} />
            </Button>
          </div>
        </DialogHeader>

        <div className="flex flex-1 min-h-0">
          {/* 文件列表 */}
          <div className="w-56 flex-shrink-0 border-r border-[var(--color-border)] flex flex-col">
            <div className="flex items-center justify-end px-1.5 py-1 border-b border-[var(--color-border)] flex-shrink-0">
              <Button
                variant="ghost" size="icon"
                onClick={() => setListSortAsc(!listSortAsc)}
                title={listSortAsc ? t('log.sortAsc') : t('log.sortDesc')}
                className={listSortAsc ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}
              >
                {listSortAsc ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
            {sortedFiles.length === 0 ? (
              <div className="text-center py-8 text-xs opacity-50">{t('log.noFiles')}</div>
            ) : sortedFiles.map((file) => (
              <button
                key={`${file.env}-${file.name}`}
                type="button"
                onClick={() => setSelected(file)}
                className={`w-full text-left px-3 py-2 flex flex-col gap-0.5 transition-colors ${
                  selected?.name === file.name
                    ? 'bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]'
                    : 'hover:bg-[var(--color-hover)]'
                }`}
              >
                <span className="flex items-center gap-1.5 text-xs text-[var(--color-text)]">
                  <FileText size={11} className="flex-shrink-0 opacity-60" />
                  <span className="truncate">{file.name}</span>
                </span>
                <span className="pl-[18px] text-[10px] text-[var(--color-text-muted)]">
                  {formatSize(file.size)} · {formatDate(file.mtime)}
                </span>
              </button>
            ))}
            </div>
          </div>

          {/* 内容区 */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center justify-between px-3 py-1 border-b border-[var(--color-border)] flex-shrink-0">
              <span className="text-[10px] text-[var(--color-text-muted)]">
                {selected
                  ? (totalLines > MAX_CONTENT_LINES
                      ? t('log.totalLines').replace('{total}', String(totalLines)).replace('{shown}', String(MAX_CONTENT_LINES))
                      : `${totalLines} lines`)
                  : ''}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost" size="icon"
                  onClick={() => setContentSortAsc(!contentSortAsc)}
                  disabled={!content}
                  title={contentSortAsc ? t('log.sortAsc') : t('log.sortDesc')}
                  className={contentSortAsc ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-accent)]'}
                >
                  {contentSortAsc ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
                </Button>
                <Button
                  variant="ghost" size="icon"
                  onClick={copyContent}
                  disabled={!content}
                  title={t('log.copy')}
                >
                  {copied ? <Check size={13} className="text-[var(--color-accent)]" /> : <Copy size={13} />}
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              {!selected ? (
                <div className="h-full flex items-center justify-center text-xs opacity-50">
                  {t('log.selectHint')}
                </div>
              ) : loading ? (
                <div className="h-full flex items-center justify-center text-xs opacity-50">
                  {t('status.loading')}
                </div>
              ) : loadError ? (
                <div className="h-full flex items-center justify-center text-xs text-[var(--color-error)]">
                  {loadError}
                </div>
              ) : (
                <pre
                  ref={contentRef}
                  className="p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap break-all text-[var(--color-text-secondary)]"
                >
                  {displayedLines}
                </pre>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
