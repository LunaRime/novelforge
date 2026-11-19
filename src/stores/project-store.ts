import { create } from 'zustand'
import { ipc } from '../services/ipc-client'
import { loadProjectCustomPrompts, clearProjectCustomPrompts } from '../services/prompt-templates'
import type { ProjectData, NovelConfig, FileNode } from '../shared/ipc-channels'
import { alertError, confirm } from '../components/ui/Confirm'
import { renderLog } from '../services/render-logger'
import { toast } from '../components/ui/Toast'
import { t } from '../shared/locale'
import { globalEventBus } from '../shared/event-bus'
import { useEditorStore } from './editor-store'
import { NovelConfigRequestCancelled, type NovelConfigScope } from '../core'
import { commitProjectConfig, markProjectConfigReloaded, ProjectConfigResultUnknown } from '../services/config/project-config-save'
import { forgetDraftTabs, rememberDraftTabs, restoreDraftTabs } from '../services/editor/draft-tab-session'
// 延迟导入 ProjectService，避免循环依赖
let _onProjectOpened: (() => Promise<void>) | null = null
let _onProjectClosed: (() => void) | null = null
let openingProject = false
let creatingProject = false
type EditorTabsSnapshot = Pick<ReturnType<typeof useEditorStore.getState>, 'tabs' | 'activeTabId' | 'activeCharCount'>

async function confirmEditorTabSwitch(): Promise<EditorTabsSnapshot | false> {
  const protectedTabs = useEditorStore.getState().tabs.filter(tab => tab.dirty || tab.inlineSession)
  if (protectedTabs.length) {
    const accepted = await confirm(t('project.switchDiscardConfirm'), {
      title: t('dialog.unsavedTitle'), confirmText: t('project.discardAndSwitch'), danger: true,
    })
    if (!accepted) return false
    const latest = useEditorStore.getState().tabs
    if (latest.some(tab => (tab.dirty || tab.inlineSession) && !protectedTabs.includes(tab))) {
      toast.warning(t('project.switchEditsChanged'))
      return false
    }
  }
  const { tabs, activeTabId, activeCharCount } = useEditorStore.getState()
  return { tabs, activeTabId, activeCharCount }
}

async function callProjectOpened() {
  if (!_onProjectOpened) {
    const { onProjectOpened } = await import('../services/project-service')
    _onProjectOpened = onProjectOpened
  }
  await _onProjectOpened()
}
async function callProjectClosed() {
  if (!_onProjectClosed) {
    const { onProjectClosed } = await import('../services/project-service')
    _onProjectClosed = onProjectClosed
  }
  // 延迟加载期间可能已打开另一部作品，旧关闭操作不能重置其数据。
  if (!useProjectStore.getState().currentProject) _onProjectClosed()
}

interface ProjectState {
  /** 当前打开的项目 */
  currentProject: ProjectData | null
  /** 项目关闭和重开会使前一会话的异步任务失效，包括重开相同路径。 */
  projectSession: number
  /** 项目文件树 */
  fileTree: FileNode[]
  /** 最近项目列表 */
  recentProjects: Array<{ name: string; path: string; updatedAt: number }>
  /** 是否正在加载 */
  loading: boolean

