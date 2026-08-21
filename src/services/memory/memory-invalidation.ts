import { computeMemoryFileRange } from './chapter-memory'
import { ipc } from '../ipc-client'

export type InvalidationReason = 'finalize' | 'chapter-add' | 'volume-change'

export interface AffectedFile { file: string; reason: InvalidationReason }

/**
 * 失效规则（设计 §5.2，审阅修正 + reviewer F1 diff 修正）：
 * - 卷成员变更（volume-store upsert/delete 钩子调用）→ **diff 式失效**：受影响章节区间
 *   = 变更卷旧范围 ∪ 新范围（进行中卷 chapterEnd=0 取 start..start+30 保守上限），区间内
 *   每章在变更前后卷列表下的记忆文件收集去重——防单侧边界编辑/进行中卷漏标（欠失效）
 * - 重定稿旧章 → 不在此处处理：chapter_memory DAG 步骤内 upsert 覆盖即恢复非 stale（stale 闭环）
 * - 章节插入/删除在 NovelForge 无独立操作（新建=追加、修改=重定稿）——由重定稿规则覆盖，文档化
 *
 * 注：affectedFiles（双窗口）为保守单点入口，保留导出；卷编辑钩子走 collectAffectedFiles diff 路径。
 */
export function affectedFiles(
  chapterNumber: number,
  volumes: { volumeNumber: number; chapterStart: number; chapterEnd: number }[],
): AffectedFile[] {
  const { file } = computeMemoryFileRange(chapterNumber, volumes)
  const out: AffectedFile[] = [{ file, reason: 'volume-change' }]
  // 相邻窗口起始（审阅修正公式：第 15 章 → 16，第 30 章 → 31）
  const nextStart = Math.floor((chapterNumber - 1) / 15) * 15 + 16
  const next = computeMemoryFileRange(nextStart, volumes)
  if (next.file !== file) out.push({ file: next.file, reason: 'volume-change' })
  return out
}

/**
 * diff 式失效区间（reviewer F1）：对 [start, end] 内每章，收集其在变更前后卷列表下的
 * 记忆文件并去重。纯函数无 IPC，几十章计算开销可忽略。
 * F4：受影响区间重叠的卷的 volume-NNN.md 一并失效——卷边界编辑后旧聚合文件保持非 stale
 * 会被 M2 注入（卷成员已变、聚合内容过期）。进行中卷（chapterEnd=0）按 start..start+30
 * 保守上限判定重叠（与 volume-store 钩子同口径）。
 */
export function collectAffectedFiles(
  oldVolumes: { volumeNumber: number; chapterStart: number; chapterEnd: number }[],
  newVolumes: { volumeNumber: number; chapterStart: number; chapterEnd: number }[],
  start: number,
  end: number,
): string[] {
  const files = new Set<string>()
  for (let n = start; n <= end; n++) {
    files.add(computeMemoryFileRange(n, oldVolumes).file)
    files.add(computeMemoryFileRange(n, newVolumes).file)
  }
  for (const v of [...oldVolumes, ...newVolumes]) {
    const vStart = v.chapterStart
    const vEnd = v.chapterEnd === 0 ? v.chapterStart + 30 : v.chapterEnd
    if (vEnd >= start && vStart <= end) {
      files.add(`volume-${String(v.volumeNumber).padStart(3, '0')}.md`)
    }
  }
  return [...files]
}

/** 批量失效：read → markStale → write（返回成功数；统一走 ipc-client——30s 超时 + 类型推导 + 浏览器模式优雅降级） */
export async function invalidateMemoryFiles(files: string[]): Promise<number> {
  let ok = 0
  for (const file of files) {
    const res = await ipc.invoke('memory:mark-stale', file)
    if (res.success) ok++
  }
  return ok
}
