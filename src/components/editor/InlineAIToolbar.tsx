/**
 * InlineAIToolbar — 编辑器中选中文字后浮现的 AI 快速操作工具条
 *
 * 不离开编辑区即可对选中文字执行 AI 改写操作。
 * 3 秒无操作自动消失，Escape 键关闭。
 *
 * 审计标记: [R10-2026-07-18] — R10-02
 */
import { useState, useEffect, useCallback } from 'react'
import { Sparkles, X } from 'lucide-react'

export type AIAction = {
  key: string
  label: string
  icon?: string   // emoji
  prompt: string  // AI 提示词
}

interface InlineAIToolbarProps {
  /** 工具栏显示位置（相对于 viewport 的绝对坐标） */
  x: number
  y: number
  /** 选中的文字 */
  selectedText: string
  /** 可用操作列表 */
  actions: AIAction[]
  /** 点击操作回调 */
  onAction: (action: AIAction, text: string) => void
  /** 关闭工具栏 */
  onClose: () => void
}

const AUTO_HIDE_MS = 3000

export default function InlineAIToolbar({
  x, y, selectedText, actions, onAction, onClose,
}: InlineAIToolbarProps) {
  const [visible, setVisible] = useState(true)
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  // 重置自动隐藏计时器
  const resetTimer = useCallback(() => {
    if (timer) clearTimeout(timer)
    const t = setTimeout(() => setVisible(false), AUTO_HIDE_MS)
    setTimer(t)
  }, [timer])

  // 初始计时 + 清理
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    resetTimer()
    return () => { if (timer) clearTimeout(timer) }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Escape 关闭
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  // 关闭动画后通知父组件
  useEffect(() => {
    if (!visible) {
      const t = setTimeout(onClose, 200)
      return () => clearTimeout(t)
    }
  }, [visible, onClose])

  if (!visible) {
    return (
      <div
        className="fixed z-[var(--z-overlay)] flex items-center gap-0.5 px-1.5 py-1 rounded-lg opacity-0 transition-opacity duration-200"
        style={{ left: x, top: y, pointerEvents: 'none' }}
      />
    )
  }

  return (
    <div
      className="fixed z-[var(--z-overlay)] flex items-center gap-0.5 px-1.5 py-1 rounded-lg shadow-lg"
      style={{
        left: x,
        top: y,
        backgroundColor: 'var(--color-panel)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-popover)',
        transform: 'translate(-50%, -120%)',
        transition: 'opacity 0.15s ease-out',
        opacity: visible ? 1 : 0,
      }}
      onMouseEnter={resetTimer}
      onMouseMove={resetTimer}
    >
      {/* AI 操作按钮 */}
      {actions.map((action) => (
        <button
          key={action.key}
          onClick={(e) => {
            e.stopPropagation()
            onAction(action, selectedText)
            onClose()
          }}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors hover:bg-[var(--color-hover)] whitespace-nowrap"
          style={{ color: 'var(--color-text-secondary)' }}
          title={action.prompt}
        >
          {action.icon && <span className="text-sm">{action.icon}</span>}
          {!action.icon && <Sparkles size={12} />}
          {action.label}
        </button>
      ))}

      {/* 分隔线 */}
      <div
        className="w-px h-4 mx-0.5 flex-shrink-0"
        style={{ backgroundColor: 'var(--color-border)' }}
      />

      {/* 关闭按钮 */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className="flex items-center justify-center w-5 h-5 rounded-md transition-colors hover:bg-[var(--color-hover)] flex-shrink-0"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <X size={11} />
      </button>
    </div>
  )
}
