/**
 * 编辑器视图状态（光标 + 滚动）缓存。
 *
 * 按「项目路径 + filePath」隔离；localStorage 单 key 存 JSON map，最多 200 条。
 * 读取/写入全部 try/catch——隐私模式、配额满、坏 JSON 都不得影响编辑器。
 */
export interface EditorViewState {
  anchor: number
  head: number
  scrollTop: number
}

interface StoredState extends EditorViewState {
  updatedAt: number
}

interface StoreShape {
  entries: Record<string, StoredState>
}

const STORAGE_KEY = 'novelforge:editor-view-state:v1'
const MAX_ENTRIES = 200

function entryKey(projectPath: string, filePath: string): string {
  return `${projectPath}\u0000${filePath}`
}

function readStore(): StoreShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { entries: {} }
    const parsed = JSON.parse(raw) as Partial<StoreShape> | null
    if (!parsed || typeof parsed !== 'object' || !parsed.entries || typeof parsed.entries !== 'object') {
      return { entries: {} }
    }
    return { entries: parsed.entries }
  } catch {
    return { entries: {} }
  }
}

function writeStore(store: StoreShape): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // 配额满/隐私模式：静默放弃，不影响编辑
  }
}

function validState(value: unknown): value is StoredState {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<StoredState>
  return Number.isFinite(v.anchor) && Number.isFinite(v.head) && Number.isFinite(v.scrollTop)
}

export function loadEditorViewState(projectPath: string, filePath: string): EditorViewState | null {
  if (!projectPath || !filePath) return null
  const entry = readStore().entries[entryKey(projectPath, filePath)]
  if (!validState(entry)) return null
  return { anchor: entry.anchor, head: entry.head, scrollTop: entry.scrollTop }
}

export function saveEditorViewState(projectPath: string, filePath: string, state: EditorViewState): void {
  if (!projectPath || !filePath) return
  const store = readStore()
  store.entries[entryKey(projectPath, filePath)] = { ...state, updatedAt: Date.now() }

  const keys = Object.keys(store.entries)
  if (keys.length > MAX_ENTRIES) {
    keys.sort((a, b) => store.entries[a].updatedAt - store.entries[b].updatedAt)
    for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) {
      delete store.entries[key]
    }
  }
  writeStore(store)
}

export function clearEditorViewState(projectPath: string, filePath: string): void {
  if (!projectPath || !filePath) return
  const store = readStore()
  delete store.entries[entryKey(projectPath, filePath)]
  writeStore(store)
}

export function clampEditorViewState(
  state: EditorViewState,
  docLength: number,
  scrollHeight: number,
): EditorViewState {
  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(Number.isFinite(value) ? value : min, min), Math.max(min, max))
  return {
    anchor: clamp(state.anchor, 0, docLength),
    head: clamp(state.head, 0, docLength),
    scrollTop: clamp(state.scrollTop, 0, scrollHeight),
  }
}