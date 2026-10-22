/**
 * 空白章节创建 — 写作优先入口的最小服务层。
 *
 * 不经过 AI：有草稿则直接打开已有版本；没有草稿则补一条最小蓝图 + v1 空草稿。
 * 蓝图只是为了让章节在蓝图/分卷里可寻址；正文仍由用户在 DraftEditor 里手写。
 */
import { ipc } from './ipc-client'
import { t } from '../shared/locale'
import { globalEventBus } from '../shared/event-bus'
import type { BlueprintData } from '../../electron/repositories/blueprint-repository'

export interface BlankChapterRequest {
  chapterNumber: number
  title?: string
}

export type BlankChapterResult =
  | { kind: 'created'; chapterNumber: number; draftId: number; version: number; title: string }
  | { kind: 'existing'; chapterNumber: number; draftId: number; version: number; title: string }

interface DraftListRow {
  id: number
  version: number
  status: string
}

export async function createBlankChapter(request: BlankChapterRequest): Promise<BlankChapterResult> {
  const chapterNumber = request.chapterNumber
  if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
    throw new Error('invalid chapter number')
  }

  const title = request.title?.trim() ?? ''

  const drafts = await ipc.invoke('db:draft-list', chapterNumber) as DraftListRow[]
  const existing = drafts
    .filter(d => d.status !== 'archived')
    .sort((a, b) => b.version - a.version)[0]
  if (existing) {
    return { kind: 'existing', chapterNumber, draftId: existing.id, version: existing.version, title: '' }
  }

  const blueprint = await ipc.invoke('db:blueprint-get', chapterNumber)
  if (!blueprint) {
    const data: BlueprintData = {
      chapterNumber,
      title: title || t('chapter.label').replace('{n}', String(chapterNumber)),
      role: '发展',
      purpose: '',
      keyEvents: '',
      characters: [],
      suspenseHook: '',
      userGuidance: '',
      notes: '',
      notesUpdatedAt: '',
      sortOrder: chapterNumber,
      priority: 1,
      volumeNumber: null,
    }
    const saved = await ipc.invoke('db:blueprint-upsert', data)
    if (!saved.success) throw new Error(saved.error ?? 'blueprint upsert failed')
  }

  const created = await ipc.invoke('db:draft-create', {
    chapterNumber,
    version: 1,
    source: 'write',
    content: '',
    wordCount: 0,
  })
  if (!created.success || !created.id) throw new Error(created.error ?? 'draft create failed')

  globalEventBus.emit('REFRESH_RESOURCE', { resources: ['drafts', 'blueprints'] })

  return {
    kind: 'created',
    chapterNumber,
    draftId: created.id,
    version: 1,
    title: title || t('chapter.label').replace('{n}', String(chapterNumber)),
  }
}