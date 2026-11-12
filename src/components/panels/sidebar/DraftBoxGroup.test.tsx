// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { globalEventBus } from '../../../shared/event-bus'
import { mergeRendererRevision } from '../../../services/editor/merge-revision'
import { useDraftStore } from '../../../stores/draft-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useProjectStore } from '../../../stores/project-store'
import DraftBoxGroup from './DraftBoxGroup'
import { registerMenuSetter, unregisterMenuSetter, type SidebarMenuState } from './SidebarShared'

const h = vi.hoisted(() => ({
  invoke: vi.fn(), confirm: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), log: vi.fn(), refresh: vi.fn(),
}))
vi.mock('../../../services/ipc-client', () => ({ ipc: { invoke: h.invoke } }))
vi.mock('../../../services/render-logger', () => ({ renderLog: h.log }))
vi.mock('../../../stores/project-store', async () => {
  const { create } = await import('zustand')
  return { useProjectStore: create(() => ({ currentProject: { id: 'a', path: '/a' }, projectSession: 1, loading: false, refreshFileTree: h.refresh })) }
})
vi.mock('../../ui/Confirm', () => ({ confirm: h.confirm }))
vi.mock('../../ui/Toast', () => ({ toast: { success: h.success, error: h.error, warning: h.warning } }))
vi.mock('./SidebarGroup', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))

const row = (id: number, status = 'draft') => ({ id, status, version: 2, chapterNumber: 4, createdAt: 0, source: 'write' })
const title = (value: string) => ({
  chapterNumber: 4, title: value, role: '发展', purpose: '', keyEvents: '', characters: [],
  suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: 0,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { resolve, promise }
}

let host: HTMLDivElement
let root: Root
let menu: SidebarMenuState | null
async function mount() {
  await useDraftStore.getState().loadAllDrafts()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<DraftBoxGroup />))
}
const rows = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter(button => button.textContent?.includes('草稿_v'))
async function expand() {
  const chapter = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('第4章'))
  expect(chapter).toBeDefined()
  await act(async () => chapter!.click())
}
function actionAt(index: number, key: string) {
  rows()[index].parentElement!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
  const action = menu?.items.find(item => item.key === key)
  if (!action || 'type' in action || action.disabled) throw new Error(`Expected available action ${key}`)
  return action.onClick?.()
}
const archive = (index: number) => actionAt(index, 'delete')

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.resetAllMocks()
  useProjectStore.setState({ currentProject: { id: 'a', path: '/a' }, projectSession: 1, loading: false } as never)
  useDraftStore.getState().reset()
  useEditorStore.getState().clearTabs()
  menu = null
  registerMenuSetter(value => { menu = value })
  h.confirm.mockResolvedValue(true)
  h.invoke.mockImplementation(async (channel: string, arg: number) => {
    if (channel === 'db:draft-get-all-chapter-numbers') return [4]
    if (channel === 'db:draft-list') return [row(7), row(8)]
    if (channel === 'db:blueprint-get-all') return [title('Blueprint')]
    if (channel === 'db:draft-get-full') return { content: `body-${arg}` }
    if (channel === 'db:revision-merge') return { success: true, chapterNumber: 4 }
    if (channel === 'db:draft-archive') return { success: true, updatedAt: 2000 }
    throw new Error(`Unexpected IPC ${channel}`)
  })
})
afterEach(async () => {
  if (host?.isConnected) await act(async () => root.unmount())
  host?.remove()
  unregisterMenuSetter()
})

it('opens the selected same-version draft and keeps its identity through the existing merge adapter', async () => {
  await mount()
  await expand()
  await act(async () => rows()[1].click())
  expect(h.invoke).toHaveBeenCalledWith('db:draft-get-full', 8)
  expect(useEditorStore.getState().tabs).toMatchObject([{ id: 'doc:8', docId: 8, content: 'body-8' }])
  await act(async () => {
    await mergeRendererRevision({ chapterNumber: 4, draftPath: 'vela://draft/8', revisionPath: 'vela://revision/12', expectedContent: 'body-8', content: 'merged' })
  })
  expect(h.invoke).toHaveBeenCalledWith('db:revision-merge', expect.objectContaining({ draftId: 8, revisionId: 12, expectedContent: 'body-8' }))
  expect(useEditorStore.getState().tabs[0]).toMatchObject({ id: 'doc:8', content: 'merged' })
  await act(async () => { await actionAt(0, 'open') })
  expect(useEditorStore.getState().tabs.map(tab => tab.id)).toEqual(['doc:8', 'doc:7'])
})

