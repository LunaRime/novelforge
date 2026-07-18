/**
 * 更新通知栏组件
 *
 * 在发现新版本时显示在窗口顶部的横幅通知，
 * 支持：检查中 / 更新可用 / 下载中 / 下载完成 / 错误 等状态
 */

import { useEffect, useState } from 'react'
import { Download, CheckCircle2, AlertCircle, X, RefreshCw, ExternalLink, Loader2 } from 'lucide-react'
import { useUpdateStore } from '../stores/update-store'
import type { UpdateProgressInfo } from '../shared/ipc-channels'

export default function UpdateNotification() {
  const {
    status, updateInfo, downloadProgress, error,
    checkForUpdates, downloadUpdate, installUpdate,
    openReleasesPage, init,
  } = useUpdateStore()

  const [dismissed, setDismissed] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)

  const handleCheck = async () => {
    setIsChecking(true)
    await checkForUpdates()
    setIsChecking(false)
  }

  // 初始化更新监听
  useEffect(() => {
    const cleanup = init()

    // 监听菜单触发的更新检查
    const handler = () => {
      setDismissed(false)
      handleCheck()
    }

    // 监听菜单触发的更新检查事件（通过 preload 暴露的底层 on）
    let menuCleanup: (() => void) | undefined
    try {
      const api = (window as unknown as { velaAPI?: { on: (ch: string, cb: (...args: unknown[]) => void) => () => void } }).velaAPI
      if (api) {
        menuCleanup = api.on('menu:check-update', handler)
      }
    } catch {
      // 非 Electron 环境，忽略
    }

    return () => {
      cleanup()
      menuCleanup?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps — init/handleCheck are stable references from zustand
  }, [])

  // 重置 dismiss 状态当有新更新可用时
  useEffect(() => {
    if (status === 'available' || status === 'downloaded') {
      setDismissed(false)
    }
  }, [status])

  const handleDownload = async () => {
    setIsDownloading(true)
    await downloadUpdate()
    setIsDownloading(false)
  }

  const handleInstall = async () => {
    await installUpdate()
  }

  // 不显示的条件
  if (dismissed && status !== 'downloading') return null
  if (status === 'idle' || status === 'no-update') return null

  // 错误状态
  if (status === 'error') {
    return (
      <UpdateBanner variant="error" onDismiss={() => setDismissed(true)}>
        <AlertCircle size={14} className="flex-shrink-0" />
        <span className="flex-1">
          更新检查失败：{error || '未知错误'}
        </span>
        <UpdateButton onClick={handleCheck} disabled={isChecking}>
          <RefreshCw size={12} className={isChecking ? 'animate-spin' : ''} />
          重试
        </UpdateButton>
        <UpdateButton onClick={openReleasesPage} variant="ghost">
          <ExternalLink size={12} />
          手动下载
        </UpdateButton>
      </UpdateBanner>
    )
  }

  // 检查中
  if (status === 'checking') {
    return (
      <UpdateBanner variant="info">
        <Loader2 size={14} className="animate-spin flex-shrink-0" />
        <span>正在检查更新...</span>
      </UpdateBanner>
    )
  }

  // 更新可用
  if (status === 'available' && updateInfo) {
    return (
      <UpdateBanner variant="info" onDismiss={() => setDismissed(true)}>
        <Download size={14} className="flex-shrink-0" />
        <span className="flex-1">
          🎉 发现新版本 <strong>{updateInfo.version}</strong>
          {updateInfo.releaseDate && (
            <span className="opacity-60 ml-1">({updateInfo.releaseDate})</span>
          )}
        </span>
        <UpdateButton onClick={handleDownload} disabled={isDownloading} variant="primary">
          {isDownloading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Download size={12} />
          )}
          {isDownloading ? '下载中...' : '立即更新'}
        </UpdateButton>
        <UpdateButton onClick={openReleasesPage} variant="ghost">
          <ExternalLink size={12} />
          详情
        </UpdateButton>
      </UpdateBanner>
    )
  }

  // 下载中
  if (status === 'downloading') {
    return (
      <UpdateBanner variant="info">
        <Loader2 size={14} className="animate-spin flex-shrink-0" />
        <span className="flex-1">
          正在下载更新... {downloadProgress ? `${Math.round(downloadProgress.percent)}%` : ''}
        </span>
        {downloadProgress && <DownloadProgressBar progress={downloadProgress} />}
      </UpdateBanner>
    )
  }

  // 下载完成
  if (status === 'downloaded') {
    return (
      <UpdateBanner variant="success">
        <CheckCircle2 size={14} className="flex-shrink-0" />
        <span className="flex-1">
          ✅ 更新已下载完成！重启应用以安装新版本。
        </span>
        <UpdateButton onClick={handleInstall} variant="primary">
          <RefreshCw size={12} />
          立即重启
        </UpdateButton>
      </UpdateBanner>
    )
  }

  return null
}

// ===== 子组件 =====

function UpdateBanner({
  variant,
  children,
  onDismiss,
}: {
  variant: 'info' | 'success' | 'error'
  children: React.ReactNode
  onDismiss?: () => void
}) {
  const bgColor = variant === 'error'
    ? 'rgba(239, 68, 68, 0.12)'
    : variant === 'success'
      ? 'rgba(34, 197, 94, 0.12)'
      : 'rgba(var(--color-accent-rgb), 0.1)'

  const borderColor = variant === 'error'
    ? 'rgba(239, 68, 68, 0.3)'
    : variant === 'success'
      ? 'rgba(34, 197, 94, 0.3)'
      : 'rgba(var(--color-accent-rgb), 0.25)'

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 text-xs select-none"
      style={{
        backgroundColor: bgColor,
        borderBottom: `1px solid ${borderColor}`,
        color: 'var(--color-text)',
        minHeight: 28,
      }}
    >
      {children}
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="flex-shrink-0 p-0.5 rounded opacity-50 hover:opacity-100 transition-opacity"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}

function UpdateButton({
  children,
  onClick,
  disabled,
  variant = 'default',
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  variant?: 'default' | 'primary' | 'ghost'
}) {
  const bgColor = variant === 'primary'
    ? 'var(--color-accent)'
    : variant === 'ghost'
      ? 'transparent'
      : 'rgba(var(--color-accent-rgb), 0.15)'

  const textColor = variant === 'ghost'
    ? 'var(--color-text-secondary)'
    : 'white'

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-all hover:brightness-110 active:scale-[0.96] disabled:opacity-50 cursor-pointer"
      style={{ backgroundColor: bgColor, color: textColor }}
    >
      {children}
    </button>
  )
}

function DownloadProgressBar({ progress }: { progress: UpdateProgressInfo }) {
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      <div
        style={{
          width: 80,
          height: 3,
          borderRadius: 2,
          backgroundColor: 'rgba(var(--color-accent-rgb), 0.2)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${Math.min(100, progress.percent)}%`,
            backgroundColor: 'var(--color-accent)',
            borderRadius: 2,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <span className="font-mono text-[0.62rem] opacity-60">
        {formatBytes(progress.bytesPerSecond)}/s
      </span>
    </div>
  )
}

function formatBytes(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return `${bytesPerSecond} B`
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB`
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB`
}
