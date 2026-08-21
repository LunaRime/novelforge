import { computeMemoryFileRange } from './chapter-memory'

export type InvalidationReason = 'finalize' | 'chapter-add' | 'volume-change'

export interface AffectedFile { file: string; reason: InvalidationReason }

/**
 * 失效规则（设计 §5.2，审阅修正）：
 * - 卷成员变更（VolumeDialog upsert/delete 钩子调用）→ 受影响区间 = 变更卷起始窗口 + 相邻滚动窗口 stale
 * - 重定稿旧章 → 不在此处处理：chapter_memory DAG 步骤内 upsert 覆盖即恢复非 stale（stale 闭环）
 * - 章节插入/删除在 NovelForge 无独立操作（新建=追加、修改=重定稿）——由重定稿规则覆盖，文档化
 * 保守策略：双窗口失效（变更卷起始窗口 + 下一滚动窗口），防边界漂移遗漏。
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

/** 批量失效：read → markStale → write（返回成功数） */
export async function invalidateMemoryFiles(files: string[]): Promise<number> {
  let ok = 0
  for (const file of files) {
    const res = await (window as unknown as { velaAPI: { invoke: (ch: string, ...a: unknown[]) => Promise<unknown> } }).velaAPI.invoke('memory:mark-stale', file)
    if ((res as { success: boolean }).success) ok++
  }
  return ok
}
