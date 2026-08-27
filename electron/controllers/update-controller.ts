/**
 * 应用更新 & 卸载控制器
 *
 * 功能：
 * 1. 自动更新 — 基于 electron-updater 检查/下载/安装更新
 * 2. 卸载 — 触发 NSIS 卸载程序 + 清理用户数据
 */

import { ipcMain, app, BrowserWindow, shell } from 'electron'
import { autoUpdater, UpdateInfo as EUUpdateInfo } from 'electron-updater'
import path from 'node:path'
import fs from 'node:fs'
import { exec } from 'node:child_process'
import { logger } from '../utils/logger'
import { t } from '../../src/shared/locale'
import { VELA_HOME } from '../utils/config-utils'

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
 * 清理用户数据目录 (~/.vela)
 */
function cleanUserData(): { success: boolean; error?: string } {
  try {
    if (fs.existsSync(VELA_HOME)) {
      fs.rmSync(VELA_HOME, { recursive: true, force: true })
      logger.info('Uninstall', t('log.uninstall.cleanedUserData').replace('{path}', VELA_HOME))
      return { success: true }
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

  ipcMain.handle('update:check', async () => {
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

  ipcMain.handle('update:download', async () => {
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

  ipcMain.handle('update:install', () => {
    try {
      autoUpdater.quitAndInstall(false, true)
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('update:get-version', () => {
    return {
      currentVersion: app.getVersion(),
      appName: app.getName(),
    }
  })

  ipcMain.handle('update:get-status', () => {
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

  ipcMain.handle('uninstall:trigger', () => {
    return triggerUninstall()
  })

  ipcMain.handle('uninstall:clean-user-data', () => {
    return cleanUserData()
  })

  // ---- 辅助 ----
  ipcMain.handle('update:open-releases', () => {
    openReleasesPage()
    return { success: true }
  })

  logger.info('Update', t('log.ipc.updateRegistered'))
}
