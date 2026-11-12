import { expect, it } from 'vitest'
import {
  commitDraftContent, commitDraftFinalization, commitRevisionMerge, createDraftEditorApplication,
  openEditorDocument, saveDraftReview, saveDraftRevision, startWorkflow,
  type DraftWritePort, type DraftWriteSnapshot, type DraftRevisionWrite, type DraftReviewWrite,
  type EditorDraftIdentity, type EditorOpenPort, type OpenedEditorDocument,
  type RevisionMergePort, type WorkflowStartPort,
} from '../index'

const draftPath = 'vela://draft/41'
const project = { path: '/book', session: 1 }
const manuscript = { id: 41, chapterNumber: 3, version: 2, branchId: 1, status: 'draft',
  content: 'Initial body', contentHash: 'Initial body', updatedAt: 1, wordCount: 2 }
type Draft = DraftWriteSnapshot & EditorDraftIdentity
type Revision = DraftRevisionWrite & { id: number; status: string; mergedTo?: number }
type Review = DraftReviewWrite & { id: number }

function fixture() {
  let drafts = new Map<number, Draft>([
    [41, { ...manuscript }],
    [42, { ...manuscript, id: 42, branchId: 2, content: 'Other branch' }],
  ])
  let revisions = new Map<number, Revision>()
  const reviews = new Map<number, Review>()
  let snapshots: string[] = []
  let rejectMerge = false
  const opened: OpenedEditorDocument[] = []
  const transactions = <T>(work: () => T): T => {
    const before = structuredClone({ drafts, revisions, snapshots })
    try { return work() }
    catch (error) { ({ drafts, revisions, snapshots } = before); throw error }
  }
  const updateDraft = (id: number, patch: Partial<Draft>) => drafts.set(id, { ...drafts.get(id)!, ...patch })
  const draftWrite: DraftWritePort = {
    atomic: transactions,
    read: id => drafts.get(id) ?? null,
    snapshot: draft => { snapshots.push(draft.content) },
    replace: (input, before) => {
      updateDraft(input.draftId, {
        content: input.content, contentHash: input.content, updatedAt: before.updatedAt + 1, wordCount: input.wordCount,
      })
      return { success: true }
    },
  }
  const mergePort: RevisionMergePort = {
    atomic: transactions,
    draft: draftWrite.read,
    revision: id => revisions.get(id) ?? null,
    write: (input, before) => commitDraftContent({
      draftId: input.draftId, content: input.content, wordCount: input.wordCount, actor: 'user',
      expectedHash: before.contentHash, expectedUpdatedAt: before.updatedAt,
    }, draftWrite),
    reviseDraft: (id, wordCount) => { updateDraft(id, { status: 'revised', wordCount }); return true },
    mergeRevision: (id, target) => {
      if (rejectMerge) return false
      revisions.set(id, { ...revisions.get(id)!, status: 'merged', mergedTo: target })
      return true
    },
  }
  const finalize = (content: string) => commitDraftFinalization({
    draftId: 41, chapterNumber: 3, expectedContent: content, wordCount: 4,
  }, {
    atomic: transactions, read: draftWrite.read,
    markFinalized: (id, wordCount) => { updateDraft(id, { status: 'finalized', wordCount }); return true },
  })

  const pending = async (id: number) => [...revisions.values()].filter(row => row.baseDraftId === id && row.status === 'pending')
  const unsupported = async (): Promise<never> => { throw new Error('Unexpected workflow') }
  const runs = new Map<string, Promise<void>>()
  const workflowPort: WorkflowStartPort<() => Promise<void>> = {
    async chapter(kind, chapterNumber, draft) {
      if (!draft || draft.draftPath !== draftPath || chapterNumber !== 3) throw new Error('Unexpected draft')
      return {
        displayName: kind,
        definition: async () => {
          if (kind === 'refine') {
            await saveDraftRevision({
              baseDraftId: 41, revisionType: 'refine', wordCount: 4, content: `${draft.draftContent} refined`,
            }, {
              assertCurrent() {},
              nextIndex: async () => revisions.size + 1,
              pending,
              create: async input => { revisions.set(51, { ...input, id: 51, status: 'pending' }); return 51 },
              discard: async id => { revisions.set(id, { ...revisions.get(id)!, status: 'discarded' }) },
            })
          } else if (kind === 'review') {
            await saveDraftReview({ baseDraftId: 41, content: `Reviewed: ${draft.draftContent}` }, {
              assertCurrent() {},
              nextIndex: async () => reviews.size + 1,
              create: async input => { reviews.set(61, { ...input, id: 61 }); return 61 },
            })
          } else if (kind === 'finalize') {
            const result = finalize(draft.draftContent)
            if (!result.success) throw new Error(result.error)
          } else await unsupported()
        },
      }
    },
    async start(definition) {
      const id = String(runs.size + 1)
      runs.set(id, Promise.resolve().then(definition))
      return id
    },
    repair: unsupported, write: unsupported, importNovel: unsupported, configField: unsupported,
    extractCharacters: unsupported, repairCharacters: unsupported, blueprint: unsupported, fillGaps: unsupported,
    architecture: unsupported, book: unsupported, config: unsupported,
  }
  const opening: EditorOpenPort = {
    scope: () => ({ projectId: 'book', projectPath: project.path, session: project.session }),
    async resolve(request) {
      if (request.kind !== 'draft') return null
      const draft = drafts.get(request.draftId)
      return draft ? { id: `doc:${draft.id}`, docId: draft.id, locator: `vela://draft/${draft.id}`,
        kind: 'chapter', name: request.name, content: draft.content } : null
    },
    publish: document => { opened.push(document) },
  }
  const draftId = (path: string) => Number(path.split('/').at(-1))
  const editor = createDraftEditorApplication({
    project: () => project, errors: { changed: 'scope changed', create: 'create failed', empty: 'empty' },
    metadata: async path => drafts.get(draftId(path)) ?? null,
    title: async () => 'Rain',
    pending,
    reviewCount: async id => [...reviews.values()].filter(row => row.baseDraftId === id).length,
    read: async path => {
      const id = draftId(path)
      if (path.startsWith('vela://review/')) return reviews.get(id)!.content
      if (path.startsWith('vela://revision/')) return revisions.get(id)!.content
      return drafts.get(id)!.content
    },
    write: async (path, content) => {
      const result = commitDraftContent({ draftId: draftId(path), content, wordCount: 2, actor: 'user' }, draftWrite)
      if (!result.success) throw new Error(result.error)
    },
    refresh() {},
    start: request => startWorkflow(request, workflowPort),
    repairGuard: unsupported,
    merge: async (chapterNumber, path, revisionPath, content, expectedContent) => commitRevisionMerge({
      draftId: draftId(path), revisionId: draftId(revisionPath), chapterNumber,
      content, expectedContent: expectedContent!, projectPath: project.path, wordCount: 4,
    }, mergePort),
    latestReview: async id => [...reviews.values()].find(row => row.baseDraftId === id) ?? null,
    translate: unsupported, nextVersion: unsupported, createTranslation: unsupported,
  })
  const workflow = async (kind: 'refine' | 'review' | 'finalize') => {
    const receipt = await editor.workflow(kind, draftPath, manuscript, 'Rain') as { runId: string }
    await runs.get(receipt.runId)
  }
  return { editor, opening, opened, workflow, finalize, draftWrite, draft: (id: number) => drafts.get(id)!,
    revision: () => revisions.get(51), rejectMerge: () => { rejectMerge = true } }
}