it('keeps drafts available when blueprint lookup fails and leaves editor tabs alone on body read failure', async () => {
  const invoke = h.invoke.getMockImplementation()!
  h.invoke.mockImplementation(async (channel, ...args) => {
    if (channel === 'db:blueprint-get-all' || channel === 'db:draft-get-full') throw new Error('read failed')
    return invoke(channel, ...args)
  })
  await mount()
  expect(host.textContent).not.toContain('Blueprint')
  await expand()
  await act(async () => rows()[0].click())
  expect(h.error).toHaveBeenCalledWith(expect.stringContaining('read failed'))
  expect(useEditorStore.getState().tabs).toEqual([])
})

it('refreshes renamed titles and ignores an earlier read that completes later', async () => {
  const oldTitle = deferred<ReturnType<typeof title>[]>()
  const invoke = h.invoke.getMockImplementation()!
  let titleReads = 0
  h.invoke.mockImplementation(async (channel, ...args) => {
    if (channel === 'db:blueprint-get-all') return ++titleReads === 1 ? oldTitle.promise : [title('Renamed')]
    return invoke(channel, ...args)
  })
  await mount()
  await act(async () => globalEventBus.emit('REFRESH_RESOURCE', { resources: ['blueprints'] }))
  expect(host.textContent).toContain('Renamed')
  await act(async () => oldTitle.resolve([title('Obsolete')]))
  expect(host.textContent).toContain('Renamed')
  expect(host.textContent).not.toContain('Obsolete')
})

it('abandons confirmation and hides stale versions after a same-path reopen', async () => {
  const confirmation = deferred<boolean>()
  h.confirm.mockReturnValue(confirmation.promise)
  await mount()
  await expand()
  await act(async () => { void archive(1); void archive(1) })
  expect(h.confirm).toHaveBeenCalledTimes(1)
  await act(async () => useProjectStore.setState({ projectSession: 2 }))
  expect(rows()).toEqual([])
  await act(async () => confirmation.resolve(true))
  expect(h.invoke.mock.calls.some(([channel]) => channel === 'db:draft-archive' || channel === 'db:draft-update-status')).toBe(false)
  expect(h.success).not.toHaveBeenCalled()
  expect(h.error).not.toHaveBeenCalled()
})

it('archives the exact version and does not let an already pending list restore its former status', async () => {
  await mount()
  await expand()
  const previous = deferred<ReturnType<typeof row>[]>()
  const invoke = h.invoke.getMockImplementation()!
  h.invoke.mockImplementation((channel, ...args) => {
    if (channel === 'db:draft-get-all-chapter-numbers') return Promise.resolve([4, 5])
    if (channel === 'db:draft-list') return args[0] === 4 ? previous.promise : Promise.resolve([{ ...row(9), chapterNumber: 5 }])
    return invoke(channel, ...args)
  })
  let loading!: Promise<void>
  await act(async () => { loading = useDraftStore.getState().loadAllDrafts() })
  await act(async () => { await archive(1) })
  expect(h.invoke).toHaveBeenCalledWith('db:draft-archive', { projectPath: '/a', draftId: 8, chapterNumber: 4 })
  await act(async () => { previous.resolve([row(7), row(8)]); await loading })
  expect(rows()).toHaveLength(1)
  expect(useDraftStore.getState().draftsByChapter[4]).toMatchObject([{ id: 7, status: 'draft' }, { id: 8, status: 'archived', updatedAt: 2000 }])
  expect(useDraftStore.getState().draftsByChapter[5]).toMatchObject([{ id: 9, chapterNumber: 5 }])
  expect(h.success).toHaveBeenCalledTimes(1)
})

it('reports a rejected archive and leaves the visible version intact', async () => {
  await mount()
  await expand()
  h.invoke.mockResolvedValueOnce({ success: false, error: 'no longer available' })
  await act(async () => { await archive(1) })
  expect(rows()).toHaveLength(2)
  expect(h.error).toHaveBeenCalledWith(expect.stringContaining('no longer available'))
  expect(h.success).not.toHaveBeenCalled()
})

it('keeps the new project projection when an older archive succeeds with the same draft ID', async () => {
  await mount()
  await expand()
  const pending = deferred<{ success: true; updatedAt: number }>()
  h.invoke.mockReturnValueOnce(pending.promise)
  await act(async () => { void archive(1) })
  await act(async () => {
    useProjectStore.setState({ currentProject: { id: 'b', path: '/b' }, projectSession: 2 } as never)
    await useDraftStore.getState().loadAllDrafts()
  })
  await act(async () => pending.resolve({ success: true, updatedAt: 2000 }))
  expect(useDraftStore.getState().draftsByChapter[4]).toMatchObject([{ id: 7, status: 'draft' }, { id: 8, status: 'draft' }])
  expect(h.success).not.toHaveBeenCalled()
})
