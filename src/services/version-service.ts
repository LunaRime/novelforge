/**
 * version-service — 版本历史数据访问服务
 *
 * 封装 VersionHistory 中的所有 IPC 调用，
 * 避免组件直接与 IPC 通信。
 */

import { ipc } from './ipc-client'
import { t } from '../shared/locale'
import { computeTextStats } from './text-stats'
import type { DraftFull } from '../../electron/repositories/draft-repository'

/** 章节元数据（从数据库返回） */
export interface ChapterRecord {
  chapter_id: string
  file_path: string
  file_name: string
  updated_at: string
  chapter_number: number
  status: string
}

/** 版本记录 */
export interface VersionRecord {
  id: number
  version: number
  type: string
  word_count: number
  created_at: string
}

export interface SnapshotRecord {
  id: number
  chapterNumber: number
  draftId: number
  branchId: number | null
  label: string
  kind: string
  contentId: number
  contentHash: string
  wordCount: number
  createdBy: string
  createdAt: number
}

/** 获取项目的所有章节 (现在从蓝图获取) */
export async function getChapters(): Promise<ChapterRecord[]> {
  const blueprints = (await ipc.invoke('db:blueprint-get-all')) as unknown as Array<Record<string, unknown>>
  return blueprints.map(bp => ({
    chapter_id: String(bp.chapterNumber),
    file_path: '',
    file_name: String(bp.title || t('chapter.nLabel').replace('{n}', String(bp.chapterNumber))),
    updated_at: '',
    chapter_number: bp.chapterNumber as number,
    status: 'draft',
  }))
}

/** 获取章节的版本列表 (草稿列表) */
export async function getChapterVersions(chapterId: string): Promise<VersionRecord[]> {
  const chapterNumber = parseInt(chapterId)
  if (isNaN(chapterNumber)) return []
  const drafts = (await ipc.invoke('db:draft-list', chapterNumber)) as unknown as Array<Record<string, unknown>>
  return drafts.map(d => ({
    id: d.id as number,
    version: d.version as number,
    type: d.status === 'finalized' ? 'final' : (d.status === 'revised' ? 'refined' : 'draft'),
    word_count: (d.wordCount as number) || 0,
    created_at: String(d.createdAt),
  }))
}

/** 获取版本内容 */
export async function getVersionContent(versionId: number): Promise<string | null> {
  const draft = (await ipc.invoke('db:draft-get-full', versionId)) as { content?: string } | null
  return draft?.content || null
}

/** 获取章节最新内容（取代之前的文件读取） */
export async function getChapterLatestContent(chapterNumber: number): Promise<string> {
  const draft = await getChapterLatestDraft(chapterNumber)
  return draft?.content ?? t('version.noContent')
}

/**
 * 获取章节最新草稿（id + 内容）
 * 供工作台等场景用真实草稿 id 构造 vela://draft/{id} 路径打开
 * （parseDraftMeta 依赖纯数字 id 解析，ch{n} 格式无法解析导致保存/定稿失效）
 */
export async function getChapterLatestDraft(
  chapterNumber: number,
): Promise<{ id: number; content: string; contentHash: string; updatedAt: number; wordCount: number } | null> {
  const draft = (await ipc.invoke('db:draft-get-latest', chapterNumber)) as { id?: number } | null
  if (!draft || draft.id === undefined) return null
  const full = (await ipc.invoke('db:draft-get-full', draft.id)) as { content?: string } | null
  if (!full) return null
  const meta = await ipc.invoke('db:draft-get-latest', chapterNumber)
  return {
    id: draft.id,
    content: full.content ?? '',
    contentHash: meta?.contentHash ?? '',
    updatedAt: meta?.updatedAt ?? 0,
    wordCount: meta?.wordCount ?? 0,
  }
}

/** 回退到某个历史版本，创建新草稿 */
export async function revertToVersion(chapterNumber: number, content: string): Promise<boolean> {
  const nextVer: number = await ipc.invoke('db:draft-next-version', chapterNumber)
  const res = await ipc.invoke('db:draft-create', {
    chapterNumber,
    version: nextVer,
    source: 'rewrite',
    content,
    wordCount: computeTextStats(content).novelWordCount,
  })
  return res.success
}

/** 章节快照列表（v20） */
export async function getChapterSnapshots(chapterNumber: number, limit = 100): Promise<SnapshotRecord[]> {
  return (await ipc.invoke('db:draft-snapshot-list', chapterNumber, limit)) as SnapshotRecord[]
}

/** 创建快照（手动/外部入口） */
export async function createChapterSnapshot(params: {
  chapterNumber: number
  draftId: number
  label?: string
  kind: 'auto' | 'manual' | 'pre-agent' | 'pre-restore' | 'branch-base'
  content: string
  contentHash: string
  wordCount: number
  createdBy: 'user' | 'agent' | 'system'
}): Promise<boolean> {
  const res = await ipc.invoke('db:draft-snapshot-create', params)
  return res.success
}

/** 快照正文 */
export async function getSnapshotContent(id: number): Promise<string | null> {
  const snap = await ipc.invoke('db:draft-snapshot-get-full', id)
  return snap?.content ?? null
}

export interface DraftBranchRecord {
  id: number
  chapterNumber: number
  name: string
  status: 'active' | 'merged' | 'archived'
  baseSnapshotId: number | null
  headDraftId: number | null
  createdAt: number
  updatedAt: number
  mergedAt: number | null
}

export async function getDraftBranches(chapterNumber: number): Promise<DraftBranchRecord[]> {
  return (await ipc.invoke('db:draft-branch-list', chapterNumber)) as DraftBranchRecord[]
}

export async function createDraftBranch(chapterNumber: number, name: string, baseDraftId?: number): Promise<{ branch: DraftBranchRecord; draftId: number } | null> {
  const res = await ipc.invoke('db:draft-branch-create', chapterNumber, name, baseDraftId)
  if (!res.success || !res.branch || !res.draftId) return null
  return { branch: res.branch as DraftBranchRecord, draftId: res.draftId }
}

export async function mergeDraftBranch(branchId: number): Promise<{ branch: DraftBranchRecord; draftId: number } | null> {
  const res = await ipc.invoke('db:draft-branch-merge', branchId)
  if (!res.success || !res.branch || !res.draftId) return null
  return { branch: res.branch as DraftBranchRecord, draftId: res.draftId }
}

export async function archiveDraftBranch(branchId: number): Promise<boolean> {
  return (await ipc.invoke('db:draft-branch-archive', branchId)).success
}

export async function getDraftFullById(id: number): Promise<DraftFull | null> {
  return await ipc.invoke('db:draft-get-full', id)
}