  // ===== Actions =====
  /** 新建项目 */
  createProject: (config: {
    name: string
    path: string
    genre: string
    targetAudience: string
  }) => Promise<boolean>
  /** 打开项目 */
  openProject: (projectPath: string, opts?: { keepView?: boolean }) => Promise<boolean>
  /** 保存项目 */
  saveProject: (configSnapshot?: NovelConfig, onPending?: () => void) => Promise<boolean>
  saveNovelConfigPatch: (source: NovelConfigScope, patch: Partial<NovelConfig>, onCommitted?: () => void) => Promise<void>
  commitNovelConfigPatch: (source: NovelConfigScope, patch: Partial<NovelConfig>, expectedVersions?: ProjectState['configFieldVersions']) => Promise<void>
  configFieldVersions: Partial<Record<keyof NovelConfig, number>>
  /** 更新小说配置 */
  updateNovelConfig: (config: Partial<NovelConfig>) => void
  /** 线③：AI 产出应用前的配置快照（撤销出口） */
  configSnapshot: NovelConfig | null
  configSnapshotSource: NovelConfigScope | null
  /** 线③：快照当前配置（AI 产出应用前调用，供撤销恢复） */
  snapshotNovelConfig: () => void
  /** 线③：恢复快照（撤销 AI 产出）；无快照时 no-op 返回 false */
  restoreNovelConfigSnapshot: () => Promise<boolean>
  /** 刷新文件树 */
  refreshFileTree: () => Promise<void>
  /** 加载最近项目 */
  loadRecentProjects: () => Promise<void>
  /** 关闭项目 */
  closeProject: () => void
  /** 更新角色状态（内存 + 持久化） */
  updateCharacterStates: (states: string) => Promise<void>
  /** 删除项目文件夹（从磁盘删除） */
  deleteProjectFolder: (projectPath: string) => Promise<boolean>
  /** 移除历史记录（仅从最近列表中移除） */
  removeRecentProject: (projectPath: string) => Promise<void>
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  currentProject: null,
  projectSession: 0,
  fileTree: [],
  recentProjects: [],
  loading: false,
  configSnapshot: null,
  configSnapshotSource: null,
  configFieldVersions: {},

  createProject: async (config) => {
    if (creatingProject || openingProject) return false
    creatingProject = true
    const source = get()
    let session: number | undefined
    let detachedTabs: EditorTabsSnapshot | undefined
    let opened = false
    let handedOff = false
    try {
      const { useCharacterStore } = await import('./character-store')
      if (get().projectSession !== source.projectSession) return false
      if (source.currentProject) {
        const tabs = await confirmEditorTabSwitch()
        if (!tabs || get().projectSession !== source.projectSession) return false
        detachedTabs = tabs
      }
      if (useCharacterStore.getState().saving) {
        toast.warning(t('tip.characterSaving'))
        return false
      }
      session = get().projectSession + 1
      set({ loading: true, projectSession: session })
      if (detachedTabs) useEditorStore.getState().clearTabs()
      const result = await ipc.invoke('project:create', config)
      if (get().projectSession !== session) return false
      if (result.restoredWriteToken && source.currentProject) {
        set({ currentProject: { ...get().currentProject!, writeToken: result.restoredWriteToken } })
      }
      if (!result.success) {
        console.error('[Project] 创建失败:', result.error)
        alertError(result.error ?? t('status.unknown'), { title: t('dialog.createFailed') })
        return false
      }
      // 使用主进程返回的实际项目路径（跨平台安全，避免路径分隔符问题）
      const projectDir = result.projectPath ?? `${config.path}/${config.name}`
      // keepView：新建/导入后保持当前视图（home），让方块列表立即显示新项目
      handedOff = true
      creatingProject = false
      opened = await get().openProject(projectDir, { keepView: true })
      return opened
    } catch (e) {
      console.error('[Project] createProject 异常:', e)
      alertError(String(e), { title: t('dialog.createError') })
      return false
    } finally {
      if (!handedOff) creatingProject = false
      if (session !== undefined && get().projectSession === session) {
        if (!opened && detachedTabs) useEditorStore.setState(detachedTabs)
        set({ loading: false })
      } else if (handedOff && !opened && detachedTabs && session !== undefined
        && get().projectSession === session + 1 && get().currentProject?.path === source.currentProject?.path) {
        useEditorStore.setState(detachedTabs)
      }
    }
  },


