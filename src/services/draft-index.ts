/**
 * 草稿元数据管理（原 index.json 封装层）
 *
 * 全量 DB 化后，这里不再读写 index.json，而是直接桥接到 db:* IPC 通道。
 * 保留原有函数名和数据接口结构，以便减少对 UI 层 (DraftEditor) 的破坏性修改。
 */
import { ipc } from './ipc-client'
import { t } from '../shared/locale'

import { useProjectStore } from '../stores/project-store'
import { computeTextStats } from './text-stats'
import type { DraftStatus } from '../shared/draft-status'

// 导入后端的类型定义
import type { DraftMeta as DB_DraftMeta } from '../../electron/repositories/draft-repository'
import type { RevisionMeta as DB_RevisionMeta } from '../../electron/repositories/revision-repository'
import type { ReviewMeta as DB_ReviewMeta } from '../../electron/repositories/review-repository'

// ===== 草稿身份与状态（URI 在使用处投影） =====
export interface DraftMeta {
  id: number
  chapterNumber: number
  version: number
  status: DraftStatus
  wordCount?: number
  createdAt: number
  updatedAt?: number
  source: 'write' | 'rewrite'
}

// ===== RevisionEntry 兼容类型 =====
export interface RevisionEntry {
  id: number
  baseDraftId: number
  baseVersion: number         // 为了 UI 需要保留关联版本号
  revisionIndex: number
  type: 'refine' | 'review-fix'
  status: 'pending' | 'merged' | 'discarded'
  createdAt: number
  mergedToDraftId?: number

  // 虚拟文件路径字段，供 UI 展示或查内容使用
  fileName: string
  baseDraft: string
}

// ===== ReviewEntry 兼容类型 =====
export interface ReviewEntry {
  id: number
  baseDraftId: number
  baseVersion: number
  reviewIndex: number
  createdAt: number

  fileName: string
  baseDraft: string
}

// ==========================================
// 辅助映射函数
// ==========================================

function mapDraftMeta(dbMeta: DB_DraftMeta): DraftMeta {
  return {
    ...dbMeta,
    status: dbMeta.status as DraftStatus,
    source: dbMeta.source as 'write' | 'rewrite',
  }
}

function mapRevisionEntry(dbMeta: DB_RevisionMeta, baseVersion: number): RevisionEntry {
  return {
    ...dbMeta,
    type: dbMeta.revisionType as 'refine' | 'review-fix',
    status: dbMeta.status as 'pending' | 'merged' | 'discarded',
    mergedToDraftId: dbMeta.mergedToDraftId ?? undefined,
    baseVersion,
    fileName: `v${baseVersion}_r${dbMeta.revisionIndex}.md`,
    baseDraft: `draft_v${baseVersion}.md`,
  }
}

function mapReviewEntry(dbMeta: DB_ReviewMeta, baseVersion: number): ReviewEntry {
  return {
    ...dbMeta,
    baseVersion,
    fileName: `v${baseVersion}_review_${dbMeta.reviewIndex}.md`,
    baseDraft: `draft_v${baseVersion}.md`,
  }
}

/** Capture before asynchronous work; never issue a follow-up IPC into another project. */
export function captureDraftProject(expectedPath?: string): () => void {
  const project = useProjectStore.getState().currentProject
  const session = useProjectStore.getState().projectSession
  if (!project || (expectedPath !== undefined && project.path !== expectedPath)) throw new Error(t('error.noProject'))
  return () => {
    const current = useProjectStore.getState().currentProject
    if (!current || current.path !== project.path || current.id !== project.id || useProjectStore.getState().projectSession !== session) throw new Error(t('error.noProject'))
  }
}

export function assertDraftWrite(result: { success: boolean; error?: string }): void {
  if (!result.success) throw new Error(result.error || t('status.unknown'))
}

function assertId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(t('error.noBaseDraft'))
}

