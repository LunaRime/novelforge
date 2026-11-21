/**
 * MentionMenu — @ 提及选择菜单
 *
 * 用户输入 @ 时弹出的上下文资源选择面板。
 */
import { useState, useEffect, useCallback, useRef, type RefObject } from 'react'
import { BookOpen, ClipboardList, FileText, FolderTree, Library, UsersRound } from 'lucide-react'
import { searchMentionTargets, type MentionTarget } from '../../../services/agent/intent-router'
import { t } from '../../../shared/locale'
import { useFloatingPosition } from '../../../hooks/useFloatingPosition'
import { useOutsideClick } from '../../../hooks/useOutsideClick'
import { PopoverSurface } from '../../ui/PopoverSurface'
import './agent-popovers.css'

const mentionIcons = {
  architecture: FolderTree,
  character: UsersRound,
  blueprint: ClipboardList,
  knowledge: Library,
  chapter: BookOpen,
  file: FileText,
} satisfies Record<MentionTarget['type'], typeof FileText>

interface Props {
  /** 搜索关键词（@ 后面的文字） */
  query: string
  /** 选择提及目标的回调 */
  onSelect: (target: MentionTarget) => void
  /** 关闭菜单 */
  onClose: () => void
  /** 定位锚点（输入框容器）——菜单浮在整个窗口之上 */
  anchorRef: RefObject<HTMLElement | null>
}

export default function MentionMenu({ query, onSelect, onClose, anchorRef }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  // 浮在整个窗口之上（锚点：输入框容器）：不受任何祖先 overflow 裁剪
  const menuRef = useFloatingPosition<HTMLDivElement>(anchorRef, true, { placement: 'above', align: 'start' })

  const results = searchMentionTargets(query)
  const selectedRow = useRef<HTMLButtonElement>(null)
  useOutsideClick(anchorRef, onClose)

  const [prevQuery, setPrevQuery] = useState(query)

  if (query !== prevQuery) {
    setSelectedIndex(0)
    setPrevQuery(query)
  }

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.isComposing) return
    // Escape 始终拦截（关闭菜单），即使列表为空
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    // 空结果不拦截方向键/Enter——否则监听器会吞掉回车导致消息无法发送
    if (results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[selectedIndex]) {
        onSelect(results[selectedIndex])
      }
    }
  }, [results, selectedIndex, onSelect, onClose])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  useEffect(() => {
    selectedRow.current?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedIndex, query])

  if (results.length === 0) return null

  return (
    <PopoverSurface
      ref={menuRef}
      className="nf-mention-menu p-1"
      style={{
        width: 264,
        maxWidth: 'calc(100vw - 32px)', // 窗口窄时不让菜单顶出视口
        maxHeight: 260,
        overflowY: 'auto',
      }}
    >
      <div className="nf-mention-heading px-2 py-1 text-micro font-semibold text-[var(--color-text-secondary)]">
        {t('agentPanel.mentionContext')}
      </div>
      {results.map((target, i) => {
        const Icon = mentionIcons[target.type]
        const selected = i === selectedIndex
        const path = target.type === 'file' && target.value !== target.displayName ? target.value : undefined
        return (
          <button
            key={target.value}
            type="button"
            ref={selected ? selectedRow : undefined}
            data-selected={selected || undefined}
            onMouseDown={event => event.preventDefault()}
            onClick={() => onSelect(target)}
            className="nf-mention-row flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-xs"
            onMouseEnter={() => setSelectedIndex(i)}
          >
            <span className="nf-mention-icon"><Icon size={15} aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{target.displayName}</span>
              {path && <span className="block truncate text-micro text-[var(--color-text-muted)]" data-tooltip={path}>{path}</span>}
            </span>
          </button>
        )
      })}
    </PopoverSurface>
  )
}
