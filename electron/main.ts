import { app, BrowserWindow, Menu, dialog, shell } from 'electron'
import { registerIPCHandlers } from './ipc-handlers'
import { registerMCPHandlers } from './mcp/mcp-ipc-bridge'
import { closeProjectDatabase } from './database'
import { installGlobalErrorHandlers, logger } from './utils/logger'

import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { exec } from 'node:child_process'


const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
      preload: path.join(__dirname, 'preload.mjs'),
      // 安全性设置
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (process.platform === 'darwin') {
    app.dock?.setIcon(path.join(process.env.APP_ROOT!, 'build', 'icon.png'))
  }

  // 构建应用菜单
  buildAppMenu()

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
  logger.info('Main', 'Vela 启动完成')
})