  openProject: async (projectPath, opts) => {
    // #34 块 C：保存/删除进行中禁止切项目——IPC await 期间 DB 已切换，
    // 旧项目数据会被写进新项目库（saveAll 全量 upsert + 改名 diff 曾误删新项目角色）
    const { useCharacterStore } = await import('./character-store')
    if (useCharacterStore.getState().saving) {
      toast.warning(t('tip.characterSaving'))
      return false
    }
    if (openingProject || creatingProject) return false
    openingProject = true
    let session: number | undefined
    let detachedTabs: EditorTabsSnapshot | undefined
    let opened = false
    let restorePath: string | undefined
    try {
      const source = get()
      if (source.currentProject && source.currentProject.path !== projectPath) {
        const tabs = await confirmEditorTabSwitch()
        if (!tabs || get().projectSession !== source.projectSession) return false
        detachedTabs = tabs
      }
      if (useCharacterStore.getState().saving) {
        toast.warning(t('tip.characterSaving'))
        return false
      }
      session = get().projectSession + 1
      set({ loading: true, projectSession: session })
      if (detachedTabs) useEditorStore.getState().clearTabs()
      const result = await ipc.invoke('project:open', projectPath)
      if (get().projectSession !== session) return false
      if (result.success && result.fileProjectPath) {
        // 文件编辑器使用独立会话，暂时分离的 SQLite 标签在 finally 中恢复。
        globalEventBus.emit('OPEN_FILE_PROJECT_EDITOR', { projectPath: result.fileProjectPath })
        return true
      }
      if (result.success && result.project) {
        opened = true
        markProjectConfigReloaded(result.project.path, result.project.writeToken)
        // 切换项目时清空配置快照——旧项目的快照不得跨项目残留（否则撤销会用 A 的快照覆盖 B）
        set({ currentProject: result.project, configSnapshot: null, configSnapshotSource: null, configFieldVersions: {} })
        // 加载项目级 Prompt 覆盖（此前仅在设置页挂载时加载——未打开设置页时覆盖静默失效；
        // 挂到项目打开统一入口，新建/导入/切换均生效）
        loadProjectCustomPrompts(projectPath).catch(() => {})
        // 同步最近项目到全局配置（主进程活动聚合/历史导航可读）
        const list = get().recentProjects
        if (!list.some(p => p.path === projectPath)) {
          list.unshift({ name: result.project.name, path: projectPath, updatedAt: Date.now() })
          set({ recentProjects: list.slice(0, 20) })
        }
        ipc.invoke('config:set', { recentProjects: get().recentProjects.slice(0, 20) }).catch(() => {})
        // 加载文件树
        await get().refreshFileTree()
        // 默认自动展开侧边栏并切换到项目结构视图；
        // keepView（新建/导入）时保持当前视图，让方块列表显示新项目
        if (!opts?.keepView) {
          const { useLayoutStore } = await import('./layout-store')
          useLayoutStore.setState({ sidebarOpen: true, sidebarView: 'project' })
        }
        // 统一初始化 Layer 2 Store（角色卡、草稿等）
        await callProjectOpened()
        if (source.currentProject?.path !== result.project.path) restorePath = result.project.path
        return true
      }
      if (result.restoredWriteToken && source.currentProject) {
        set({ currentProject: { ...get().currentProject!, writeToken: result.restoredWriteToken } })
      }
      console.error('[Project] 打开失败:', result.error)
      alertError(result.error ?? t('status.unknown'), { title: t('dialog.openFailed') })
      return false
    } catch (e) {
      console.error('[Project] IPC 通信异常:', e)
      // L4 S5：原实现写死 `'/tmp/vela_error.log'` —— Windows 上解析为**当前盘的 \tmp\**
      //   （会在用户盘根目录外造目录），且返回值从不检查（失败静默）。改为走应用日志流：
      //   LogsView 可见、跟着日志保留策略走、不再向用户磁盘写垃圾文件。
      renderLog('error', 'Project', `${t('dialog.openError')}: ${String(e)}`)
      alertError(String(e), { title: t('dialog.openError') })
      return false
    } finally {
      openingProject = false
      if (session !== undefined && get().projectSession === session) {
        if (!opened && detachedTabs) useEditorStore.setState(detachedTabs)
        set({ loading: false })
        if (restorePath) await restoreDraftTabs(restorePath, session)
      }
    }
  },

