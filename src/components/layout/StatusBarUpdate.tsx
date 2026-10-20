import { useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Download, ExternalLink, RefreshCw } from 'lucide-react'
import { Spinner } from '../ui/Spinner'
import { ProgressBar } from '../ui/ProgressBar'
import { PopoverSurface } from '../ui/PopoverSurface'
import { MenuItem } from '../ui/MenuItem'
import { toast } from '../ui/Toast'
import { useUpdateStore } from '../../stores/update-store'
import { useTranslation } from '../../hooks/useTranslation'
import { useOutsideClick } from '../../hooks/useOutsideClick'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useFloatingPosition } from '../../hooks/useFloatingPosition'
import { ipc } from '../../services/ipc-client'
import { StatusBarSegment } from './StatusBarSegment'

/**
 * 状态栏更新指示器（2026-10-20）—— 更新的**唯一操作面**。
 *
 * 取代窗口顶部的横幅：发现新版本不再打断写作，只在状态栏亮一个短徽章；
 * 下载支持「前台」（弹窗保持打开、进度可见）与「后台」（关闭弹窗、完成后
 * 用带重启动作的 toast 提示一次）。设置页只保留「检查更新」。
 *
 * 下载 IPC 已改为启动即返回（Task 11）：状态全部由 `update:status-changed`
 * 事件驱动，因此这里不做「invoke 返回 = 下载完成」的假设。
 */
