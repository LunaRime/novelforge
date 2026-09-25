/**
 * SlashCommandMenu — / 命令选择菜单
 *
 * 用户输入 / 时弹出的命令搜索和选择面板。
 */
import { useState, useEffect, useCallback, type RefObject } from 'react'
import { Sparkles, Zap } from 'lucide-react'
import { searchSlashCommands, type SlashCommand } from '../../../services/agent/intent-router'
import { Badge } from '../../ui/Badge'
import { PopoverSurface } from '../../ui/PopoverSurface'
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
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    // 空结果不拦截方向键/Enter——否则监听器会吞掉回车导致消息无法发送。
    // ⚠️ 2026-09-25 修：MentionMenu 早就有这行守卫（并注明理由），本组件漏了 ——
    // 输入 `/xyz`（无匹配）后按回车：preventDefault 已执行、results[selectedIndex] 又是 undefined
    // → 既不换行也不发送，发送功能静默失灵。
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
        width: 280,
        maxWidth: 'calc(100vw - 32px)', // 窗口窄时不让菜单顶出视口
        maxHeight: 300,
        overflowY: 'auto',
      }}
    >
      <div className="text-micro px-3 py-1" style={{ color: 'var(--color-text-muted)' }}>
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
              className="text-micro truncate"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {cmd.description}
            </div>
          </div>
          {cmd.source === 'skill' && (
            <Badge variant="success" className="px-1.5 text-2xs font-normal flex-shrink-0">
              Skill
            </Badge>
          )}
        </button>
      ))}
    </PopoverSurface>
  )
}
