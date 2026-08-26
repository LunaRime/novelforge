/**
 * shared-memory — 跨会话可复用事实（shared.md）编解码与合并（CCR P3 Task 1）
 *
 * 数据链：CCR 压缩摘要生成成功 → 解析「[可复用事实]」锚点段（机器锚，三语字面量一致）
 * → 提取逐行事实 → 与既有 shared.md 合并（文本去重 + 上限 50 条丢最旧）→ 写回。
 * M2 注入（context-builder）：kind=shared 独立段，150 tokens 保底配额。
 */
import { ipc } from '../ipc-client'
import { parseMemoryFile } from './memory-codec'

/** shared.md 文件名（固定；memory-controller classifyMemoryFileKind 文件名兜底识别）
 */
export const SHARED_MEMORY_FILE = 'shared.md'

/** 可复用事实总上限（新事实追加保留，超限丢最旧） */
const MAX_SHARED_FACTS = 50

/** 机器锚点：从压缩摘要输出提取「可复用事实」段（三语字面量一致，不翻译） */
const FACTS_ANCHOR = '[可复用事实]'

/** 逐行事实提取（parseSharedFacts / parseSharedFile 共口径：`- 事实` 行） */
function extractFactLines(text: string): string[] {
  const facts: string[] = []
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*[-*]\s+(.+)$/)
    if (m) facts.push(m[1].trim())
  }
  return facts
}

/** 从压缩摘要输出解析「[可复用事实]」锚点段后的逐行事实（无锚点 → 空数组） */
export function parseSharedFacts(summaryText: string): string[] {
  const lines = summaryText.split('\n')
  const anchorIdx = lines.findIndex(l => l.includes(FACTS_ANCHOR))
  if (anchorIdx < 0) return []
  return extractFactLines(lines.slice(anchorIdx + 1).join('\n'))
}

/** 合并：按文本去重（保留先出现顺序，新事实追加尾部）+ 上限 50 条丢最旧 */
export function mergeSharedFacts(existing: string[], facts: string[]): string[] {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const f of [...existing, ...facts]) {
    const key = f.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(key)
  }
  return merged.length > MAX_SHARED_FACTS ? merged.slice(merged.length - MAX_SHARED_FACTS) : merged
}

/** 组装 shared.md（frontmatter type: shared + 条目列表） */
export function buildSharedFile(facts: string[]): string {
  return ['---', 'type: shared', '---', '', '# 跨会话可复用事实', ...facts.map(f => `- ${f}`)].join('\n')
}

/** 解析 shared.md（损坏/无条目 → 空数组，不抛错） */
export function parseSharedFile(raw: string): string[] {
  const parsed = parseMemoryFile(raw)
  if (!parsed) return []
  return extractFactLines(parsed.body)
}

/**
 * 将提取事实合并写入 shared.md（memory:read → merge → memory:write；文件不存在 → 新建）。
 * 写回重建 frontmatter（丢弃 status——同 upsert 语义：合并后不再视为 stale）。
 * 失败降级返回 false——不阻断压缩主流程（调用方 ccr-summary）。
 */
export async function upsertSharedFacts(facts: string[]): Promise<boolean> {
  try {
    const raw = await ipc.invoke('memory:read', SHARED_MEMORY_FILE) as string | null
    const merged = mergeSharedFacts(parseSharedFile(raw ?? ''), facts)
    if (merged.length === 0) return true // 无可写事实：不写入（幂等）
    const res = await ipc.invoke('memory:write', SHARED_MEMORY_FILE, buildSharedFile(merged)) as { success: boolean } | null
    return res?.success ?? false
  } catch {
    return false
  }
}
