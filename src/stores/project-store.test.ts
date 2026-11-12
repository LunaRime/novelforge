// @vitest-environment jsdom
/**
 * project-store 快照机制（线③ 产出审查层：前置快照 + 撤销出口）
 *
 * 契约：snapshotNovelConfig 深拷贝当前配置；restoreNovelConfigSnapshot 恢复快照
 * 并清空快照；无快照/无项目时 no-op 返回 false。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useProjectStore } from './project-store'
import { useEditorStore } from './editor-store'
import type { ProjectData } from '../shared/ipc-channels'
import { ipc } from '../services/ipc-client'
import { confirm } from '../components/ui/Confirm'

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
  vi.mocked(confirm).mockReset()
  useEditorStore.getState().clearTabs()
  useProjectStore.setState({
    currentProject: structuredClone(BASE),
    configSnapshot: null,
  })
})

afterEach(() => {
  useProjectStore.setState({ currentProject: null, configSnapshot: null })
})

describe('project-store 快照机制（线③）', () => {
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
  it('snapshot 深拷贝当前配置；update 后 restore 恢复原值', () => {
    const { snapshotNovelConfig, updateNovelConfig, restoreNovelConfigSnapshot } = useProjectStore.getState()

    snapshotNovelConfig()
    updateNovelConfig({ coreOutline: 'AI 生成的新大纲', genre: '仙侠' })

    // 应用后：配置已变，快照仍在
    expect(useProjectStore.getState().currentProject!.novelConfig.coreOutline).toBe('AI 生成的新大纲')

    const ok = restoreNovelConfigSnapshot()
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

  it('无快照时 restore 返回 false 且不改动配置', () => {
    const { restoreNovelConfigSnapshot } = useProjectStore.getState()
    expect(restoreNovelConfigSnapshot()).toBe(false)
    expect(useProjectStore.getState().currentProject!.novelConfig.coreOutline).toBe('旧大纲')
  })

  it('无 currentProject 时 snapshot/restore 均 no-op', () => {
    useProjectStore.setState({ currentProject: null })
    const { snapshotNovelConfig, restoreNovelConfigSnapshot } = useProjectStore.getState()
    snapshotNovelConfig()
    expect(useProjectStore.getState().configSnapshot).toBeNull()
    expect(restoreNovelConfigSnapshot()).toBe(false)
  })
})

describe('config field versions and captured saves', () => {
  it('counts every supplied field edit, including equal values and legacy restore', () => {
    useProjectStore.setState({ configFieldVersions: {} })
    const store = useProjectStore.getState()
    store.snapshotNovelConfig()
    store.updateNovelConfig({ coreOutline: '旧大纲' })
    store.updateNovelConfig({ coreOutline: 'changed', worldSetting: 'world' })
    expect(useProjectStore.getState().configFieldVersions).toEqual({ coreOutline: 2, worldSetting: 1 })
    store.restoreNovelConfigSnapshot()
    expect(useProjectStore.getState().configFieldVersions.coreOutline).toBe(3)
    expect(useProjectStore.getState().configFieldVersions.worldSetting).toBe(2)
  })
  it('legacy restore versions optional fields removed by the full snapshot', () => {
    useProjectStore.setState({ configFieldVersions: {} })
    const store = useProjectStore.getState()
    store.snapshotNovelConfig()
    store.updateNovelConfig({ writingStyle: 'new optional style' })
    store.restoreNovelConfigSnapshot()
    expect(useProjectStore.getState().currentProject?.novelConfig.writingStyle).toBeUndefined()
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
