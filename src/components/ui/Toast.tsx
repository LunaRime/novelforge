/* eslint-disable react-refresh/only-export-components */
/**
 * NovelForge 全局 Toast 通知系统
 *
 * 轻量、非阻塞的操作反馈（成功/错误/警告/信息/AI），支持带操作按钮的增强通知。
 * 关键错误请使用 alertError() — 见 Confirm.tsx。
 *
 * 使用 CSS 动画类替代 inline-style，统一与 index.css 中的 keyframes 对齐。
 *
 * 用法：
 *   import { toast } from '@/components/ui/Toast'
 *   toast.success('保存成功')
 *   toast.warning('字数超出限制')
 *   toast.show({ type: 'ai', message: '✅ 草稿已生成', actions: [{ label: '打开查看', onClick: openDraft }] })
 *   toast.workflowComplete('「第3章」已完成', () => openRightPanel('ai-output'))
 */

import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { X, CheckCircle2, AlertTriangle, Info, Sparkles } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import type { TextKey } from '../../shared/locale'

// ===== 类型定义 =====

export type ToastType = 'success' | 'error' | 'info' | 'warning' | 'ai'

/** 操作按钮（点击后 Toast 自动关闭） */
export interface ToastAction {
  /** 按钮文案（若提供 i18nKey 则渲染时用 t() 翻译，label 作为 fallback） */
  label: string
  /** i18n key：优先于 label 渲染（Toast 是模块级 API，调用处无 t 上下文） */
  i18nKey?: TextKey
  /** 点击回调 */
  onClick?: () => void | Promise<void>
  /** 按钮风格：主色('primary') 或灰色('ghost') */
  variant?: 'primary' | 'ghost'
}

interface ToastItem {
  id: number
  type: ToastType
  message: string
  duration: number
  /** 操作按钮列表（最多 2 个） */
  actions?: ToastAction[]
}

// ===== 全局状态 =====

let _toastCounter = 0
let _addToast: ((item: ToastItem) => void) | null = null

/** 挂载 Toast 容器到 DOM */
function ensureContainer() {
  if (document.getElementById('vela-toast-root')) return
  const container = document.createElement('div')
  container.id = 'vela-toast-root'
  document.body.appendChild(container)
  createRoot(container).render(<ToastContainer />)
}

// ===== Toast 容器组件 =====

function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    _addToast = (item) => {
      setToasts(prev => [...prev, item])
    }
    return () => { _addToast = null }
  }, [])

  const remove = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  return (
    <div
      className="fixed bottom-10 right-5 z-[var(--z-toast)] flex flex-col gap-2 pointer-events-none"
    >
      {toasts.map(t => (
        <ToastItemView key={t.id} item={t} onRemove={remove} />
      ))}
    </div>
  )
}

// ===== 单条 Toast =====

/** 类型 → 视觉映射（左边框颜色 + 图标 + 背景渐变） */
const TOAST_STYLE: Record<ToastType, { border: string; bg: string; icon: React.ReactNode }> = {
  success: {
    border: 'var(--color-success)',
    bg: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(16, 185, 129, 0.04))',
    icon: <CheckCircle2 size={15} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
  },
  error: {
    border: 'var(--color-error)',
    bg: 'linear-gradient(135deg, rgba(244, 63, 94, 0.12), rgba(244, 63, 94, 0.04))',
    icon: <AlertTriangle size={15} style={{ color: 'var(--color-error)', flexShrink: 0 }} />
  },
  warning: {
    border: 'var(--color-warning)',
    bg: 'linear-gradient(135deg, rgba(245, 158, 11, 0.12), rgba(245, 158, 11, 0.04))',
    icon: <AlertTriangle size={15} style={{ color: 'var(--color-warning)', flexShrink: 0 }} />
  },
  info: {
    border: 'var(--color-accent)',
    bg: 'linear-gradient(135deg, rgba(var(--color-accent-rgb), 0.12), rgba(var(--color-accent-rgb), 0.04))',
    icon: <Info size={15} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
  },
  ai: {
    border: 'var(--color-accent)',
    bg: 'linear-gradient(135deg, rgba(var(--color-accent-rgb), 0.12), rgba(var(--color-accent-rgb), 0.04))',
    icon: <Sparkles size={15} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
  },
}

