/**
 * 应用更新 & 卸载控制器
 *
 * 功能：
 * 1. 自动更新 — 基于 electron-updater 检查/下载/安装更新
 * 2. 卸载 — 触发 NSIS 卸载程序 + 清理用户数据
 */

import { app, BrowserWindow, dialog, shell } from 'electron'
import { autoUpdater, UpdateInfo as EUUpdateInfo } from 'electron-updater'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { exec } from 'node:child_process'
import { logger } from '../utils/logger'
import { t } from '../../src/shared/locale'
import { VELA_HOME } from '../utils/config-utils'
import { guardedHandle } from '../security/ipc-guard'

// ===== 状态管理 =====

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'no-update'

let currentStatus: UpdateStatus = 'idle'
let currentUpdateInfo: EUUpdateInfo | null = null
let currentError: string | null = null

function sendStatusToRenderer(status: UpdateStatus, info?: EUUpdateInfo | null, error?: string) {
  currentStatus = status
  currentUpdateInfo = info ?? null
  currentError = error ?? null

  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    win.webContents.send('update:status-changed', {
      status,
      info: info ? {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: typeof info.releaseNotes === 'string'
          ? info.releaseNotes
          : Array.isArray(info.releaseNotes)
            ? info.releaseNotes.map(n => n.note ?? '').join('\n')
            : '',
      } : undefined,
      error,
    })
  }
}

// ===== 自动更新 =====

function setupAutoUpdater() {
  // 配置更新源（从 electron-builder.json5 的 publish 配置读取）
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false

  // 检查更新
  autoUpdater.on('checking-for-update', () => {
    logger.info('Update', t('log.update.checking'))
  })

  autoUpdater.on('update-available', (info) => {
    logger.info('Update', t('log.update.available').replace('{version}', info.version))
    sendStatusToRenderer('available', info)
  })

  autoUpdater.on('update-not-available', () => {
    logger.info('Update', t('log.update.upToDate'))
    sendStatusToRenderer('no-update')
  })

  // 下载进度
  autoUpdater.on('download-progress', (progress) => {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('update:download-progress', { progress })
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    logger.info('Update', t('log.update.downloaded').replace('{version}', info.version))
    sendStatusToRenderer('downloaded', info)
  })

  // 错误处理
  autoUpdater.on('error', (error) => {
    logger.error('Update', t('log.update.error').replace('{err}', error.message))
    sendStatusToRenderer('error', null, error.message)
  })
}

// ===== 卸载 =====

/**
 * 触发 NSIS 卸载程序
 * 卸载程序位于应用安装目录的上一级（NSIS 标准布局）
 */
function triggerUninstall(): { success: boolean; error?: string } {
  try {
    const appDir = path.dirname(app.getPath('exe'))
    const uninstallerPath = path.join(appDir, 'Uninstall NovelForge.exe')

    // 检查卸载程序是否存在
    if (!fs.existsSync(uninstallerPath)) {
      return {
        success: false,
        error: `未找到卸载程序: ${uninstallerPath}。请通过系统控制面板卸载。`,
      }
    }

    // 启动卸载程序
    exec(`"${uninstallerPath}"`, (err) => {
      if (err) {
        logger.error('Uninstall', t('log.uninstall.launchFailed').replace('{err}', err.message))
      }
    })

    // 退出应用（在卸载程序启动后）
    setTimeout(() => {
      app.quit()
    }, 500)

    return { success: true }
  } catch (err) {
    return { success: false, error: `触发卸载失败: ${String(err)}` }
  }
}

/**
 * 清理用户数据目录（~/.novelforge + 旧 ~/.vela 双删——迁移失败残留场景）
 */
function cleanUserData(): { success: boolean; error?: string } {
  try {
    const legacyHome = path.join(os.homedir(), '.vela')
    const targets = [VELA_HOME, legacyHome]
    const cleanedDirs: string[] = []
    for (const dir of targets) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true })
        cleanedDirs.push(dir)
      }
    }
    if (cleanedDirs.length > 0) {
      // 记录实际清理的路径（迁移失败残留时可能只清理了旧 ~/.vela，固定 {path}=VELA_HOME 会失真）
      logger.info('Uninstall', t('log.uninstall.cleanedUserData').replace('{path}', cleanedDirs.join(', ')))
    }
    return { success: true } // 目录不存在也算成功
  } catch (err) {
    return { success: false, error: `清理用户数据失败: ${String(err)}` }
  }
}

