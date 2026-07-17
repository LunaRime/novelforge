/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /** 构建产物根目录 */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// 通过 contextBridge 在 preload.ts 中暴露到渲染进程的 API
interface Window {
  velaAPI: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
    on: (channel: string, callback: (...args: unknown[]) => void) => () => void
    once: (channel: string, callback: (...args: unknown[]) => void) => void
    send: (channel: string, ...args: unknown[]) => void
    setZoomLevel: (level: number) => void
    setZoomFactor: (factor: number) => void
    getZoomLevel: () => number
  }
}