  saveProject: async (configSnapshot, onPending = notifyPendingConfigSave) => {
    const source = captureProjectConfigSource()
    const project = get().currentProject
    if (!source || !project) return false
    const data = { path: project.path, writeToken: project.writeToken, name: project.name, novelConfig: { ...(configSnapshot ?? project.novelConfig) } }
    const result = await commitProjectConfig(source, () => isProjectConfigCurrent(source),
      () => ipc.invoke('project:save', source.id, data), onPending)
    return result.success
  },

  saveNovelConfigPatch: async (source, patch, onCommitted) => {
    const writeToken = get().currentProject?.writeToken
    const novelConfig = { ...patch }
    // SQLite represents an unset optional text field as an empty string.
    if ('writingStyle' in novelConfig && novelConfig.writingStyle === undefined) novelConfig.writingStyle = ''
    if ('referenceWorks' in novelConfig && novelConfig.referenceWorks === undefined) novelConfig.referenceWorks = ''
    const result = await commitProjectConfig(source, () => isProjectConfigCurrent(source),
      () => ipc.invoke('project:update-config', source.id, { path: source.path, writeToken, novelConfig }), notifyPendingConfigSave, onCommitted)
    if (!result.success) throw new Error(result.error ?? t('novelConfig.saveRejected'))
  },

  commitNovelConfigPatch: async (source, patch, expectedVersions = get().configFieldVersions) => {
    if (!isProjectConfigCurrent(source)) throw new NovelConfigRequestCancelled()
    const submitted = { ...patch }
    const fields = Object.keys(submitted) as Array<keyof NovelConfig>
    const current = () => get().configFieldVersions
    const unchanged = (field: keyof NovelConfig) => (current()[field] ?? 0) === (expectedVersions[field] ?? 0)
    if (fields.some(field => !unchanged(field))) throw new Error(t('novelConfig.generationConflict'))
    await get().saveNovelConfigPatch(source, submitted, () => {
      const applied = Object.fromEntries(fields.filter(unchanged).map(field => [field, submitted[field]]))
      if (Object.keys(applied).length) get().updateNovelConfig(applied)
    })
    if (!isProjectConfigCurrent(source)) throw new NovelConfigRequestCancelled()
  },

  updateNovelConfig: (config) => {
    const project = get().currentProject
    if (!project) return
    const configFieldVersions = { ...get().configFieldVersions }
    for (const field of Object.keys(config) as (keyof NovelConfig)[]) configFieldVersions[field] = (configFieldVersions[field] ?? 0) + 1
    set({
      configFieldVersions,
      currentProject: {
        ...project,
        novelConfig: { ...project.novelConfig, ...config },
      },
    })
  },

  snapshotNovelConfig: () => {
    const project = get().currentProject
    const source = captureProjectConfigSource()
    if (!project || !source) return
    // 深拷贝快照（避免后续 updateNovelConfig 浅合并污染快照引用）
    set({ configSnapshot: structuredClone(project.novelConfig), configSnapshotSource: source })
  },

  restoreNovelConfigSnapshot: async () => {
    const { configSnapshot, configSnapshotSource, currentProject, configFieldVersions } = get()
    if (!configSnapshot || !configSnapshotSource || !currentProject || !isProjectConfigCurrent(configSnapshotSource)) return false
    const fields = new Set([...Object.keys(currentProject.novelConfig), ...Object.keys(configSnapshot)] as (keyof NovelConfig)[])
    const patch = Object.fromEntries([...fields].map(field => [field, configSnapshot[field]]))
    try {
      await get().commitNovelConfigPatch(configSnapshotSource, patch, configFieldVersions)
      if (isProjectConfigCurrent(configSnapshotSource) && get().configSnapshot === configSnapshot) {
        set({ configSnapshot: null, configSnapshotSource: null })
      }
      return true
    } catch (error) {
      if (isProjectConfigCurrent(configSnapshotSource)) reportLegacySaveError(error)
      return false
    }
  },