// ===== 打开 GitHub Releases 页面 =====
function openReleasesPage(): void {
  shell.openExternal('https://github.com/LunaRime/novelforge/releases')
}

// ===== 注册 IPC =====

export function registerUpdateController(): void {
  // 初始化 autoUpdater 事件监听
  setupAutoUpdater()

  // ---- 更新相关 ----

  guardedHandle('update:check', async () => {
    try {
      sendStatusToRenderer('checking')
      const result = await autoUpdater.checkForUpdates()
      if (result?.updateInfo) {
        return {
          hasUpdate: true,
          info: {
            version: result.updateInfo.version,
            releaseDate: result.updateInfo.releaseDate,
            releaseNotes: typeof result.updateInfo.releaseNotes === 'string'
              ? result.updateInfo.releaseNotes
              : Array.isArray(result.updateInfo.releaseNotes)
                ? result.updateInfo.releaseNotes.map(n => n.note ?? '').join('\n')
                : '',
          },
        }
      }
      return { hasUpdate: false }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      sendStatusToRenderer('error', null, msg)
      return { hasUpdate: false, error: msg }
    }
  })

  guardedHandle('update:download', async () => {
    try {
      sendStatusToRenderer('downloading')
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      sendStatusToRenderer('error', null, msg)
      return { success: false, error: msg }
    }
  })

  guardedHandle('update:install', () => {
    try {
      autoUpdater.quitAndInstall(false, true)
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  })

  guardedHandle('update:get-version', () => {
    return {
      currentVersion: app.getVersion(),
      appName: app.getName(),
    }
  })

  guardedHandle('update:get-status', () => {
    return {
      status: currentStatus,
      info: currentUpdateInfo ? {
        version: currentUpdateInfo.version,
        releaseDate: currentUpdateInfo.releaseDate,
        releaseNotes: typeof currentUpdateInfo.releaseNotes === 'string'
          ? currentUpdateInfo.releaseNotes
          : Array.isArray(currentUpdateInfo.releaseNotes)
            ? currentUpdateInfo.releaseNotes.map(n => n.note ?? '').join('\n')
            : '',
      } : undefined,
      error: currentError ?? undefined,
    }
  })

  // ---- 卸载相关 ----

  /**
   * 破坏性操作的主进程原生确认（L4 S10）。
   *
   * 为什么还要确认一次：渲染层的确认弹窗（`confirm()`）对**主帧 XSS 无效** —— 攻击者
   * 可以直接 `ipc.invoke('uninstall:clean-user-data')` 跳过它。原生对话框由主进程弹出，
   * 用户不点「确定」就什么都不做。
   */
  async function confirmDestructive(message: string, title: string): Promise<boolean> {
    const win = BrowserWindow.getFocusedWindow()
    const opts: Electron.MessageBoxOptions = {
      type: 'warning',
      buttons: [t('dialog.buttons.cancel'), t('dialog.buttons.ok')],
      defaultId: 0,
      cancelId: 0,
      title,
      message,
    }
    const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
    return response === 1
  }

  guardedHandle('uninstall:trigger', async () => {
    const ok = await confirmDestructive(t('settings.uninstallConfirmMsg'), t('settings.uninstall'))
    if (!ok) return { success: false, error: t('status.cancelled') }
    return triggerUninstall()
  })

  guardedHandle('uninstall:clean-user-data', async () => {
    // 该通道当前**没有渲染层调用方**（UI 只做「卸载但保留项目数据」），但它在白名单里、
    // 且会抹掉整个 ~/.novelforge —— 属「不可逆 + 无正常入口」，必须由主进程确认才能执行。
    const ok = await confirmDestructive(t('settings.cleanUserDataConfirmMsg'), t('settings.cleanUserData'))
    if (!ok) return { success: false, error: t('status.cancelled') }
    return cleanUserData()
  })

  // ---- 辅助 ----
  guardedHandle('update:open-releases', () => {
    openReleasesPage()
    return { success: true }
  })

  logger.info('Update', t('log.ipc.updateRegistered'))
}
