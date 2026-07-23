import { app, BrowserWindow, Menu, dialog, shell, session } from 'electron'
import { registerIPCHandlers } from './ipc-handlers'
import { registerMCPHandlers } from './mcp/mcp-ipc-bridge'
import { closeProjectDatabase } from './database'
import { installGlobalErrorHandlers, logger } from './utils/logger'

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
 * 包含：文件、帮助（更新检查、卸载）
 */
function buildAppMenu() {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS 应用菜单
    ...(isMac ? [{
      label: app.getName(),
      submenu: [
        { role: 'about' as const, label: '关于 NovelForge' },
        { type: 'separator' as const },
        { role: 'quit' as const, label: '退出 NovelForge' },
      ],
    }] : []),

    // 文件
    {
      label: '文件',
      submenu: [
        {
          label: '检查更新...',
          accelerator: 'CmdOrCtrl+U',
          click: () => {
            const focused = BrowserWindow.getFocusedWindow()
            focused?.webContents.send('menu:check-update')
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' },
      ],
    },

    // 帮助
    {
      label: '帮助',
      submenu: [
        {
          label: '检查更新',
          click: () => {
            const focused = BrowserWindow.getFocusedWindow()
            focused?.webContents.send('menu:check-update')
          },
        },
        {
          label: '查看发布页面',
          click: () => {
            shell.openExternal('https://github.com/LunaRime/novelforge/releases')
          },
        },
        { type: 'separator' },
        {
          label: `关于 NovelForge v${app.getVersion()}`,
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: '关于 NovelForge',
              message: `NovelForge v${app.getVersion()}`,
              detail: 'AI 深度驱动的小说创作 IDE\n\n基于 Electron + React + TypeScript 构建\n开源协议: GPL-3.0\n\n© LunaRime',
            })
          },
        },
        { type: 'separator' },
        {
          label: '卸载 NovelForge...',
          click: () => {
            dialog.showMessageBox({
              type: 'warning',
              title: '确认卸载',
              message: '确定要卸载 NovelForge 吗？',
              detail: '卸载将从计算机中移除程序文件。\n你的项目文件不会被删除。\n\n如需同时清理用户配置数据（~/.vela），请在卸载后手动删除该目录。',
              buttons: ['取消', '卸载'],
              defaultId: 0,
              cancelId: 0,
            }).then(({ response }) => {
              if (response === 1) {
                const appDir = path.dirname(app.getPath('exe'))
                const uninstallerPath = path.join(appDir, 'Uninstall NovelForge.exe')
                exec(`"${uninstallerPath}"`, (err) => {
                  if (err) {
                    logger.error('Main', `启动卸载程序失败: ${err.message}`)
                    dialog.showErrorBox('卸载失败', `无法启动卸载程序。\n请通过系统控制面板卸载。\n\n${err.message}`)
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
    title: 'NovelForge — AI 深度驱动的小说创作 IDE',
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
    logger.error('Main', `渲染进程终止 (reason=${details.reason}, exitCode=${details.exitCode})`)
    dialog.showErrorBox(
      '渲染进程意外终止',
      '应用界面意外终止，点击确定后将尝试重新加载。\n如有未保存的工作可能会丢失。'
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
          title: '未保存的修改',
          message: '你有未保存的修改内容。',
          detail: '如果现在关闭，未保存的修改将会丢失。',
          buttons: ['取消', '不保存并退出'],
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
    logger.info('Main', `开发模式: ${VITE_DEV_SERVER_URL}`)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
    logger.info('Main', '生产模式启动')
  }
}

// macOS: 关闭所有窗口不退出
app.on('window-all-closed', () => {
  closeProjectDatabase()
  logger.info('Main', '所有窗口已关闭')
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
  logger.info('Main', '应用即将退出')
  logger.close()
})

app.whenReady().then(() => {
  installGlobalErrorHandlers()
  registerIPCHandlers()
  registerMCPHandlers()
  createWindow()
  logger.info('Main', 'NovelForge 启动完成')
})
