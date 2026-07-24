/**
 * 应用更新 Zustand Store
 *
 * 管理更新状态、触发检查和下载、追踪进度
 */

import { create } from 'zustand'
import { ipc } from '../services/ipc-client'
import type { UpdateStatus, UpdateInfo, UpdateProgressInfo } from '../shared/ipc-channels'

interface UpdateState {
  /** 当前更新状态 */
  status: UpdateStatus
  /** 更新信息（新版本号、日期、更新日志等） */
  updateInfo: UpdateInfo | null
  /** 下载进度 */
  downloadProgress: UpdateProgressInfo | null
  /** 错误信息 */
  error: string | null
  /** 当前版本 */
  currentVersion: string
  /** 应用名称 */
  appName: string
  /** 是否正在加载 */
  loading: boolean

  // ---- Actions ----

  /** 初始化：获取当前版本并监听状态变化 */
  init: () => () => void
  /** 检查更新 */
  checkForUpdates: () => Promise<boolean>
  /** 下载更新 */
  downloadUpdate: () => Promise<boolean>
  /** 安装更新（重启应用） */
  installUpdate: () => Promise<boolean>
  /** 打开 GitHub Releases 页面 */
  openReleasesPage: () => void
  /** 触发卸载 */
  triggerUninstall: () => Promise<boolean>
  /** 清理用户数据 */
  cleanUserData: () => Promise<boolean>
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: 'idle',
  updateInfo: null,
  downloadProgress: null,
  error: null,
  currentVersion: '',
  appName: 'NovelForge',
  loading: false,

  init: () => {
    // 获取当前版本
    ipc.invoke('update:get-version').then((result) => {
      set({ currentVersion: result.currentVersion, appName: result.appName })
    }).catch(() => {
      set({ currentVersion: '2.2.0', appName: 'NovelForge' })
    })

    // 监听状态变化
    const cleanup = ipc.on('update:status-changed', (data) => {
      set({
        status: data.status,
        updateInfo: data.info ?? get().updateInfo,
        error: data.error ?? null,
      })
    })

    // 监听下载进度
    const cleanupProgress = ipc.on('update:download-progress', (data) => {
      set({ downloadProgress: data.progress })
    })

    return () => {
      cleanup()
      cleanupProgress()
    }
  },

  checkForUpdates: async () => {
    set({ loading: true, error: null })
    try {
      const result = await ipc.invoke('update:check')
      set({ loading: false })
      if (result.hasUpdate && result.info) {
        set({ updateInfo: result.info })
        return true
      }
      return false
    } catch (err) {
      set({ loading: false, error: String(err) })
      return false
    }
  },

  downloadUpdate: async () => {
    set({ loading: true, error: null })
    try {
      const result = await ipc.invoke('update:download')
      set({ loading: false })
      return result.success
    } catch (err) {
      set({ loading: false, error: String(err) })
      return false
    }
  },

  installUpdate: async () => {
    try {
      const result = await ipc.invoke('update:install')
      return result.success
    } catch (err) {
      set({ error: String(err) })
      return false
    }
  },

  openReleasesPage: () => {
    ipc.invoke('update:open-releases').catch(() => {})
  },

  triggerUninstall: async () => {
    try {
      const result = await ipc.invoke('uninstall:trigger')
      return result.success
    } catch (err) {
      set({ error: String(err) })
      return false
    }
  },

  cleanUserData: async () => {
    try {
      const result = await ipc.invoke('uninstall:clean-user-data')
      return result.success
    } catch {
      return false
    }
  },
}))