it('opens, edits, saves, refines, merges, reviews and finalizes the same saved draft without UI', async () => {
  const f = fixture()
  await expect(openEditorDocument({ kind: 'draft', draftId: 41, name: 'Rain' }, f.opening)).resolves.toMatchObject({ status: 'opened' })
  expect(f.opened[0]).toMatchObject({ docId: 41, locator: draftPath, content: 'Initial body' })
  await f.editor.save(draftPath, 'Edited body')
  await f.workflow('refine')
  expect(f.draft(41).content).toBe('Edited body')
  const proposal = await f.editor.revision(draftPath, 'vela://revision/51')
  expect(proposal).toMatchObject({ originalContent: 'Edited body', modifiedContent: 'Edited body refined' })
  await expect(f.editor.merge(manuscript, draftPath, proposal.revisionPath, proposal.modifiedContent, proposal.originalContent))
    .resolves.toMatchObject({ success: true, pending: [] })
  expect(f.revision()).toMatchObject({ status: 'merged', baseDraftId: 41, mergedTo: 41 })
  await expect(f.editor.merge(manuscript, draftPath, proposal.revisionPath, 'Repeated', 'Edited body refined'))
    .resolves.toMatchObject({ success: false, error: 'revision-not-pending' })
  await f.workflow('review')
  await expect(f.editor.review(manuscript)).resolves.toEqual({ id: 61, content: 'Reviewed: Edited body refined' })
  await expect(f.editor.load(draftPath)).resolves.toMatchObject({ meta: { id: 41, status: 'revised' }, reviewCount: 1 })
  await f.workflow('finalize')
  expect(f.draft(41)).toMatchObject({ status: 'finalized', content: 'Edited body refined' })
  expect(f.draft(42)).toMatchObject({ status: 'draft', content: 'Other branch' })
  await expect(f.editor.save(draftPath, 'Late edit')).rejects.toThrow('draft-finalized-readonly')
  expect(f.finalize('Edited body refined')).toEqual({ success: true, alreadyFinalized: true })
  expect(f.draft(41).content).toBe('Edited body refined')
})

it('protects newer text and rolls back a merge rejected after replacing the body', async () => {
  const f = fixture()
  await f.workflow('refine')
  const preview = await f.editor.revision(draftPath, 'vela://revision/51')
  await f.editor.save(draftPath, 'Newer text')
  await expect(f.editor.merge(manuscript, draftPath, preview.revisionPath, preview.modifiedContent, preview.originalContent))
    .resolves.toMatchObject({ success: false, conflict: true })
  expect(f.finalize(preview.originalContent)).toMatchObject({ success: false, conflict: true })
  f.rejectMerge()
  await expect(f.editor.merge(manuscript, draftPath, preview.revisionPath, preview.modifiedContent, 'Newer text'))
    .resolves.toMatchObject({ success: false, error: 'revision-mark-merged-failed' })
  expect(f.draft(41)).toMatchObject({ content: 'Newer text', status: 'draft', updatedAt: 2 })
  expect(f.revision()?.status).toBe('pending')
})
