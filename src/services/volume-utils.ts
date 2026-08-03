/**
 * volume-utils — 分卷纯函数工具（自动划分等）
 */

export interface VolumeSplitResult {
  volumeNumber: number
  chapterStart: number
  chapterEnd: number
}

/**
 * 按卷数均分章节（余数分散到前面的卷——网文惯例：前期卷略厚，避免末尾卷过短）。
 * 示例：total=100, count=3 → [1-34, 35-67, 68-100]
 *       total=100, count=4 → [1-25, 26-50, 51-75, 76-100]
 */
export function splitChaptersIntoVolumes(totalChapters: number, volumeCount: number): VolumeSplitResult[] {
  if (totalChapters < 1 || volumeCount < 1) return []
  const count = Math.min(volumeCount, totalChapters)
  const base = Math.floor(totalChapters / count)
  const remainder = totalChapters % count

  const out: VolumeSplitResult[] = []
  let cursor = 1
  for (let i = 1; i <= count; i++) {
    const len = base + (i <= remainder ? 1 : 0)
    out.push({ volumeNumber: i, chapterStart: cursor, chapterEnd: cursor + len - 1 })
    cursor += len
  }
  return out
}

/** 卷的章节总数（进行中卷 end=0 时按总章数推断） */
export function volumeChapterCount(
  chapterStart: number,
  chapterEnd: number,
  totalChapters: number,
): number {
  const end = chapterEnd > 0 ? chapterEnd : Math.max(chapterStart, totalChapters)
  return Math.max(1, end - chapterStart + 1)
}
