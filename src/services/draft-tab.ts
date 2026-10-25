import { t } from '../shared/locale'
import type { EditorTab } from '../stores/editor-store'
import { VELA } from './vela-protocol'

export interface DraftTabInput {
  draftId: number
  chapterNumber: number
  chapterTitle?: string
  version: number
  content: string
}

/** 统一构造草稿 Tab：id/filePath 必须带真实 draft id，chapterNumber 供版本刷新定位 */
export function buildDraftTab(input: DraftTabInput): EditorTab {
  const chLabel = t('chapter.label').replace('{n}', String(input.chapterNumber))
  const rawTitle = input.chapterTitle?.trim() ?? ''
  const titlePart = rawTitle
    ? (rawTitle.startsWith(chLabel) ? rawTitle.slice(chLabel.length).trimStart() : rawTitle)
    : ''
  const name = `${chLabel}${titlePart ? ` ${titlePart}` : ''} v${input.version}`
  const filePath = `${VELA.DRAFT}${input.draftId}`

  return {
    id: filePath,
    name,
    type: 'chapter',
    filePath,
    content: input.content,
    chapterNumber: input.chapterNumber,
  }
}