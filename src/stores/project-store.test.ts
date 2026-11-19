// @vitest-environment jsdom
/**
 * project-store 快照机制（线③ 产出审查层：前置快照 + 撤销出口）
 *
 * 契约：snapshotNovelConfig 深拷贝当前配置；restoreNovelConfigSnapshot 恢复快照
 * 并清空快照；无快照/无项目时 no-op 返回 false。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { captureProjectConfigSource, useProjectStore } from './project-store'
import { ProjectConfigResultUnknown } from '../services/config/project-config-save'
import { useEditorStore } from './editor-store'
import type { ProjectData } from '../shared/ipc-channels'
import { ipc } from '../services/ipc-client'
import { confirm } from '../components/ui/Confirm'
import { globalEventBus } from '../shared/event-bus'

vi.mock('../services/ipc-client', () => ({
  ipc: { invoke: vi.fn().mockResolvedValue(true) },
}))
vi.mock('./character-store', () => ({ useCharacterStore: { getState: () => ({ saving: false }) } }))
vi.mock('../services/project-service', () => ({ onProjectClosed: vi.fn(), onProjectOpened: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../components/ui/Confirm', () => ({ confirm: vi.fn(), alertError: vi.fn() }))

const BASE: ProjectData = {
  id: 'p1',
  name: '测试小说',
  path: '/test',
  novelConfig: {
    genre: '玄幻',
    subGenre: '',
    targetAudience: '',
    totalChapters: 100,
    wordsPerChapter: 3000,
    plotStructure: 'three_act',
    narrativePOV: 'third_limited',
    coreOutline: '旧大纲',
    worldSetting: '',
    goldenFinger: '',
    protagonistProfile: '',
    globalGuidance: '',
  },
  characterStates: '',
  createdAt: 0,
  updatedAt: 0,
}

beforeEach(() => {
  localStorage.clear()
  vi.mocked(confirm).mockReset()
  vi.mocked(ipc.invoke).mockReset().mockResolvedValue({ success: true } as never)
  useEditorStore.getState().clearTabs()
  useProjectStore.setState(state => ({
    currentProject: structuredClone(BASE),
    projectSession: state.projectSession + 1,
    configSnapshot: null,
    loading: false,
  }))
})

afterEach(() => {
  useProjectStore.setState({ currentProject: null, configSnapshot: null })
})

describe('SQLite 正文标签恢复', () => {
  const other = { ...BASE, path: '/other' }
  const openProject = (path: string) => useProjectStore.getState().openProject(path, { keepView: true })

  beforeEach(() => {
    vi.mocked(confirm).mockResolvedValue(true)
    vi.mocked(ipc.invoke).mockImplementation(async (...[channel, arg]) => {
      if (channel === 'project:open') return { success: true, project: arg === other.path ? other : BASE } as never
      if (channel === 'fs:list-dir') return [] as never
      if (channel === 'db:draft-get-full') return { content: `已保存:${useProjectStore.getState().currentProject?.path}:${arg}` } as never
      return { success: true } as never
    })
  })

  it('按作品恢复 SQLite 正文的顺序、选中项和固定状态，正文重新读库', async () => {
    const editor = useEditorStore.getState()
    editor.openFile({ id: 'doc:7', type: 'chapter', filePath: 'vela://draft/7', name: '原稿', content: '未保存的修改', dirty: true })
    editor.beginInlineSession('doc:7', { sessionId: '未保存的建议', sourceKind: 'selection', baseDocSnapshot: '', hunks: [], decisions: {} })
    editor.openFile({ id: 'vela://manuscript/8', type: 'chapter', filePath: 'vela://manuscript/8', name: '定稿', pinned: true })
    editor.setActiveTab('doc:7')
    editor.openFile({ id: 'history', type: 'version-history', name: '历史' })

    expect(await openProject(other.path)).toBe(true)
    expect(useEditorStore.getState().tabs).toEqual([])
    editor.openFile({ id: 'doc:7', type: 'chapter', filePath: 'vela://draft/7', name: '另一部作品' })

    expect(await openProject(BASE.path)).toBe(true)
    expect(useEditorStore.getState().tabs).toEqual([
      expect.objectContaining({ id: 'doc:7', name: '原稿', content: '已保存:/test:7' }),
      expect.objectContaining({ id: 'vela://manuscript/8', name: '定稿', content: '已保存:/test:8', pinned: true }),
    ])
    expect(useEditorStore.getState().tabs[0].dirty).toBeFalsy()
    expect(useEditorStore.getState().tabs[0].inlineSession).toBeUndefined()
    expect(useEditorStore.getState().activeTabId).toBe('doc:7')
    const stored = Object.values(localStorage).join()
    expect(stored).not.toContain('未保存的修改')
    expect(stored).not.toContain('未保存的建议')

    useProjectStore.getState().closeProject()
    expect(await openProject(other.path)).toBe(true)
    expect(useEditorStore.getState().tabs).toEqual([
      expect.objectContaining({ id: 'doc:7', name: '另一部作品', content: '已保存:/other:7' }),
    ])
  })

  it('忽略已经删除的草稿，手动关闭后不会在重开时复现', async () => {
    const editor = useEditorStore.getState()
    editor.openFile({ id: 'doc:7', type: 'chapter', filePath: 'vela://draft/7', name: '保留' })
    editor.openFile({ id: 'doc:8', type: 'chapter', filePath: 'vela://draft/8', name: '已删' })
    const invoke = vi.mocked(ipc.invoke).getMockImplementation()!
    vi.mocked(ipc.invoke).mockImplementation((...args) => args[0] === 'db:draft-get-full' && args[1] === 8
      ? Promise.resolve(null) as never
      : invoke(...args))

    useProjectStore.getState().closeProject()
    expect(await openProject(BASE.path)).toBe(true)
    expect(useEditorStore.getState().tabs.map(tab => tab.id)).toEqual(['doc:7'])
    expect(useEditorStore.getState().activeTabId).toBe('doc:7')

    editor.closeTab('doc:7')
    useProjectStore.getState().closeProject()
    expect(await openProject(BASE.path)).toBe(true)
    expect(useEditorStore.getState().tabs).toEqual([])
  })

  it('项目关闭并从同一路径重开时，丢弃上一会话的迟到恢复', async () => {
    useEditorStore.getState().openFile({ id: 'doc:7', type: 'chapter', filePath: 'vela://draft/7', name: '草稿' })
    useProjectStore.getState().closeProject()
    const invoke = vi.mocked(ipc.invoke).getMockImplementation()!
    let finishOldRead: ((value: { content: string }) => void) | undefined
    vi.mocked(ipc.invoke).mockImplementation((...args) => {
      if (args[0] !== 'db:draft-get-full' || finishOldRead) return invoke(...args)
      return new Promise(resolve => { finishOldRead = resolve }) as never
    })

    const previous = openProject(BASE.path)
    await vi.waitFor(() => expect(finishOldRead).toBeDefined())
    useProjectStore.getState().closeProject()
    expect(await openProject(BASE.path)).toBe(true)
    finishOldRead!({ content: '迟到的正文' })
    await previous

    expect(useEditorStore.getState().tabs).toEqual([
      expect.objectContaining({ id: 'doc:7', content: '已保存:/test:7' }),
    ])
  })

  it('恢复期间主动打开的草稿保持选中，迟到结果不替换正文', async () => {
    const editor = useEditorStore.getState()
    const draft = { id: 'doc:7', type: 'chapter', filePath: 'vela://draft/7', name: '草稿' } as const
    editor.openFile(draft)
    useProjectStore.getState().closeProject()
    const invoke = vi.mocked(ipc.invoke).getMockImplementation()!
    let finishRead: ((value: { content: string }) => void) | undefined
    vi.mocked(ipc.invoke).mockImplementation((...args) => args[0] === 'db:draft-get-full'
      ? new Promise(resolve => { finishRead = resolve }) as never
      : invoke(...args))

    const opening = openProject(BASE.path)
    await vi.waitFor(() => expect(finishRead).toBeDefined())
    editor.openFile({ ...draft, name: '主动打开', content: '当前正文' })
    editor.updateTabContent(draft.id, '正在编辑')
    finishRead!({ content: '恢复读取' })
    await opening

    expect(useEditorStore.getState().tabs).toEqual([
      expect.objectContaining({ id: draft.id, name: '主动打开', content: '正在编辑', dirty: true }),
    ])
    expect(useEditorStore.getState().activeTabId).toBe(draft.id)
  })

  it('删除作品成功后清除恢复记录，同一路径可用于新作品', async () => {
    useEditorStore.getState().openFile({ id: 'doc:7', type: 'chapter', filePath: 'vela://draft/7', name: '旧作品' })
    expect(await useProjectStore.getState().deleteProjectFolder(BASE.path)).toBe(true)
    expect(await openProject(BASE.path)).toBe(true)
    expect(useEditorStore.getState().tabs).toEqual([])
  })
})

describe('project-store 快照机制（线③）', () => {
  it('hands the candidate to the file editor while preserving the SQLite project and tabs', async () => {
    const route = vi.fn()
    const off = globalEventBus.on('OPEN_FILE_PROJECT_EDITOR', route)
    try {
      useEditorStore.getState().openFile({ id: 'doc:7', type: 'chapter', filePath: 'vela://draft/7', name: 'Draft', content: 'unsaved', dirty: true })
      vi.mocked(confirm).mockResolvedValue(true)
      vi.mocked(ipc.invoke).mockResolvedValue({ success: true, project: null, fileProjectPath: '/candidate' } as never)
      expect(await useProjectStore.getState().openProject('/candidate')).toBe(true)
      expect(route).toHaveBeenCalledWith({ projectPath: '/candidate' })
      expect(useProjectStore.getState().currentProject).toEqual(BASE)
      expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'unsaved', dirty: true })
      expect(ipc.invoke).toHaveBeenCalledTimes(1)
    } finally { off() }
  })
  it('confirms protected edits before project creation can change the database connection', async () => {
    useEditorStore.getState().openFile({ id: 'doc:7', type: 'chapter', filePath: 'vela://draft/7', name: 'Draft', content: 'old', dirty: true })
    vi.mocked(confirm).mockResolvedValue(false)
    vi.mocked(ipc.invoke).mockClear()
    const request = { name: 'New', path: '/books', genre: '玄幻', targetAudience: '' }
    expect(await useProjectStore.getState().createProject(request)).toBe(false)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(ipc.invoke).not.toHaveBeenCalledWith('project:create', request)
    expect(useEditorStore.getState().tabs[0]?.content).toBe('old')
  })

  it('restores edits if the newly created project cannot be opened', async () => {
    useEditorStore.getState().openFile({ id: 'doc:7', type: 'chapter', filePath: 'vela://draft/7', name: 'Draft', content: 'old', dirty: true })
    vi.mocked(confirm).mockResolvedValue(true)
    vi.mocked(ipc.invoke).mockImplementation(async (...[channel]) => (channel === 'project:create'
      ? { success: true, projectPath: '/books/New' }
      : { success: false, error: 'open failed' }) as never)
    const request = { name: 'New', path: '/books', genre: '玄幻', targetAudience: '' }
    expect(await useProjectStore.getState().createProject(request)).toBe(false)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(useProjectStore.getState().currentProject?.path).toBe('/test')
    expect(useEditorStore.getState().tabs[0]?.content).toBe('old')
  })
  it('asks before switching away from protected tabs and keeps them if cancelled', async () => {
    const editor = useEditorStore.getState()
    editor.openFile({ id: 'doc:7', type: 'chapter', filePath: 'vela://draft/7', name: 'Draft', content: 'old', dirty: true })
    vi.mocked(confirm).mockResolvedValue(false)
    vi.mocked(ipc.invoke).mockClear()
    expect(await useProjectStore.getState().openProject('/other', { keepView: true })).toBe(false)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(ipc.invoke).not.toHaveBeenCalledWith('project:open', '/other')
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ id: 'doc:7', content: 'old', dirty: true })
  })

  it('does not expose old inline content while switching to a project with the same draft ID', async () => {
    const editor = useEditorStore.getState()
    editor.openFile({ id: 'doc:7', type: 'chapter', filePath: 'vela://draft/7', name: 'Draft', content: 'old' })
    editor.beginInlineSession('doc:7', { sessionId: 'old', sourceKind: 'selection', baseDocSnapshot: 'old', hunks: [], decisions: {} })
    vi.mocked(confirm).mockResolvedValue(true)
    const tabsAtOpen: unknown[] = []
    vi.mocked(ipc.invoke).mockImplementation(async (...[channel]) => {
      if (channel === 'project:open') {
        tabsAtOpen.push(...useEditorStore.getState().tabs)
        return { success: true, project: { ...BASE, path: '/other' } } as never
      }
      return (channel === 'fs:list-dir' ? [] : { success: true }) as never
    })
    expect(await useProjectStore.getState().openProject('/other', { keepView: true })).toBe(true)
    expect(tabsAtOpen).toEqual([])
    editor.openFile({ id: 'doc:7', type: 'chapter', filePath: 'vela://draft/7', name: 'New', content: 'other project' })
    expect(useEditorStore.getState().tabs[0].content).toBe('other project')
  })

  it('restores the original tabs when the project cannot be opened', async () => {
    const editor = useEditorStore.getState()
    editor.openFile({ id: 'doc:7', type: 'chapter', filePath: 'vela://draft/7', name: 'Draft', content: 'old', dirty: true })
    vi.mocked(confirm).mockResolvedValue(true)
    vi.mocked(ipc.invoke).mockResolvedValue({ success: false, error: 'missing project' } as never)
    expect(await useProjectStore.getState().openProject('/missing', { keepView: true })).toBe(false)
    expect(useProjectStore.getState().currentProject?.path).toBe('/test')
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ id: 'doc:7', content: 'old', dirty: true })
  })
  it.each(['another project', 'same path reopened'])('does not publish a late file tree after switching to %s', async mode => {
    let resolveTree!: (value: unknown) => void
    vi.mocked(ipc.invoke).mockImplementation((...args: unknown[]) => args[0] === 'fs:list-dir'
      ? new Promise(resolve => { resolveTree = resolve }) as never : Promise.resolve(true) as never)
    useProjectStore.setState({ fileTree: [] })
    const pending = useProjectStore.getState().refreshFileTree()
    const session = useProjectStore.getState().projectSession
    useProjectStore.setState({
      currentProject: mode === 'another project' ? { ...BASE, id: 'p2', path: '/other' } : structuredClone(BASE),
      projectSession: session + 1,
    })
    resolveTree([{ name: 'old.md', path: '/test/old.md', type: 'file' }])
    await pending
    expect(useProjectStore.getState().fileTree).toEqual([])
  })
  it('publishes a refreshed tree while the source project session is unchanged', async () => {
    const tree = [{ name: 'chapter.md', path: '/test/chapter.md', type: 'file' }]
    vi.mocked(ipc.invoke).mockResolvedValue(tree as never)
    await useProjectStore.getState().refreshFileTree()
    expect(useProjectStore.getState().fileTree).toEqual(tree)
  })
  it('opening invalidates the previous session before IPC completion', async () => {
    const before = useProjectStore.getState().projectSession
    let resolveOpen!: (value: unknown) => void
    vi.mocked(ipc.invoke).mockImplementation((...args) => {
      const channel = args[0]
      if (channel === 'project:open') return new Promise(resolve => { resolveOpen = resolve }) as never
      return Promise.resolve(channel === 'fs:list-dir' ? [] : { success: true }) as never
    })
    const opening = useProjectStore.getState().openProject('/new', { keepView: true })
    await vi.waitFor(() => expect(resolveOpen).toBeTypeOf('function'))
    expect(useProjectStore.getState().projectSession).toBe(before + 1)
    resolveOpen({ success: true, project: { ...BASE, path: '/new' } })
    await expect(opening).resolves.toBe(true)
  })
  it('closing changes the session; ordinary config updates keep it', () => {
    const before = useProjectStore.getState().projectSession
    expect(typeof before).toBe('number')
    useProjectStore.getState().updateNovelConfig({ coreOutline: '改动' })
    expect(useProjectStore.getState().projectSession).toBe(before)
    useProjectStore.getState().closeProject()
    expect(useProjectStore.getState().projectSession).toBe(before + 1)
  })
  it('snapshot 深拷贝当前配置；update 后 restore 恢复原值', async () => {
    const { snapshotNovelConfig, updateNovelConfig, restoreNovelConfigSnapshot } = useProjectStore.getState()

    snapshotNovelConfig()
    updateNovelConfig({ coreOutline: 'AI 生成的新大纲', genre: '仙侠' })

    // 应用后：配置已变，快照仍在
    expect(useProjectStore.getState().currentProject!.novelConfig.coreOutline).toBe('AI 生成的新大纲')

    const ok = await restoreNovelConfigSnapshot()
    expect(ok).toBe(true)
    // 恢复：回到快照（旧大纲 + 旧题材），快照清空
    const cfg = useProjectStore.getState().currentProject!.novelConfig
    expect(cfg.coreOutline).toBe('旧大纲')
    expect(cfg.genre).toBe('玄幻')
    expect(useProjectStore.getState().configSnapshot).toBeNull()
  })

  it('快照是深拷贝——update 后快照不被浅合并污染', () => {
    const { snapshotNovelConfig, updateNovelConfig } = useProjectStore.getState()
    snapshotNovelConfig()
    updateNovelConfig({ coreOutline: '新值' })
    // 快照里的 coreOutline 仍是旧值
    expect(useProjectStore.getState().configSnapshot!.coreOutline).toBe('旧大纲')
  })

  it('无快照时 restore 返回 false 且不改动配置', async () => {
    const { restoreNovelConfigSnapshot } = useProjectStore.getState()
    await expect(restoreNovelConfigSnapshot()).resolves.toBe(false)
    expect(useProjectStore.getState().currentProject!.novelConfig.coreOutline).toBe('旧大纲')
  })

  it('无 currentProject 时 snapshot/restore 均 no-op', async () => {
    useProjectStore.setState({ currentProject: null })
    const { snapshotNovelConfig, restoreNovelConfigSnapshot } = useProjectStore.getState()
    snapshotNovelConfig()
    expect(useProjectStore.getState().configSnapshot).toBeNull()
    await expect(restoreNovelConfigSnapshot()).resolves.toBe(false)
  })
})

describe('config field versions and captured saves', () => {
  it('keeps a timed out write in flight and reports its late success without resending', async () => {
    vi.useFakeTimers()
    let complete!: (result: { success: boolean }) => void
    vi.mocked(ipc.invoke).mockReset().mockImplementationOnce(() => new Promise(resolve => { complete = resolve }) as never)
    try {
      const pending = vi.fn()
      const store = useProjectStore.getState()
      const save = store.saveProject(undefined, pending)
      await vi.advanceTimersByTimeAsync(15_000)
      expect(pending).toHaveBeenCalledOnce()
      await expect(store.saveProject()).rejects.toThrow()
      await expect(store.saveNovelConfigPatch(captureProjectConfigSource()!, { genre: 'another write' })).rejects.toThrow()
      expect(ipc.invoke).toHaveBeenCalledTimes(1)
      complete({ success: true })
      await expect(save).resolves.toBe(true)
    } finally {
      complete?.({ success: true })
      vi.useRealTimers()
    }
  })

  it('requires reopening to verify a lost receipt, and separates definite rejection', async () => {
    const store = useProjectStore.getState()
    vi.mocked(ipc.invoke).mockRejectedValueOnce(new Error('IPC disconnected'))
    await expect(store.saveProject()).rejects.toBeInstanceOf(ProjectConfigResultUnknown)
    await expect(store.saveNovelConfigPatch(captureProjectConfigSource()!, { genre: 'retry' })).rejects.toBeInstanceOf(ProjectConfigResultUnknown)
    expect(ipc.invoke).toHaveBeenCalledTimes(1)

    vi.mocked(ipc.invoke).mockResolvedValueOnce({ success: false, error: 'could not open' } as never)
    expect(await store.openProject('/other', { keepView: true })).toBe(false)
    await expect(store.saveProject()).rejects.toBeInstanceOf(ProjectConfigResultUnknown)

    vi.mocked(ipc.invoke).mockImplementation(async (...[channel]) => (channel === 'project:open'
      ? { success: true, project: BASE }
      : channel === 'fs:list-dir' ? [] : { success: true }) as never)
    expect(await store.openProject(BASE.path, { keepView: true })).toBe(true)
    vi.mocked(ipc.invoke).mockResolvedValueOnce({ success: false } as never)
    await expect(store.saveProject()).resolves.toBe(false)
    await expect(store.saveProject()).resolves.toBe(true)
  })

  it('releases the old write on a verified reopen without releasing a newer write', async () => {
    const store = useProjectStore.getState()
    let finishOld!: (receipt: { success: boolean }) => void
    let finishNew!: (receipt: { success: boolean }) => void
    vi.mocked(ipc.invoke).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }) as never)
    const stale = store.saveProject().catch(error => error)
    vi.mocked(ipc.invoke).mockImplementation(async (...[channel]) => (channel === 'project:open'
      ? { success: true, project: { ...BASE, writeToken: 'new-connection' } }
      : channel === 'fs:list-dir' ? [] : { success: true }) as never)
    expect(await store.openProject(BASE.path, { keepView: true })).toBe(true)
    vi.mocked(ipc.invoke).mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve }) as never)
    const current = store.saveProject().catch(error => error)
    try {
      expect(finishNew).toBeTypeOf('function')
      finishOld({ success: true })
      expect(await stale).toBeInstanceOf(Error)
      await expect(store.saveProject()).rejects.toThrow()
      finishNew({ success: true })
      await expect(current).resolves.toBe(true)
    } finally {
      finishOld?.({ success: true })
      finishNew?.({ success: true })
    }
  })

  it('rejects an old legacy undo snapshot after reopening the same project', async () => {
    const store = useProjectStore.getState()
    store.snapshotNovelConfig()
    useProjectStore.setState(state => ({ projectSession: state.projectSession + 1 }))
    store.updateNovelConfig({ coreOutline: 'new session' })
    await expect(store.restoreNovelConfigSnapshot()).resolves.toBe(false)
    expect(useProjectStore.getState().currentProject!.novelConfig.coreOutline).toBe('new session')
    expect(ipc.invoke).not.toHaveBeenCalled()
  })

  it('counts every supplied field edit, including equal values and legacy restore', async () => {
    useProjectStore.setState({ configFieldVersions: {} })
    const store = useProjectStore.getState()
    store.snapshotNovelConfig()
    store.updateNovelConfig({ coreOutline: '旧大纲' })
    store.updateNovelConfig({ coreOutline: 'changed', worldSetting: 'world' })
    expect(useProjectStore.getState().configFieldVersions).toEqual({ coreOutline: 2, worldSetting: 1 })
    await store.restoreNovelConfigSnapshot()
    expect(useProjectStore.getState().configFieldVersions.coreOutline).toBe(3)
    expect(useProjectStore.getState().configFieldVersions.worldSetting).toBe(2)
  })
  it('legacy restore versions optional fields removed by the full snapshot', async () => {
    useProjectStore.setState({ configFieldVersions: {} })
    const store = useProjectStore.getState()
    store.snapshotNovelConfig()
    store.updateNovelConfig({ writingStyle: 'new optional style' })
    await store.restoreNovelConfigSnapshot()
    expect(useProjectStore.getState().currentProject?.novelConfig.writingStyle).toBeUndefined()
    expect(ipc.invoke).toHaveBeenCalledWith('project:update-config', BASE.id, expect.objectContaining({
      novelConfig: expect.objectContaining({ writingStyle: '' }),
    }))
    expect(useProjectStore.getState().configFieldVersions.writingStyle).toBe(2)
  })
  it('persists an explicit config snapshot without replacing current input', async () => {
    vi.mocked(ipc.invoke).mockResolvedValue({ success: true } as never)
    const captured = structuredClone(BASE.novelConfig)
    useProjectStore.getState().updateNovelConfig({ coreOutline: 'new input' })
    await expect(useProjectStore.getState().saveProject(captured)).resolves.toBe(true)
    expect(ipc.invoke).toHaveBeenLastCalledWith('project:save', 'p1', expect.objectContaining({ novelConfig: captured }))
    expect(useProjectStore.getState().currentProject?.novelConfig.coreOutline).toBe('new input')
  })
})
