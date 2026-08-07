import { app, BrowserWindow, Menu, dialog, shell, session } from 'electron'
import { t } from '../src/shared/locale'
import { registerIPCHandlers } from './ipc-handlers'
import { registerMCPHandlers } from './mcp/mcp-ipc-bridge'
import { closeProjectDatabase } from './database'
import { installGlobalErrorHandlers, logger, detectLogEnvironment, LogEnvironment } from './utils/logger'

import path from 'node:path'
import { exec } from 'node:child_process'

// Rolldown CJS 输出中 __dirname 是 Node.js 原生全局变量
// import.meta.url 在 CJS 中被错误转换为 {}.url，直接使用原生 __dirname 更可靠

// 构建产物目录结构
process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null

/**
 * 构建应用菜单
 *
 * Windows/Linux：原生菜单栏的「文件/帮助」功能已迁移至设置界面
 * （检查更新 / 查看发布页 / 关于 / 卸载 / 退出），故直接隐藏菜单栏。
 * macOS：保留原生菜单（屏幕顶部菜单栏是平台惯例，非窗口内按键）。
 */
function buildAppMenu() {
  const isMac = process.platform === 'darwin'

  if (!isMac) {
    Menu.setApplicationMenu(null)
    return
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS 应用菜单
    ...(isMac ? [{
      label: app.getName(),
      submenu: [
        { role: 'about' as const, label: t('menu.aboutApp') },
        { type: 'separator' as const },
        { role: 'quit' as const, label: t('menu.quitApp') },
      ],
    }] : []),

    // 文件
    {
      label: t('menu.file'),
      submenu: [
        {
          label: t('menu.checkUpdate'),
          accelerator: 'CmdOrCtrl+U',
          click: () => {
            const focused = BrowserWindow.getFocusedWindow()
            focused?.webContents.send('menu:check-update')
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: t('menu.closeWindow') } : { role: 'quit', label: t('menu.quit') },
      ],
    },

    // 帮助
    {
      label: t('menu.help'),
      submenu: [
        {
          label: t('menu.checkUpdate').replace('...', ''),
          click: () => {
            const focused = BrowserWindow.getFocusedWindow()
            focused?.webContents.send('menu:check-update')
          },
        },
        {
          label: t('menu.viewReleases'),
          click: () => {
            shell.openExternal('https://github.com/LunaRime/novelforge/releases')
          },
        },
        { type: 'separator' },
        {
          label: `${t('menu.aboutApp')} v${app.getVersion()}`,
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: t('dialog.aboutTitle'),
              message: `NovelForge v${app.getVersion()}`,
              detail: t('dialog.aboutMessage'),
            })
          },
        },
        { type: 'separator' },
        {
          label: t('menu.uninstall'),
          click: () => {
            dialog.showMessageBox({
              type: 'warning',
              title: t('dialog.uninstallConfirmTitle'),
              message: t('dialog.uninstallConfirmMsg'),
              buttons: [t('dialog.buttons.cancel'), t('dialog.buttons.uninstall')],
              defaultId: 0,
              cancelId: 0,
            }).then(({ response }) => {
              if (response === 1) {
                const appDir = path.dirname(app.getPath('exe'))
                const uninstallerPath = path.join(appDir, 'Uninstall NovelForge.exe')
                exec(`"${uninstallerPath}"`, (err) => {
                  if (err) {
                    logger.error('Main', t('log.uninstall.launchFailed').replace('{err}', err.message))
                    dialog.showErrorBox(
                      t('dialog.uninstallFailedTitle'),
                      t('dialog.uninstallFailedMsg').replace('{error}', err.message)
                    )
                  }
                })
                setTimeout(() => app.quit(), 500)
              }
            })
          },
        },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: t('window.title'),
    icon: path.join(process.env.APP_ROOT!, 'build', 'icon.png'),
    // macOS 使用自定义标题栏
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 10 },
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // 安全性设置
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  // 通过 session API 设置 Content-Security-Policy（Electron 推荐方式，防御 XSS）
  // 开发模式下需要 'unsafe-inline' 支持 Vite HMR 注入脚本 + index.html 内联脚本（主题检测/启动计时器）
  // 生产模式下使用 loadFile (file://)，CSP 不经过 webRequest，此处仅影响 dev 模式
  const cspPolicy = [
    "default-src 'self'",
    VITE_DEV_SERVER_URL
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.openai.com https://*.anthropic.com https://*.googleapis.com https://*.deepseek.com https://*.bigmodel.cn http://localhost:* http://127.0.0.1:*",
    "media-src 'self'",
  ].join('; ')
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [cspPolicy],
      },
    })
  })

  if (process.platform === 'darwin') {
    app.dock?.setIcon(path.join(process.env.APP_ROOT!, 'build', 'icon.png'))
  }

  // 构建应用菜单
  buildAppMenu()

  // 渲染进程崩溃检测 — 自动提示重载
  win.webContents.on('render-process-gone', (_event, details) => {
    logger.error('Main', t('log.main.rendererGone')
      .replace('{reason}', details.reason)
      .replace('{exitCode}', String(details.exitCode)))
    dialog.showErrorBox(
      t('dialog.crashTitle'),
      t('dialog.crashMsg')
    )
    if (win && !win.isDestroyed()) {
      win.webContents.reload()
      win.focus()
    }
  })

  // 关闭窗口前检查未保存内容
  win.on('close', async (e) => {
    try {
      // 查询渲染进程是否有脏 tab
      const hasDirty = await win?.webContents.executeJavaScript(
        'window.__vela_hasDirtyTabs ? window.__vela_hasDirtyTabs() : false',
      ).catch(() => false)

      if (hasDirty) {
        e.preventDefault()
        const { response } = await dialog.showMessageBox(win!, {
          type: 'warning',
          title: t('dialog.unsavedTitle'),
          message: t('dialog.unsavedMsg'),
          buttons: [t('dialog.buttons.cancel'), t('dialog.buttons.discardExit')],
          defaultId: 0,
          cancelId: 0,
        })
        if (response === 1) {
          // 用户确认退出 — 强制关闭
          win?.destroy()
        }
      }
    } catch {
      // IPC 不可用时正常关闭
    }
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    logger.info('Main', t('log.main.devMode').replace('{url}', VITE_DEV_SERVER_URL))
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
    logger.info('Main', t('log.main.productionStart'))
  }
}

// macOS: 关闭所有窗口不退出
app.on('window-all-closed', () => {
  closeProjectDatabase()
  logger.info('Main', t('log.main.allWindowsClosed'))
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

// macOS: 点击 dock 图标重新创建窗口
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// 应用即将退出时清理
app.on('before-quit', () => {
  closeProjectDatabase()
  logger.info('Main', t('log.main.appQuitting'))
  logger.close()
})

app.whenReady().then(() => {
  // 双环境日志：dev 模式 / 内测版（-alpha.N 或历史日期式）→ 开发日志（DEBUG 全量）；
  // 公测版（-beta.N）/ 正式版 → 发布日志（INFO 起）
  const logEnv = detectLogEnvironment(Boolean(VITE_DEV_SERVER_URL), app.getVersion())
  installGlobalErrorHandlers(logEnv, app.getVersion())
  registerIPCHandlers()
  registerMCPHandlers()
  createWindow()
  logger.info('Main', t('log.main.startupDone').replace('{env}', t(logEnv === LogEnvironment.Dev ? 'log.envDev' : 'log.envRelease')))
})