function ToastItemView({ item, onRemove }: { item: ToastItem; onRemove: (id: number) => void }) {
  const { t } = useTranslation()
  const [isExiting, setIsExiting] = useState(false)

  useEffect(() => {
    if (item.duration <= 0) return
    // 退场动画 - 提前 300ms 开始
    const t2 = setTimeout(() => setIsExiting(true), item.duration - 300)
    // 移除 DOM
    const t3 = setTimeout(() => onRemove(item.id), item.duration)
    return () => { clearTimeout(t2); clearTimeout(t3) }
  }, [item.id, item.duration, onRemove])

  const dismiss = () => {
    setIsExiting(true)
    setTimeout(() => onRemove(item.id), 250)
  }

  const handleAction = async (action: ToastAction) => {
    if (action.onClick) {
      await action.onClick()
    }
    dismiss()
  }

  const { border, bg, icon } = TOAST_STYLE[item.type]

  return (
    <div
      className={`
        pointer-events-auto flex flex-col gap-2 px-4 py-3
        rounded-xl border backdrop-blur-xl
        ${isExiting ? 'animate-toast-exit' : 'animate-toast-enter'}
      `}
      style={{
        background: bg,
        backgroundColor: 'color-mix(in srgb, var(--color-sidebar) 92%, transparent)',
        backdropFilter: 'blur(24px)',
        border: `1px solid var(--color-border)`,
        borderLeft: `3px solid ${border}`,
        boxShadow: 'var(--shadow-popover)',
        maxWidth: 380,
        minWidth: 260,
      }}
    >
      {/* 第一行：图标 + 消息 + 关闭 */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">{icon}</div>
        <span
          className="flex-1 text-xs leading-relaxed"
          style={{
            color: 'var(--color-text)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {item.message}
        </span>
        <button
          onClick={dismiss}
          className="flex-shrink-0 p-0.5 rounded transition-all duration-150 hover:bg-[var(--color-hover)]"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-text-muted)',
            lineHeight: 1,
          }}
        >
          <X size={13} />
        </button>
      </div>

      {/* 第二行：操作按钮 */}
      {item.actions && item.actions.length > 0 && (
        <div className="flex justify-end gap-1.5">
          {item.actions.map((action, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleAction(action)}
              className="px-3 py-1 text-[0.7rem] font-medium cursor-pointer transition-all rounded-md"
              style={{
                border: action.variant === 'ghost'
                  ? '1px solid var(--color-border)'
                  : '1px solid transparent',
                backgroundColor: action.variant === 'ghost'
                  ? 'transparent'
                  : 'var(--color-accent)',
                color: action.variant === 'ghost'
                  ? 'var(--color-text-secondary)'
                  : 'var(--color-text)',
              }}
              onMouseEnter={e => {
                if (action.variant === 'ghost') {
                  e.currentTarget.style.backgroundColor = 'var(--color-hover)'
                } else {
                  e.currentTarget.style.filter = 'brightness(1.1)'
                }
              }}
              onMouseLeave={e => {
                if (action.variant === 'ghost') {
                  e.currentTarget.style.backgroundColor = 'transparent'
                } else {
                  e.currentTarget.style.filter = 'none'
                }
              }}
            >
              {action.i18nKey ? t(action.i18nKey) : action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ===== 公共 API =====

function show(message: string, type: ToastType = 'info', duration = 4000, actions?: ToastAction[]) {
  ensureContainer()
  const item: ToastItem = { id: ++_toastCounter, type, message, duration, actions }
  // 等待下一帧确保容器已挂载
  requestAnimationFrame(() => _addToast?.(item))
}

export const toast = {
  success: (msg: string, duration = 3500) => show(msg, 'success', duration),
  error:   (msg: string, duration = 5000) => show(msg, 'error', duration),
  warning: (msg: string, duration = 4500) => show(msg, 'warning', duration),
  info:    (msg: string, duration = 4000) => show(msg, 'info', duration),

  /** 带操作按钮的增强通知（兼容原 ActionToast.show） */
  show: (options: { type?: ToastType; message: string; actions?: ToastAction[]; duration?: number }) =>
    show(options.message, options.type ?? 'info', options.duration ?? 8000, options.actions),

  /** 工作流完成快捷方法（原 actionToast.workflowComplete） */
  workflowComplete: (message: string, openAction?: () => void | Promise<void>) => {
    const actions: ToastAction[] = []
    if (openAction) {
      actions.push({ label: 'Open', i18nKey: 'toast.openView', onClick: openAction })
      actions.push({ label: 'Dismiss', i18nKey: 'toast.dismiss', variant: 'ghost' })
    }
    show(message, 'ai', openAction ? 10000 : 6000, actions)
  },
}
