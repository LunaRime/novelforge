/**
 * MentionMenu — @ 提及选择菜单
 *
 * 用户输入 @ 时弹出的上下文资源选择面板。
 */
import { useState, useEffect, useCallback, type RefObject } from 'react'
import { searchMentionTargets, type MentionTarget } from '../../../services/agent/intent-router'
import { t } from '../../../shared/locale'
import { useFloatingPosition } from '../../../hooks/useFloatingPosition'
import { PopoverSurface } from '../../ui/PopoverSurface'

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

  const [prevQuery, setPrevQuery] = useState(query)

  if (query !== prevQuery) {
    setSelectedIndex(0)
    setPrevQuery(query)
  }

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
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

  if (results.length === 0) return null

  return (
    <PopoverSurface
      ref={menuRef}
      className="py-1"
      style={{
        width: 240,
        maxWidth: 'calc(100vw - 32px)', // 窗口窄时不让菜单顶出视口
        maxHeight: 260,
        overflowY: 'auto',
      }}
    >
      <div className="text-micro px-3 py-1" style={{ color: 'var(--color-text-muted)' }}>
        {t('agentPanel.mentionContext')}
      </div>
      {results.map((target, i) => (
        <button
          key={target.value}
          onClick={() => onSelect(target)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors"
          style={{
            backgroundColor: i === selectedIndex ? 'var(--color-hover)' : 'transparent',
            color: 'var(--color-text)',
          }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <span className="text-sm">{target.icon}</span>
          <span className="font-medium">{target.displayName}</span>
          {/* 文件目标：右侧小字显示相对路径（插入后为 @路径 文本） */}
          {target.type === 'file' && (
            <span className="ml-auto text-2xs opacity-50 truncate max-w-[90px]" style={{ color: 'var(--color-text-muted)' }}>
              {target.value}
            </span>
          )}
        </button>
      ))}
    </PopoverSurface>
  )
}
