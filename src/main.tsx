import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { useEditorStore } from './stores/editor-store'

// ===== 启动计时：诊断初始化瓶颈 =====
const T0 = performance.now()
const T_HTML = window.__VELA_HTML_READY as number | undefined
if (T_HTML) {
  console.log(`[Startup] HTML→JS 模块加载耗时: ${(T0 - T_HTML).toFixed(0)}ms`)
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