export function draftIdFromPath(filePath: string): number {
  const match = /^vela:\/\/(?:draft|manuscript)\/(\d+)$/.exec(filePath)
  const id = match ? Number(match[1]) : NaN
  assertId(id)
  return id
}

export async function saveDraftContent(filePath: string, content: string, projectPath: string): Promise<void> {
  const assertProject = captureDraftProject(projectPath)
  const id = draftIdFromPath(filePath)
  assertDraftWrite(await ipc.invoke('db:draft-update-content', id, content, computeTextStats(content).novelWordCount))
  assertProject()
}

export async function updateDraftStatus(draftId: number, status: DraftStatus, wordCount?: number): Promise<void> {
  assertId(draftId)
  const assertProject = captureDraftProject()
  const draft = await ipc.invoke('db:draft-get-meta', draftId)
  assertProject()
  if (!draft) throw new Error(t('error.noBaseDraft'))
  assertDraftWrite(await ipc.invoke('db:draft-update-status', draftId, status, wordCount))
  assertProject()
  if (status === 'finalized') {
    const list = await ipc.invoke('db:draft-list', draft.chapterNumber)
    assertProject()
    for (const d of list) {
      // A different branch can use the same version; it must remain independent.
      if (d.id !== draftId && d.branchId === draft.branchId && (d.status === 'draft' || d.status === 'revised')) {
        assertProject()
        assertDraftWrite(await ipc.invoke('db:draft-update-status', d.id, 'archived'))
      }
    }
  }
}

export async function getNextDraftVersion(chapterNumber: number): Promise<number> {
  assertId(chapterNumber)
  return ipc.invoke('db:draft-next-version', chapterNumber)
}

export async function getDraftMeta(draftId: number): Promise<DraftMeta | null> {
  assertId(draftId)
  const dbMeta = await ipc.invoke('db:draft-get-meta', draftId)
  return dbMeta ? mapDraftMeta(dbMeta) : null
}

export async function getNextRevisionIndex(draftId: number): Promise<number> {
  assertId(draftId)
  return ipc.invoke('db:revision-next-index', draftId)
}

export async function getPendingRevisions(draftId: number, baseVersion: number): Promise<RevisionEntry[]> {
  assertId(draftId)
  const list = await ipc.invoke('db:revision-get-pending', draftId)
  return list.map(m => mapRevisionEntry(m, baseVersion))
}

export async function markRevisionMerged(revisionId: number, targetDraftId: number): Promise<void> {
  assertId(revisionId)
  assertId(targetDraftId)
  assertDraftWrite(await ipc.invoke('db:revision-mark-merged', revisionId, targetDraftId))
}

export async function getNextReviewIndex(draftId: number): Promise<number> {
  assertId(draftId)
  return ipc.invoke('db:review-next-index', draftId)
}

export async function getLatestReview(draftId: number, baseVersion: number): Promise<ReviewEntry | null> {
  assertId(draftId)
  const review = await ipc.invoke('db:review-get-latest', draftId)
  return review ? mapReviewEntry(review, baseVersion) : null
}

export async function getReviewsForVersion(draftId: number, baseVersion: number): Promise<ReviewEntry[]> {
  assertId(draftId)
  const list = await ipc.invoke('db:review-list', draftId)
  return list.map(m => mapReviewEntry(m, baseVersion)).sort((a, b) => a.reviewIndex - b.reviewIndex)
}

// ==========================================
// 被旧接口或 UI 其他地方需要兼容的方法
// ==========================================

export async function readDraftIndex() {
  // 返回空结构，因为调用者现在应该是直接查 draftsByChapter 而不是读 index
  return { chapterNumber: 0, chapterTitle: '', drafts: [], revisions: [], reviews: [] }
}

/**
 * @deprecated 已废弃，请直接通过 IPC 查询 drafts 表获取 DraftMeta。
 * 该函数将在下一主版本中移除。
 */
export function toDraftMeta(): never {
  throw new Error(t('error.draftMetaDeprecated'))
}
