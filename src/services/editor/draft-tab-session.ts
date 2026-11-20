import { openEditorDocument, type EditorOpenRequest } from '../../core'
import { useEditorStore, type EditorTab } from '../../stores/editor-store'
import { renderLog } from '../render-logger'
import { VELA } from '../vela-protocol'
import { createRendererEditorOpenPort } from './open-editor-document'

type EditorTabs = Pick<ReturnType<typeof useEditorStore.getState>, 'tabs' | 'activeTabId'>

interface SavedTab {
  locator: string
  name: string
  pinned: boolean
}

interface SavedTabSession {
  tabs: SavedTab[]
  activeLocator: string | null
}

const storageKey = (path: string) => `novelforge:sqlite-draft-tabs:${path}`
const sqliteDraftLocator = /^vela:\/\/(draft|manuscript)\/([1-9]\d*)$/

function isSqliteDraftLocator(locator: unknown): locator is string {
  if (typeof locator !== 'string') return false
  const match = sqliteDraftLocator.exec(locator)
  return !!match && Number.isSafeInteger(Number(match[2]))
}

function isSavedTab(value: unknown): value is SavedTab {
  if (!value || typeof value !== 'object') return false
  const tab = value as Partial<SavedTab>
  return isSqliteDraftLocator(tab.locator) && typeof tab.name === 'string' && typeof tab.pinned === 'boolean'
}

function readTabSession(path: string): SavedTabSession | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(path))
    if (!raw) return
    const saved = JSON.parse(raw) as Partial<SavedTabSession> | null
    if (!Array.isArray(saved?.tabs)) return
    const tabs = [...new Map(saved.tabs.filter(isSavedTab).map(tab => [tab.locator, tab])).values()]
    return { tabs, activeLocator: isSqliteDraftLocator(saved.activeLocator) ? saved.activeLocator : null }
  } catch {
    // 旧记录损坏或本地存储不可用时，用户仍可正常打开作品和正文。
    return undefined
  }
}

function getTabLocator(tab: EditorTab): string | undefined {
  if (tab.type === 'chapter' && isSqliteDraftLocator(tab.filePath)) return tab.filePath
}

export function rememberDraftTabs(path: string, next: EditorTabs, previous: EditorTabs) {
  if (next.tabs === previous.tabs && next.activeTabId === previous.activeTabId) return
  const sameLabels = next.tabs.length === previous.tabs.length && next.tabs.every((tab, index) => {
    const old = previous.tabs[index]
    return tab === old || (tab.id === old.id && tab.name === old.name && tab.type === old.type
      && tab.filePath === old.filePath && tab.pinned === old.pinned)
  })
  // 只记录标签信息。键入、标记已保存和行内建议变化不触发持久化。
  if (sameLabels && next.activeTabId === previous.activeTabId) return

  const tabs = next.tabs.flatMap(tab => {
    const locator = getTabLocator(tab)
    return locator ? [{ locator, name: tab.name, pinned: tab.pinned === true }] : []
  })
  try {
    const key = storageKey(path)
    if (!tabs.length) {
      if (previous.tabs.some(getTabLocator)) globalThis.localStorage?.removeItem(key)
      return
    }
    // 切到历史等临时视图时，保留最后选中的正文。
    const active = next.tabs.find(tab => tab.id === next.activeTabId)
    const recent = (active && getTabLocator(active)) ?? readTabSession(path)?.activeLocator
    const activeLocator = tabs.find(tab => tab.locator === recent)?.locator ?? tabs.at(-1)!.locator
    globalThis.localStorage?.setItem(key, JSON.stringify({ tabs, activeLocator }))
  } catch {
    // 恢复记录写失败不会影响编辑器中的文档和保存操作。
  }
}

export function forgetDraftTabs(path: string) {
  try {
    globalThis.localStorage?.removeItem(storageKey(path))
  } catch {
    // 本地存储不可用时，删除作品仍按文件删除结果处理。
  }
}

export async function restoreDraftTabs(path: string, projectSession: number) {
  const saved = readTabSession(path)
  if (!saved?.tabs.length) return

  const original = useEditorStore.getState()
  const openPort = createRendererEditorOpenPort()
  const projectId = openPort.scope().projectId
  const isCurrent = () => {
    const scope = openPort.scope()
    return scope.projectId === projectId && scope.projectPath === path && scope.session === projectSession
  }
  if (!isCurrent()) return

  // 先通过打开用例读库，再一次性发布，避免还原中途切换活跃标签。
  const readPort = { ...openPort, publish: () => {} }
  const results = await Promise.allSettled(saved.tabs.map(async (tab): Promise<EditorTab | null> => {
    const request: EditorOpenRequest = tab.locator.startsWith(VELA.DRAFT)
      ? { kind: 'draft', draftId: Number(tab.locator.slice(VELA.DRAFT.length)), name: tab.name }
      : { kind: 'path', locator: tab.locator, name: tab.name, documentKind: 'chapter' }
    const result = await openEditorDocument(request, readPort)
    if (result.status === 'missing') return null
    const document = result.document
    return { id: document.id, docId: document.docId, name: document.name, type: document.kind,
      filePath: document.locator, content: document.content, pinned: tab.pinned }
  }))

  const current = useEditorStore.getState()
  // 项目关闭或用户在等待期间管理了标签时，以当前会话和用户操作为准。
  if (!isCurrent() || current.tabs !== original.tabs || current.activeTabId !== original.activeTabId) return
  const restored = results.flatMap(result => {
    if (result.status === 'rejected') {
      renderLog('warn', 'Load:EditorTabs', String(result.reason))
      return []
    }
    const tab = result.value
    return tab && !current.tabs.some(existing => existing.id === tab.id) ? [tab] : []
  })
  if (!restored.length) return
  const selected = restored.find(tab => tab.filePath === saved.activeLocator)
  useEditorStore.setState({
    tabs: [...current.tabs, ...restored],
    activeTabId: current.activeTabId ?? selected?.id ?? restored.at(-1)!.id,
  })
}