export default function StatusBarUpdate() {
  const { t } = useTranslation()
  const status = useUpdateStore(s => s.status)
  const updateInfo = useUpdateStore(s => s.updateInfo)
  const downloadProgress = useUpdateStore(s => s.downloadProgress)
  const error = useUpdateStore(s => s.error)
  const init = useUpdateStore(s => s.init)
  const checkForUpdates = useUpdateStore(s => s.checkForUpdates)
  const downloadUpdate = useUpdateStore(s => s.downloadUpdate)
  const installUpdate = useUpdateStore(s => s.installUpdate)
  const openReleasesPage = useUpdateStore(s => s.openReleasesPage)

  const [open, setOpen] = useState(false)
  /** 本轮下载的入口：后台下载完成后才弹重启提示 */
  const downloadModeRef = useRef<'foreground' | 'background' | null>(null)
  /** 重启提示去重：同一轮下载只弹一次 */
  const notifiedRef = useRef(false)

  // 锚点包住触发器 + 浮层（浮层 fixed 但仍是 DOM 子节点），点浮层内部不算外部点击
  const anchorRef = useRef<HTMLDivElement>(null)
  const popoverRef = useFloatingPosition<HTMLDivElement>(anchorRef, open, {
    placement: 'above',
    align: 'end',
  })

  useOutsideClick(anchorRef, () => setOpen(false), open)
  useEscapeKey(() => setOpen(false), open)

  // 初始化：版本号 + 状态/进度监听 + 菜单「检查更新」
  useEffect(() => {
    const cleanup = init()
    const menuCleanup = ipc.on('menu:check-update', () => {
      void checkForUpdates()
    })
    return () => {
      cleanup()
      menuCleanup()
    }
  }, [init, checkForUpdates])

  // 新一轮下载开始/发现新版本时，允许再次提示
  useEffect(() => {
    if (status === 'available' || status === 'downloading') {
      notifiedRef.current = false
    }
  }, [status])

  // 后台下载完成：只弹一次带「立即重启 / 稍后」的 toast
  useEffect(() => {
    if (status !== 'downloaded') return
    if (downloadModeRef.current !== 'background' || notifiedRef.current) return
    notifiedRef.current = true
    toast.show({
      type: 'success',
      message: t('update.backgroundDone'),
      actions: [
        {
          label: 'Restart',
          i18nKey: 'action.restart',
          onClick: () => { void installUpdate() },
        },
        { label: 'Later', i18nKey: 'update.restartLater', variant: 'ghost' },
      ],
    })
  }, [status, t, installUpdate])

  if (status === 'idle') return null

  const version = updateInfo?.version ?? ''
  const percent = Math.round(downloadProgress?.percent ?? 0)
  const canOpen = status === 'available' || status === 'downloading' || status === 'downloaded' || status === 'error'

  const handleDownload = (background: boolean) => {
    downloadModeRef.current = background ? 'background' : 'foreground'
    notifiedRef.current = false
    if (background) setOpen(false)
    void downloadUpdate()
  }

  const handleInstall = () => {
    void installUpdate()
  }

  const summary = (() => {
    switch (status) {
      case 'checking':
        return (
          <>
            <Spinner size={11} />
            <span>{t('update.checkingShort')}</span>
          </>
        )
      case 'no-update':
        return (
          <>
            <CheckCircle2 size={11} />
            <span className="opacity-70">{t('update.latest')}</span>
          </>
        )
      case 'downloading':
        return (
          <>
            <Download size={11} />
            <span className="tabular-nums">
              {t('update.downloadingShort').replace('{percent}', String(percent))}
            </span>
            <ProgressBar className="w-10 flex-shrink-0" height={2} value={percent} />
          </>
        )
      case 'downloaded':
        return (
          <>
            <CheckCircle2 size={11} style={{ color: 'var(--color-success)' }} />
            <span>{t('update.downloadedShort')}</span>
          </>
        )
      case 'error':
        return (
          <>
            <AlertCircle size={11} style={{ color: 'var(--color-warning)' }} />
            <span>{t('status.error')}</span>
          </>
        )
      default:
        return (
          <>
            <Download size={11} />
            <span>{t('update.availableShort').replace('{version}', version)}</span>
          </>
        )
    }
  })()

  return (
    <div ref={anchorRef} className="relative h-full">
      <StatusBarSegment
        title={
          status === 'available'
            ? t('update.newVersionShort').replace('{version}', version)
            : status === 'error'
              ? `${t('update.checkFailed')}${error ?? ''}`
              : t('update.latest')
        }
        onClick={canOpen ? () => setOpen(v => !v) : undefined}
        aria-haspopup={canOpen ? 'menu' : undefined}
        aria-expanded={canOpen ? open : undefined}
      >
        {summary}
      </StatusBarSegment>

      {open && canOpen && (
        <PopoverSurface ref={popoverRef} className="p-3" style={{ width: 280 }}>
          {status === 'available' && (
            <>
              <div className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                {t('update.newVersionShort').replace('{version}', version)}
              </div>
              {updateInfo?.releaseDate && (
                <div className="mt-0.5 text-micro" style={{ color: 'var(--color-text-muted)' }}>
                  {updateInfo.releaseDate}
                </div>
              )}
              {updateInfo?.releaseNotes && (
                <div
                  className="mt-2 text-xs whitespace-pre-wrap"
                  style={{ maxHeight: 180, overflowY: 'auto', color: 'var(--color-text-secondary)' }}
                >
                  {updateInfo.releaseNotes}
                </div>
              )}
              <div className="mt-2 flex flex-col gap-0.5">
                <MenuItem
                  label={t('update.downloadForeground')}
                  icon={<Download size={12} />}
                  onClick={() => handleDownload(false)}
                />
                <MenuItem
                  label={t('update.downloadBackground')}
                  icon={<Download size={12} />}
                  onClick={() => handleDownload(true)}
                />
                <MenuItem
                  label={t('action.details')}
                  icon={<ExternalLink size={12} />}
                  onClick={() => { setOpen(false); openReleasesPage() }}
                />
              </div>
            </>
          )}

          {status === 'downloading' && (
            <>
              <div className="text-xs" style={{ color: 'var(--color-text)' }}>
                {t('update.downloadingShort').replace('{percent}', String(percent))}
              </div>
              <ProgressBar className="mt-2" height={3} value={percent} />
              {downloadProgress && (
                <div className="mt-1 text-micro tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                  {formatBytes(downloadProgress.bytesPerSecond)}/s
                </div>
              )}
            </>
          )}

          {status === 'downloaded' && (
            <>
              <div className="text-xs" style={{ color: 'var(--color-text)' }}>
                {t('update.restartPrompt')}
              </div>
              <div className="mt-2 flex flex-col gap-0.5">
                <MenuItem
                  label={t('action.restart')}
                  icon={<RefreshCw size={12} />}
                  onClick={handleInstall}
                />
                <MenuItem
                  label={t('update.restartLater')}
                  onClick={() => setOpen(false)}
                />
              </div>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="text-xs" style={{ color: 'var(--color-text)' }}>
                {t('update.downloadFailed').replace('{error}', error ?? t('status.unknown'))}
              </div>
              <div className="mt-2 flex flex-col gap-0.5">
                <MenuItem
                  label={t('action.retry')}
                  icon={<RefreshCw size={12} />}
                  onClick={() => { setOpen(false); void checkForUpdates() }}
                />
                <MenuItem
                  label={t('action.details')}
                  icon={<ExternalLink size={12} />}
                  onClick={() => { setOpen(false); openReleasesPage() }}
                />
              </div>
            </>
          )}
        </PopoverSurface>
      )}
    </div>
  )
}

function formatBytes(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return `${bytesPerSecond} B`
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB`
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB`
}