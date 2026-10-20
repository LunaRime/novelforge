/**
 * Agent 文件路径解析：模型常把「当前 Tab 名」当 file_path（例如「第1章 冒烟章节 v1」），
 * 而不是 vela://draft/1。这里把 Tab 名/id 统一映射到真实 filePath，工具与确认卡共用。
 */
import { useEditorStore } from '../../stores/editor-store'

export function resolveAgentFilePath(input: string): string {
  const raw = (input || '').trim()
  if (!raw) return raw
  if (raw.startsWith('vela://')) return raw
  const editor = useEditorStore.getState()
  const tabs = editor.tabs
  const tab = tabs.find(t => t.name === raw)
    ?? tabs.find(t => t.id === raw)
    ?? tabs.find(t => t.name === raw.replace(/（草稿）$/, ''))
    ?? tabs.find(t => t.name.replace(/（草稿）$/, '') === raw)
  if (tab?.filePath) return tab.filePath

  // 模型常见的「章节文件」猜测：chapter_01 / 第1章 / 01_第一章.txt。
  // 当前打开的章节 Tab 是唯一可信目标，直接映射过去，避免它编辑一个不存在的物理文件。
  if (/^(?:chapter[_-]?\d+|第?\d+章|\d+_第.+章)/i.test(raw)) {
    const active = tabs.find(t => t.id === editor.activeTabId && t.type === 'chapter' && t.filePath)
    if (active?.filePath) return active.filePath
  }
  return tab?.id ?? raw
}
