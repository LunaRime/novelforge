/* eslint-disable react-refresh/only-export-components */
/**
 * ManuscriptGroup — 正文章节折叠组（已定稿章节列表）
 */

import { useState, useEffect } from 'react'
import { FileText, FolderOpen, Copy, PenTool, Download, Archive } from 'lucide-react'
import type { FileNode } from '../../../shared/ipc-channels'
import { ipc } from '../../../services/ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import { t } from '../../../shared/locale'
import { useTranslation } from '../../../hooks/useTranslation'

import { showSidebarMenu, openChapterFile } from './SidebarShared'
import ChapterExportDialog from '../../dialogs/ChapterExportDialog'
import SidebarGroup from './SidebarGroup'

// ===== 章节标题缓存 =====

/** 章节标题内存缓存：path → 显示名（进程内常驻，避免大量重复 IPC 读取） */
export const chapterTitleCache = new Map<string, string>()

/** 清除特定文件的章节标题缓存 */
export function clearChapterTitleCache(filePath?: string) {
  if (filePath) {
    chapterTitleCache.delete(filePath)
  } else {
    chapterTitleCache.clear()
  }
}

/**
 * 优先从蓝图 JSON 读取章节标题，fallback 到文件首行
 *
 * @param filePath    manuscript 文件路径
 * @param fallback    兜底显示名（如 "第1章"）
 * @param chapterNumber 章节号（用于定位蓝图文件）
 */
