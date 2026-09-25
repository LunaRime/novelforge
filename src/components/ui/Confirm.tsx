/* eslint-disable react-refresh/only-export-components */
/**
 * NovelForge 异步确认对话框
 *
 * 替代所有 window.confirm() 调用，返回 Promise<boolean>
 * 使用 CSS 动画（dialog-enter / dialog-exit / backdrop-enter）统一进出场效果。
 *
 * 用法：
 *   import { confirm } from '@/components/ui/Confirm'
 *   const ok = await confirm('确定要归档吗？', '归档后可在列表中恢复查看。')
 *   if (ok) { ... }
 */

import { createRoot } from 'react-dom/client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { AlertCircle } from 'lucide-react'
import { t } from '../../shared/locale'
import { Button } from './Button'
import { ModalShell } from './ModalShell'

// ===== 内部组件 =====

interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  /** 单按钮错误提示模式（无取消按钮，遮罩/ESC 等同确认）— alertError 使用 */
  alert?: boolean
}

interface ConfirmDialogProps extends ConfirmOptions {
  onResolve: (value: boolean) => void
}

/** 退场动画时长 —— 必须与 index.css 的 dialog-exit / backdrop-exit 对齐 */
const EXIT_ANIMATION_MS = 200

/**
 * 退场延时：返回的 `exitThen` 先置 exiting（驱动 CSS 退场动画），
 * 动画放完再执行 done（真正卸载）。两份模态此前各自重复这三行。
 */
function useExitDelay(): [boolean, (done: () => void) => void] {
  const [isExiting, setIsExiting] = useState(false)
  const exitThen = useCallback((done: () => void) => {
    setIsExiting(true)
    setTimeout(done, EXIT_ANIMATION_MS)
  }, [])
  return [isExiting, exitThen]
}

/**
 * 命令式挂载：建容器 → 挂 body → createRoot → 渲染；resolve 时卸载并摘掉容器。
 * 三个入口（confirm / alertError / confirmDeleteProject）共用。
 */
function mountDialog<T>(render: (resolve: (value: T) => void) => React.ReactNode): Promise<T> {
  return new Promise<T>((resolve) => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const root = createRoot(container)
    root.render(
      render((value) => {
        root.unmount()
        document.body.removeChild(container)
        resolve(value)
      }),
    )
  })
}

function ConfirmDialog({
  title = t('dialog.confirmTitle'),
  message,
  confirmText = t('dialog.confirm'),
  cancelText = t('action.cancel'),
  danger = false,
  alert = false,
  onResolve,
}: ConfirmDialogProps) {
  const [isExiting, exitThen] = useExitDelay()
  const confirmBtnRef = useRef<HTMLButtonElement>(null)

  const handleConfirm = useCallback(() => exitThen(() => onResolve(true)), [exitThen, onResolve])

  const handleCancel = useCallback(() => exitThen(() => onResolve(false)), [exitThen, onResolve])

  // 进场聚焦确认按钮
  useEffect(() => {
    confirmBtnRef.current?.focus()
  }, [])

  // ESC 关闭（alert 模式等同确认，否则等同取消）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (alert) handleConfirm()
        else handleCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [alert, handleCancel, handleConfirm])

  return (
    <ModalShell
      exiting={isExiting}
      role={alert ? 'alertdialog' : 'dialog'}
      /* alert 模式点遮罩等同确认（用户只有「知道了」一条路） */
      onBackdropClick={alert ? handleConfirm : handleCancel}
    >
        {/* 标题（alert 模式带错误图标） */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          {alert && (
            <AlertCircle size={14} style={{ color: 'var(--color-error)', flexShrink: 0 }} />
          )}
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
            {title}
          </div>
        </div>

        {/* 消息体 */}
        <div
          style={{
            fontSize: 12,
            color: 'var(--color-text-secondary)',
            lineHeight: 1.65,
            whiteSpace: 'pre-wrap',
            marginBottom: 20,
          }}
        >
          {message}
        </div>

        {/* 按钮区 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {!alert && (
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              {cancelText}
            </Button>
          )}
          <Button
            ref={confirmBtnRef}
            variant={danger ? 'destructive' : 'default'}
            size="sm"
            onClick={handleConfirm}
          >
            {confirmText}
          </Button>
        </div>
    </ModalShell>
  )
}

// ===== 公共 API =====

/**
 * 显示确认对话框，返回 Promise<boolean>
 *
 * @example
 * const ok = await confirm('确定要删除此草稿吗？', { danger: true })
 */
export function confirm(
  message: string,
  options?: Partial<Omit<ConfirmOptions, 'message'>>,
): Promise<boolean> {
  return mountDialog<boolean>((resolve) => (
    <ConfirmDialog
      message={message}
      title={options?.title}
      confirmText={options?.confirmText}
      cancelText={options?.cancelText}
      danger={options?.danger}
      alert={options?.alert}
      onResolve={resolve}
    />
  ))
}

/**
 * 显示单按钮错误弹窗（原 AlertDialog.alertError），返回 Promise（确认后 resolve）。
 * 也可以不 await，fire-and-forget。
 *
 * @example
 * await alertError('不是有效的 NovelForge 项目目录', { title: '打开项目失败' })
 */
export function alertError(
  message: string,
  options?: { title?: string; confirmText?: string },
): Promise<void> {
  return confirm(message, {
    title: options?.title,
    confirmText: options?.confirmText,
    alert: true,
  }).then(() => undefined)
}

// ===== 删除项目确认对话框 =====

type DeleteAction = 'delete' | 'remove' | 'cancel'

interface ConfirmDeleteProjectProps {
  onResolve: (action: DeleteAction) => void
}

function ConfirmDeleteProjectDialog({ onResolve }: ConfirmDeleteProjectProps) {
  const [isExiting, exitThen] = useExitDelay()
  const deleteBtnRef = useRef<HTMLButtonElement>(null)

  const handleAction = useCallback(
    (action: DeleteAction) => exitThen(() => onResolve(action)),
    [exitThen, onResolve],
  )

  const handleCancel = useCallback(() => handleAction('cancel'), [handleAction])

  useEffect(() => {
    deleteBtnRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleCancel])

  return (
    <ModalShell exiting={isExiting} minWidth={380} onBackdropClick={handleCancel}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>
          {t('project.deleteTitle')}
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--color-text-secondary)',
            lineHeight: 1.65,
            marginBottom: 20,
          }}
        >
          {t('project.deleteMessage')}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" size="sm" onClick={() => handleAction('cancel')}>
            {t('action.cancel')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => handleAction('remove')}>
            {t('project.removeRecent')}
          </Button>
          <Button
            ref={deleteBtnRef}
            variant="destructive"
            size="sm"
            onClick={() => handleAction('delete')}
          >
            {t('project.deleteFolder')}
          </Button>
        </div>
    </ModalShell>
  )
}

/**
 * 显示删除项目确认对话框，返回用户选择的删除方式
 *
 * @example
 * const action = await confirmDeleteProject()
 * if (action === 'delete') deleteProjectFolder(path)
 * else if (action === 'remove') removeRecentProject(path)
 */
export function confirmDeleteProject(): Promise<DeleteAction> {
  return mountDialog<DeleteAction>((resolve) => (
    <ConfirmDeleteProjectDialog onResolve={resolve} />
  ))
}
