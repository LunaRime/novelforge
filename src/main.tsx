import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { useEditorStore } from './stores/editor-store'
import { installRendererErrorCapture, renderLog } from './services/render-logger'

// 渲染进程全局错误捕获 → ERROR 落盘（必须先注册，确保早期错误也被记录）
installRendererErrorCapture()

// ===== 启动计时：诊断初始化瓶颈 =====
const T0 = performance.now()
const T_HTML = window.__VELA_HTML_READY as number | undefined
if (T_HTML) {
  const elapsed = (T0 - T_HTML).toFixed(0)
  console.log(`[Startup] HTML→JS 模块加载耗时: ${elapsed}ms`)
  renderLog('debug', 'Startup', `HTML→JS 模块加载耗时: ${elapsed}ms`)
}

declare global {
  interface Window {
    __VELA_HTML_READY?: number
    __vela_hasDirtyTabs?: () => boolean
  }
}

// 暴露给主进程的关闭前检查（主进程 window.on('close') 通过 executeJavaScript 调用）
window.__vela_hasDirtyTabs = () => {
  try {
    return useEditorStore.getState().tabs.some(t => t.dirty)
  } catch {
    return false
  }
}

const T_RENDER = performance.now()
console.log(`[Startup] 开始渲染 App — 距入口加载: ${(T_RENDER - T0).toFixed(0)}ms`)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