  refreshFileTree: async () => {
    const project = get().currentProject
    if (!project) return
    const source = { id: project.id, path: project.path, session: get().projectSession }
    const tree = await ipc.invoke('fs:list-dir', project.path)
    const current = get()
    if (current.currentProject?.id !== source.id || current.currentProject.path !== source.path || current.projectSession !== source.session) return
    set({ fileTree: tree })
  },

  loadRecentProjects: async () => {
    const list = await ipc.invoke('project:recent-list')
    set({ recentProjects: list })
  },

  closeProject: () => {
    // 先退出作品会话，再清空内存标签，以保留该作品的恢复记录。
    set(state => ({ projectSession: state.projectSession + 1, currentProject: null, fileTree: [], loading: false,
      configSnapshot: null, configSnapshotSource: null, configFieldVersions: {} }))
    useEditorStore.getState().clearTabs()
    callProjectClosed()
    clearProjectCustomPrompts()
  },

  updateCharacterStates: async (states) => {
    const source = captureProjectConfigSource()
    const project = get().currentProject
    if (!project || !source) return
    try {
      const result = await commitProjectConfig(source, () => isProjectConfigCurrent(source),
        () => ipc.invoke('project:save', source.id, { path: source.path, writeToken: project.writeToken, name: project.name, characterStates: states }),
        notifyPendingConfigSave, () => set(state => ({ currentProject: { ...state.currentProject!, characterStates: states } })))
      if (!result.success) throw new Error(result.error ?? t('novelConfig.saveRejected'))
    } catch (error) {
      if (isProjectConfigCurrent(source)) reportLegacySaveError(error)
    }
  },

  deleteProjectFolder: async (projectPath) => {
    try {
      // 如果当前打开的就是要删除的项目，先关闭
      const current = get().currentProject
      if (current && current.path === projectPath) {
        get().closeProject()
      }
      const result = await ipc.invoke('project:delete-folder', projectPath)
      if (result.success) {
        forgetDraftTabs(projectPath)
        // 从本地状态中移除
        set((s) => ({
          recentProjects: s.recentProjects.filter((p) => p.path !== projectPath),
        }))
        return true
      }
      console.error('[Project] 删除文件夹失败:', result.error)
      alertError(result.error ?? t('status.unknown'), { title: t('dialog.deleteFailed') })
      return false
    } catch (e) {
      console.error('[Project] deleteProjectFolder 异常:', e)
      alertError(String(e), { title: t('dialog.deleteError') })
      return false
    }
  },

  removeRecentProject: async (projectPath) => {
    try {
      await ipc.invoke('project:remove-recent', projectPath)
      set((s) => ({
        recentProjects: s.recentProjects.filter((p) => p.path !== projectPath),
      }))
    } catch (e) {
      console.error('[Project] removeRecentProject 异常:', e)
    }
  },
}))

// 项目切换期间会临时清空标签。只保存已就绪作品里的主动标签变更。
useEditorStore.subscribe((next, previous) => {
  const { currentProject, loading } = useProjectStore.getState()
  if (currentProject && !loading) rememberDraftTabs(currentProject.path, next, previous)
})

export function captureProjectConfigSource(): NovelConfigScope | null {
  const { currentProject, projectSession, loading } = useProjectStore.getState()
  return currentProject && !loading ? { id: currentProject.id, path: currentProject.path, session: projectSession } : null
}

export function isProjectConfigCurrent(source: NovelConfigScope): boolean {
  const current = captureProjectConfigSource()
  return current?.id === source.id && current.path === source.path && current.session === source.session
}

function notifyPendingConfigSave() {
  const message = t('novelConfig.savePending')
  renderLog('warn', 'Save:Config', message)
  toast.warning(message)
}

function reportLegacySaveError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof ProjectConfigResultUnknown) {
    renderLog('warn', 'Save:Config', message)
    toast.warning(message)
    return
  }
  renderLog('error', 'Save:Config', message)
  toast.error(t('save.failed').replace('{error}', () => message))
}
