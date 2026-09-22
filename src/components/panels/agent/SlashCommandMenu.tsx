/**
 * SlashCommandMenu — / 命令选择菜单
 *
 * 用户输入 / 时弹出的命令搜索和选择面板。
 */
import { useState, useEffect, useCallback, type RefObject } from 'react'
import { Sparkles, Zap } from 'lucide-react'
import { searchSlashCommands, type SlashCommand } from '../../../services/agent/intent-router'
import { t } from '../../../shared/locale'
import { useFloatingPosition } from '../../../hooks/useFloatingPosition'

interface Props {
  /** 搜索关键词（/ 后面的文字） */
  query: string
  /** 选择命令的回调 */
  onSelect: (command: SlashCommand) => void
  /** 关闭菜单 */
  onClose: () => void
  /** 定位锚点（输入框容器）——菜单浮在整个窗口之上 */
  anchorRef: RefObject<HTMLElement | null>
}

export default function SlashCommandMenu({ query, onSelect, onClose, anchorRef }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  // 浮在整个窗口之上（锚点：输入框容器）
  const menuRef = useFloatingPosition<HTMLDivElement>(anchorRef, true, { placement: 'above', align: 'start' })

  const results = searchSlashCommands(query)

  const [prevQuery, setPrevQuery] = useState(query)

  // 重置选中索引
  if (query !== prevQuery) {
    setSelectedIndex(0)
    setPrevQuery(query)
  }

  // 键盘导航
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
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
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }, [results, selectedIndex, onSelect, onClose])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  if (results.length === 0) return null

  return (
    <div
      ref={menuRef}
      className="z-[var(--z-dropdown)] py-1 rounded-lg shadow-lg"
      style={{
        // 浮在整个窗口之上（useFloatingPosition 定位）
        position: 'fixed',
        visibility: 'hidden',
        width: 280,
        maxWidth: 'calc(100vw - 32px)', // 窗口窄时不让菜单顶出视口
        maxHeight: 300,
        overflowY: 'auto',
        backgroundColor: 'var(--color-sidebar)',
        border: '1px solid var(--color-border)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
      }}
    >
      <div className="text-[0.68rem] px-3 py-1" style={{ color: 'var(--color-text-muted)' }}>
        {t('agentPanel.commands')}
      </div>
      {results.map((cmd, i) => (
        <button
          key={cmd.name}
          onClick={() => onSelect(cmd)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors"
          style={{
            backgroundColor: i === selectedIndex ? 'var(--color-hover)' : 'transparent',
            color: 'var(--color-text)',
          }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <span style={{ color: 'var(--color-accent)' }}>
            {cmd.source === 'skill' ? <Sparkles size={13} /> : <Zap size={13} />}
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-medium">/{cmd.name}</div>
            <div
              className="text-[0.68rem] truncate"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {cmd.description}
            </div>
          </div>
          {cmd.source === 'skill' && (
            <span
              className="text-[0.6rem] px-1.5 py-0.5 rounded-full flex-shrink-0"
              style={{
                backgroundColor: 'rgba(var(--color-success-rgb), 0.12)',
                color: 'var(--color-success)',
              }}
            >
              Skill
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
