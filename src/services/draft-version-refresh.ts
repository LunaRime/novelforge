import { ipc } from './ipc-client'
import { useEditorStore, type EditorTab } from '../stores/editor-store'
import { buildDraftTab } from './draft-tab'
import { VELA } from './vela-protocol'
import type { EventPayloadMap } from '../shared/event-bus'

export type DraftVersionRefreshResult =
  | { action: 'retargeted'; tabId: string; newTabId: string; newVersion: number }
  | { action: 'dirty'; tabId: string; newVersion: number }
  | { action: 'no-tab' }
  | { action: 'missing'; draftId: number }

async function matchesChapter(tab: EditorTab, chapterNumber: number): Promise<boolean> {
  if (tab.chapterNumber === chapterNumber) return true
  if (!tab.filePath?.startsWith(VELA.DRAFT)) return false
  const idRaw = tab.filePath.slice(VELA.DRAFT.length)
  if (!/^\d+$/.test(idRaw)) return false
  try {
    const meta = await ipc.invoke('db:draft-get-meta', Number(idRaw)) as { chapterNumber?: number } | null
    return meta?.chapterNumber === chapterNumber
  } catch {
    return false
  }
}

/**
 * AI 自审/重写产生新版本后，刷新当前打开的章节草稿 Tab。
 * - Tab 干净：原位切到新版本（保留 Tab 顺序与标题，清 dirty）
 * - Tab 脏：不覆盖用户编辑，只返回 dirty 让调用方提示
 */
export async function refreshOpenDraftVersion(
  payload: EventPayloadMap['DRAFT_VERSION_CREATED'],
): Promise<DraftVersionRefreshResult> {
  const { tabs, activeTabId, retargetTab } = useEditorStore.getState()
  const draftTabs = tabs.filter(t => t.type === 'chapter' && t.filePath?.startsWith(VELA.DRAFT))

  // 优先当前激活 Tab；否则找第一个属于该章的草稿 Tab
  let target: EditorTab | undefined
  const active = draftTabs.find(t => t.id === activeTabId)
  if (active && await matchesChapter(active, payload.chapterNumber)) target = active
  if (!target) {
    for (const tab of draftTabs) {
      if (await matchesChapter(tab, payload.chapterNumber)) { target = tab; break }
    }
  }
  if (!target) return { action: 'no-tab' }

  const nextPath = `${VELA.DRAFT}${payload.draftId}`
  if (target.filePath === nextPath) return { action: 'no-tab' }
  if (target.dirty) {
    return { action: 'dirty', tabId: target.id, newVersion: payload.version }
  }

  const full = await ipc.invoke('db:draft-get-full', payload.draftId) as { content?: string } | null
  if (!full || typeof full.content !== 'string') {
    return { action: 'missing', draftId: payload.draftId }
  }

  let version = payload.version
  try {
    const meta = await ipc.invoke('db:draft-get-meta', payload.draftId) as { version?: number } | null
    version = meta?.version ?? version
  } catch { /* 元数据失败时用事件里的版本 */ }

  const tab = buildDraftTab({
    draftId: payload.draftId,
    chapterNumber: payload.chapterNumber,
    version,
    content: full.content,
  })
  // 保留已有标题（如「第3章 雨夜」），只替换版本后缀
  const baseName = target.name.replace(/\s*v\d+\s*$/, '').trim()
  if (baseName) tab.name = `${baseName} v${version}`

  retargetTab(target.id, {
    id: tab.id,
    name: tab.name,
    filePath: tab.filePath as string,
    content: tab.content ?? '',
  })
  return { action: 'retargeted', tabId: target.id, newTabId: tab.id, newVersion: version }
}