import { saveDraftRevision, saveDraftReview, type DraftRevisionWrite, type DraftReviewWrite } from '../../core'
import { t } from '../../shared/locale'
import { assertDraftWrite } from '../draft-index'
import { ipc } from '../ipc-client'

function requireFeedbackId(result: { success: boolean; error?: string; id?: number }): number {
  assertDraftWrite(result)
  if (!result.id) throw new Error(t('error.noBaseDraft'))
  return result.id
}

export function persistWorkflowRevision(input: Omit<DraftRevisionWrite, 'revisionIndex'>, assertCurrent: () => void) {
  return saveDraftRevision(input, {
    assertCurrent,
    nextIndex: id => ipc.invoke('db:revision-next-index', id),
    pending: id => ipc.invoke('db:revision-get-pending', id),
    create: async revision => requireFeedbackId(await ipc.invoke('db:revision-create', revision)),
    discard: async id => assertDraftWrite(await ipc.invoke('db:revision-mark-discarded', id)),
  })
}

export function persistWorkflowReview(input: Omit<DraftReviewWrite, 'reviewIndex'>, assertCurrent: () => void) {
  return saveDraftReview(input, {
    assertCurrent,
    nextIndex: id => ipc.invoke('db:review-next-index', id),
    create: async review => requireFeedbackId(await ipc.invoke('db:review-create', review)),
  })
}
