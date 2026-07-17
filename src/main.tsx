import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { useEditorStore } from './stores/editor-store'

declare global {
  interface Window {
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
