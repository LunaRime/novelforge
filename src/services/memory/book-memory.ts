/**
 * book-memory — 全书状态（book-state.md）自动生成（CCR P2 Task 3）
 *
 * 数据链：volume-NNN.md（非 stale，P1 卷级聚合产物）→ 纯函数聚合 → book-state.md。
 * 零 LLM：全部从既有记忆文件内容组装（与 P1 卷聚合同口径）。
 * 触发：非 stale 卷文件数计数（每满 3 卷触发一次，低频检查点）——卷号用户自定可跳号，
 *       用计数而非卷号取模；查看器手动重建按钮为第二入口（MemoryGroup book 分支）。
 * 无分卷降级：直接聚合最新章节文件（memory:list 按 mtime 降序取最先 = 最近写入，
 *       聚合章节级而非卷级）。
 */
import { ipc } from '../ipc-client'
import { buildChapterEntryBlock, parseMemoryFile, type ChapterSummaryEntry, type MemoryFileMeta } from './memory-codec'

/** 每满 3 个非 stale 卷检查点触发一次全书重建（低频） */
const CHECKPOINT_EVERY = 3

/**
 * 全书摘要纯函数：frontmatter（updatedAt/volumes）+ 每卷节选。
 * 章节条目复用 P1 条目形态（buildChapterEntryBlock——与 buildVolumeSummaryFile 渲染格式一致）。
 * 无分卷时 volumes 传空数组、entries.volumeNumber = 0（正文章节级渲染，volumes: 0）。
 */
export function buildBookSummaryFile(
  volumes: { volumeNumber: number; range: string }[],
  entries: { volumeNumber: number; chapters: ChapterSummaryEntry[] }[],
): string {
  const lines = [
    '---',
    `updatedAt: ${new Date().toISOString()}`,
    `volumes: ${volumes.length}`,
    '---',
    '',
    '# 全书状态',
  ]
  for (const e of entries) {
    const range = volumes.find(v => v.volumeNumber === e.volumeNumber)?.range
    if (range) lines.push('', `## 第 ${e.volumeNumber} 卷 · 范围 ${range}`)
    for (const c of e.chapters) lines.push('', buildChapterEntryBlock(c))
  }
  return lines.join('\n')
}

/**
 * 从记忆文件正文解析章节条目（与 chapter-memory ensureVolumeSummary 同口径：
 * 「## 第」块分割 + 六字段行提取；卷文件卷标题为单 #，不会误切）。
 */
function parseChapterBlocks(body: string): ChapterSummaryEntry[] {
  const blocks = body.split('\n## 第 ')
  const out: ChapterSummaryEntry[] = []
  for (const b of blocks.slice(1)) {
    const numMatch = b.match(/^(\d+) 章 · (.+)/)
    if (!numMatch) continue
    const field = (label: string) => { const m = b.match(new RegExp(`${label}：([^\\n]+)`)); return m ? m[1].trim() : '' }
    out.push({
      chapterNumber: Number(numMatch[1]),
      title: numMatch[2].trim(),
      keyEvents: field('关键事件'),
      characters: field('出场角色'),
      foreshadowing: field('伏笔'),
      newElements: field('新设定'),
      currentState: field('当前状态'),
    })
  }
  return out
}

/**
 * 全书重建：扫描非 stale volume-NNN.md → 聚合 → memory:write book-state.md。
 * 无分卷 → 聚合最新章节文件（mtime 最新，章节级）。
 * 失败返回 success:false + reason（触发方静默容错 / 手动按钮 toast 指引）。
 */
export async function rebuildBookState(): Promise<{ success: boolean; file: string | null; reason?: string }> {
  try {
    const list = (await ipc.invoke('memory:list')) as MemoryFileMeta[] | null
    if (!list) return { success: false, file: null, reason: 'memory:list failed' }
    const volumeFiles = list
      .filter(f => f.kind === 'volume' && !f.stale) // 与 M2 注入 fresh 口径一致（stale 卷不聚合）
      .sort((a, b) => a.file.localeCompare(b.file)) // volume-NNN 零填充字典序 = 卷号序
    // 卷文件存在但全部 stale：无分卷分支会取最新章节窗口覆盖原多卷摘要（静默退化）——返回失败，
    // 由触发方容错（检查点返回 false）/手动按钮 toast 指引；「无分卷降级」仅对完全无卷文件成立
    if (list.some(f => f.kind === 'volume') && volumeFiles.length === 0) {
      return { success: false, file: null, reason: 'all volume files stale' }
    }
    const volumes: { volumeNumber: number; range: string }[] = []
    let entries: { volumeNumber: number; chapters: ChapterSummaryEntry[] }[] = []
    if (volumeFiles.length > 0) {
      // 卷级聚合：扫描全部非 stale 卷文件，收集卷 frontmatter + 卷内章节条目
      for (const f of volumeFiles) {
        const raw = await ipc.invoke('memory:read', f.file) as string | null
        if (!raw) continue
        const parsed = parseMemoryFile(raw)
        const volumeNumber = Number(parsed?.frontmatter.volume ?? NaN)
        if (!Number.isFinite(volumeNumber)) continue
        const chapters = parseChapterBlocks(parsed ? parsed.body : raw)
        if (chapters.length === 0) continue
        volumes.push({ volumeNumber, range: parsed?.frontmatter.range ?? '' })
        entries.push({ volumeNumber, chapters })
      }
    } else {
      // 无分卷 → 最新章节文件（memory:list 已按 mtime 降序，取最先 = 最近写入；章节级聚合）
      const f = list.find(x => x.kind === 'chapters' && !x.stale)
      if (!f) return { success: false, file: null, reason: 'no memory files' }
      const raw = await ipc.invoke('memory:read', f.file) as string | null
      if (!raw) return { success: false, file: null, reason: 'read failed' }
      const parsed = parseMemoryFile(raw)
      const chapters = parseChapterBlocks(parsed ? parsed.body : raw)
      if (chapters.length === 0) return { success: false, file: null, reason: 'no chapter entries' }
      entries = [{ volumeNumber: 0, chapters }]
    }
    if (entries.length === 0) return { success: false, file: null, reason: 'no readable volume memory' }
    const res = await ipc.invoke('memory:write', 'book-state.md', buildBookSummaryFile(volumes, entries))
    if (!res || !res.success) return { success: false, file: null, reason: 'memory:write failed' }
    return { success: true, file: 'book-state.md' }
  } catch (e) {
    return { success: false, file: null, reason: String(e) }
  }
}

/**
 * 检查点触发：非 stale 卷文件计数，每满 CHECKPOINT_EVERY 卷触发一次全书重建。
 * 返回是否触发成功；未到检查点 / 失败均返回 false（低频重建不阻断定稿主流程）。
 */
export async function maybeTriggerBookState(): Promise<boolean> {
  try {
    const list = (await ipc.invoke('memory:list')) as MemoryFileMeta[] | null
    if (!list) return false
    const count = list.filter(f => f.kind === 'volume' && !f.stale).length
    if (count < CHECKPOINT_EVERY || count % CHECKPOINT_EVERY !== 0) return false
    const res = await rebuildBookState()
    return res.success
  } catch {
    return false
  }
}
