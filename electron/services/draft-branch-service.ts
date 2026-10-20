/**
 * 分支编排（v21）：创建 = 快照基线 + 复制 head 成新分支 draft。
 * 合并不覆盖主线：生成新的主线 draft，分支标记 merged。
 */
import { DraftRepository } from '../repositories/draft-repository'
import { DraftBranchRepository, type DraftBranch } from '../repositories/draft-branch-repository'
import { DraftSnapshotRepository } from '../repositories/draft-snapshot-repository'

export function createDraftBranch(chapterNumber: number, name: string, baseDraftId?: number): {
  branch: DraftBranch
  draftId: number
} {
  const sourceMeta = baseDraftId
    ? DraftRepository.getMeta(baseDraftId)
    : DraftRepository.getLatestByChapter(chapterNumber, null)
  const source = sourceMeta ? DraftRepository.getFull(sourceMeta.id) : null
  if (!source) throw new Error('source-draft-not-found')
  const cleanName = name.trim()
  if (!cleanName) throw new Error('branch-name-empty')

  const branchId = DraftBranchRepository.create(chapterNumber, cleanName, null)
  const snapshotId = DraftSnapshotRepository.create({
    chapterNumber,
    draftId: source.id,
    branchId,
    label: cleanName,
    kind: 'branch-base',
    content: source.content,
    contentHash: source.contentHash,
    wordCount: source.wordCount,
    createdBy: 'user',
  })
  DraftBranchRepository.setBaseSnapshot(branchId, snapshotId)

  const version = DraftRepository.getNextVersion(chapterNumber, branchId)
  const draftId = DraftRepository.create({
    chapterNumber,
    version,
    source: 'write',
    content: source.content,
    wordCount: source.wordCount,
    branchId,
  })
  DraftBranchRepository.setHead(branchId, draftId)
  const branch = DraftBranchRepository.get(branchId)
  if (!branch) throw new Error('branch-create-failed')
  return { branch, draftId }
}

export function mergeDraftBranch(branchId: number): { branch: DraftBranch; draftId: number } {
  const branch = DraftBranchRepository.get(branchId)
  if (!branch) throw new Error('branch-not-found')
  if (branch.status !== 'active') throw new Error('branch-not-active')
  if (!branch.headDraftId) throw new Error('branch-head-missing')
  const head = DraftRepository.getFull(branch.headDraftId)
  if (!head) throw new Error('branch-head-draft-missing')

  const version = DraftRepository.getNextVersion(branch.chapterNumber, null)
  const draftId = DraftRepository.create({
    chapterNumber: branch.chapterNumber,
    version,
    source: 'rewrite',
    content: head.content,
    wordCount: head.wordCount,
    branchId: null,
  })
  DraftBranchRepository.markMerged(branchId)
  const merged = DraftBranchRepository.get(branchId)
  if (!merged) throw new Error('branch-merge-failed')
  return { branch: merged, draftId }
}