async function readChapterTitle(filePath: string, fallback: string, chapterNumber?: number): Promise<string> {
  if (chapterTitleCache.has(filePath)) return chapterTitleCache.get(filePath)!

  // 优先从蓝图 JSON 读取标题
  if (chapterNumber) {
    try {
      const project = useProjectStore.getState().currentProject
      if (project) {
        const bpResult = await ipc.invoke('db:blueprint-get', chapterNumber)
        if (bpResult) {
          const display = `${t('chapter.label').replace('{n}', String(chapterNumber))} ${bpResult.title}`
          chapterTitleCache.set(filePath, display)
          return display
        }
      }
    } catch { /* 蓝图读取失败时 fallback 到文件首行 */ }
  }

  // fallback: 读取正文首行
  let fileContent = ''
  if (filePath.startsWith('vela://')) {
    const { readVelaContent } = await import('../../../services/vela-protocol')
    fileContent = await readVelaContent(filePath)
  } else {
    const result = await ipc.invoke('fs:read-file', filePath)
    if (result.success) fileContent = result.content
  }

  if (!fileContent) return fallback
  const firstLine = fileContent.split('\n').find((l: string) => l.trim())
  if (!firstLine) return fallback
  const title = firstLine.replace(/^#+\s*/, '').trim()
  const display = title || fallback
  chapterTitleCache.set(filePath, display)
  return display
}

// ===== 正文章节组件 =====

export default function ManuscriptGroup({ files }: { files: FileNode[]; projectPath: string }) {
  const { t, locale } = useTranslation()
  const [titleMap, setTitleMap] = useState<Record<string, string>>({})
  // 导出状态
  const [exportOpen, setExportOpen] = useState(false)
  const [exportChapters, setExportChapters] = useState<number[]>([])
  const [exportTitleMap, setExportTitleMap] = useState<Record<number, string>>({})

  // 每次 files 或 locale 变化时读取各文件标题；语言切换时先清空缓存
  // （缓存值含旧语言 t() 文本），再全量重建映射
  const filesDep = files.map(f => f.path).join(',')
  useEffect(() => {
    if (files.length === 0) return
    let cancelled = false
    const load = async () => {
      clearChapterTitleCache()
      const entries: Record<string, string> = {}
      await Promise.all(
        files.map(async (f) => {
          if (f.name.includes('_notes')) return
          const rawName = f.name.replace(/\.[^.]+$/, '')
          const chMatch = rawName.match(/^chapter_(\d+)$/)
          const fallback = chMatch ? t('chapter.label').replace('{n}', String(parseInt(chMatch[1], 10))) : rawName
          const chNum = chMatch ? parseInt(chMatch[1], 10) : undefined
          entries[f.path] = await readChapterTitle(f.path, fallback, chNum)
        })
      )
      if (!cancelled) setTitleMap(entries)
    }
    load()
    return () => { cancelled = true }
  }, [files, filesDep, t, locale])

  const getDisplay = (f: FileNode) => {
    if (titleMap[f.path]) return titleMap[f.path]
    const rawName = f.name.replace(/\.[^.]+$/, '')
    const chMatch = rawName.match(/^chapter_(\d+)$/)
    return chMatch ? t('chapter.label').replace('{n}', String(parseInt(chMatch[1], 10))) : rawName
  }

  // 导出处理
  const openSingleExport = (chapterNumber: number) => {
    setExportChapters([chapterNumber])
    setExportTitleMap(prev => ({ ...prev, [chapterNumber]: getTitleFromMap(chapterNumber) }))
    setExportOpen(true)
  }

  const openBatchExport = () => {
    const allChapters = chapterFiles.map(f => extractChapterNumber(f))
    setExportChapters(allChapters)
    const titles: Record<number, string> = {}
    for (const cn of allChapters) {
      titles[cn] = getTitleFromMap(cn)
    }
    setExportTitleMap(titles)
    setExportOpen(true)
  }

  const getTitleFromMap = (chapterNumber: number): string => {
    // 从 titleMap 中找到对应章节的标题
    for (const [path, title] of Object.entries(titleMap)) {
      const chMatch = path.match(/chapter_(\d+)/)
      if (chMatch && parseInt(chMatch[1]) === chapterNumber) {
        return title
      }
    }
    return t('chapter.label').replace('{n}', String(chapterNumber))
  }

  /** 从文件名提取章节号 */
  const extractChapterNumber = (f: FileNode): number => {
    const rawName = f.name.replace(/\.[^.]+$/, '')
    const chMatch = rawName.match(/^chapter_(\d+)$/)
    return chMatch ? parseInt(chMatch[1], 10) : 0
  }

  // 只显示正文章节（过滤掉旧的 _notes 文件）
  const chapterFiles = files.filter(f => !f.name.includes('_notes'))

  return (
    <SidebarGroup
      icon={<PenTool size={12} />}
      title={t('manuscript.title')}
      count={chapterFiles.length > 0
        ? t('draftbox.count').replace('{n}', String(chapterFiles.length))
        : undefined}
      actions={chapterFiles.length > 0 && (
        <button
          type="button"
          className="p-0.5 rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0"
          style={{ color: 'var(--color-text-muted)' }}
          title={t('export.batchExportTip')}
          onClick={(e) => { e.stopPropagation(); openBatchExport() }}
        >
          <Archive size={12} />
        </button>
      )}
    >
      {chapterFiles.length === 0 ? (
        <div className="text-xs py-1" style={{ paddingLeft: 24, color: 'var(--color-text-muted)' }}>
          {t('manuscript.empty')}
        </div>
      ) : (
        chapterFiles.map(f => {
              const displayName = getDisplay(f)
              const chapterNum = extractChapterNumber(f)
              return (
                <div
                  key={f.path}
                  className="tree-item gap-1.5 cursor-pointer group"
                  style={{ paddingLeft: 30 }}
                  onClick={() => openChapterFile(f.path, displayName)}
                  onContextMenu={e => showSidebarMenu([
                    {
                      key: 'open',
                      label: t('action.openChapter'),
                      icon: <FolderOpen size={13} />,
                      onClick: () => openChapterFile(f.path, displayName),
                    },
                    {
                      key: 'export-single',
                      label: t('action.export'),
                      icon: <Download size={13} />,
                      onClick: () => openSingleExport(chapterNum),
                    },
                    { key: 'div1', type: 'divider' as const },
                    {
                      key: 'copy-path',
                      label: t('action.copyPath'),
                      icon: <Copy size={13} />,
                      onClick: () => navigator.clipboard.writeText(f.path).catch(() => { }),
                    },
                  ], e)}
                  title={t('manuscript.tooltip').replace('{name}', displayName)}
                >
                  <FileText size={11} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                  <span className="text-sm truncate flex-1" style={{ color: 'var(--color-text-secondary)' }}>
                    {displayName}
                  </span>
                  {/* 单章导出按钮 — hover 时显示 */}
                  <button
                    className="flex items-center justify-center rounded-sm transition-all opacity-0 group-hover:opacity-100 hover:bg-[var(--color-hover)]"
                    style={{ width: 22, height: 22, flexShrink: 0, color: 'var(--color-text-muted)' }}
                    title={t('export.singleExportTip')}
                    onClick={(e) => { e.stopPropagation(); openSingleExport(chapterNum) }}
                    type="button"
                  >
                    <Download size={12} />
                  </button>
                </div>
              )
            })
          )}

      {/* 章节导出对话框 */}
      <ChapterExportDialog
        chapterNumbers={exportChapters}
        chapterTitles={exportTitleMap}
        open={exportOpen}
        onClose={() => setExportOpen(false)}
      />
    </SidebarGroup>
  )
}
