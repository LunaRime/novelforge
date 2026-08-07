/**
 * Report Controller — 报告/分享卡生成链路
 *
 * 渲染进程构造 HTML（年度报告/章节分享卡，内联样式零外部依赖）
 * → report:render-html 离屏截图 → PNG buffer 返回 → fs:write-buffer 保存。
 */
import { BrowserWindow, ipcMain } from 'electron'

/** 分享卡固定宽度（与 yearly-report HTML 宽度一致） */
const REPORT_WIDTH = 1200
/** 截图高度上限（防止异常内容撑爆内存） */
const MAX_HEIGHT = 8000

export function registerReportController() {
  ipcMain.handle('report:render-html', async (_event, html: string): Promise<{ success: boolean; png?: Uint8Array; error?: string }> => {
    const win = new BrowserWindow({
      show: false,
      width: REPORT_WIDTH,
      height: 800,
      webPreferences: { sandbox: true },
    })
    try {
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))

      // 等待首次绘制（隐藏窗口 capturePage 需要 paint 事件；超时兜底防挂起）
      await new Promise<void>((resolve) => {
        let done = false
        win.webContents.once('paint', () => { if (!done) { done = true; resolve() } })
        setTimeout(() => { if (!done) { done = true; resolve() } }, 1500)
      })

      // 内容高度自适应：测量 scrollHeight 后调整窗口再截图（长图/短卡通用）
      const height = Math.min(
        Math.max(Number(await win.webContents.executeJavaScript('document.body.scrollHeight') || 0), 400),
        MAX_HEIGHT,
      )
      win.setContentSize(REPORT_WIDTH, height)
      await new Promise<void>((resolve) => setTimeout(resolve, 120))

      const image = await win.webContents.capturePage()
      const png = image.toPNG()
      return { success: true, png: new Uint8Array(png) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      win.destroy()
    }
  })
}
