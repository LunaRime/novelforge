/**
 * 自动快照节流（主进程侧）。
 *
 * 自动保存每 30s 一次，不能每次都建快照。规则：
 * - 内容 hash 与最近快照不同；
 * - 距 last_auto_snapshot_at >= AUTO_SNAPSHOT_MIN_INTERVAL_MS（默认 5 分钟）。
 */
import { DraftRepository } from '../repositories/draft-repository'
import { DraftSnapshotRepository } from '../repositories/draft-snapshot-repository'

export const AUTO_SNAPSHOT_MIN_INTERVAL_MS = 5 * 60 * 1000
export const AUTO_SNAPSHOT_KEEP = 50

export function maybeCreateAutoSnapshot(draftId: number): number | null {
  const meta = DraftRepository.getMeta(draftId)
  if (!meta) return null
  const now = Date.now()
  if (meta.lastAutoSnapshotAt > 0 && now - meta.lastAutoSnapshotAt < AUTO_SNAPSHOT_MIN_INTERVAL_MS) return null

  const full = DraftRepository.getFull(draftId)
  if (!full) return null
  const recent = DraftSnapshotRepository.listByChapter(meta.chapterNumber, 20)
  if (recent[0]?.contentHash === full.contentHash) return null

  const id = DraftSnapshotRepository.create({
    chapterNumber: meta.chapterNumber,
    draftId,
    label: '',
    kind: 'auto',
    content: full.content,
    contentHash: full.contentHash,
    wordCount: full.wordCount,
    createdBy: 'system',
  })
  DraftRepository.touchAutoSnapshotAt(draftId, now)
  try { DraftSnapshotRepository.pruneAuto(meta.chapterNumber, AUTO_SNAPSHOT_KEEP) } catch { /* 清理失败不阻断保存 */ }
  return id
}
