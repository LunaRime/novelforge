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
import { buildResidentSection } from '../agent/memory-layers'
import type { MemoryLoadMode } from '../../shared/memory-types'

export type LoadModeChangeResult =
  | { ok: true; mode: MemoryLoadMode }
  | { ok: false; reason: 'dirty' | 'readFailed' | 'writeFailed' }

export async function changeMemoryLoadMode(file: string, mode: MemoryLoadMode): Promise<LoadModeChangeResult> {
  const tabId = `${VELA.MEMORY}${file}`
  const tab = useEditorStore.getState().tabs.find(t => t.id === tabId || t.filePath === tabId)
  if (tab?.dirty) return { ok: false, reason: 'dirty' }

  const raw = await ipc.invoke('memory:read', file)
  if (raw === null || raw === undefined) return { ok: false, reason: 'readFailed' }
  const updated = setLoadModeFrontmatter(raw, mode)
  const res = await ipc.invoke('memory:write', file, updated)
  if (!res?.success) return { ok: false, reason: 'writeFailed' }
  // 干净标签页静默同步（不清也不设 dirty）；脏标签页前面已拦下
  if (tab) useEditorStore.getState().syncTabContent(tab.id, updated)
  return { ok: true, mode }
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
