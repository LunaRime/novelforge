/**
 * FilePickerMenu — 可视化添加项目文件（+ 菜单 → 添加文件）
 *
 * 与 @ 提及文件搜索共用 searchProjectFiles：
 * - 顶部搜索框实时过滤项目可读文件
 * - 方向键 + Enter 选择，点击选择
 * - 选中回调 path（相对项目根），由调用方以 "@路径 " 追加到输入框，
 *   发送时走与 @ 提及一致的预取链路（parseMentions → read_file）
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { FileText, Search, FolderOpen } from 'lucide-react'
import { searchProjectFiles } from '../../../services/agent/intent-router'
import { useTranslation } from '../../../hooks/useTranslation'

interface Props {
  onSelect: (path: string) => void
  onClose: () => void
}

export default function FilePickerMenu({ onSelect, onClose }: Props) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 文件列表（最多 30 条，随搜索词实时过滤）
  const files = searchProjectFiles(query, 30)

  // 打开时自动聚焦搜索框
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 搜索词变化时重置选中
  const [prevQuery, setPrevQuery] = useState(query)
  if (query !== prevQuery) {
    setSelectedIndex(0)
    setPrevQuery(query)
  }

  /** 打开系统对话框选择项目外文件（可多选，取第一个；重复点按可继续添加） */
  const handleOpenExternal = useCallback(async () => {
    try {
      const { ipc } = await import('../../../services/ipc-client')
      const paths = await ipc.invoke('dialog:select-files')
      if (paths && paths.length > 0) onSelect(paths[0])
    } catch { /* 对话框失败不处理 */ }
  }, [onSelect])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      // 空列表时保持 0，避免 Math.min(i+1, -1) 产生 -1 索引
      setSelectedIndex(i => files.length === 0 ? 0 : Math.min(i + 1, files.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (files[selectedIndex]) onSelect(files[selectedIndex].value)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }, [files, selectedIndex, onSelect, onClose])

  // 选中项滚动可见
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  return (
    <div
      className="absolute bottom-[calc(100%+8px)] left-0 z-[var(--z-dropdown)] rounded-lg shadow-lg"
      style={{
        width: 280,
        backgroundColor: 'var(--color-sidebar)',
        border: '1px solid var(--color-border)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
      }}
    >
      {/* 搜索框 */}
      <div className="flex items-center gap-1.5 px-2.5 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <Search size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('agent.searchFiles')}
          className="flex-1 min-w-0 bg-transparent outline-none text-xs"
          style={{ color: 'var(--color-text)' }}
        />
      </div>

      {/* 文件列表 */}
      <div ref={listRef} className="max-h-[280px] overflow-y-auto py-1">
        {files.length === 0 ? (
          <div className="px-3 py-4 text-center text-[0.7rem]" style={{ color: 'var(--color-text-muted)' }}>
            {t('agent.noFilesFound')}
          </div>
        ) : (
          files.map((f, i) => (
            <button
              key={f.value}
              type="button"
              onClick={() => onSelect(f.value)}
              onMouseEnter={() => setSelectedIndex(i)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors"
              style={{
                backgroundColor: i === selectedIndex ? 'var(--color-hover)' : 'transparent',
                color: 'var(--color-text)',
              }}
            >
              <FileText size={12} style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }} />
              <span className="flex-1 min-w-0">
                <span className="block truncate font-medium">{f.displayName}</span>
                <span className="block truncate text-[0.62rem]" style={{ color: 'var(--color-text-muted)' }}>
                  {f.value}
                </span>
              </span>
            </button>
          ))
        )}
      </div>

      {/* 项目外文件：系统对话框选择 */}
      <div style={{ borderTop: '1px solid var(--color-border)' }}>
        <button
          type="button"
          onClick={handleOpenExternal}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors"
          style={{ color: 'var(--color-text-secondary)' }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; e.currentTarget.style.color = 'var(--color-text)' }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)' }}
        >
          <FolderOpen size={12} style={{ flexShrink: 0 }} />
          <span className="flex-1 truncate">{t('agent.openExternalFile')}</span>
        </button>
      </div>
    </div>
  )
}
