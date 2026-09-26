/**
 * 记忆加载方式（C 档第一轮）：写回链路 + 编辑器守卫 + 常驻合计。
 *
 * 写回走既有 memory:read → setLoadModeFrontmatter → memory:write（读-改-写，主进程 tmp+rename
 * 原子落盘），**不新增 IPC 通道**。编辑器守卫：同一文件在编辑器里有未保存修改时拒绝切换——
 * 否则用户随后保存会用旧 frontmatter 覆盖刚写入的 load_mode（静默丢失）。
 */
import { ipc } from '../ipc-client'
import { VELA } from '../vela-protocol'
import { useEditorStore } from '../../stores/editor-store'
import { parseMemoryFile, setLoadModeFrontmatter } from './memory-codec'
import type { MemoryFileMeta } from './memory-codec'
import { buildResidentSection } from '../agent/memory-layers'
import type { MemoryLoadMode } from '../../shared/memory-types'

export type LoadModeChangeResult =
  | { ok: true; mode: MemoryLoadMode; changed: boolean }
  | { ok: false; reason: 'dirty' | 'openInEditor' | 'readFailed' | 'writeFailed' }

export async function changeMemoryLoadMode(file: string, mode: MemoryLoadMode): Promise<LoadModeChangeResult> {
  const tabId = `${VELA.MEMORY}${file}`
  const tab = useEditorStore.getState().tabs.find(t => t.id === tabId || t.filePath === tabId)
  // 编辑器是唯一编辑面（2026-09-19 真机反馈定案）：只要该文件在编辑器里开着，就不动磁盘 ——
  // 两个写入方（编辑器缓冲 / 本函数）必然互相覆盖。脏 → 先保存；干净 → 先关标签页。
  // ⚠️ 刻意**不**同步编辑器缓冲：CodeMirror 的外部内容回显会经 onChange → updateTabContent
  // 无条件置 dirty（EditorArea.tsx:698 记录了同一个坑），同步完反而显示「未保存」。
  if (tab?.dirty) return { ok: false, reason: 'dirty' }
  if (tab) return { ok: false, reason: 'openInEditor' }

  const raw = await ipc.invoke('memory:read', file)
  if (raw === null || raw === undefined) return { ok: false, reason: 'readFailed' }
  const updated = setLoadModeFrontmatter(raw, mode)
  // 评审 Minor 5：内容没变就不写盘 —— 写盘会 bump mtime，而 memory:list 按 mtime 排序，
  // 目录行顺序随之漂移（M2 在前缀区 → 伤前缀缓存），且会给用户虚假的「加载方式已更新」反馈
  if (updated === raw) return { ok: true, mode, changed: false }
  const res = await ipc.invoke('memory:write', file, updated)
  if (!res?.success) return { ok: false, reason: 'writeFailed' }
  return { ok: true, mode, changed: true }
}

/**
 * 常驻指示的目标文件（评审 Minor 4）：**必须与注入口径一致** —— 装配侧先滤掉 stale
 * （context-builder 的 `!f.stale`），指示若把 stale 文件算进来，用户会看到比实发更大的数字
 * （甚至显示「超上限」而实际注入正常），从而去精简本来没问题的常驻记忆。
 */
export function residentTargets(files: MemoryFileMeta[]): string[] {
  return files.filter(f => f.loadMode === 'resident' && !f.stale).map(f => f.file)
}

/** 常驻合计（与注入同一口径：同一个 buildResidentSection）——视图里的「常驻 N / 4000」指示 */
export async function sumResidentSectionTokens(files: string[]): Promise<{ tokens: number; overCap: boolean }> {
  const contents: Array<{ file: string; body: string }> = []
  for (const file of files) {
    try {
      const raw = await ipc.invoke('memory:read', file)
      if (raw === null || raw === undefined) continue
      contents.push({ file, body: (parseMemoryFile(raw) ?? { body: raw }).body })
    } catch {
      // 读盘失败跳过该条（与装配口径一致）
    }
  }
  const built = buildResidentSection(contents)
  return { tokens: built.tokens, overCap: built.overCap }
}
